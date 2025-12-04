use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::Transfer;
use crate::{
    error::GameError,
    helpers::add_to_inventory,
    state::{
        GameEngine, ShopConfigAccount, FlashSaleAccount, FlashSaleStatus,
        ShopItemAccount, BundleAccount, PlayerAccount,
        unlock_extension_if_eligible, require_extension, EXT_HEROES, EXT_INVENTORY,
    },
    validation::{require_signer, require_writable, require_key_match},
    logic::safe_math::apply_bp_penalty,
};

/// Purchase from a flash sale
///
/// Flash sales have limited stock and time. Applies flash sale discount
/// plus subscription tier discount.
///
/// # Accounts
/// - [signer, writable] buyer: The player buying
/// - [writable] player: PlayerAccount
/// - [] game_engine: GameEngine (for treasury)
/// - [] shop_config: ShopConfigAccount
/// - [writable] flash_sale: FlashSaleAccount
/// - [] item_or_bundle: ShopItemAccount or BundleAccount (for price/fulfillment)
/// - [writable] treasury: SOL treasury wallet
/// - [writable] inventory: PlayerInventoryAccount (auto-created if needed)
/// - [] system_program: System program
///
/// # Instruction Data
/// - sale_id: u64
/// - quantity: u16 (usually 1 for flash sales)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        buyer,
        player_account,
        game_engine_account,
        shop_config_account,
        flash_sale_account,
        item_or_bundle_account,
        treasury,
        inventory_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(player_account)?;
    require_writable(flash_sale_account)?;
    require_writable(treasury)?;
    require_writable(inventory_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let sale_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let quantity = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap()) as u64;

    if quantity == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load and Validate Game Engine / Treasury

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if treasury.key() != &game_engine.treasury_wallet {
        return Err(GameError::InvalidTreasury.into());
    }

    if game_engine.paused {
        return Err(GameError::GamePaused.into());
    }

    // 5. Load Shop Config

    let shop_config_data_ref = shop_config_account.try_borrow_data()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data_ref) };

    // 6. Load and Validate Flash Sale

    let (expected_pda, _) = FlashSaleAccount::derive_pda(game_engine_account.key(), sale_id);
    if flash_sale_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let mut flash_sale_data_ref = flash_sale_account.try_borrow_mut_data()?;
    let flash_sale = unsafe { FlashSaleAccount::load_mut(&mut flash_sale_data_ref) };

    // Check timing
    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    // Update status based on time if needed
    if flash_sale.status == FlashSaleStatus::Announced as u8 && now >= flash_sale.starts_at {
        flash_sale.status = FlashSaleStatus::Active as u8;
    }
    if now > flash_sale.ends_at && flash_sale.status != FlashSaleStatus::SoldOut as u8 {
        flash_sale.status = FlashSaleStatus::Ended as u8;
    }

    // Must be active
    if flash_sale.status != FlashSaleStatus::Active as u8 {
        return Err(GameError::SaleNotActive.into());
    }

    // Check stock
    if flash_sale.remaining_stock < quantity {
        return Err(GameError::SaleSoldOut.into());
    }

    // 7. Read Player for Validation and Discount Calculation

    let (fib_discount_bps, sub_discount_bps, milestone_discount_bps, streak_discount_bps) = {
        let player_data_ref = player_account.try_borrow_data()?;
        let player = unsafe { PlayerAccount::load(&player_data_ref) };

        if player.owner != *buyer.key() {
            return Err(GameError::NotOwner.into());
        }

        // PREREQUISITE: Require EXT_HEROES to be unlocked before shopping
        require_extension(player, EXT_HEROES)?;

        // Get effective subscription tier (handles expiration)
        let effective_tier = player.get_effective_tier(now);

        (
            calculate_fib_bonus(player.daily_purchase_count, shop_config),
            calculate_subscription_discount(effective_tier),
            calculate_milestone_discount(player.total_shop_spent, shop_config),
            calculate_streak_discount(player.loyalty_streak, shop_config),
        )
    };

    // 8. Get Base Price and Item Info

    let (base_price, item_type, items_per_purchase) = if flash_sale.is_bundle {
        // Load bundle
        let (expected_bundle, _) = BundleAccount::derive_pda(
            game_engine_account.key(),
            flash_sale.item_id,
        );
        if item_or_bundle_account.key() != &expected_bundle {
            return Err(GameError::InvalidAccount.into());
        }

        let bundle_data_ref = item_or_bundle_account.try_borrow_data()?;
        let bundle = unsafe { BundleAccount::load(&bundle_data_ref) };

        // Use SOL price for bundles in flash sales
        (bundle.price_sol_lamports, 0u16, 1u64) // Bundle handled separately
    } else {
        // Load shop item
        let (expected_item, _) = ShopItemAccount::derive_pda(
            game_engine_account.key(),
            flash_sale.item_id,
        );
        if item_or_bundle_account.key() != &expected_item {
            return Err(GameError::InvalidAccount.into());
        }

        let item_data_ref = item_or_bundle_account.try_borrow_data()?;
        let item = unsafe { ShopItemAccount::load(&item_data_ref) };

        if !item.is_active {
            return Err(GameError::ItemNotAvailable.into());
        }

        (item.price_sol_lamports, item.item_type, item.quantity_per_purchase as u64)
    };

    if base_price == 0 {
        return Err(GameError::PaymentTypeNotSupported.into());
    }

    // 9. Calculate Final Price with Full Discount Stack

    let total_base = base_price.saturating_mul(quantity);
    let flash_discount_bps = flash_sale.discount_bps;

    let final_price = calculate_final_price(
        total_base,
        flash_discount_bps,  // base discount (flash sale discount)
        0,                   // bundle discount (not applicable)
        fib_discount_bps,
        sub_discount_bps,
        milestone_discount_bps,
        streak_discount_bps,
        shop_config.max_total_discount_bps,
    );

    // 10. Process SOL Payment

    Transfer {
        from: buyer,
        to: treasury,
        lamports: final_price,
    }.invoke()?;

    // 11. Fulfill Items

    let is_inventory = !flash_sale.is_bundle && is_inventory_item_type(item_type);
    let total_items = items_per_purchase.saturating_mul(quantity);

    if flash_sale.is_bundle {
        // For bundles in flash sales, we'd need to load each item
        // Simplified: just acknowledge the bundle purchase
        // Full implementation would iterate bundle.items
    } else if is_inventory {
        // Items that go to inventory (armor, cosmetics, event items)
        for _ in 0..total_items {
            add_to_inventory(
                _program_id,
                buyer,
                buyer.key(),
                inventory_account,
                system_program,
                item_type,
                1,
                0, // rarity - shop items don't have rarity
                flash_sale.item_id,
                now as u32,
            )?;
        }
    } else {
        // Items that go directly to PlayerAccount fields
        let mut player_data_ref = player_account.try_borrow_mut_data()?;
        let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };
        fulfill_item(player, item_type, total_items)?;
    }

    // 12. Update Flash Sale Stats

    flash_sale.remaining_stock = flash_sale.remaining_stock.saturating_sub(quantity);
    flash_sale.total_claims = flash_sale.total_claims.saturating_add(quantity);
    flash_sale.total_revenue_lamports = flash_sale.total_revenue_lamports.saturating_add(final_price);

    if flash_sale.remaining_stock == 0 {
        flash_sale.status = FlashSaleStatus::SoldOut as u8;
    }

    // 13. Update Player Shop State

    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Unlock EXT_INVENTORY extension if not already unlocked
    unlock_extension_if_eligible(player_account, buyer, player, EXT_INVENTORY)?;

    update_player_shop_state(player, final_price, now, shop_config);

    Ok(())
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/// Check if item type goes to inventory (armor, cosmetics, event items)
fn is_inventory_item_type(item_type: u16) -> bool {
    matches!(item_type, 3 | 300..=399 | 1000..)
}

