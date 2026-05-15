use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::Transfer;
use crate::{
    error::GameError,
    helpers::{
        add_to_inventory,
        estate::{market_discount_bps, load_estate_for_player, require_market},
        is_inventory_item_type,
        process_token_payment_flow,
    },
    state::{
        GameEngine, ShopConfigAccount, BundleAccount, ShopItemAccount,
        PlayerAccount, BundleTier,
        unlock_extension_if_eligible, require_extension, EXT_RESEARCH, EXT_INVENTORY,
    },
    validation::{require_signer, require_writable, require_key_match},
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
    program_id: &Address,
    accounts: &[AccountView],
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

    // Validate game_engine account (ownership + PDA + discriminator + bump)
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

    let shop_config_data_ref = shop_config_account.try_borrow()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data_ref) };

    // 6. Load and Validate Bundle

    // Verify bundle PDA
    let (expected_bundle, _bump) = BundleAccount::derive_pda(game_engine_account.address(), bundle_id);
    if bundle_account.address() != &expected_bundle {
        return Err(GameError::InvalidPDA.into());
    }

    let mut bundle_data_ref = bundle_account.try_borrow_mut()?;
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
        let data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&data) };
        if player.owner != *buyer.address() {
            return Err(GameError::NotOwner.into());
        }
        require_extension(player, EXT_RESEARCH)?;
    }
    unlock_extension_if_eligible(player_account, buyer, EXT_INVENTORY)?;

    // 8. Load Player mutably for remaining operations
    let mut player_data_ref = player_account.try_borrow_mut()?;
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
    let milestone_discount_bps = calculate_milestone_discount(player.total_shop_spent(), shop_config);
    let streak_discount_bps = calculate_streak_discount(player.loyalty_streak(), shop_config);
    let fib_discount_bps = calculate_fib_bonus(player.daily_purchase_count(), shop_config);

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
            game_engine_account.address(),
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
                game_engine_account.address(),
                bundle_item.item_id,
            );
            if shop_item_account.address() != &expected_item_pda {
                return Err(GameError::InvalidAccount.into());
            }

            let shop_item_data_ref = shop_item_account.try_borrow()?;
            let shop_item = unsafe { ShopItemAccount::load(&shop_item_data_ref) };

            let amount = bundle_item.quantity as u64 * shop_item.quantity_per_purchase as u64;

            // Check if this is an inventory item
            if is_inventory_item_type(shop_item.item_type) {
                for _ in 0..amount {
                    add_to_inventory(
                        program_id,
                        buyer,
                        buyer.address(),
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
                        buyer.address(),
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
    player.set_total_shop_spent(player.total_shop_spent().saturating_add(final_price));
    player.set_milestone_tier(calculate_milestone_tier(player.total_shop_spent(), shop_config));
    super::common::update_streak_and_daily(&mut *player, now);

    // Emit event
    emit!(BundlePurchased {
        player: *player_account.address(),
        player_name: player.name,
        bundle_id,
        price: final_price,
        currency: payment_type,
        timestamp: now,
    });

    Ok(())
}

// HELPER FUNCTIONS

use super::common::{
    calculate_final_price, calculate_fib_bonus, calculate_milestone_discount,
    calculate_milestone_tier, calculate_streak_discount, calculate_subscription_discount,
    fulfill_item,
};
