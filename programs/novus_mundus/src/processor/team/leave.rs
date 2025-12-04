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

/// Leave a team
///
/// Player leaves their current team.
/// Leader cannot leave (must transfer leadership first or disband team).
///
/// # Accounts
/// - [writable] player: PlayerAccount (leaving member)
/// - [writable] team: TeamAccount
/// - [signer] owner: Player wallet
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
        player_account,
        team_account,
        owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;

    // 3. Load Accounts

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_TEAM
    require_extension(player_data, EXT_TEAM)?;

    // 4. Validate Player Can Leave

    // Not in a team?
    if !player_data.has_team {
        return Err(GameError::NotInTeam.into());
    }

    // Verify player is in THIS team
    if &player_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Leader cannot leave (must transfer leadership first)
    if &team_data.leader == owner.key() {
        return Err(GameError::CannotLeaveAsLeader.into());
    }

    // 5. Remove Player from Team

    let player_key = *owner.key();
    let members = team_data.members();

    // Find player index
    let player_index = members.iter()
        .position(|&member| member == player_key)
        .ok_or(GameError::NotTeamMember)?;

    // Remove by shifting remaining members left
    for i in player_index..(team_data.member_count as usize - 1) {
        team_data.members[i] = team_data.members[i + 1];
    }

    // Clear last slot
    team_data.members[(team_data.member_count - 1) as usize] = NULL_PUBKEY;
    team_data.member_count -= 1;

    // 6. Update Player Account

    player_data.team = NULL_PUBKEY;
    player_data.has_team = false;

    Ok(())
}
