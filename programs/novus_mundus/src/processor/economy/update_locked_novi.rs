use pinocchio::{
    AccountView,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, UserAccount, GameEngine},
    helpers::estate::{vault_novi_cap_bonus_bps, load_estate_for_player},
    emit,
    events::NoviLocked,
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
/// # Subscription Tiers (from GameEngine) — display values (raw = ×10 for 1 decimal)
/// - Rookie: 50 NOVI per 5 min (max 3,000 NOVI) → full in 5h
/// - Expert: 100 NOVI per 5 min (max 6,000 NOVI) → full in 5h
/// - Epic: 500 NOVI per 5 min (max 30,000 NOVI) → full in 5h
/// - Legendary: 2,500 NOVI per 5 min (max 150,000 NOVI) → full in 5h
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [] user: UserAccount PDA (for subscription data)
/// - [signer] owner: Wallet that owns both accounts
/// - [writable] player_token_account: Player's NOVI token account (ATA)
/// - [writable] novi_mint: NOVI token mint
/// - [] game_engine: GameEngine PDA (mint authority)
/// - [] token_program: SPL Token program
/// - [] estate_account: EstateAccount PDA (for Vault cap bonus)
///
/// # Building Bonuses
/// Vault building increases max NOVI cap:
/// - Lv 5-9: +50% cap
/// - Lv 10-14: +100% cap
/// - Lv 15-19: +150% cap
/// - Lv 20+: +200% cap
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        user_account,
        owner,
        player_token_account,
        novi_mint,
        game_engine_account,
        _token_program,
        estate_account,
    ]);

    // 2. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // Verify token account belongs to the PlayerAccount PDA
    crate::helpers::validate_token_account_owner(player_token_account, player_account.address())?;

    // 3. Load Accounts

    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    let user_data_ref = user_account.try_borrow()?;
    let user_data = unsafe { UserAccount::load(&user_data_ref) };

    // 4. Validate Ownership

    if !player_data.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    if &user_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Get Current Timestamp

    let now = Clock::get()?.unix_timestamp;

    // 6. Calculate Time Elapsed
    const TIME_INTERVAL: i64 = 300; // 5 minutes in seconds

    let time_since_last_update = now.saturating_sub(player_data.last_updated_tokens_at);

    // If less than one interval has passed, nothing to update
    if time_since_last_update < TIME_INTERVAL {
        return Ok(());
    }

    let intervals_elapsed = time_since_last_update / TIME_INTERVAL;

    // 7. Determine Generation Rate from Subscription Tier

    // Validate GameEngine fully (ownership + PDA + discriminator + bump), then
    // use raw pointer access to avoid holding RefCell borrows across the mint_tokens CPI.
    {
        let _ge = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    }
    let game_engine_data = unsafe { &*(game_engine_account.data_ptr() as *const GameEngine) };

    // Determine active tier (free tier 0 if expired)
    let tier_index = if player_data.subscription_end > now {
        player_data.subscription_tier.min(3) // Cap at 3 for safety
    } else {
        0 // Expired or no subscription = free tier
    };

    let tier = &game_engine_data.subscription_tiers[tier_index as usize];
    let generation_rate = tier.generation_multiplier;

    // 8. Calculate Max Cap (with Vault bonus)

    let base_max_locked_novi = tier.max_locked_novi;

    // Apply Vault building bonus (BUILDING BONUS)
    // Vault increases max NOVI cap by percentage
    let estate = load_estate_for_player(estate_account, player_data, program_id)?;
    let vault_bonus_bps = vault_novi_cap_bonus_bps(estate);

    // Apply bonus: cap × (10000 + bonus_bps) / 10000
    let max_locked_novi = if vault_bonus_bps > 0 {
        let bonus_multiplier = 10000u64.saturating_add(vault_bonus_bps as u64);
        base_max_locked_novi.saturating_mul(bonus_multiplier) / 10000
    } else {
        base_max_locked_novi
    };

    // If already at cap, update timestamp and return.
    // This prevents time from banking while at cap — without this,
    // a player who sits at cap for days then spends would get an
    // instant refill from the stale last_updated_tokens_at.
    if player_data.locked_novi >= max_locked_novi {
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
        let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
        let bump_seed = [game_engine_data.bump];
        let seeds = crate::seeds!(crate::constants::GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
        let signer = pinocchio::cpi::Signer::from(&seeds);

        crate::require_keys_eq!(
            novi_mint.address().as_array(),
            &crate::constants::NOVI_MINT_ADDRESS,
            "update_locked_novi.novi_mint",
            GameError::InvalidMint,
        );

        // Mint tokens to player's token account (increases total supply)
        crate::helpers::mint_tokens(
            novi_mint,
            player_token_account,
            game_engine_account,
            actual_tokens_generated,
            &[signer],
        )?;

        // Emit NoviLocked event
        emit!(NoviLocked {
            player: *player_account.address(),
            player_name: player_data.name,
            amount: actual_tokens_generated,
            total_locked: player_data.locked_novi,
            timestamp: now,
        });
    }

    Ok(())
}