/// Update player shop state after purchase
fn update_player_shop_state(
    player: &mut PlayerAccount,
    final_price: u64,
    now: i64,
    shop_config: &ShopConfigAccount,
) {
    // Track total spending (SOL only for milestone tracking)
    player.total_shop_spent = player.total_shop_spent.saturating_add(final_price);

    // Update milestone tier if threshold reached
    player.milestone_tier = calculate_milestone_tier(player.total_shop_spent, shop_config);

    // Calculate current day for streak tracking
    let current_day = (now / 86400) as u32;

    // Update loyalty streak
    if player.last_purchase_day == 0 {
        // First purchase ever
        player.loyalty_streak = 1;
    } else if current_day == player.last_purchase_day + 1 {
        // Consecutive day purchase
        player.loyalty_streak = player.loyalty_streak.saturating_add(1).min(7);
    } else if current_day > player.last_purchase_day + 1 {
        // Streak broken
        player.loyalty_streak = 1;
    }
    // Same day purchase doesn't change streak

    // Reset daily counters if new day
    if current_day != player.last_purchase_day {
        player.daily_purchase_count = 0;
        player.flash_claims_today = 0;
    }

    // Update daily tracking
    player.daily_purchase_count = player.daily_purchase_count.saturating_add(1);
    player.flash_claims_today = player.flash_claims_today.saturating_add(1);
    player.last_purchase_day = current_day;
    player.last_daily_reset = now;
}

