use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable},
};

/// Transfer team leadership to another member
///
/// Current leader passes leadership to another team member.
/// New leader must be an existing team member.
///
/// # Accounts
/// - [] current_leader_player: PlayerAccount (current leader)
/// - [] new_leader_player: PlayerAccount (new leader)
/// - [writable] team: TeamAccount
/// - [signer] current_leader_owner: Current leader's wallet
///
/// # Instruction Data
/// None (new leader derived from account)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        current_leader_account,
        new_leader_account,
        team_account,
        current_leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(current_leader_owner)?;
    require_writable(team_account)?;

    // 3. Load Accounts

    let mut current_leader_account_data = current_leader_account.try_borrow_mut_data()?;
    let mut new_leader_account_data = new_leader_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let current_leader_data = unsafe { PlayerAccount::load_mut(&mut current_leader_account_data) };
    let new_leader_data = unsafe { PlayerAccount::load_mut(&mut new_leader_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &current_leader_data.owner != current_leader_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_TEAM for current leader
    require_extension(current_leader_data, EXT_TEAM)?;

    // 4. Validate Current Leader

    // Is current leader actually the team leader?
    if &team_data.leader != current_leader_owner.key() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Current leader in the team?
    if !current_leader_data.has_team || &current_leader_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 5. Validate New Leader

    // New leader must be in the team
    if !new_leader_data.has_team || &new_leader_data.team != team_account.key() {
        return Err(GameError::NewLeaderNotMember.into());
    }

    // Verify new leader is actually in members list
    let new_leader_key = new_leader_data.owner;
    let is_member = team_data.members()
        .iter()
        .any(|&member| member == new_leader_key);

    if !is_member {
        return Err(GameError::NewLeaderNotMember.into());
    }

    // 6. Transfer Leadership

    team_data.leader = new_leader_key;

    Ok(())
}
