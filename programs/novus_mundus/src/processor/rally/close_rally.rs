use pinocchio::{
    AccountView,
    Address,
    ProgramResult,
};

use pinocchio::sysvars::{clock::Clock, Sysvar};

use crate::{
    error::GameError,
    helpers::close_account,
    state::{RallyAccount, RallyStatus},
    validation::{require_writable, require_owner},
    emit,
    events::RallyClosed,
};

/// Close a completed or cancelled rally
///
/// Closes the RallyAccount and refunds rent to the leader.
/// Can be called by ANYONE once all participants have processed their returns.
/// This allows for permissionless cranking.
///
/// # Requirements
/// - Rally must be in Completed or Cancelled status
/// - All participants must have returned (`returned_count >= participant_count`)
///
/// # Accounts
/// 0. `[WRITE]` rally_account: RallyAccount to close
/// 1. `[WRITE]` leader_owner: Leader's wallet (receives rent refund, derived from rally.creator)
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
        rally_account,
        leader_owner,
    ]);

    // 2. Validate Accounts
    require_writable(rally_account)?;
    require_writable(leader_owner)?;

    // 3. Load Rally and validate
    require_owner(rally_account, program_id)?;
    let rally_data_ref = rally_account.try_borrow()?;
    let rally = unsafe { RallyAccount::load(&rally_data_ref) };

    // Validate leader_owner matches rally creator (rent recipient)
    if &rally.creator != leader_owner.address() {
        return Err(GameError::InvalidParameter.into());
    }

    // Validate rally can be closed
    if !rally.can_close() {
        // Rally must be Completed or Cancelled, and all participants must have returned
        if rally.status != RallyStatus::Completed as u8
            && rally.status != RallyStatus::Cancelled as u8
        {
            return Err(GameError::RallyNotCompleted.into());
        }
        // All participants haven't returned yet
        return Err(GameError::RallyCannotBeClosed.into());
    }

    // Store rally info for event
    let rally_key = *rally_account.address();
    let rally_id = rally.id;
    let leader = rally.creator;

    drop(rally_data_ref);

    // 4. Close RallyAccount (refund rent to leader)
    close_account(rally_account, leader_owner)?;

    // 5. Emit event
    // Note: team_name not available here - would need to pass team account
    let now = Clock::get()?.unix_timestamp;
    emit!(RallyClosed {
        rally: rally_key,
        rally_id,
        team_name: [0u8; 32], // Team name not available, lookup via rally.team
        leader,
        timestamp: now,
    });

    Ok(())
}