fn calculate_subscription_discount(tier: u8) -> u16 {
    match tier {
        0 => 0,
        1 => 500,   // 5%
        2 => 1000,  // 10%
        3 => 1500,  // 15%
        4 => 2500,  // 25%
        _ => 0,
    }
}

fn calculate_milestone_discount(total_spent: u64, config: &ShopConfigAccount) -> u16 {
    if total_spent >= config.diamond_threshold {
        config.diamond_discount_bps
    } else if total_spent >= config.platinum_threshold {
        config.platinum_discount_bps
    } else if total_spent >= config.gold_threshold {
        config.gold_discount_bps
    } else if total_spent >= config.silver_threshold {
        config.silver_discount_bps
    } else if total_spent >= config.bronze_threshold {
        config.bronze_discount_bps
    } else {
        0
    }
}

fn calculate_milestone_tier(total_spent: u64, config: &ShopConfigAccount) -> u8 {
    if total_spent >= config.diamond_threshold {
        5 // Diamond
    } else if total_spent >= config.platinum_threshold {
        4 // Platinum
    } else if total_spent >= config.gold_threshold {
        3 // Gold
    } else if total_spent >= config.silver_threshold {
        2 // Silver
    } else if total_spent >= config.bronze_threshold {
        1 // Bronze
    } else {
        0 // None
    }
}

fn calculate_streak_discount(streak: u8, config: &ShopConfigAccount) -> u16 {
    match streak {
        7.. => config.streak_day_7_bps,
        5..=6 => config.streak_day_5_bps,
        3..=4 => config.streak_day_3_bps,
        2 => config.streak_day_2_bps,
        _ => 0,
    }
}

fn calculate_fib_bonus(daily_purchase_count: u8, config: &ShopConfigAccount) -> u16 {
    // Fibonacci bonus for multiple purchases per day
    let base_bonus = match daily_purchase_count {
        0 | 1 => 0,
        2 => 100,   // 1%
        3 => 200,   // 2%
        4 => 300,   // 3% (1+2)
        5 => 500,   // 5% (2+3)
        6.. => 800, // 8% (3+5) - capped
    };
    base_bonus.min(config.max_fib_discount_bps)
}

