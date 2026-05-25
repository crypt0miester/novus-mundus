use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::MemberRankChanged,
    state::{require_extension, PlayerAccount, TeamAccount, TeamMemberSlot, EXT_TEAM, NULL_PUBKEY},
    utils::{read_u16, read_u64, read_u8},
    validation::{require_owner, require_signer, require_writable},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let team_id = read_u64(instruction_data, 0, "team_id")?;
    let demoter_slot_index = read_u16(instruction_data, 8, "demoter_slot_index")?;
    let target_slot_index = read_u16(instruction_data, 10, "target_slot_index")?;
    let new_rank = read_u8(instruction_data, 12, "new_rank")?;

    // New rank must be valid (1-4, cannot demote to leader rank or below RANK_4)
    if new_rank > TeamMemberSlot::RANK_4 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        demoter_account,
        demoter_slot_account,
        target_slot_account,
        team_account,
        demoter_owner,
    ]);

    // 3. Validate Accounts

    require_signer(demoter_owner)?;
    require_writable(target_slot_account)?;
    require_writable(team_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let demoter = PlayerAccount::load_checked_by_key(demoter_account, program_id)?;
    if &demoter.owner != demoter_owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if demoter.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*demoter, EXT_TEAM)?;

    // 5. Validate Demoter is in Team

    if demoter.team_address() == NULL_PUBKEY || &demoter.team_address() != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // Team not disbanded
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // 6. Verify Demoter Slot and Get Rank

    let (expected_demoter_slot, _) =
        TeamMemberSlot::derive_pda(team_account.address(), demoter_slot_index);
    if demoter_slot_account.address() != &expected_demoter_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(demoter_slot_account, program_id)?;

    let demoter_rank: u8;
    {
        let slot_data = demoter_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *demoter_account.address() {
            return Err(GameError::NotSlotOwner.into());
        }

        demoter_rank = slot.rank;
    }

    // 7. Verify Target Slot

    let (expected_target_slot, _) =
        TeamMemberSlot::derive_pda(team_account.address(), target_slot_index);
    if target_slot_account.address() != &expected_target_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(target_slot_account, program_id)?;

    // 8. Load Target Slot and Validate Demotion

    let mut target_data = target_slot_account.try_borrow_mut()?;
    let target_slot = unsafe { TeamMemberSlot::load_mut(&mut target_data) };

    // Verify target is in same team
    if target_slot.team != *team_account.address() {
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
        team: *team_account.address(),
        team_name: team.name,
        member: member_pubkey,
        old_rank,
        new_rank,
        changed_by: *demoter_account.address(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
