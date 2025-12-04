use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::EventAccount,
    validation::require_writable,
};

/// Finalize event
///
/// Anyone can call this after event end_time.
/// Locks the leaderboard and enables prize claiming.
///
/// # Accounts
/// - [writable] event: EventAccount
/// - [] clock: Clock sysvar
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        event_account,
        clock_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_writable(event_account)?;

    // 3. Load Clock

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Event Account

    let mut event_account_data = event_account.try_borrow_mut_data()?;
    let event_data = unsafe { EventAccount::load_mut(&mut event_account_data) };

    // 5. Validate Event State

    // Event must not already be finalized or cancelled
    if event_data.status == 2 {
        return Err(GameError::EventNotCompleted.into()); // Already finalized
    }

    if event_data.status == 3 {
        return Err(GameError::EventCancelled.into());
    }

    // Must be past end_time
    if now < event_data.end_time {
        return Err(GameError::EventNotCompleted.into());
    }

    // 6. Finalize Event

    event_data.status = 2; // finalized

    // Leaderboard is already populated from score updates
    // No additional processing needed

    Ok(())
}
