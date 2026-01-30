use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::{CreateAccount, Transfer};
use crate::{
    constants::PLAYER_PURCHASE_SEED,
    error::GameError,
    helpers::{
        add_to_inventory,
        estate::{market_discount_bps, load_estate_for_player, require_market},
        process_token_payment_flow,
    },
    state::{
        GameEngine, ShopConfigAccount, ShopItemAccount, PlayerPurchaseAccount,
        PlayerAccount, DailyDealAccount, WeeklySaleAccount,
        unlock_extension_if_eligible, require_extension, EXT_HEROES, EXT_INVENTORY,
    },
    validation::{require_signer, require_writable, require_key_match, require_owner},
    logic::safe_math::apply_bp_penalty,
    emit,
    events::shop::ItemPurchased,
};

/// Discount source flags for optional accounts
pub const DISCOUNT_DAILY_DEAL: u8 = 1;
pub const DISCOUNT_WEEKLY_SALE: u8 = 2;

/// Purchase an item from the shop
///
/// Transfers payment to treasury, updates player inventory,
/// tracks purchase limits, and applies discounts from various sources.
///
/// # Accounts (Required)
/// - [signer, writable] buyer: The player buying
/// - [writable] player: PlayerAccount
/// - [] game_engine: GameEngine (for treasury)
/// - [] shop_config: ShopConfigAccount
/// - [writable] shop_item: ShopItemAccount
/// - [writable] player_purchase: PlayerPurchaseAccount (optional, created if needed)
/// - [writable] treasury: SOL treasury wallet
/// - [] system_program: System program
/// - [writable] inventory: PlayerInventoryAccount PDA (auto-created/expanded for inventory items)
/// - [] estate_account: EstateAccount PDA (for Market discount)
///
/// # Building Bonuses
/// Market building provides shop discounts:
/// - 1% discount per Market level (max 20% at level 20)
///
/// # Accounts (Optional, based on discount_flags)
/// - [] daily_deal: DailyDealAccount (if DISCOUNT_DAILY_DEAL flag set)
/// - [] weekly_sale: WeeklySaleAccount (if DISCOUNT_WEEKLY_SALE flag set)
///
/// # Accounts (Required for Token Payment, payment_type >= 2)
/// - [] allowed_token: AllowedTokenAccount PDA
/// - [] token_mint: SPL Token mint (for decimals)
/// - [writable] buyer_token_ata: Buyer's token account
/// - [writable] treasury_token_ata: Treasury's token account
/// - [] token_program: SPL Token program
/// - [] sol_oracle_feed: SOL/USD price feed (Pyth or Switchboard)
/// - [] token_oracle_feed: TOKEN/USD price feed (Pyth or Switchboard)
///
/// # Instruction Data
/// - item_id: u32
/// - quantity: u16 (how many purchases, each gives quantity_per_purchase items)
/// - payment_type: u8 (0 = SOL, 2+ = Token via AllowedToken)
/// - discount_flags: u8 (optional, bitmask: 1=daily_deal, 2=weekly_sale)
/// - daily_deal_slot: u8 (if daily_deal flag, slot index 0-2)
/// - weekly_sale_week: u64 (if weekly_sale flag, week number)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    if accounts.len() < 10 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let buyer = &accounts[0];
    let player_account = &accounts[1];
    let game_engine_account = &accounts[2];
    let shop_config_account = &accounts[3];
    let shop_item_account = &accounts[4];
    let player_purchase_account = &accounts[5];
    let treasury = &accounts[6];
    let system_program = &accounts[7];
    let inventory_account = &accounts[8];
    let estate_account = &accounts[9];

    // 2. Validate Accounts

    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(player_account)?;
    require_writable(player_purchase_account)?;
    require_writable(treasury)?;
    require_writable(inventory_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    if instruction_data.len() < 7 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let item_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let quantity = u16::from_le_bytes(instruction_data[4..6].try_into().unwrap()) as u64;
    let payment_type = instruction_data[6];

    if quantity == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load and Validate Game Engine / Treasury (kingdom-scoped)

    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Verify treasury matches
    if treasury.key() != &game_engine.treasury_wallet {
        return Err(GameError::InvalidTreasury.into());
    }

    // Check game not paused
    if game_engine.paused {
        return Err(GameError::GamePaused.into());
    }

    // 5. Load Shop Config
    require_owner(shop_config_account, program_id)?;
    let shop_config_data_ref = shop_config_account.try_borrow_data()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data_ref) };

    // 6. Load and Validate Shop Item
    require_owner(shop_item_account, program_id)?;
    let mut shop_item_data_ref = shop_item_account.try_borrow_mut_data()?;
    let shop_item = unsafe { ShopItemAccount::load_mut(&mut shop_item_data_ref) };

    // Check item is active
    if !shop_item.is_active {
        return Err(GameError::ItemNotAvailable.into());
    }

    // Check availability time window
    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    if shop_item.available_from > 0 && now < shop_item.available_from {
        return Err(GameError::ItemNotAvailable.into());
    }

    if shop_item.available_until > 0 && now > shop_item.available_until {
        return Err(GameError::ItemNotAvailable.into());
    }

    // Check global stock
    if shop_item.max_global_stock > 0 {
        if shop_item.current_global_stock < quantity {
            return Err(GameError::InsufficientStock.into());
        }
    }

    // 7. Determine Price

    // Payment type 0 = SOL, 2+ = Token via AllowedToken
    // Type 1 (formerly Gems) is no longer supported
    if payment_type == 1 {
        return Err(GameError::PaymentTypeNotSupported.into());
    }

    // For both SOL and token payments, we need the SOL price as the base
    let base_price = if shop_item.price_sol_lamports == 0 {
        return Err(GameError::PaymentTypeNotSupported.into());
    } else {
        shop_item.price_sol_lamports
    };

    // Total before discounts
    let total_base = base_price.saturating_mul(quantity);

    // 8. Load Player and Calculate Discounts (kingdom-scoped)

    let mut player = PlayerAccount::load_checked_mut(player_account, game_engine_account.key(), buyer.key(), program_id)?;

    // PREREQUISITE: Require EXT_HEROES to be unlocked before shopping
    // Player must lock a hero before using the shop (user journey)
    require_extension(&*player, EXT_HEROES)?;

    // Unlock EXT_INVENTORY extension if not already unlocked
    // This is the third step in the user journey
    unlock_extension_if_eligible(player_account, buyer, &mut *player, EXT_INVENTORY)?;

    // Calculate subscription discount (using effective tier to handle expiration)
    let effective_tier = player.get_effective_tier(now);
    let sub_discount_bps = calculate_subscription_discount(effective_tier);

    // Calculate milestone discount based on lifetime spending
    let milestone_discount_bps = calculate_milestone_discount(player.total_shop_spent, shop_config);

    // Calculate loyalty streak discount
    let streak_discount_bps = calculate_streak_discount(player.loyalty_streak, shop_config);

    // Fibonacci bonus for consecutive day purchases
    let fib_discount_bps = calculate_fib_bonus(player.daily_purchase_count, shop_config);

    // Calculate base discount from optional discount sources (daily deal, weekly sale)
    let base_discount_bps = calculate_optional_discounts(
        instruction_data,
        &accounts[10..], // Optional accounts start after estate_account
        game_engine_account.key(),
        item_id,
        shop_item.category,
        now,
    );

    // HARD GATE: Require Market building to use shop
    let estate = load_estate_for_player(estate_account, &*player, program_id)?;
    require_market(estate, 1)?;

    // Calculate Market discount (BUILDING BONUS + DAILY MINI-GAME BONUS)
    let building_discount = market_discount_bps(estate);
    let daily_discount = estate.market_discount_bps;
    let market_bonus_bps = building_discount.saturating_add(daily_discount);

    // Calculate final price (multiplicative stacking)
    let final_price = calculate_final_price(
        total_base,
        base_discount_bps,
        0, // bundle discount (not applicable for single items)
        fib_discount_bps,
        sub_discount_bps,
        milestone_discount_bps,
        streak_discount_bps,
        market_bonus_bps,
        shop_config.max_total_discount_bps,
    );

    // 9. Handle Player Purchase Limits

    let has_limits = shop_item.max_per_player > 0 || shop_item.max_per_day > 0;

    if has_limits {
        // Check if player_purchase account exists or needs creation
        let player_purchase_data_len = player_purchase_account.data_len();

        let (expected_pda, pp_bump) = PlayerPurchaseAccount::derive_pda(buyer.key(), item_id);

        if player_purchase_account.key() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }
        if player_purchase_data_len == 0 {
            // Create the account
            let lamports = pinocchio::sysvars::rent::Rent::get()?
                .minimum_balance(PlayerPurchaseAccount::LEN);

            let item_id_bytes = item_id.to_le_bytes();
            let bump_seed = [pp_bump];
            let seeds = pinocchio::seeds!(
                PLAYER_PURCHASE_SEED,
                buyer.key().as_ref(),
                &item_id_bytes,
                &bump_seed
            );
            let signer = pinocchio::instruction::Signer::from(&seeds);

            CreateAccount {
                from: buyer,
                to: player_purchase_account,
                lamports,
                space: PlayerPurchaseAccount::LEN as u64,
                owner: program_id,
            }.invoke_signed(&[signer])?;

            // Initialize
            let mut pp_data_ref = player_purchase_account.try_borrow_mut_data()?;
            let pp = unsafe { PlayerPurchaseAccount::load_mut(&mut pp_data_ref) };
            pp.lifetime_purchased = 0;
            pp.purchased_today = 0;
            pp.last_purchase_day = PlayerPurchaseAccount::current_day(now);
            pp._reserved = [0; 8];
            pp.bump = pp_bump;
        }

        // Now validate limits
        let mut pp_data_ref = player_purchase_account.try_borrow_mut_data()?;
        let pp = unsafe { PlayerPurchaseAccount::load_mut(&mut pp_data_ref) };

        // Reset daily counter if needed
        pp.maybe_reset_daily(now);

        // Check lifetime limit
        if shop_item.max_per_player > 0 {
            if pp.lifetime_purchased.saturating_add(quantity) > shop_item.max_per_player as u64 {
                return Err(GameError::PurchaseLimitReached.into());
            }
        }

        // Check daily limit
        if shop_item.max_per_day > 0 {
            if pp.purchased_today.saturating_add(quantity) > shop_item.max_per_day as u64 {
                return Err(GameError::DailyLimitReached.into());
            }
        }

        // Update purchase tracking
        pp.lifetime_purchased = pp.lifetime_purchased.saturating_add(quantity);
        pp.purchased_today = pp.purchased_today.saturating_add(quantity);
    }

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
        // Calculate offset for token accounts (after base + optional discount accounts)
        let discount_flags = if instruction_data.len() >= 8 { instruction_data[7] } else { 0 };
        let discount_accounts = (discount_flags & DISCOUNT_DAILY_DEAL != 0) as usize
            + (discount_flags & DISCOUNT_WEEKLY_SALE != 0) as usize;
        let token_offset = 10 + discount_accounts;

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

    // 11. Fulfill Order - Add Items to Player

    let items_to_add = shop_item.quantity_per_purchase as u64 * quantity;

    // Check if this is an inventory item
    let is_inventory_item = is_inventory_item_type(shop_item.item_type);

    if is_inventory_item {
        // Add to separate PlayerInventoryAccount (auto-creates/expands)
        for _ in 0..items_to_add {
            add_to_inventory(
                program_id,
                buyer,
                buyer.key(),
                inventory_account,
                system_program,
                shop_item.item_type,
                1, // quantity per slot
                0, // rarity (could be derived from item)
                item_id,
                now as u32,
            )?;
        }
    } else {
        // Add directly to PlayerAccount fields
        fulfill_item(&mut *player, shop_item.item_type, items_to_add)?;
    }

    // 12. Update Stats

    // Update global stock
    if shop_item.max_global_stock > 0 {
        shop_item.current_global_stock = shop_item.current_global_stock.saturating_sub(quantity);
    }

    // 13. Update Player Shop State

    // Track total spending (SOL only for milestone tracking)
    if payment_type == 0 {
        player.total_shop_spent = player.total_shop_spent.saturating_add(final_price);

        // Update milestone tier if threshold reached
        player.milestone_tier = calculate_milestone_tier(player.total_shop_spent, shop_config);
    }

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
    emit!(ItemPurchased {
        player: *player_account.key(),
        player_name: player.name,
        item_id,
        quantity: quantity as u16,
        price: final_price,
        currency: payment_type,
        timestamp: now,
    });

    Ok(())
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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
    // Capped at max_fib_discount_bps
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

