use crate::{
    emit,
    error::GameError,
    events::shop::BundlePurchased,
    helpers::{
        add_to_inventory,
        estate::{load_estate_for_player, market_discount_bps, require_market},
        is_inventory_item_type, process_token_payment_flow,
    },
    processor::shop::common::is_cosmetic_item_type,
    state::{
        require_extension, unlock_extension_if_eligible, BundleAccount, BundleTier, GameEngine,
        PlayerAccount, ShopConfigAccount, ShopItemAccount, EXT_COSMETICS, EXT_INVENTORY,
        EXT_RESEARCH,
    },
    utils::{read_u32, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{error::ProgramError, sysvars::Sysvar, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::Transfer;

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
/// # Accounts (Required for Token Payment, payment_type >= 2)
///   Appended after the `shop_items[]` (token_offset = 9 + item_count):
/// - [] allowed_token, token_mint, [writable] buyer_token_ata, treasury_token_ata, token_program
///   Then, by oracle program (see helpers::process_token_payment_flow):
///   - Pyth (+2): sol `PriceUpdateV2`, token `PriceUpdateV2`
///   - Switchboard (+3): oracle-quote PDA, Switchboard queue, SlotHashes sysvar
///
/// # Building Bonuses
/// Market building provides shop discounts:
/// - 1% discount per Market level (max 20% at level 20)
///
/// # Instruction Data
/// - bundle_id: u32
/// - payment_type: u8 (0 = SOL, 2+ = Token via AllowedToken)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    // Minimum accounts: buyer, player, game_engine, shop_config, bundle, treasury, system, inventory, estate
    // Remaining accounts are shop items for fulfillment reference
    crate::extract_accounts!(
        accounts,
        [
            buyer,
            player_account,
            game_engine_account,
            shop_config_account,
            bundle_account,
            treasury,
            system_program,
            inventory_account,
            estate_account,
        ],
        rest = shop_item_accounts
    );

    // 2. Validate Accounts

    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(player_account)?;
    require_writable(bundle_account)?;
    require_writable(treasury)?;
    require_writable(inventory_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    let bundle_id = read_u32(instruction_data, 0, "purchase_bundle.bundle_id")?;
    let payment_type = read_u8(instruction_data, 4, "purchase_bundle.payment_type")?;

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

    // 5. Load Shop Config (owner + discriminator + canonical PDA).

    let shop_config = ShopConfigAccount::load_checked(
        shop_config_account,
        game_engine_account.address(),
        program_id,
    )?;

    // 6. Load and Validate Bundle

    // Verify bundle PDA
    let (expected_bundle, _bump) =
        BundleAccount::derive_pda(game_engine_account.address(), bundle_id);
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
        let player = PlayerAccount::load_checked_by_key(player_account, program_id)?;
        if player.owner != *buyer.address() {
            return Err(GameError::NotOwner.into());
        }
        require_extension(player, EXT_RESEARCH)?;
    }
    unlock_extension_if_eligible(player_account, buyer, EXT_INVENTORY)?;

    // 7.5. Pre-scan: if any bundle item routes through fulfill_item's cosmetic
    // branches, unlock EXT_COSMETICS now so `cosmetics_mut()` returns Some
    // during fulfillment. Without this, fulfill_item would error
    // (CosmeticsNotUnlocked) and the whole bundle purchase would revert —
    // safe for the buyer but unusable for any bundle that contains a
    // cosmetic. The simplified-fallback fulfillment uses item_id % 1000
    // which can never produce a cosmetic item_type, so the scan only needs
    // to cover the detailed (shop_item_accounts-provided) path.
    let bundle_item_count = (bundle.item_count as usize).min(bundle.items.len());
    if shop_item_accounts.len() >= bundle_item_count {
        let mut any_cosmetic = false;
        for i in 0..bundle_item_count {
            if bundle.items[i].quantity == 0 {
                continue;
            }
            // The main fulfillment loop below validates each shop_item PDA;
            // a spoofed account here would at worst trigger a redundant
            // EXT_COSMETICS unlock (benign — no cosmetic is granted).
            let shop_item_data = shop_item_accounts[i].try_borrow()?;
            let shop_item = unsafe { ShopItemAccount::load(&shop_item_data) };
            if is_cosmetic_item_type(shop_item.item_type) {
                any_cosmetic = true;
                break;
            }
        }
        if any_cosmetic {
            unlock_extension_if_eligible(player_account, buyer, EXT_COSMETICS)?;
        }
    }

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
    let milestone_discount_bps =
        calculate_milestone_discount(player.total_shop_spent(), shop_config);
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
        }
        .invoke()?;
    } else {
        // Token payment (payment_type >= 2). `shop_item_accounts` is the `rest`
        // slice, which greedily holds BOTH the per-item ShopItem accounts and
        // the trailing token-payment accounts. The layout is
        // [shop_item × item_count, ...token_accounts], so the token accounts are
        // the tail past the bundle's own items.
        let item_count = bundle.item_count as usize;
        let token_accounts = shop_item_accounts
            .get(item_count..)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;

        // Use unified token payment helper
        process_token_payment_flow(
            token_accounts,
            game_engine_account.address(),
            &game_engine.treasury_wallet,
            treasury,
            program_id,
            shop_config,
            buyer,
            final_price,
            None, // SOL-priced bundle; pegged tokens rejected by the helper
            system_program,
            clock.slot,
            clock.unix_timestamp,
        )?;
    }

    // 11. Fulfill Bundle Items

    let item_count = bundle.item_count as usize;

    // Resolving each bundle item's true item_type requires its ShopItemAccount:
    // item_id != item_type in the catalogue (gems are item_id 1 but item_type
    // 50), so the caller MUST pass one shop item account per bundle item. Without
    // the full set we cannot fulfil correctly — fail loudly rather than guess the
    // item_type from item_id and silently grant the wrong thing.
    if shop_item_accounts.len() < item_count {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Detailed fulfillment with item type lookup (one shop item account per item)
    {
        for i in 0..item_count {
            let bundle_item = &bundle.items[i];
            if bundle_item.quantity == 0 {
                continue;
            }

            let shop_item_account = &shop_item_accounts[i];

            // Verify this is the correct shop item
            let (expected_item_pda, _) =
                ShopItemAccount::derive_pda(game_engine_account.address(), bundle_item.item_id);
            if shop_item_account.address() != &expected_item_pda {
                return Err(GameError::InvalidAccount.into());
            }

            let shop_item_data_ref = shop_item_account.try_borrow()?;
            let shop_item = unsafe { ShopItemAccount::load(&shop_item_data_ref) };

            let amount = (bundle_item.quantity as u64).saturating_mul(shop_item.quantity_per_purchase as u64);

            // Check if this is an inventory item
            if is_inventory_item_type(shop_item.item_type) {
                for _ in 0..amount {
                    add_to_inventory(
                        program_id,
                        buyer,
                        player_account.address(),
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
    }

    // 12. Update Bundle Stats

    bundle.total_purchases = bundle.total_purchases.saturating_add(1);
    bundle.total_revenue_lamports = bundle.total_revenue_lamports.saturating_add(final_price);

    // 13. Update Player Shop State
    player.set_total_shop_spent(player.total_shop_spent().saturating_add(final_price));
    player.set_milestone_tier(calculate_milestone_tier(
        player.total_shop_spent(),
        shop_config,
    ));
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
    calculate_fib_bonus, calculate_final_price, calculate_milestone_discount,
    calculate_milestone_tier, calculate_streak_discount, calculate_subscription_discount,
    fulfill_item,
};
