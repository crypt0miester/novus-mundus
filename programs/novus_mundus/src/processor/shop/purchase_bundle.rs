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
    helpers::{
        add_to_inventory,
        estate::{market_discount_bps, load_estate_for_player, require_market},
        process_token_payment_flow,
    },
    state::{
        GameEngine, ShopConfigAccount, BundleAccount, ShopItemAccount,
        PlayerAccount, BundleTier,
        unlock_extension_if_eligible, require_extension, EXT_RESEARCH, EXT_INVENTORY,
    },
    validation::{require_signer, require_writable, require_key_match},
    logic::safe_math::apply_bp_penalty,
    emit,
    events::shop::BundlePurchased,
};

/// Purchase a bundle from the shop
///
/// Bundles have pre-set pricing that includes base bundle discount.
/// Additional discounts (subscription tier) stack multiplicatively.
///
/// # Accounts
/// - [signer, writable] buyer: The player buying
/// - [writable] player: PlayerAccount
/// - [] game_engine: GameEngine (for treasury)
/// - [] shop_config: ShopConfigAccount
/// - [writable] bundle: BundleAccount
/// - [writable] treasury: SOL treasury wallet
/// - [] system_program: System program
/// - [writable] inventory: PlayerInventoryAccount PDA (auto-created/expanded for inventory items)
/// - [] estate_account: EstateAccount PDA (for Market discount)
/// - [] shop_items[]: ShopItemAccount for each item in bundle (for fulfillment validation)
///
/// # Building Bonuses
/// Market building provides shop discounts:
/// - 1% discount per Market level (max 20% at level 20)
///
/// # Instruction Data
/// - bundle_id: u32
/// - payment_type: u8 (0 = SOL, 2+ = Token via AllowedToken - future)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    // Minimum accounts: buyer, player, game_engine, shop_config, bundle, treasury, system, inventory, estate
    if accounts.len() < 9 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let buyer = &accounts[0];
    let player_account = &accounts[1];
    let game_engine_account = &accounts[2];
    let shop_config_account = &accounts[3];
    let bundle_account = &accounts[4];
    let treasury = &accounts[5];
    let system_program = &accounts[6];
    let inventory_account = &accounts[7];
    let estate_account = &accounts[8];

    // Remaining accounts are shop items for fulfillment reference
    let shop_item_accounts = &accounts[9..];

    // 2. Validate Accounts

    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(player_account)?;
    require_writable(bundle_account)?;
    require_writable(treasury)?;
    require_writable(inventory_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    if instruction_data.len() < 5 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let bundle_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let payment_type = instruction_data[4];

    // 4. Load and Validate Game Engine / Treasury

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    // Verify treasury matches
    if treasury.key() != &game_engine.treasury_wallet {
        return Err(GameError::InvalidTreasury.into());
    }

    // Check game not paused
    if game_engine.paused {
        return Err(GameError::GamePaused.into());
    }

    // 5. Load Shop Config

    let shop_config_data_ref = shop_config_account.try_borrow_data()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data_ref) };

    // 6. Load and Validate Bundle

    // Verify bundle PDA
    let (expected_bundle, _bump) = BundleAccount::derive_pda(game_engine_account.key(), bundle_id);
    if bundle_account.key() != &expected_bundle {
        return Err(GameError::InvalidPDA.into());
    }

    let mut bundle_data_ref = bundle_account.try_borrow_mut_data()?;
    let bundle = unsafe { BundleAccount::load_mut(&mut bundle_data_ref) };

    // Check bundle is active
    if !bundle.is_active {
        return Err(GameError::BundleNotActive.into());
    }

    // Check availability time window
    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    if bundle.available_from > 0 && now < bundle.available_from {
        return Err(GameError::BundleNotActive.into());
    }

    if bundle.available_until > 0 && now > bundle.available_until {
        return Err(GameError::BundleNotActive.into());
    }

    // 7. Check extensions and unlock INVENTORY before loading player mutably
    {
        let data = player_account.try_borrow_data()?;
        let player = unsafe { PlayerAccount::load(&data) };
        if player.owner != *buyer.key() {
            return Err(GameError::NotOwner.into());
        }
        require_extension(player, EXT_RESEARCH)?;
    }
    unlock_extension_if_eligible(player_account, buyer, EXT_INVENTORY)?;

    // 8. Load Player mutably for remaining operations
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Get effective subscription tier (handles expiration)
    let effective_tier = player.get_effective_tier(now);

    // Check subscription requirement
    if bundle.requires_subscription > 0 {
        if effective_tier < bundle.requires_subscription {
            return Err(GameError::InsufficientSubscriptionTier.into());
        }
    }

    // 8. Determine Price

    // Payment type 1 (formerly Gems) is no longer supported
    if payment_type == 1 {
        return Err(GameError::PaymentTypeNotSupported.into());
    }

    if bundle.price_sol_lamports == 0 {
        return Err(GameError::PaymentTypeNotSupported.into());
    }

    let base_price = bundle.price_sol_lamports;

    // 9. Calculate Final Price with Discounts

    // Bundle price already includes bundle discount (savings_bps is for display)
    // Apply additional discounts: subscription tier, milestone, streak, fib, market
    let sub_discount_bps = calculate_subscription_discount(effective_tier);
    let milestone_discount_bps = calculate_milestone_discount(player.total_shop_spent, shop_config);
    let streak_discount_bps = calculate_streak_discount(player.loyalty_streak, shop_config);
    let fib_discount_bps = calculate_fib_bonus(player.daily_purchase_count, shop_config);

    // HARD GATE: Require Market building to use shop
    let estate = load_estate_for_player(estate_account, player, program_id)?;
    require_market(estate, 1)?;

    // Calculate Market building discount (BUILDING BONUS) + daily mini-game discount
    let building_discount = market_discount_bps(estate);
    let daily_discount = estate.market_discount_bps;
    let market_bonus_bps = building_discount.saturating_add(daily_discount);

    // Get bundle tier for potential additional discount (tier discount already in price)
    let _bundle_tier = BundleTier::from_u8(bundle.tier);

    // Calculate final price with all discounts (multiplicative stacking)
    let final_price = calculate_final_price(
        base_price,
        0, // base_discount (already in bundle price)
        0, // bundle_discount (already in bundle price)
        fib_discount_bps,
        sub_discount_bps,
        milestone_discount_bps,
        streak_discount_bps,
        market_bonus_bps,
        shop_config.max_total_discount_bps,
    );

    // 10. Process Payment

    if payment_type == 0 {
        // SOL payment - direct transfer to treasury
        Transfer {
            from: buyer,
            to: treasury,
            lamports: final_price,
        }.invoke()?;
    } else {
        // Token payment (payment_type >= 2)
        // Token accounts come after shop_item_accounts
        let token_offset = 9 + shop_item_accounts.len();

        // Use unified token payment helper
        process_token_payment_flow(
            &accounts[token_offset..],
            game_engine_account.key(),
            program_id,
            shop_config,
            buyer,
            final_price,
            clock.slot,
        )?;
    }

    // 11. Fulfill Bundle Items

    let item_count = bundle.item_count as usize;

    // If shop_item_accounts provided, validate and use for detailed fulfillment
    // Otherwise, use simplified fulfillment based on item_id ranges
    if shop_item_accounts.len() >= item_count {
        // Detailed fulfillment with item type lookup
        for i in 0..item_count {
            let bundle_item = &bundle.items[i];
            if bundle_item.quantity == 0 {
                continue;
            }

            let shop_item_account = &shop_item_accounts[i];

            // Verify this is the correct shop item
            let (expected_item_pda, _) = ShopItemAccount::derive_pda(
                game_engine_account.key(),
                bundle_item.item_id,
            );
            if shop_item_account.key() != &expected_item_pda {
                return Err(GameError::InvalidAccount.into());
            }

            let shop_item_data_ref = shop_item_account.try_borrow_data()?;
            let shop_item = unsafe { ShopItemAccount::load(&shop_item_data_ref) };

            let amount = bundle_item.quantity as u64 * shop_item.quantity_per_purchase as u64;

            // Check if this is an inventory item
            if is_inventory_item_type(shop_item.item_type) {
                for _ in 0..amount {
                    add_to_inventory(
                        program_id,
                        buyer,
                        buyer.key(),
                        inventory_account,
                        system_program,
                        shop_item.item_type,
                        1,
                        0,
                        bundle_item.item_id,
                        now as u32,
                    )?;
                }
            } else {
                fulfill_item(player, shop_item.item_type, amount)?;
            }
        }
    } else {
        // Simplified fulfillment - just use item_id as item_type
        // This is a fallback when shop item accounts aren't provided
        for i in 0..item_count {
            let bundle_item = &bundle.items[i];
            if bundle_item.quantity == 0 {
                continue;
            }

            // Use item_id as a proxy for item_type (simplified)
            let item_type = (bundle_item.item_id % 1000) as u16;
            let amount = bundle_item.quantity as u64;

            // Check if this is an inventory item
            if is_inventory_item_type(item_type) {
                for _ in 0..amount {
                    add_to_inventory(
                        program_id,
                        buyer,
                        buyer.key(),
                        inventory_account,
                        system_program,
                        item_type,
                        1,
                        0,
                        bundle_item.item_id,
                        now as u32,
                    )?;
                }
            } else {
                fulfill_item(player, item_type, amount)?;
            }
        }
    }

    // 12. Update Bundle Stats

    bundle.total_purchases = bundle.total_purchases.saturating_add(1);
    bundle.total_revenue_lamports = bundle.total_revenue_lamports.saturating_add(final_price);

    // 13. Update Player Shop State

    // Track total spending for milestone tracking
    player.total_shop_spent = player.total_shop_spent.saturating_add(final_price);
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
    player.last_purchase_day = current_day;
    player.last_daily_reset = now;

    // Emit event
    emit!(BundlePurchased {
        player: *player_account.key(),
        player_name: player.name,
        bundle_id,
        price: final_price,
        currency: payment_type,
        timestamp: now,
    });

    Ok(())
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

