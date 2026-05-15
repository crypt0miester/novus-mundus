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
    state::{GameEngine, PlayerAccount, UserAccount, ShopConfigAccount},
    validation::{require_signer, require_writable, require_key_match, require_owner},
    emit,
    events::shop::NoviPurchased,
    helpers::{validate_token_account_owner, detect_oracle_type, get_pyth_price, pin_oracle_feed, read_switchboard_price, scale_ratio, OracleType},
    logic::safe_math::apply_bp_penalty,
    utils::{read_u64, read_u8, unlikely},
};
use p_pyth::OraclePrice;

/// Purchase NOVI tokens from the shop
///
/// Users select from fixed package amounts. NOVI is minted to the user's
/// reserved token account. Bonuses are applied based on:
/// - Package tier (bulk discount)
/// - Subscription tier
/// - Purchase streak (consecutive daily purchases)
///
/// # Pricing
/// - If oracle is configured and oracle accounts are provided:
///   Uses oracle price with 15% undercut (novi_market_undercut_bps)
/// - Otherwise: Uses DAO-set fallback price (novi_base_price_lamports)
///
/// # Accounts (Required - 9)
/// 0. [signer, writable] buyer - Wallet paying SOL
/// 1. [writable] user_account - UserAccount PDA (tracks purchases)
/// 2. [] player_account - PlayerAccount PDA (for subscription tier)
/// 3. [] game_engine - GameEngine (config & pricing)
/// 4. [writable] treasury - Treasury wallet (receives SOL)
/// 5. [writable] novi_mint - NOVI token mint
/// 6. [writable] reserved_token_account - User's reserved ATA (receives minted NOVI)
/// 7. [] token_program - SPL Token program
/// 8. [] system_program - System program
///
/// # Accounts (Optional - Oracle Pricing, +3 accounts; Pyth or Switchboard)
/// 9. [] shop_config - ShopConfigAccount (for SOL oracle config)
/// 10. [] sol_oracle_feed - SOL/USD price feed (Pyth or Switchboard pull feed)
/// 11. [] novi_oracle_feed - NOVI/USD price feed (Pyth or Switchboard pull feed)
///
/// # Instruction Data
/// - package_index: u8 (0-4, which package to buy)
/// - max_lamports: u64 (slippage protection, max SOL willing to pay)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, [
        buyer,
        user_account,
        player_account,
        game_engine_account,
        treasury,
        novi_mint,
        reserved_token_account,
        token_program,
        system_program,
    ]);

    // 2. Validate Accounts
    require_signer(buyer)?;
    require_writable(buyer)?;
    require_writable(user_account)?;
    require_writable(treasury)?;
    require_writable(novi_mint)?;
    require_writable(reserved_token_account)?;
    require_key_match(token_program, &pinocchio_token::ID)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data
    let package_index = read_u8(instruction_data, 0, "purchase_novi.package_index")?;
    let max_lamports = read_u64(instruction_data, 1, "purchase_novi.max_lamports")?;

    if unlikely(package_index > 4) {
        pinocchio_log::log!("purchase_novi: package_index out of range: {}", package_index);
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load Game Engine (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    crate::require!(!game_engine.paused, GameError::GamePaused);
    crate::require_keys_eq!(
        treasury.address().as_array(),
        game_engine.treasury_wallet.as_array(),
        "purchase_novi.treasury",
        GameError::InvalidTreasury,
    );
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "purchase_novi.novi_mint",
        GameError::InvalidMint,
    );

    // 5. Load Player Account (for subscription tier, kingdom-scoped)
    let player = PlayerAccount::load_checked(player_account, game_engine_account.address(), buyer.address(), program_id)?;
    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;
    let subscription_tier = player.get_effective_tier(now);

    // 6. Load and Update User Account
    let mut user = UserAccount::load_checked_mut(user_account, buyer.address(), program_id)?;

    // 7. Get current day
    let current_day = (now / 86400) as u32;

    // 8. Calculate streak
    let streak_day = if user.novi_last_purchase_day == current_day {
        // Same day purchase, keep current streak
        user.novi_purchase_streak
    } else if user.novi_last_purchase_day == current_day - 1 {
        // Consecutive day, increment streak (max 7)
        user.novi_purchase_streak.saturating_add(1).min(7)
    } else {
        // Streak broken, start at day 1
        1
    };

    // 9. Reset daily counter if new day
    if user.novi_last_purchase_day != current_day {
        user.novi_purchased_today = 0;
    }

    // 10. Get purchase amount from config
    let novi_config = &game_engine.novi_purchase_config;
    let base_amount = novi_config.get_purchase_amount(package_index)
        .ok_or(GameError::InvalidParameter)?;

    // 11. Check daily cap
    let daily_cap = novi_config.get_daily_cap(subscription_tier);
    let new_total = user.novi_purchased_today.saturating_add(base_amount);
    if new_total > daily_cap {
        return Err(GameError::DailyCapExceeded.into());
    }

    // 12. Calculate bonuses
    let total_bonus_bps = novi_config.calculate_total_bonus_bps(
        package_index,
        subscription_tier,
        streak_day,
    );

    let bonus_amount = (base_amount as u128)
        .checked_mul(total_bonus_bps as u128)
        .and_then(|v| v.checked_div(10000))
        .ok_or(GameError::MathOverflow)? as u64;

    let total_novi = base_amount.saturating_add(bonus_amount);

    // 13. Calculate SOL cost using oracle price or fallback
    // Price is calculated per base_amount only (bonuses are free)
    let cost_lamports = calculate_cost_lamports(
        base_amount,
        novi_config,
        &accounts[9..],  // Optional oracle accounts
        game_engine_account.address(),
        program_id,
        clock.slot,
    )?;

    // 14. Slippage protection
    if cost_lamports > max_lamports {
        return Err(GameError::SlippageExceeded.into());
    }

    // 15. Validate reserved token account ownership
    validate_token_account_owner(reserved_token_account, user_account.address())?;

    // 16. Transfer SOL to treasury
    Transfer {
        from: buyer,
        to: treasury,
        lamports: cost_lamports,
    }.invoke()?;

    // 17. Mint NOVI to reserved token account
    // Game engine is the mint authority
    let kingdom_id_bytes = game_engine.kingdom_id.to_le_bytes();
    let game_engine_bump = game_engine.bump;
    let bump_seed = [game_engine_bump];
    let seeds = crate::seeds!(crate::constants::GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    crate::helpers::mint_tokens(
        novi_mint,
        reserved_token_account,
        game_engine_account,
        total_novi,
        &[signer],
    )?;

    // 18. Update user tracking
    user.novi_purchase_streak = streak_day;
    user.novi_last_purchase_day = current_day;
    user.novi_purchased_today = new_total;

    // 19. Update user's reserved_novi balance
    user.reserved_novi = user.reserved_novi
        .checked_add(total_novi)
        .ok_or(GameError::MathOverflow)?;

    // Update vesting basis so the 7-day vesting window starts now.
    // This prevents the bypass where fresh accounts with default 0 earned_at
    // could withdraw immediately (now - 0 ≫ 7d).
    user.reserved_novi_earned_at = now;

    // 20. Emit event
    emit!(NoviPurchased {
        buyer: *buyer.address(),
        user: *user_account.address(),
        package_index,
        base_amount,
        bonus_amount,
        total_received: total_novi,
        cost_lamports,
        streak_day,
        subscription_tier,
        timestamp: now,
    });

    Ok(())
}

// ORACLE PRICE CALCULATION

/// Calculate cost in lamports using oracle price or fallback.
///
/// When an oracle is *configured* on `novi_config`, oracle errors
/// must be fatal (not silently fall back to `novi_base_price_lamports`).
/// Otherwise an attacker can deliberately supply a malformed feed to force
/// the cheap fallback path. The fallback is only used when no oracle is
/// configured at all (DAO has not set feeds yet).
fn calculate_cost_lamports(
    base_amount: u64,
    novi_config: &crate::state::NoviPurchaseConfig,
    oracle_accounts: &[AccountView],
    game_engine_key: &Address,
    program_id: &Address,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    // No oracle configured: pure DAO-set fallback price.
    if !novi_config.has_oracle() {
        return base_amount
            .checked_mul(novi_config.novi_base_price_lamports)
            .ok_or(GameError::MathOverflow.into());
    }

    // Oracle is configured — require feed accounts and propagate any failure.
    if oracle_accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    try_oracle_price(
        base_amount,
        novi_config,
        oracle_accounts,
        game_engine_key,
        program_id,
        current_slot,
    )
}

/// Try to calculate price using oracle.
///
/// `oracle_accounts`:
/// - [0] shop_config
/// - [1] sol_oracle_feed (Pyth price account or Switchboard pull feed)
/// - [2] novi_oracle_feed (same oracle program as sol_oracle_feed)
fn try_oracle_price(
    base_amount: u64,
    novi_config: &crate::state::NoviPurchaseConfig,
    oracle_accounts: &[AccountView],
    _game_engine_key: &Address,
    program_id: &Address,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    let shop_config_account = &oracle_accounts[0];
    let sol_oracle_feed = &oracle_accounts[1];
    let novi_oracle_feed = &oracle_accounts[2];

    require_owner(shop_config_account, program_id)?;
    let shop_config_data = shop_config_account.try_borrow()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data) };

    // Detect oracle type by feed owner; reject mixed Pyth+Switchboard.
    let oracle_type = detect_oracle_type(sol_oracle_feed)?;
    if unlikely(detect_oracle_type(novi_oracle_feed)? != oracle_type) {
        pinocchio_log::log!("purchase_novi: mixed Pyth+Switchboard feeds rejected");
        return Err(GameError::OracleUnavailable.into());
    }

    // Pin both feeds to the DAO-configured pubkey for this oracle type.
    let (sol_configured, novi_configured) = match oracle_type {
        OracleType::Pyth => (&shop_config.sol_pyth_feed, &novi_config.novi_pyth_feed),
        OracleType::Switchboard => (&shop_config.sol_switchboard_feed, &novi_config.novi_switchboard_feed),
    };
    pin_oracle_feed(sol_oracle_feed, sol_configured)?;
    pin_oracle_feed(novi_oracle_feed, novi_configured)?;

    let price_lamports = match oracle_type {
        OracleType::Pyth => {
            let (sol_price, novi_price) = get_pyth_prices(
                sol_oracle_feed,
                novi_oracle_feed,
                shop_config,
                novi_config,
                current_slot,
            )?;
            calculate_lamports_from_pyth(base_amount, &sol_price, &novi_price)?
        }
        OracleType::Switchboard => {
            let sol_price = read_switchboard_price(
                sol_oracle_feed,
                current_slot,
                shop_config.sol_max_staleness_slots as u64,
                shop_config.sol_confidence_threshold_bps,
            )?;
            let novi_price = read_switchboard_price(
                novi_oracle_feed,
                current_slot,
                novi_config.novi_max_staleness_slots as u64,
                novi_config.novi_confidence_threshold_bps,
            )?;
            calculate_lamports_from_sb(base_amount, sol_price.value, novi_price.value)?
        }
    };

    // undercut means user pays LESS, so we reduce the price.
    let undercut_bps = novi_config.novi_market_undercut_bps;
    apply_bp_penalty(price_lamports, undercut_bps)
        .ok_or(GameError::MathOverflow.into())
}