fn calculate_final_price(
    base_price: u64,
    base_discount_bps: u16,
    bundle_discount_bps: u16,
    fib_discount_bps: u16,
    sub_discount_bps: u16,
    milestone_discount_bps: u16,
    loyalty_discount_bps: u16,
    max_total_discount_bps: u16,
) -> u64 {
    // Multiplicative stacking with checked math
    let mut price = base_price;

    // Layer 1: Base discount (flash sale discount)
    price = apply_bp_penalty(price, base_discount_bps).unwrap_or(price);

    // Layer 2: Bundle discount
    price = apply_bp_penalty(price, bundle_discount_bps).unwrap_or(price);

    // Layer 3: Fibonacci bonus
    price = apply_bp_penalty(price, fib_discount_bps).unwrap_or(price);

    // Layer 4: Subscription
    price = apply_bp_penalty(price, sub_discount_bps).unwrap_or(price);

    // Layer 5: Milestone
    price = apply_bp_penalty(price, milestone_discount_bps).unwrap_or(price);

    // Layer 6: Loyalty streak
    price = apply_bp_penalty(price, loyalty_discount_bps).unwrap_or(price);

    // Enforce max discount
    let min_price = apply_bp_penalty(base_price, max_total_discount_bps).unwrap_or(0);
    price.max(min_price).max(1)
}

fn fulfill_item(player: &mut PlayerAccount, item_type: u16, amount: u64) -> ProgramResult {
    let amount_u16 = amount.min(u16::MAX as u64) as u16;
    let amount_u32 = amount.min(u32::MAX as u64) as u32;

    match item_type {
        // Equipment - Weapons by type
        0 => player.melee_weapons = player.melee_weapons.saturating_add(amount),
        1 => player.ranged_weapons = player.ranged_weapons.saturating_add(amount),
        2 => player.siege_weapons = player.siege_weapons.saturating_add(amount),
        3 => player.armor_pieces = player.armor_pieces.saturating_add(amount),
        4 => player.vehicles = player.vehicles.saturating_add(amount),

        // Consumables (100-199)
        100 => player.stamina_potions = player.stamina_potions.saturating_add(amount_u16),
        101 => player.xp_boosters = player.xp_boosters.saturating_add(amount_u16),
        102 => player.loot_magnets = player.loot_magnets.saturating_add(amount_u16),
        103 => player.shield_tokens = player.shield_tokens.saturating_add(amount_u16),
        104 => player.speed_elixirs = player.speed_elixirs.saturating_add(amount_u16),
        105 => player.attack_boosters = player.attack_boosters.saturating_add(amount_u16),
        106 => player.defense_boosters = player.defense_boosters.saturating_add(amount_u16),
        107 => player.collection_boosters = player.collection_boosters.saturating_add(amount_u16),
        108 => player.rally_horns = player.rally_horns.saturating_add(amount_u16),
        109 => player.teleport_scrolls = player.teleport_scrolls.saturating_add(amount_u16),
        110 => player.mystery_keys = player.mystery_keys.saturating_add(amount_u16),

        // Materials (200-299)
        200 => player.common_materials = player.common_materials.saturating_add(amount),
        201 => player.uncommon_materials = player.uncommon_materials.saturating_add(amount),
        202 => player.rare_materials = player.rare_materials.saturating_add(amount),
        203 => player.epic_materials = player.epic_materials.saturating_add(amount),
        204 => player.legendary_materials = player.legendary_materials.saturating_add(amount),

        // Currency/Resources
        50 => player.gems = player.gems.saturating_add(amount),
        51 => player.cash_on_hand = player.cash_on_hand.saturating_add(amount),
        52 => player.fragments = player.fragments.saturating_add(amount),

        // Legacy consumables
        60 => player.encounter_stamina = player.encounter_stamina.saturating_add(amount),
        61 => player.produce = player.produce.saturating_add(amount),

        // Cosmetics (300-399) and Event items (1000+)
        // These require separate PlayerInventoryAccount
        _ => {
            // Items that go to inventory are handled by the inventory system
        }
    }

    Ok(())
}
