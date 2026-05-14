use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, NULL_PUBKEY, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable},
    emit,
    events::TeamDisbanded,
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
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());

    // 2. Parse Accounts

    let [
        leader_account,
        team_account,
        leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(leader_owner)?;
    require_writable(leader_account)?;
    require_writable(team_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let mut leader = PlayerAccount::load_checked_mut_by_key(leader_account, program_id)?;
    if &leader.owner != leader_owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if leader.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*leader, EXT_TEAM)?;

    // 5. Validate Leader Authority

    // Leader in the team?
    if leader.team == NULL_PUBKEY || &leader.team != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // Is caller the team leader? (leader is stored as player account pubkey)
    if &team.leader != leader_account.address() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Team must have only the leader (no other members)
    if team.member_count > 1 {
        return Err(GameError::TeamHasMembers.into());
    }

    // 6. Return Treasury to Leader

    let treasury_distributed = team.treasury;
    if team.treasury > 0 {
        leader.cash_on_hand = leader.cash_on_hand
            .saturating_add(team.treasury);
        team.treasury = 0;
    }

    // 7. Mark Team as Disbanded

    // Set disbanded flag (CRITICAL: prevents orphaned member issues)
    team.disbanded = true;

    // Zero out member count
    team.member_count = 0;

    // Clear leader
    team.leader = NULL_PUBKEY;

    // NOTE: Individual member accounts still reference this team.
    // They will discover it's disbanded when they check team.disbanded
    // and can then clear their own team reference.

    // 8. Update Leader Account

    leader.team = NULL_PUBKEY;

    // 9. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(TeamDisbanded {
        team: *team_account.address(),
        team_name: team.name,
        leader: *leader_account.address(),
        treasury_distributed,
        timestamp: now,
    });

    Ok(())
}