fn get_pyth_prices(
    sol_oracle_feed: &AccountView,
    novi_oracle_feed: &AccountView,
    shop_config: &ShopConfigAccount,
    novi_config: &crate::state::NoviPurchaseConfig,
    current_slot: u64,
) -> Result<(OraclePrice, OraclePrice), ProgramError> {
    let sol_oracle_data = sol_oracle_feed.try_borrow()?;
    let sol_price = get_pyth_price(
        &sol_oracle_data,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
        shop_config.sol_confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    let novi_oracle_data = novi_oracle_feed.try_borrow()?;
    let novi_price = get_pyth_price(
        &novi_oracle_data,
        current_slot,
        novi_config.novi_max_staleness_slots as u64,
        novi_config.novi_confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    Ok((sol_price, novi_price))
}

/// Calculate lamports cost from Pyth prices.
///
/// Formula: lamports = base_amount * (novi_usd / sol_usd) * 10^8
/// where 10^8 = 10^9 (SOL decimals) / 10^1 (NOVI decimal).
fn calculate_lamports_from_pyth(
    base_amount: u64,
    sol_price: &OraclePrice,
    novi_price: &OraclePrice,
) -> Result<u64, ProgramError> {
    // lamports = base_amount * (novi_usd / sol_usd) * 10^8
    // — all powers of ten folded into one `net_expo` for scale_ratio.
    if sol_price.price <= 0 || novi_price.price <= 0 {
        return Err(GameError::OracleUnavailable.into());
    }

    let net_expo = novi_price.expo - sol_price.expo + 8;
    let numerator = (base_amount as u128)
        .checked_mul(novi_price.price as u128)
        .ok_or(GameError::OracleOverflow)?;

    let lamports = scale_ratio(numerator, sol_price.price as u128, net_expo)?;

    if lamports > u64::MAX as u128 {
        return Err(GameError::OracleOverflow.into());
    }
    Ok(lamports as u64)
}

/// Calculate lamports cost from Switchboard pull-feed prices (i128 @ 10^18).
///
/// Both prices share the same scale (10^18), so they cancel in the ratio.
/// Direct u128 math — no lossy i128→i64 round-trip through Pyth's
/// OraclePrice (which is what the old stub did, and would have silently
/// truncated for any token over ~$9 at 10^18 scale).
fn calculate_lamports_from_sb(
    base_amount: u64,
    sol_usd_i128: i128,
    novi_usd_i128: i128,
) -> Result<u64, ProgramError> {
    if sol_usd_i128 <= 0 || novi_usd_i128 <= 0 {
        return Err(GameError::OracleUnavailable.into());
    }
    let sol_usd = sol_usd_i128 as u128;
    let novi_usd = novi_usd_i128 as u128;

    // Same formula as the Pyth path; 10^18 scale cancels in the division.
    let numerator = (base_amount as u128)
        .checked_mul(novi_usd)
        .ok_or(GameError::OracleOverflow)?
        .checked_mul(100_000_000) // 10^8
        .ok_or(GameError::OracleOverflow)?;

    let lamports = numerator
        .checked_div(sol_usd)
        .ok_or(GameError::OracleOverflow)?;

    if lamports > u64::MAX as u128 {
        return Err(GameError::OracleOverflow.into());
    }
    Ok(lamports as u64)
}
