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
    state::{GameEngine, PlayerAccount, UserAccount, ShopConfigAccount},
    validation::{require_signer, require_writable, require_key_match, require_owner},
    emit,
    events::shop::NoviPurchased,
    helpers::{validate_token_account_owner, detect_oracle_type, get_pyth_price, OracleType},
    logic::safe_math::apply_bp_penalty,
};
use p_pyth::OraclePrice;
use switchboard_on_demand::QuoteVerifier;

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
/// # Accounts (Optional - Oracle Pricing with Pyth, +3 accounts)
/// 9. [] shop_config - ShopConfigAccount (for SOL oracle config)
/// 10. [] sol_oracle_feed - SOL/USD Pyth price feed
/// 11. [] novi_oracle_feed - NOVI/USD Pyth price feed
///
/// # Accounts (Optional - Oracle Pricing with Switchboard, +6 accounts)
/// 9. [] shop_config - ShopConfigAccount (for SOL oracle config)
/// 10. [] sol_oracle_feed - SOL/USD Switchboard quote
/// 11. [] novi_oracle_feed - NOVI/USD Switchboard quote
/// 12. [] switchboard_queue - Switchboard queue account
/// 13. [] slothashes_sysvar - SlotHashes sysvar
/// 14. [] instructions_sysvar - Instructions sysvar
///
/// # Instruction Data
/// - package_index: u8 (0-4, which package to buy)
/// - max_lamports: u64 (slippage protection, max SOL willing to pay)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    if accounts.len() < 9 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let buyer = &accounts[0];
    let user_account = &accounts[1];
    let player_account = &accounts[2];
    let game_engine_account = &accounts[3];
    let treasury = &accounts[4];
    let novi_mint = &accounts[5];
    let reserved_token_account = &accounts[6];
    let token_program = &accounts[7];
    let system_program = &accounts[8];

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
    if instruction_data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let package_index = instruction_data[0];
    let max_lamports = u64::from_le_bytes(instruction_data[1..9].try_into().unwrap());

    // Validate package index
    if package_index > 4 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load Game Engine (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Check game not paused
    if game_engine.paused {
        return Err(GameError::GamePaused.into());
    }

    // Verify treasury matches
    if treasury.key() != &game_engine.treasury_wallet {
        return Err(GameError::InvalidTreasury.into());
    }

    // Verify novi mint matches
    if novi_mint.key() != &game_engine.novi_mint {
        return Err(GameError::InvalidMint.into());
    }

    // 5. Load Player Account (for subscription tier, kingdom-scoped)
    let player = PlayerAccount::load_checked(player_account, game_engine_account.key(), buyer.key(), program_id)?;
    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;
    let subscription_tier = player.get_effective_tier(now);

    // 6. Load and Update User Account
    let mut user = UserAccount::load_checked_mut(user_account, buyer.key(), program_id)?;

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
        game_engine_account.key(),
        program_id,
        clock.slot,
    )?;

    // 14. Slippage protection
    if cost_lamports > max_lamports {
        return Err(GameError::SlippageExceeded.into());
    }

    // 15. Validate reserved token account ownership
    validate_token_account_owner(reserved_token_account, user_account.key())?;

    // 16. Transfer SOL to treasury
    Transfer {
        from: buyer,
        to: treasury,
        lamports: cost_lamports,
    }.invoke()?;

    // 17. Mint NOVI to reserved token account
    // Game engine is the mint authority
    let game_engine_bump = game_engine.bump;
    let bump_seed = [game_engine_bump];
    let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

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

    // 20. Emit event
    emit!(NoviPurchased {
        buyer: *buyer.key(),
        user: *user_account.key(),
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

// ============================================================
// ORACLE PRICE CALCULATION
// ============================================================

/// Calculate cost in lamports using oracle price or fallback
///
/// If oracle accounts are provided and valid, uses oracle prices with undercut.
/// Otherwise falls back to novi_base_price_lamports.
fn calculate_cost_lamports(
    base_amount: u64,
    novi_config: &crate::state::NoviPurchaseConfig,
    oracle_accounts: &[AccountInfo],
    game_engine_key: &Pubkey,
    program_id: &Pubkey,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    // Check if oracle is configured and accounts provided
    if !novi_config.has_oracle() || oracle_accounts.len() < 3 {
        // Use fallback price
        return base_amount
            .checked_mul(novi_config.novi_base_price_lamports)
            .ok_or(GameError::MathOverflow.into());
    }

    // Try to get oracle price
    match try_oracle_price(
        base_amount,
        novi_config,
        oracle_accounts,
        game_engine_key,
        program_id,
        current_slot,
    ) {
        Ok(price) => Ok(price),
        Err(_) => {
            // Oracle failed, use fallback price
            base_amount
                .checked_mul(novi_config.novi_base_price_lamports)
                .ok_or(GameError::MathOverflow.into())
        }
    }
}

/// Try to calculate price using oracle
fn try_oracle_price(
    base_amount: u64,
    novi_config: &crate::state::NoviPurchaseConfig,
    oracle_accounts: &[AccountInfo],
    _game_engine_key: &Pubkey,
    program_id: &Pubkey,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    // Parse oracle accounts
    // [0] = shop_config
    // [1] = sol_oracle_feed
    // [2] = novi_oracle_feed
    // [3..] = switchboard extras (queue, slothashes, instructions)

    let shop_config_account = &oracle_accounts[0];
    let sol_oracle_feed = &oracle_accounts[1];
    let novi_oracle_feed = &oracle_accounts[2];

    // Validate shop_config
    require_owner(shop_config_account, program_id)?;
    let shop_config_data = shop_config_account.try_borrow_data()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data) };

    // Detect oracle type from SOL feed
    let sol_oracle_data = sol_oracle_feed.try_borrow_data()?;
    let oracle_type = detect_oracle_type(&sol_oracle_data);

    // Get prices based on oracle type
    let (sol_price, novi_price) = match oracle_type {
        OracleType::Pyth => {
            get_pyth_prices(
                &sol_oracle_data,
                novi_oracle_feed,
                shop_config,
                novi_config,
                current_slot,
            )?
        }
        OracleType::Switchboard => {
            // Need extra accounts for Switchboard
            if oracle_accounts.len() < 6 {
                return Err(ProgramError::NotEnoughAccountKeys);
            }
            get_switchboard_prices(
                sol_oracle_feed,
                novi_oracle_feed,
                &oracle_accounts[3], // queue
                &oracle_accounts[4], // slothashes
                &oracle_accounts[5], // instructions
                shop_config,
                novi_config,
                current_slot,
            )?
        }
    };

    // Calculate cost: base_amount * (novi_usd / sol_usd) * 10^9 / 10^novi_decimals
    // Since both prices are OraclePrice with same expo after normalization,
    // we can calculate: lamports = base_amount * novi_price / sol_price * (10^9 / 10^1)
    // NOVI has 1 decimal, SOL has 9 decimals
    //
    // Formula: lamports = base_amount * novi_usd / sol_usd * 10^8
    // (10^9 SOL decimals / 10^1 NOVI decimal = 10^8)

    let price_lamports = calculate_lamports_from_oracle(
        base_amount,
        &sol_price,
        &novi_price,
    )?;

    // Apply undercut (e.g., 15% off market price)
    // undercut means user pays LESS, so we reduce the price
    let undercut_bps = novi_config.novi_market_undercut_bps;
    let final_price = apply_bp_penalty(price_lamports, undercut_bps)
        .ok_or(GameError::MathOverflow)?;

    Ok(final_price)
}

