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

/// Promote a team member to a higher rank
///
/// Promoter must have PERM_PROMOTE and outrank the target rank.
/// Cannot promote to RANK_0 (leader transfer is separate).
/// Cannot promote above one's own rank.
///
/// # Accounts
/// - [] promoter_player: PlayerAccount (promoter)
/// - [] promoter_slot: TeamMemberSlot (for promoter rank)
/// - [writable] target_slot: TeamMemberSlot (member being promoted)
/// - [writable] team: TeamAccount
/// - [signer] promoter_owner: Promoter's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - promoter_slot_index: u16 (2 bytes) - Promoter's slot index
/// - target_slot_index: u16 (2 bytes) - Target's slot index
/// - new_rank: u8 (1 byte) - New rank for target (1-4, cannot promote to 0)
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
    let promoter_slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let target_slot_index = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());
    let new_rank = instruction_data[12];

    // Cannot promote to leader rank (0)
    if new_rank == TeamMemberSlot::RANK_0 || new_rank > TeamMemberSlot::RANK_4 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    let [
        promoter_account,
        promoter_slot_account,
        target_slot_account,
        team_account,
        promoter_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(promoter_owner)?;
    require_writable(target_slot_account)?;
    require_writable(team_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let promoter = PlayerAccount::load_checked_by_key(promoter_account, program_id)?;
    if &promoter.owner != promoter_owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if promoter.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*promoter, EXT_TEAM)?;

    // 5. Validate Promoter is in Team

    if promoter.team == NULL_PUBKEY || &promoter.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Team not disbanded
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // 6. Verify Promoter Slot and Get Rank

    let (expected_promoter_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), promoter_slot_index);
    if promoter_slot_account.key() != &expected_promoter_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(promoter_slot_account, program_id)?;

    let promoter_rank: u8;
    {
        let slot_data = promoter_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *promoter_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        promoter_rank = slot.rank;
    }

    // 7. Check Promoter Has Promote Permission and Outranks Target Rank

    if !team.can_promote_to(promoter_rank, new_rank) {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 8. Verify Target Slot

    let (expected_target_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), target_slot_index);
    if target_slot_account.key() != &expected_target_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(target_slot_account, program_id)?;

    // 9. Load Target Slot and Validate Promotion

    let mut target_data = target_slot_account.try_borrow_mut_data()?;
    let target_slot = unsafe { TeamMemberSlot::load_mut(&mut target_data) };

    // Verify target is in same team
    if target_slot.team != *team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    let current_rank = target_slot.rank;

    // Cannot promote someone already at or above the new rank
    if current_rank <= new_rank {
        return Err(GameError::AlreadyAtRank.into());
    }

    // Cannot promote to rank higher (lower number) than promoter
    if new_rank <= promoter_rank {
        return Err(GameError::CannotPromoteToHigherRank.into());
    }

    // 10. Execute Promotion

    let old_rank = target_slot.rank;
    target_slot.rank = new_rank;

    let member_pubkey = target_slot.player;

    // 11. Update Team Activity

    let clock = Clock::get()?;
    team.last_activity = clock.unix_timestamp;

    // 12. Emit Event

    emit!(MemberRankChanged {
        team: *team_account.key(),
        team_name: team.name,
        member: member_pubkey,
        old_rank,
        new_rank,
        changed_by: *promoter_account.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