fn calculate_subscription_discount(tier: u8) -> u16 {
    match tier {
        0 => 0,     // Free: 0%
        1 => 500,   // Rookie: 5%
        2 => 1000,  // Expert: 10%
        3 => 1500,  // Epic: 15%
        4 => 2500,  // Legendary: 25%
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
    market_discount_bps: u16,
    max_total_discount_bps: u16,
) -> u64 {
    // Multiplicative stacking with checked math
    let mut price = base_price;

    // Layer 1: Base discount
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

    // Layer 7: Market building discount
    price = apply_bp_penalty(price, market_discount_bps).unwrap_or(price);

    // Enforce max discount
    let min_price = apply_bp_penalty(base_price, max_total_discount_bps).unwrap_or(0);
    price.max(min_price).max(1)
}

/// Check if item type goes to PlayerInventoryAccount instead of direct PlayerAccount fields
fn is_inventory_item_type(item_type: u16) -> bool {
    matches!(item_type, 3 | 300..=399 | 1000..)
}

fn fulfill_item(player: &mut PlayerAccount, item_type: u16, amount: u64) -> ProgramResult {
    // Item type ranges (from architecture doc):
    // 0-99: Equipment (except 3=armor which goes to inventory)
    // 100-199: Consumables
    // 200-299: Materials
    // 300-399: Cosmetics (inventory)
    // 1000+: Event items (inventory)

    let amount_u16 = amount.min(u16::MAX as u64) as u16;
    let _amount_u32 = amount.min(u32::MAX as u64) as u32;

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

        // Inventory items (3=armor, 300-399=cosmetics, 1000+=event) handled by add_to_inventory
        _ => {}
    }

    Ok(())
}
