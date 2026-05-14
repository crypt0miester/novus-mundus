//! Close Kingdom Registration
//!
//! Instruction 4
//!
//! DAO-only instruction to close new player registration for a kingdom.
//! Once closed, no new players can join the kingdom.
//! Can also be triggered automatically when registration_closes_at timestamp is reached.

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::GameEngine,
    emit,
    events::kingdom::KingdomRegistrationClosed,
};

/// Close Kingdom Registration
///
/// # Accounts
/// 0. `[signer]` DAO authority OR anyone if registration_closes_at has passed
/// 1. `[writable]` GameEngine account
///
/// # Instruction Data
/// None required - just the 2-byte discriminant
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [caller, game_engine_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Load game engine mutably
    let mut game_engine = GameEngine::load_checked_mut_by_key(game_engine_account, program_id)?;

    // 3. Check if registration is already closed
    if !game_engine.registration_open {
        return Err(GameError::KingdomRegistrationClosed.into());
    }

    // 4. Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Validate authority to close
    // Either:
    // a) Caller is DAO authority and signs
    // b) registration_closes_at has passed (anyone can trigger)
    let is_dao_authority = caller.address() == &game_engine.authority && caller.is_signer();
    let registration_expired = game_engine.registration_closes_at > 0
        && now >= game_engine.registration_closes_at;

    if !is_dao_authority && !registration_expired {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Close registration
    game_engine.registration_open = false;

    // 7. Emit event (uses existing event from kingdom.rs)
    emit!(KingdomRegistrationClosed {
        kingdom_id: game_engine.kingdom_id,
        game_engine: *game_engine_account.address(),
        total_players: game_engine.total_players,
        closed_at: now,
    });

    Ok(())
}
