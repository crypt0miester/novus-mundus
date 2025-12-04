use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, player::NULL_PUBKEY, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable},
};

/// Kick a member from the team
///
/// Team leader can remove any member (except themselves).
/// Kicked member loses team affiliation.
///
/// # Accounts
/// - [] leader_player: PlayerAccount (team leader)
/// - [writable] kicked_player: PlayerAccount (member being kicked)
/// - [writable] team: TeamAccount
/// - [signer] leader_owner: Leader's wallet
///
/// # Instruction Data
/// None (kicked player derived from account)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        leader_account,
        kicked_account,
        team_account,
        leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(leader_owner)?;
    require_writable(kicked_account)?;
    require_writable(team_account)?;

    // 3. Load Accounts

    let mut leader_account_data = leader_account.try_borrow_mut_data()?;
    let mut kicked_account_data = kicked_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let leader_data = unsafe { PlayerAccount::load_mut(&mut leader_account_data) };
    let kicked_data = unsafe { PlayerAccount::load_mut(&mut kicked_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &leader_data.owner != leader_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_TEAM for leader
    require_extension(leader_data, EXT_TEAM)?;

    // 4. Validate Leader Authority

    // Is signer the team leader?
    if &team_data.leader != leader_owner.key() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Leader in the team?
    if !leader_data.has_team || &leader_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 5. Validate Kicked Player

    // Cannot kick yourself
    if &kicked_data.owner == leader_owner.key() {
        return Err(GameError::InvalidParameter.into());
    }

    // Kicked player in the team?
    if !kicked_data.has_team || &kicked_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Remove Player from Team

    let kicked_key = kicked_data.owner;
    let members = team_data.members();

    // Find player index
    let player_index = members.iter()
        .position(|&member| member == kicked_key)
        .ok_or(GameError::NotTeamMember)?;

    // Remove by shifting remaining members left
    for i in player_index..(team_data.member_count as usize - 1) {
        team_data.members[i] = team_data.members[i + 1];
    }

    // Clear last slot
    team_data.members[(team_data.member_count - 1) as usize] = NULL_PUBKEY;
    team_data.member_count -= 1;

    // 7. Update Kicked Player Account

    kicked_data.team = NULL_PUBKEY;
    kicked_data.has_team = false;

    Ok(())
}
