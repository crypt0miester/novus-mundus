use pinocchio::{
    AccountView,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::EventAccount,
    validation::{require_writable, require_owner},
    emit,
    events::game_event::GameEventFinalized,
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
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        event_account,
    ]);

    // 2. Validate Accounts (require_owner so attackers can't pass a look-alike
    //    account; the call is intentionally permissionless cranks via the
    //    backend per design.)
    require_writable(event_account)?;
    require_owner(event_account, program_id)?;

    // 3. Load Clock

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Event Account

    let mut event_account_data = event_account.try_borrow_mut()?;
    crate::state::AccountKey::validate(&event_account_data, crate::state::AccountKey::Event)?;
    let event_data = unsafe { EventAccount::load_mut(&mut event_account_data) };

    // 5. Validate Event State

    // Event must not already be finalized or cancelled
    if event_data.status == 2 {
        return Err(GameError::EventNotCompleted.into()); // Already finalized
    }

    if event_data.status == 3 {
        return Err(GameError::EventCancelled.into());
    }

    // Require status == 1 (Active). Pending events (status=0) that
    // were never activated should not be finalized — they should be cancelled
    // via the DAO instead.
    if event_data.status != 1 {
        return Err(GameError::EventNotStarted.into());
    }

    // Must be past end_time
    if now < event_data.end_time {
        return Err(GameError::EventNotCompleted.into());
    }

    // 6. Finalize Event

    event_data.status = 2; // finalized

    // Leaderboard is already populated from score updates
    // No additional processing needed

    // Emit event
    emit!(GameEventFinalized {
        event: *event_account.address(),
        total_participants: event_data.participant_count,
        total_prizes: event_data.prize_amount,
        timestamp: now,
    });

    Ok(())
}
