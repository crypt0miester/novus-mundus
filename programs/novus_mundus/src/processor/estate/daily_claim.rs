use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::GAME_ENGINE_SEED,
    emit,
    error::GameError,
    events::estate::EstateDailyClaimed,
    helpers::{estate::require_mansion, mint_tokens, validate_token_account_owner},
    logic::safe_math::apply_bp_bonus,
    state::{EstateAccount, GameEngine, PlayerAccount},
    validation::{require_key_match, require_owner, require_signer, require_writable},
};

/// Daily Login Claim (Mansion)
///
/// Claims daily login rewards from the Mansion.
/// Rewards scale with login streak multiplier.
/// Miss a day = streak resets to 0.
///
/// # Rewards (Base)
/// - 100 common materials
/// - 50 NOVI (added to locked_novi)
/// - 10 XP
///
/// # Streak Multipliers
/// - Days 1-6: 1.0x
/// - Days 7-13: 1.25x
/// - Days 14-29: 1.5x
/// - Days 30-59: 2.0x
/// - Days 60-89: 2.5x
/// - Days 90+: 3.0x
///
/// # Milestone Rewards (One-time)
/// - 7 days: 500 NOVI + 100 uncommon
/// - 14 days: 1,000 NOVI + 50 rare
/// - 30 days: 5,000 NOVI + 25 epic + "Dedicated" title
/// - 60 days: 15,000 NOVI + 10 legendary + cosmetic
/// - 90 days: 30,000 NOVI + artifact + "Unwavering" title
/// - 180 days: 100,000 NOVI + legendary artifact + permanent +5%
///
/// # Accounts
/// - [writable, signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA
/// - [writable] player_novi_ata: Player's NOVI token account (owned by PlayerAccount PDA)
/// - [writable] novi_mint: NOVI mint
/// - [] game_engine: GameEngine PDA (mint authority)
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        owner,
        player_account,
        estate_account,
        player_novi_ata,
        novi_mint,
        game_engine,
        token_program,
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;
    require_writable(player_novi_ata)?;
    require_writable(novi_mint)?;
    // Program-ownership gate (precedes the unsafe ::load calls below).
    require_owner(player_account, program_id)?;
    require_owner(estate_account, program_id)?;
    // Token-program ID + NOVI mint identity + ATA owner must match.
    require_key_match(token_program, &pinocchio_token::ID)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "daily_claim.novi_mint",
        GameError::InvalidMint,
    );
    validate_token_account_owner(player_novi_ata, player_account.address())?;

    // 3. Load Accounts
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // 4. Verify ownership
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    if &estate_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. HARD GATE: Require Mansion (any level) and extract level
    // Extract mansion level immediately to avoid borrow conflict
    let mansion_level = {
        let mansion = require_mansion(estate_data, 1)?;
        mansion.level
    };

    // 6. Get current time
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 7. Check/update login streak
    let is_new_day = estate_data.check_login_streak(now);
    if !is_new_day {
        // Already claimed today
        return Err(GameError::AlreadyClaimedToday.into());
    }

    // 8. Get streak multiplier
    let streak_multiplier_bps = estate_data.get_streak_multiplier_bps();

    // 9. Calculate base rewards (scaled by Mansion level)
    // Mansion bonus: +5% per level
    let mansion_bonus_bps = (mansion_level as u16) * 500;

    // Base rewards
    let base_materials: u64 = 100;
    let base_novi: u64 = 50;
    let base_xp: u64 = 10;

    // Apply mansion bonus then streak multiplier
    let materials_with_mansion =
        apply_bp_bonus(base_materials, mansion_bonus_bps).unwrap_or(base_materials);
    let novi_with_mansion = apply_bp_bonus(base_novi, mansion_bonus_bps).unwrap_or(base_novi);
    let xp_with_mansion = apply_bp_bonus(base_xp, mansion_bonus_bps).unwrap_or(base_xp);

    // Apply streak multiplier (already in bps where 10000 = 1.0x)
    let final_materials =
        materials_with_mansion.saturating_mul(streak_multiplier_bps as u64) / 10000;
    let final_novi = novi_with_mansion.saturating_mul(streak_multiplier_bps as u64) / 10000;
    let final_xp = xp_with_mansion.saturating_mul(streak_multiplier_bps as u64) / 10000;

    // Apply permanent bonus from 180-day milestone
    let final_materials = if estate_data.permanent_bonus_bps > 0 {
        apply_bp_bonus(final_materials, estate_data.permanent_bonus_bps).unwrap_or(final_materials)
    } else {
        final_materials
    };
    let final_novi = if estate_data.permanent_bonus_bps > 0 {
        apply_bp_bonus(final_novi, estate_data.permanent_bonus_bps).unwrap_or(final_novi)
    } else {
        final_novi
    };
    let final_xp = if estate_data.permanent_bonus_bps > 0 {
        apply_bp_bonus(final_xp, estate_data.permanent_bonus_bps).unwrap_or(final_xp)
    } else {
        final_xp
    };

    // 10. Grant rewards
    player_data.set_common_materials(
        player_data
            .common_materials()
            .saturating_add(final_materials),
    );
    player_data.locked_novi = player_data.locked_novi.saturating_add(final_novi);
    player_data.current_xp = player_data.current_xp.saturating_add(final_xp);

    // 11. Check for milestone rewards (one-time)
    let streak = estate_data.login_streak;
    let milestone_novi = grant_milestone_rewards(player_data, streak);

    // 12. Update activity timestamp
    estate_data.last_activity = now;

    // 13. Emit EstateDailyClaimed event
    emit!(EstateDailyClaimed {
        player: *player_account.address(),
        player_name: player_data.name,
        materials: final_materials,
        streak: estate_data.login_streak,
        timestamp: now,
    });

    // 14. Mint NOVI to player's ATA so the wallet balance tracks locked_novi.
    //     Without this CPI, locked_novi accounting drifts upward over time
    //     while the ATA stays empty, causing later burns (hire/build/etc.) to
    //     fail with SPL InsufficientFunds even though the UI shows balance.
    drop(player_data_ref);
    drop(estate_data_ref);

    let total_novi = final_novi.saturating_add(milestone_novi);
    if total_novi > 0 {
        let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
        let bump_seed = [game_engine_data.bump];
        let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
        let seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
        let signer = pinocchio::cpi::Signer::from(&seeds);

        mint_tokens(
            novi_mint,
            player_novi_ata,
            game_engine,
            total_novi,
            &[signer],
        )?;
    }

    Ok(())
}

/// Grant one-time milestone rewards based on streak. Returns the NOVI amount
/// added to locked_novi (raw units) so the caller can mint a matching amount
/// to the player's ATA in the same instruction.
fn grant_milestone_rewards(player: &mut PlayerAccount, streak: u16) -> u64 {
    // Check exact streak values for milestones
    // These are one-time grants, not cumulative
    let novi_grant: u64 = match streak {
        7 => {
            player.set_uncommon_materials(player.uncommon_materials().saturating_add(100));
            500
        }
        14 => {
            player.set_rare_materials(player.rare_materials().saturating_add(50));
            1_000
        }
        30 => {
            player.set_epic_materials(player.epic_materials().saturating_add(25));
            // Title: "Dedicated" - would be stored in a separate system
            5_000
        }
        60 => {
            player.set_legendary_materials(player.legendary_materials().saturating_add(10));
            // Cosmetic unlock - would be stored in inventory
            15_000
        }
        90 => {
            // Artifact + "Unwavering" title - separate systems
            30_000
        }
        180 => {
            // Legendary artifact + permanent +5% - permanent_bonus_bps set in check_login_streak
            100_000
        }
        _ => 0,
    };
    player.locked_novi = player.locked_novi.saturating_add(novi_grant);
    novi_grant
}
