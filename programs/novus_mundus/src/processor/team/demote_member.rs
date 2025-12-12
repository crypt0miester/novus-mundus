use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, require_extension, EXT_TEAM, NULL_PUBKEY},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::MemberRankChanged,
};

/// Demote a team member to a lower rank
///
/// Demoter must outrank the target's current rank.
/// Cannot demote the leader (RANK_0).
/// Can only demote members below your rank.
///
/// # Accounts
/// - [] demoter_player: PlayerAccount (demoter)
/// - [] demoter_slot: TeamMemberSlot (for demoter rank)
/// - [writable] target_slot: TeamMemberSlot (member being demoted)
/// - [writable] team: TeamAccount
/// - [signer] demoter_owner: Demoter's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - demoter_slot_index: u16 (2 bytes) - Demoter's slot index
/// - target_slot_index: u16 (2 bytes) - Target's slot index
/// - new_rank: u8 (1 byte) - New rank for target (must be > current rank)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 13 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let demoter_slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let target_slot_index = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());
    let new_rank = instruction_data[12];

    // New rank must be valid (1-4, cannot demote to leader rank or below RANK_4)
    if new_rank > TeamMemberSlot::RANK_4 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    let [
        demoter_account,
        demoter_slot_account,
        target_slot_account,
        team_account,
        demoter_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(demoter_owner)?;
    require_writable(target_slot_account)?;
    require_writable(team_account)?;

    // 4. Load Accounts

    let demoter = PlayerAccount::load_checked(demoter_account, demoter_owner.key(), program_id)?;
    let mut team = TeamAccount::load_checked_mut(team_account, team_id, program_id)?;

    // 4a. Require EXT_TEAM
    require_extension(&*demoter, EXT_TEAM)?;

    // 5. Validate Demoter is in Team

    if demoter.team == NULL_PUBKEY || &demoter.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Team not disbanded
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // 6. Verify Demoter Slot and Get Rank

    let (expected_demoter_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), demoter_slot_index);
    if demoter_slot_account.key() != &expected_demoter_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(demoter_slot_account, program_id)?;

    let demoter_rank: u8;
    {
        let slot_data = demoter_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *demoter_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        demoter_rank = slot.rank;
    }

    // 7. Verify Target Slot

    let (expected_target_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), target_slot_index);
    if target_slot_account.key() != &expected_target_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(target_slot_account, program_id)?;

    // 8. Load Target Slot and Validate Demotion

    let mut target_data = target_slot_account.try_borrow_mut_data()?;
    let target_slot = unsafe { TeamMemberSlot::load_mut(&mut target_data) };

    // Verify target is in same team
    if target_slot.team != *team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    let current_rank = target_slot.rank;

    // Cannot demote the leader
    if current_rank == TeamMemberSlot::RANK_0 {
        return Err(GameError::CannotDemoteHigherRank.into());
    }

    // Demoter must outrank target's current rank (lower rank number = higher authority)
    if demoter_rank >= current_rank {
        return Err(GameError::CannotDemoteHigherRank.into());
    }

    // New rank must be lower (higher number) than current rank (demotion)
    if new_rank <= current_rank {
        return Err(GameError::AlreadyAtRank.into());
    }

    // 9. Execute Demotion

    let old_rank = target_slot.rank;
    target_slot.rank = new_rank;

    let member_pubkey = target_slot.player;

    // 10. Update Team Activity

    let clock = Clock::get()?;
    team.last_activity = clock.unix_timestamp;

    // 11. Emit Event

    emit!(MemberRankChanged {
        team: *team_account.key(),
        member: member_pubkey,
        old_rank,
        new_rank,
        changed_by: *demoter_account.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
