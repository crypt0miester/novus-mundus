use crate::{
    constants::PLAYER_PURCHASE_SEED,
    emit,
    error::GameError,
    events::shop::ItemPurchased,
    helpers::{
        add_to_inventory,
        estate::{load_estate_for_player, market_discount_bps, require_market},
        is_inventory_item_type, process_token_payment_flow,
    },
    state::{
        require_extension, unlock_extension_if_eligible, DailyDealAccount, GameEngine,
        PlayerAccount, PlayerPurchaseAccount, ShopConfigAccount, ShopItemAccount,
        WeeklySaleAccount, EXT_INVENTORY, EXT_RESEARCH,
    },
    utils::{read_u16, read_u32, read_u8},
    validation::{require_key_match, require_owner, require_signer, require_writable},
};
use pinocchio::{sysvars::Sysvar, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::{CreateAccount, Transfer};

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
///   Then, by oracle program (see helpers::process_token_payment_flow):
///   - Pyth (+2): sol `PriceUpdateV2`, token `PriceUpdateV2`
///   - Switchboard (+3): oracle-quote PDA, Switchboard queue, SlotHashes sysvar
///
/// # Instruction Data
/// - item_id: u32
/// - quantity: u16 (how many purchases, each gives quantity_per_purchase items)
/// - payment_type: u8 (0 = SOL, 2+ = Token via AllowedToken)
/// - discount_flags: u8 (optional, bitmask: 1=daily_deal, 2=weekly_sale)
/// - daily_deal_slot: u8 (if daily_deal flag, slot index 0-2)
/// - weekly_sale_week: u64 (if weekly_sale flag, week number)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(
        accounts,
        [
            buyer,
            player_account,
            game_engine_account,
            shop_config_account,
            shop_item_account,
            player_purchase_account,
            treasury,
            system_program,
            inventory_account,
            estate_account,
        ]
    );

    // 2. Validate Accounts

    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(player_account)?;
    require_writable(player_purchase_account)?;
    require_writable(treasury)?;
    require_writable(inventory_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    let item_id = read_u32(instruction_data, 0, "purchase_item.item_id")?;
    let quantity = read_u16(instruction_data, 4, "purchase_item.quantity")? as u64;
    let payment_type = read_u8(instruction_data, 6, "purchase_item.payment_type")?;

    if quantity == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load and Validate Game Engine / Treasury (kingdom-scoped)

    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Verify treasury matches
    if treasury.address() != &game_engine.treasury_wallet {
        return Err(GameError::InvalidTreasury.into());
    }

    // Check game not paused
    if game_engine.paused {
        return Err(GameError::GamePaused.into());
    }

    // 5. Load Shop Config
    require_owner(shop_config_account, program_id)?;
    let shop_config_data_ref = shop_config_account.try_borrow()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data_ref) };

    // 6. Load and Validate Shop Item
    require_owner(shop_item_account, program_id)?;
    let mut shop_item_data_ref = shop_item_account.try_borrow_mut()?;
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

    // 8. Check extensions and unlock INVENTORY before loading player mutably
    // (must be done before load_checked_mut to avoid borrow conflicts with resize)
    {
        let data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&data) };
        require_extension(player, EXT_RESEARCH)?;
    }
    unlock_extension_if_eligible(player_account, buyer, EXT_INVENTORY)?;

    // 9. Load Player and Calculate Discounts (kingdom-scoped)
    let player = PlayerAccount::load_checked_mut(
        player_account,
        game_engine_account.address(),
        buyer.address(),
        program_id,
    )?;

    // Calculate subscription discount (using effective tier to handle expiration)
    let effective_tier = player.get_effective_tier(now);
    let sub_discount_bps = calculate_subscription_discount(effective_tier);

    // Calculate milestone discount based on lifetime spending
    let milestone_discount_bps =
        calculate_milestone_discount(player.total_shop_spent(), shop_config);

    // Calculate loyalty streak discount
    let streak_discount_bps = calculate_streak_discount(player.loyalty_streak(), shop_config);

    // Fibonacci bonus for consecutive day purchases
    let fib_discount_bps = calculate_fib_bonus(player.daily_purchase_count(), shop_config);

    // Calculate base discount from optional discount sources (daily deal, weekly sale)
    let base_discount_bps = calculate_optional_discounts(
        instruction_data,
        &accounts[10..], // Optional accounts start after estate_account
        game_engine_account.address(),
        program_id,
        item_id,
        shop_item.category,
        now,
    );

    // HARD GATE: Require Market building to use shop (skip for gems - item_type 50)
    // Gems are premium currency purchasable without Market
    let market_bonus_bps = if shop_item.item_type != 50 {
        let estate = load_estate_for_player(estate_account, &*player, program_id)?;
        require_market(estate, 1)?;

        // Calculate Market discount (BUILDING BONUS + DAILY MINI-GAME BONUS)
        let building_discount = market_discount_bps(estate);
        let daily_discount = estate.market_discount_bps;
        building_discount.saturating_add(daily_discount)
    } else {
        0u16
    };

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

        let (expected_pda, pp_bump) = PlayerPurchaseAccount::derive_pda(buyer.address(), item_id);

        if player_purchase_account.address() != &expected_pda {
            return Err(GameError::InvalidPDA.into());
        }
        if player_purchase_data_len == 0 {
            // Create the account
            let lamports = crate::utils::rent_exempt_const(PlayerPurchaseAccount::LEN);

            let item_id_bytes = item_id.to_le_bytes();
            let bump_seed = [pp_bump];
            let seeds = crate::seeds!(
                PLAYER_PURCHASE_SEED,
                buyer.address(),
                &item_id_bytes,
                &bump_seed
            );
            let signer = pinocchio::cpi::Signer::from(&seeds);

            CreateAccount {
                from: buyer,
                to: player_purchase_account,
                lamports,
                space: PlayerPurchaseAccount::LEN as u64,
                owner: program_id,
            }
            .invoke_signed(&[signer])?;

            // Initialize
            let mut pp_data_ref = player_purchase_account.try_borrow_mut()?;
            let pp = unsafe { PlayerPurchaseAccount::load_mut(&mut pp_data_ref) };
            pp.account_key = crate::state::AccountKey::PlayerPurchase as u8;
            pp.lifetime_purchased = 0;
            pp.purchased_today = 0;
            pp.last_purchase_day = PlayerPurchaseAccount::current_day(now);
            pp._reserved = [0; 8];
            pp.bump = pp_bump;
        }

        // Now validate limits
        let mut pp_data_ref = player_purchase_account.try_borrow_mut()?;
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
        }
        .invoke()?;
    } else {
        // Token payment (payment_type >= 2)
        // Calculate offset for token accounts (after base + optional discount accounts)
        let discount_flags = if instruction_data.len() >= 8 {
            instruction_data[7]
        } else {
            0
        };
        let discount_accounts = (discount_flags & DISCOUNT_DAILY_DEAL != 0) as usize
            + (discount_flags & DISCOUNT_WEEKLY_SALE != 0) as usize;
        let token_offset = 10 + discount_accounts;

        // Use unified token payment helper
        process_token_payment_flow(
            &accounts[token_offset..],
            game_engine_account.address(),
            &game_engine.treasury_wallet,
            treasury,
            program_id,
            shop_config,
            buyer,
            final_price,
            None, // SOL-priced item; pegged tokens rejected by the helper
            system_program,
            clock.slot,
            clock.unix_timestamp,
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
                buyer.address(),
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

    // 13. Update Player Shop State (milestone tracking is SOL-only for this ix)
    if payment_type == 0 {
        let new_total = player.total_shop_spent().saturating_add(final_price);
        player.set_total_shop_spent(new_total);
        player.set_milestone_tier(calculate_milestone_tier(new_total, shop_config));
    }
    super::common::update_streak_and_daily(&mut *player, now);

    // Emit event
    emit!(ItemPurchased {
        player: *player_account.address(),
        player_name: player.name,
        item_id,
        quantity: quantity as u16,
        price: final_price,
        currency: payment_type,
        timestamp: now,
    });

    Ok(())
}

// HELPER FUNCTIONS

use super::common::{
    calculate_fib_bonus, calculate_final_price, calculate_milestone_discount,
    calculate_milestone_tier, calculate_streak_discount, calculate_subscription_discount,
    fulfill_item,
};

/// Calculate discount from optional discount sources (daily deal, weekly sale)
///
/// Parses discount_flags from instruction data and validates/applies discounts
/// from the provided optional accounts.
fn calculate_optional_discounts(
    instruction_data: &[u8],
    optional_accounts: &[AccountView],
    game_engine_key: &Address,
    program_id: &Address,
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
            program_id,
            item_id,
            now,
        ) {
            total_discount_bps = total_discount_bps.saturating_add(discount as u32);
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
            program_id,
            item_category,
            now,
        ) {
            total_discount_bps = total_discount_bps.saturating_add(discount as u32);
        }
        // account_idx += 1;
    }

    // Cap at 6000 bps (60%) for base layer discounts
    total_discount_bps.min(6000) as u16
}

