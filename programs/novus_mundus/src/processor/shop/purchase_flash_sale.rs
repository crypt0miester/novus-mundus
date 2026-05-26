use crate::{
    emit,
    error::GameError,
    events::shop::FlashSalePurchased,
    helpers::{
        add_to_inventory,
        estate::{load_estate_for_player, market_discount_bps, require_market},
        is_inventory_item_type, process_token_payment_flow,
    },
    processor::shop::common::is_cosmetic_item_type,
    state::{
        require_extension, unlock_extension_if_eligible, BundleAccount, FlashSaleAccount,
        FlashSaleStatus, GameEngine, PlayerAccount, ShopConfigAccount, ShopItemAccount,
        EXT_COSMETICS, EXT_INVENTORY, EXT_RESEARCH, MAX_BUNDLE_ITEMS,
    },
    utils::{read_u16, read_u64},
    validation::{require_key_match, require_owner, require_signer, require_writable},
};
use pinocchio::{sysvars::Sysvar, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::Transfer;

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
/// - [] estate_account: EstateAccount PDA (for Market discount)
///
/// # Building Bonuses
/// Market building provides shop discounts:
/// - 1% discount per Market level (max 20% at level 20)
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
/// - sale_id: u64
/// - quantity: u16 (usually 1 for flash sales)
/// - payment_type: u8 (optional, 0 = SOL, 2+ = Token via AllowedToken)
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
            flash_sale_account,
            item_or_bundle_account,
            treasury,
            inventory_account,
            system_program,
            estate_account,
        ]
    );

    // 2. Validate Accounts

    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(player_account)?;
    require_writable(flash_sale_account)?;
    require_writable(treasury)?;
    require_writable(inventory_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    let sale_id = read_u64(instruction_data, 0, "purchase_flash_sale.sale_id")?;
    let quantity = read_u16(instruction_data, 8, "purchase_flash_sale.quantity")? as u64;

    // Optional payment_type (default 0 = SOL, 2+ = Token)
    let payment_type = if instruction_data.len() >= 11 {
        instruction_data[10]
    } else {
        0
    };

    // Payment type 1 (formerly Gems) is no longer supported
    if payment_type == 1 {
        return Err(GameError::PaymentTypeNotSupported.into());
    }

    if quantity == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load and Validate Game Engine / Treasury (kingdom-scoped)

    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if treasury.address() != &game_engine.treasury_wallet {
        return Err(GameError::InvalidTreasury.into());
    }

    if game_engine.paused {
        return Err(GameError::GamePaused.into());
    }

    // 5. Load Shop Config
    require_owner(shop_config_account, program_id)?;
    let shop_config_data_ref = shop_config_account.try_borrow()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data_ref) };

    // 6. Load and Validate Flash Sale

    let (expected_pda, _) = FlashSaleAccount::derive_pda(game_engine_account.address(), sale_id);
    if flash_sale_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(flash_sale_account, program_id)?;
    let mut flash_sale_data_ref = flash_sale_account.try_borrow_mut()?;
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

    // 7. Read Player for Validation and Discount Calculation (kingdom-scoped)

    let (fib_discount_bps, sub_discount_bps, milestone_discount_bps, streak_discount_bps) = {
        let player = PlayerAccount::load_checked(
            player_account,
            game_engine_account.address(),
            buyer.address(),
            program_id,
        )?;

        // PREREQUISITE: Require EXT_RESEARCH to be unlocked before shopping
        require_extension(&*player, EXT_RESEARCH)?;

        // Get effective subscription tier (handles expiration)
        let effective_tier = player.get_effective_tier(now);

        (
            calculate_fib_bonus(player.daily_purchase_count(), shop_config),
            calculate_subscription_discount(effective_tier),
            calculate_milestone_discount(player.total_shop_spent(), shop_config),
            calculate_streak_discount(player.loyalty_streak(), shop_config),
        )
    };

    // 8. Get Base Price and Item Info

    let (base_price, item_type, items_per_purchase) = if flash_sale.is_bundle {
        // Load bundle
        let (expected_bundle, _) =
            BundleAccount::derive_pda(game_engine_account.address(), flash_sale.item_id);
        if item_or_bundle_account.address() != &expected_bundle {
            return Err(GameError::InvalidAccount.into());
        }

        require_owner(item_or_bundle_account, program_id)?;
        let bundle_data_ref = item_or_bundle_account.try_borrow()?;
        let bundle = unsafe { BundleAccount::load(&bundle_data_ref) };

        // Use SOL price for bundles in flash sales
        (bundle.price_sol_lamports, 0u16, 1u64) // Bundle handled separately
    } else {
        // Load shop item
        let (expected_item, _) =
            ShopItemAccount::derive_pda(game_engine_account.address(), flash_sale.item_id);
        if item_or_bundle_account.address() != &expected_item {
            return Err(GameError::InvalidAccount.into());
        }

        require_owner(item_or_bundle_account, program_id)?;
        let item_data_ref = item_or_bundle_account.try_borrow()?;
        let item = unsafe { ShopItemAccount::load(&item_data_ref) };

        if !item.is_active {
            return Err(GameError::ItemNotAvailable.into());
        }

        (
            item.price_sol_lamports,
            item.item_type,
            item.quantity_per_purchase as u64,
        )
    };

    if base_price == 0 {
        return Err(GameError::PaymentTypeNotSupported.into());
    }

    // 9. Calculate Final Price with Full Discount Stack

    let total_base = base_price.saturating_mul(quantity);
    let flash_discount_bps = flash_sale.discount_bps;

    // HARD GATE: Require Market building to use shop
    // Need to load player again for estate ownership verification
    let player_for_estate = PlayerAccount::load_checked(
        player_account,
        game_engine_account.address(),
        buyer.address(),
        program_id,
    )?;
    let estate = load_estate_for_player(estate_account, &*player_for_estate, program_id)?;
    require_market(estate, 1)?;

    // Calculate Market building discount (BUILDING BONUS) + daily mini-game discount
    let building_discount = market_discount_bps(estate);
    let daily_discount = estate.market_discount_bps;
    let market_bonus_bps = building_discount.saturating_add(daily_discount);

    let final_price = calculate_final_price(
        total_base,
        flash_discount_bps, // base discount (flash sale discount)
        0,                  // bundle discount (not applicable)
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
        }
        .invoke()?;
    } else {
        // Token payment (payment_type >= 2)
        // Token accounts come after the base 10 accounts
        let token_offset = 10;

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
            None, // SOL-priced flash sale; pegged tokens rejected by the helper
            system_program,
            clock.slot,
            clock.unix_timestamp,
        )?;
    }

    // 11. Fulfill Items

    let is_inventory = !flash_sale.is_bundle && is_inventory_item_type(item_type);
    let total_items = items_per_purchase.saturating_mul(quantity);

    if flash_sale.is_bundle {
        // Load bundle for fulfillment (was loaded earlier for pricing, borrow dropped)
        let bundle_data_ref = item_or_bundle_account.try_borrow()?;
        let bundle = unsafe { BundleAccount::load(&bundle_data_ref) };
        // Clamp to MAX_BUNDLE_ITEMS — bundle.item_count is a u8 written at create time,
        // but the in-program items array is fixed-size; a corrupted/legacy value > 10
        // would otherwise cause OOB indexing into bundle.items below.
        let item_count = (bundle.item_count as usize).min(MAX_BUNDLE_ITEMS);

        // Two-pass fulfillment to avoid borrow conflicts:
        // Pass 1: Fulfill non-inventory items (needs mutable player)
        {
            let player = PlayerAccount::load_checked_mut(
                player_account,
                game_engine_account.address(),
                buyer.address(),
                program_id,
            )?;
            for i in 0..item_count {
                let bundle_item = &bundle.items[i];
                if bundle_item.quantity == 0 {
                    continue;
                }

                // Use item_id % 1000 as item_type proxy (simplified fulfillment)
                let item_type = (bundle_item.item_id % 1000) as u16;
                if !is_inventory_item_type(item_type) {
                    let amount = (bundle_item.quantity as u64).saturating_mul(quantity);
                    fulfill_item(&mut *player, item_type, amount)?;
                }
            }
        } // player borrow dropped

        // Pass 2: Fulfill inventory items (armor, cosmetics, event items)
        for i in 0..item_count {
            let bundle_item = &bundle.items[i];
            if bundle_item.quantity == 0 {
                continue;
            }

            let item_type = (bundle_item.item_id % 1000) as u16;
            if is_inventory_item_type(item_type) {
                let amount = (bundle_item.quantity as u64).saturating_mul(quantity);
                for _ in 0..amount {
                    add_to_inventory(
                        program_id,
                        buyer,
                        player_account.address(),
                        inventory_account,
                        system_program,
                        item_type,
                        1,
                        0,
                        bundle_item.item_id,
                        now as u32,
                    )?;
                }
            }
        }
    } else if is_inventory {
        // Items that go to inventory (armor, cosmetics, event items)
        for _ in 0..total_items {
            add_to_inventory(
                program_id,
                buyer,
                player_account.address(),
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
        // Items that go directly to PlayerAccount fields. Cosmetics route
        // through fulfill_item's cosmetic branches, which require
        // EXT_COSMETICS to be unlocked first — otherwise the branch
        // returns CosmeticsNotUnlocked and the whole sale tx reverts.
        if is_cosmetic_item_type(item_type) {
            unlock_extension_if_eligible(player_account, buyer, EXT_COSMETICS)?;
        }
        let player = PlayerAccount::load_checked_mut(
            player_account,
            game_engine_account.address(),
            buyer.address(),
            program_id,
        )?;
        fulfill_item(&mut *player, item_type, total_items)?;
    }

    // 12. Update Flash Sale Stats

    flash_sale.remaining_stock = flash_sale.remaining_stock.saturating_sub(quantity);
    flash_sale.total_claims = flash_sale.total_claims.saturating_add(quantity);
    flash_sale.total_revenue_lamports = flash_sale
        .total_revenue_lamports
        .saturating_add(final_price);

    if flash_sale.remaining_stock == 0 {
        flash_sale.status = FlashSaleStatus::SoldOut as u8;
    }

    // 13. Unlock EXT_INVENTORY before loading player mutably
    unlock_extension_if_eligible(player_account, buyer, EXT_INVENTORY)?;

    // 14. Update Player Shop State
    let player = PlayerAccount::load_checked_mut(
        player_account,
        game_engine_account.address(),
        buyer.address(),
        program_id,
    )?;

    update_player_shop_state(&mut *player, final_price, now, shop_config);

    // Emit event
    emit!(FlashSalePurchased {
        player: *player_account.address(),
        player_name: player.name,
        sale_id,
        original_price: total_base,
        price_paid: final_price,
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

/// Update player shop state after purchase (flash-sale variant: increments flash_claims_today)
fn update_player_shop_state(
    player: &mut PlayerAccount,
    final_price: u64,
    now: i64,
    shop_config: &ShopConfigAccount,
) {
    player.set_total_shop_spent(player.total_shop_spent().saturating_add(final_price));
    player.set_milestone_tier(calculate_milestone_tier(
        player.total_shop_spent(),
        shop_config,
    ));
    super::common::update_streak_and_daily(player, now);
    player.set_flash_claims_today(player.flash_claims_today().saturating_add(1));
}
