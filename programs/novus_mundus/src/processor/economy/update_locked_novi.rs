use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, UserAccount, GameEngine},
};

/// Update locked NOVI balance based on time elapsed since last update
///
/// This processor calculates how many NOVI tokens the player has generated
/// based on their subscription tier and time elapsed, then MINTS those tokens
/// directly to their locked_novi balance.
///
/// # Token Generation Formula
/// ```text
/// time_interval = 5 minutes (300 seconds)
/// generation_rate = subscription_interval (NOVI per interval)
/// max_tokens = generation_rate * 300
///
/// If subscription expired:
///   generation_rate = 10 (default free tier)
///
/// elapsed_intervals = (now - last_updated_tokens_at) / time_interval
/// tokens_to_mint = elapsed_intervals * generation_rate
/// new_locked_novi = min(locked_novi + tokens_to_mint, max_tokens)
/// ```
///
/// # Subscription Tiers (from GameEngine)
/// - Rookie: 10 NOVI per 5 min (max 3,000)
/// - Expert: 20 NOVI per 5 min (max 6,000)
/// - Epic: 100 NOVI per 5 min (max 30,000)
/// - Legendary: 500 NOVI per 5 min (max 150,000)
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [] user: UserAccount PDA (for subscription data)
/// - [signer] owner: Wallet that owns both accounts
/// - [writable] player_token_account: Player's NOVI token account (ATA)
/// - [writable] novi_mint: NOVI token mint
/// - [] game_engine: GameEngine PDA (mint authority)
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        user_account,
        owner,
        player_token_account,
        novi_mint,
        game_engine_account,
        _token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 3. Load Accounts

    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    let user_data_ref = user_account.try_borrow_data()?;
    let user_data = unsafe { UserAccount::load(&user_data_ref) };

    // 4. Validate Ownership

    if !player_data.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    if &user_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Get Current Timestamp

    let now = Clock::get()?.unix_timestamp;

    // 6. Calculate Time Elapsed

    const TIME_INTERVAL: i64 = 5 * 60; // 5 minutes in seconds

    let time_since_last_update = now.saturating_sub(player_data.last_updated_tokens_at);

    // If less than one interval has passed, nothing to update
    if time_since_last_update < TIME_INTERVAL {
        return Ok(());
    }

    let intervals_elapsed = time_since_last_update / TIME_INTERVAL;

    // 7. Determine Generation Rate from Subscription Tier

    // Load GameEngine to get subscription tier config
    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine_data = unsafe { GameEngine::load(&game_engine_data_ref) };

    // Determine active tier (free tier 0 if expired)
    let tier_index = if player_data.subscription_end > now {
        player_data.subscription_tier.min(3) // Cap at 3 for safety
    } else {
        0 // Expired or no subscription = free tier
    };

    let tier = &game_engine_data.subscription_tiers[tier_index as usize];
    let generation_rate = tier.generation_multiplier;

    // 8. Calculate Max Cap

    let max_locked_novi = tier.max_locked_novi;

    // If already at cap, nothing to update
    if player_data.locked_novi >= max_locked_novi {
        // Still update timestamp to prevent overflow
        player_data.last_updated_tokens_at = now;
        return Ok(());
    }

    // 9. Calculate Tokens to Generate

    let tokens_to_generate = intervals_elapsed
        .checked_mul(generation_rate as i64)
        .ok_or(GameError::MathOverflow)? as u64;

    // 10. Update Player Balance (with cap)

    let new_balance = player_data.locked_novi
        .saturating_add(tokens_to_generate);

    // Apply cap
    player_data.locked_novi = new_balance.min(max_locked_novi);

    // 11. Update Timestamp

    player_data.last_updated_tokens_at = now;

    // 12. Actually MINT tokens via CPI

    // Only mint the actual tokens generated (respecting the cap)
    let actual_tokens_generated = new_balance.min(max_locked_novi)
        .saturating_sub(player_data.locked_novi.saturating_sub(tokens_to_generate));

    if actual_tokens_generated > 0 {
        // game_engine_data already loaded above - reuse it

        // Create PDA signer for GameEngine (mint authority)
        let bump_seed = [game_engine_data.bump];
        let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

        // Mint tokens to player's token account (increases total supply)
        crate::helpers::mint_tokens(
            novi_mint,
            player_token_account,
            game_engine_account,
            actual_tokens_generated,
            &[signer],
        )?;
    }

    Ok(())
}