fn calculate_subscription_discount(tier: u8) -> u16 {
    // Subscription discounts (from doc)
    match tier {
        0 => 0,     // Free: 0%
        1 => 500,   // Rookie: 5%
        2 => 1000,  // Expert: 10%
        3 => 1500,  // Epic: 15%
        4 => 2500,  // Legendary: 25%
        _ => 0,
    }
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
    price.max(min_price)
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

/// Calculate discount from optional discount sources (daily deal, weekly sale)
///
/// Parses discount_flags from instruction data and validates/applies discounts
/// from the provided optional accounts.
fn calculate_optional_discounts(
    instruction_data: &[u8],
    optional_accounts: &[AccountInfo],
    game_engine_key: &Pubkey,
    item_id: u32,
    item_category: u8,
    now: i64,
) -> u16 {
    // Check if discount_flags is provided (instruction data >= 8 bytes)
    if instruction_data.len() < 8 {
        return 0;
    }

    let discount_flags = instruction_data[7];
    if discount_flags == 0 {
        return 0;
    }

    let mut total_discount_bps: u32 = 0;
    let mut account_idx = 0;
    let mut data_offset = 8usize;

    // Check daily deal
    if discount_flags & DISCOUNT_DAILY_DEAL != 0 {
        if let Some(discount) = check_daily_deal(
            instruction_data,
            &mut data_offset,
            optional_accounts.get(account_idx),
            game_engine_key,
            item_id,
            now,
        ) {
            total_discount_bps += discount as u32;
        }
        account_idx += 1;
    }

    // Check weekly sale
    if discount_flags & DISCOUNT_WEEKLY_SALE != 0 {
        if let Some(discount) = check_weekly_sale(
            instruction_data,
            &mut data_offset,
            optional_accounts.get(account_idx),
            game_engine_key,
            item_category,
            now,
        ) {
            total_discount_bps += discount as u32;
        }
        // account_idx += 1;
    }

    // Cap at 6000 bps (60%) for base layer discounts
    total_discount_bps.min(6000) as u16
}

fn check_daily_deal(
    instruction_data: &[u8],
    data_offset: &mut usize,
    daily_deal_account: Option<&AccountInfo>,
    game_engine_key: &Pubkey,
    item_id: u32,
    now: i64,
) -> Option<u16> {
    // Need slot index from instruction data
    if instruction_data.len() < *data_offset + 1 {
        return None;
    }
    let slot_index = instruction_data[*data_offset];
    *data_offset += 1;

    let account = daily_deal_account?;

    // Verify PDA
    let (expected_pda, _) = DailyDealAccount::derive_pda(game_engine_key, slot_index);
    if account.key() != &expected_pda {
        return None;
    }

    // Load and validate
    let data = account.try_borrow_data().ok()?;
    let daily_deal = unsafe { DailyDealAccount::load(&data) };

    // Check item matches
    if daily_deal.item_id != item_id {
        return None;
    }

    // Check deal is active (started within last 24 hours)
    let day_seconds = 86400i64;
    if now < daily_deal.started_at || now > daily_deal.started_at + day_seconds {
        return None;
    }

    Some(daily_deal.discount_bps)
}

fn check_weekly_sale(
    instruction_data: &[u8],
    data_offset: &mut usize,
    weekly_sale_account: Option<&AccountInfo>,
    game_engine_key: &Pubkey,
    item_category: u8,
    now: i64,
) -> Option<u16> {
    // Need week number from instruction data
    if instruction_data.len() < *data_offset + 8 {
        return None;
    }
    let week_number = u64::from_le_bytes(
        instruction_data[*data_offset..*data_offset + 8].try_into().ok()?
    );
    *data_offset += 8;

    let account = weekly_sale_account?;

    // Verify PDA
    let (expected_pda, _) = WeeklySaleAccount::derive_pda(game_engine_key, week_number);
    if account.key() != &expected_pda {
        return None;
    }

    // Load and validate
    let data = account.try_borrow_data().ok()?;
    let weekly_sale = unsafe { WeeklySaleAccount::load(&data) };

    // Check sale is active
    if now < weekly_sale.starts_at || now > weekly_sale.ends_at {
        return None;
    }

    // Get category-specific discount
    let category_idx = item_category as usize;
    if category_idx < 4 {
        Some(weekly_sale.category_discounts[category_idx])
    } else {
        None
    }
}