fn check_daily_deal(
    instruction_data: &[u8],
    data_offset: &mut usize,
    daily_deal_account: Option<&AccountView>,
    game_engine_key: &Address,
    program_id: &Address,
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

    // Verify program ownership — caller passes the account, so spoofing with a
    // fake account that mimics the PDA layout would otherwise bypass the gate.
    require_owner(account, program_id).ok()?;

    // Verify PDA
    let (expected_pda, _) = DailyDealAccount::derive_pda(game_engine_key, slot_index);
    if account.address() != &expected_pda {
        return None;
    }

    // Load and validate
    let data = account.try_borrow().ok()?;
    let daily_deal = unsafe { DailyDealAccount::load(&data) };

    // Check item matches
    if daily_deal.item_id != item_id {
        return None;
    }

    // Check deal is active (started within last 24 hours).
    // Also reject zero/future start (uninitialized or clock-skew abuse).
    let day_seconds = 86400i64;
    if daily_deal.started_at <= 0 || daily_deal.started_at > now {
        return None;
    }
    if now > daily_deal.started_at + day_seconds {
        return None;
    }

    Some(daily_deal.discount_bps)
}

fn check_weekly_sale(
    instruction_data: &[u8],
    data_offset: &mut usize,
    weekly_sale_account: Option<&AccountView>,
    game_engine_key: &Address,
    program_id: &Address,
    item_category: u8,
    now: i64,
) -> Option<u16> {
    // Need week number from instruction data
    if instruction_data.len() < *data_offset + 8 {
        return None;
    }
    let week_number = u64::from_le_bytes(
        instruction_data[*data_offset..*data_offset + 8]
            .try_into()
            .ok()?,
    );
    *data_offset += 8;

    let account = weekly_sale_account?;

    // Verify program ownership — see check_daily_deal note.
    require_owner(account, program_id).ok()?;

    // Verify PDA
    let (expected_pda, _) = WeeklySaleAccount::derive_pda(game_engine_key, week_number);
    if account.address() != &expected_pda {
        return None;
    }

    // Load and validate
    let data = account.try_borrow().ok()?;
    let weekly_sale = unsafe { WeeklySaleAccount::load(&data) };

    // Reject uninitialized / future-dated sales.
    if weekly_sale.starts_at <= 0 || weekly_sale.starts_at > now {
        return None;
    }

    // Check sale is active
    if now > weekly_sale.ends_at {
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
