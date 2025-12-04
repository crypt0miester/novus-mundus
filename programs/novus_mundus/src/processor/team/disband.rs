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

/// Disband team
///
/// Team leader dissolves the team.
/// All members lose team affiliation.
/// Treasury returns to leader.
///
/// Note: This is a simplified version. In production, you'd want to:
/// - Iterate through all members and clear their team references
/// - Or add a "disbanded" flag and check it everywhere
///
/// # Accounts
/// - [writable] leader_player: PlayerAccount (team leader)
/// - [writable] team: TeamAccount (being disbanded)
/// - [signer] leader_owner: Leader's wallet
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
        leader_account,
        team_account,
        leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(leader_owner)?;
    require_writable(leader_account)?;
    require_writable(team_account)?;

    // 3. Load Accounts

    let mut leader_account_data = leader_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let leader_data = unsafe { PlayerAccount::load_mut(&mut leader_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &leader_data.owner != leader_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_TEAM
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

    // 5. Return Treasury to Leader

    if team_data.treasury > 0 {
        leader_data.cash_on_hand = leader_data.cash_on_hand
            .saturating_add(team_data.treasury);
        team_data.treasury = 0;
    }

    // 6. Mark Team as Disbanded

    // Set disbanded flag (CRITICAL: prevents orphaned member issues)
    team_data.disbanded = true;

    // Zero out member count
    team_data.member_count = 0;

    // Clear leader
    team_data.leader = NULL_PUBKEY;

    // NOTE: Individual member accounts still reference this team.
    // They will discover it's disbanded when they check team_data.disbanded
    // and can then clear their own team reference.

    // 7. Update Leader Account

    leader_data.team = NULL_PUBKEY;
    leader_data.has_team = false;

    Ok(())
}
