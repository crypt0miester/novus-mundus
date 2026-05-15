//! Expedition Strike/Cast Processor (Phase 2)
//!
//! During an active expedition, players can perform "strikes" (mining) or
//! "casts" (fishing) to earn bonus rewards. This is an active engagement
//! mechanic similar to the forge's staged tempering system.
//!
//! # Mechanics
//! - 1 strike/cast allowed per hour of expedition duration
//! - Score (0-100) is validated by game server co-signature
//! - Higher average score = bonus multiplier on final yield
//! - Strikes are optional - base yield is still earned without them
//!
//! # Phase 2 Feature
//! This instruction is prepared for Phase 2 implementation.
//! Phase 1 expeditions work without strikes (time-based yield only).

use pinocchio::{
    AccountView,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::EXPEDITION_SEED,
    error::GameError,
    state::{PlayerAccount, ExpeditionAccount, GameEngine},
    utils::read_u8,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::ExpeditionStrike,
};

/// Perform a Strike/Cast during an active expedition
///
/// Game server must co-sign to validate the score from the mini-game.
/// Each expedition allows 1 strike per hour of duration.
///
/// # Accounts
/// 0. `[signer]` owner - Player's wallet
/// 1. `[signer]` game_authority - Game server (validates score)
/// 2. `[]` player_account - PlayerAccount PDA (for ownership verification)
/// 3. `[writable]` expedition_account - ExpeditionAccount PDA
/// 4. `[]` game_engine - GameEngine (for game_authority validation)
///
/// # Instruction Data
/// - score: u8 (1 byte) - Score from mini-game (0-100)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, [
        owner,
        game_authority,
        player_account,
        expedition_account,
        game_engine_account,
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_signer(game_authority)?;
    require_writable(expedition_account)?;
    require_owner(expedition_account, program_id)?;

    // 3. Parse Instruction Data
    let score = read_u8(instruction_data, 0, "score")?.min(100); // Cap at 100

    // 4. Validate game_authority against GameEngine
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if game_authority.address() != &game_engine.game_authority {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Player Data (for ownership verification)
    let player_data_ref = player_account.try_borrow()?;
    let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

    if !player_data.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Validate ExpeditionAccount PDA
    let (expected_expedition_pda, _) = pinocchio::Address::find_program_address(
        &[EXPEDITION_SEED, owner.address().as_ref()],
        program_id,
    );

    if expedition_account.address() != &expected_expedition_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Check expedition exists
    require_initialized(expedition_account).map_err(|_| GameError::NoExpeditionInProgress)?;

    // 8. Load Expedition Data
    let mut expedition_data = expedition_account.try_borrow_mut()?;
    let expedition = unsafe { ExpeditionAccount::load_mut(&mut expedition_data) };

    // 9. Verify expedition belongs to this player
    if &expedition.player != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 10. Get current time
    let now = Clock::get()?.unix_timestamp;

    // 11. Check if expedition is complete (can't strike after completion)
    if expedition.is_complete(now) {
        return Err(GameError::ExpeditionAlreadyComplete.into());
    }

    // 12. Check if strike limit reached
    if !expedition.can_strike() {
        return Err(GameError::ExpeditionStrikeLimitReached.into());
    }

    // 13. Check if strike window is ready (1 per hour)
    if !expedition.is_strike_ready(now) {
        return Err(GameError::ExpeditionStrikeNotReady.into());
    }

    // 14. Record the strike
    expedition.record_strike(score);

    // 15. Emit event
    emit!(ExpeditionStrike {
        player: *player_account.address(),
        player_name: player_data.name,
        strike_num: expedition.strikes,
        yield_amount: 0, // Yield is calculated at claim time, not during strike
        quality: score,
        timestamp: now,
    });

    Ok(())
}
