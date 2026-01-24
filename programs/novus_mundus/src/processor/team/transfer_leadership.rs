use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::LeadershipTransferred,
};

/// Transfer team leadership to another member
///
/// Current leader passes leadership to another team member.
/// Updates both TeamAccount.leader and both members' slot ranks.
/// Old leader becomes RANK_1, new leader becomes RANK_0.
///
/// # Accounts
/// - [] current_leader_player: PlayerAccount (current leader)
/// - [writable] current_leader_slot: Current leader's TeamMemberSlot
/// - [] new_leader_player: PlayerAccount (new leader)
/// - [writable] new_leader_slot: New leader's TeamMemberSlot
/// - [writable] team: TeamAccount
/// - [signer] current_leader_owner: Current leader's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - current_slot_index: u16 (2 bytes) - Current leader's slot index
/// - new_slot_index: u16 (2 bytes) - New leader's slot index
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 12 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let current_slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let new_slot_index = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());

    // 2. Parse Accounts

    let [
        current_leader_account,
        current_leader_slot_account,
        new_leader_account,
        new_leader_slot_account,
        team_account,
        current_leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(current_leader_owner)?;
    require_writable(current_leader_slot_account)?;
    require_writable(new_leader_slot_account)?;
    require_writable(team_account)?;

    // 4. Load Accounts

    // Current leader: use load_checked (read-only, has signer)
    let current_leader = PlayerAccount::load_checked(current_leader_account, current_leader_owner.key(), program_id)?;

    // New leader: manual load (we don't have new leader's wallet key)
    require_owner(new_leader_account, program_id)?;
    let new_leader_data_ref = new_leader_account.try_borrow_data()?;
    let new_leader = unsafe { PlayerAccount::load(&new_leader_data_ref) };

    // Team: use load_checked_mut
    let mut team = TeamAccount::load_checked_mut(team_account, team_id, program_id)?;

    // 4a. Require EXT_TEAM for current leader
    require_extension(&*current_leader, EXT_TEAM)?;

    // 5. Validate Current Leader

    // Is current leader actually the team leader? (leader is stored as player account pubkey)
    if &team.leader != current_leader_account.key() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Current leader in the team?
    if current_leader.team == NULL_PUBKEY || &current_leader.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Validate New Leader

    // New leader must be in the team
    if new_leader.team == NULL_PUBKEY || &new_leader.team != team_account.key() {
        return Err(GameError::NewLeaderNotMember.into());
    }

    // Cannot transfer to self
    if current_leader_account.key() == new_leader_account.key() {
        return Err(GameError::InvalidParameter.into());
    }

    drop(new_leader_data_ref);

    // 7. Verify and Update Current Leader's Slot

    let (expected_current_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), current_slot_index);
    if current_leader_slot_account.key() != &expected_current_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(current_leader_slot_account, program_id)?;

    {
        let mut current_slot_data = current_leader_slot_account.try_borrow_mut_data()?;
        let current_slot = unsafe { TeamMemberSlot::load_mut(&mut current_slot_data) };

        if current_slot.player != *current_leader_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        // Must be RANK_0 (leader)
        if current_slot.rank != TeamMemberSlot::RANK_0 {
            return Err(GameError::NotTeamLeader.into());
        }

        // Demote old leader to RANK_1
        current_slot.rank = TeamMemberSlot::RANK_1;
    }

    // 8. Verify and Update New Leader's Slot

    let (expected_new_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), new_slot_index);
    if new_leader_slot_account.key() != &expected_new_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(new_leader_slot_account, program_id)?;

    {
        let mut new_slot_data = new_leader_slot_account.try_borrow_mut_data()?;
        let new_slot = unsafe { TeamMemberSlot::load_mut(&mut new_slot_data) };

        if new_slot.player != *new_leader_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        // Promote new leader to RANK_0
        new_slot.rank = TeamMemberSlot::RANK_0;
    }

    // 9. Transfer Leadership in TeamAccount

    let old_leader = *current_leader_account.key();
    team.leader = *new_leader_account.key();

    // 10. Update Team Activity

    let clock = Clock::get()?;
    team.last_activity = clock.unix_timestamp;

    // 11. Emit Event

    emit!(LeadershipTransferred {
        team: *team_account.key(),
        team_name: team.name,
        old_leader,
        new_leader: *new_leader_account.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