/// Get Pyth prices for SOL and NOVI
fn get_pyth_prices(
    sol_oracle_data: &[u8],
    novi_oracle_feed: &AccountInfo,
    shop_config: &ShopConfigAccount,
    novi_config: &crate::state::NoviPurchaseConfig,
    current_slot: u64,
) -> Result<(OraclePrice, OraclePrice), ProgramError> {
    // Get SOL/USD price
    let sol_price = get_pyth_price(
        sol_oracle_data,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
        shop_config.sol_confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    // Get NOVI/USD price
    let novi_oracle_data = novi_oracle_feed.try_borrow_data()?;
    let novi_price = get_pyth_price(
        &novi_oracle_data,
        current_slot,
        novi_config.novi_max_staleness_slots as u64,
        novi_config.novi_confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    Ok((sol_price, novi_price))
}

/// Get Switchboard prices for SOL and NOVI
fn get_switchboard_prices(
    sol_oracle_feed: &AccountInfo,
    novi_oracle_feed: &AccountInfo,
    queue_account: &AccountInfo,
    slothashes_sysvar: &AccountInfo,
    instructions_sysvar: &AccountInfo,
    shop_config: &ShopConfigAccount,
    novi_config: &crate::state::NoviPurchaseConfig,
    current_slot: u64,
) -> Result<(OraclePrice, OraclePrice), ProgramError> {
    // Get SOL/USD price from Switchboard
    let sol_price_i128 = get_switchboard_price_value(
        sol_oracle_feed,
        queue_account,
        slothashes_sysvar,
        instructions_sysvar,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
    )?;

    // Get NOVI/USD price from Switchboard
    let novi_price_i128 = get_switchboard_price_value(
        novi_oracle_feed,
        queue_account,
        slothashes_sysvar,
        instructions_sysvar,
        current_slot,
        novi_config.novi_max_staleness_slots as u64,
    )?;

    // Convert Switchboard i128 (18 decimals) to OraclePrice
    // OraclePrice uses expo field, Switchboard uses fixed 18 decimals
    let sol_price = OraclePrice {
        price: sol_price_i128 as i64,
        conf: 0,
        expo: -18,
        publish_time: 0,
    };
    let novi_price = OraclePrice {
        price: novi_price_i128 as i64,
        conf: 0,
        expo: -18,
        publish_time: 0,
    };

    Ok((sol_price, novi_price))
}

/// Get price value from Switchboard oracle
fn get_switchboard_price_value(
    quote_account: &AccountInfo,
    queue_account: &AccountInfo,
    slothashes_sysvar: &AccountInfo,
    instructions_sysvar: &AccountInfo,
    current_slot: u64,
    max_staleness_slots: u64,
) -> Result<i128, ProgramError> {
    let quote_data = QuoteVerifier::new()
        .slothash_sysvar(slothashes_sysvar)
        .ix_sysvar(instructions_sysvar)
        .clock_slot(current_slot)
        .queue(queue_account)
        .max_age(max_staleness_slots)
        .verify_account(quote_account)
        .map_err(|_| GameError::OraclePriceStale)?;

    let feed = quote_data.feeds().first()
        .ok_or(GameError::OracleUnavailable)?;

    Ok(feed.value().mantissa())
}

/// Calculate lamports cost from oracle prices
///
/// Formula: lamports = base_amount * (novi_usd / sol_usd) * 10^8
/// Where 10^8 = 10^9 (SOL decimals) / 10^1 (NOVI decimals)
fn calculate_lamports_from_oracle(
    base_amount: u64,
    sol_price: &OraclePrice,
    novi_price: &OraclePrice,
) -> Result<u64, ProgramError> {
    // Normalize both prices to same exponent for comparison
    const WORK_EXPO: i32 = -18;

    let sol_usd = sol_price.get_price_in_target_expo(WORK_EXPO)
        .ok_or(GameError::OracleOverflow)?;
    let novi_usd = novi_price.get_price_in_target_expo(WORK_EXPO)
        .ok_or(GameError::OracleOverflow)?;

    if sol_usd == 0 {
        return Err(GameError::OracleUnavailable.into());
    }

    // Calculate: (base_amount * novi_usd * 10^8) / sol_usd
    // NOVI has 1 decimal in base_amount (e.g., 5000 = 500 NOVI)
    // SOL has 9 decimals in lamports
    // Conversion factor: 10^9 / 10^1 = 10^8

    let numerator = (base_amount as u128)
        .checked_mul(novi_usd as u128)
        .ok_or(GameError::OracleOverflow)?
        .checked_mul(100_000_000) // 10^8
        .ok_or(GameError::OracleOverflow)?;

    let lamports = numerator
        .checked_div(sol_usd as u128)
        .ok_or(GameError::OracleOverflow)?;

    // Convert back to u64
    if lamports > u64::MAX as u128 {
        return Err(GameError::OracleOverflow.into());
    }

    Ok(lamports as u64)
}
