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
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::MemberKicked,
};

/// Kick a member from the team
///
/// Any member with KICK permission can remove members of lower rank.
/// Cannot kick yourself or someone of equal/higher rank.
/// Kicked member's slot is closed and rent refunded to the kicked player.
///
/// # Accounts
/// - [] kicker_player: PlayerAccount (member doing the kicking)
/// - [] kicker_slot: Kicker's TeamMemberSlot (to verify rank)
/// - [writable] kicked_player: PlayerAccount (member being kicked)
/// - [writable] team: TeamAccount
/// - [writable] kicked_slot: Kicked player's TeamMemberSlot (to be closed)
/// - [signer] kicker_owner: Kicker's wallet
/// - [writable] kicked_owner: Kicked player's wallet (receives slot rent refund)
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - kicker_slot_index: u16 (2 bytes) - Kicker's slot index
/// - kicked_slot_index: u16 (2 bytes) - Kicked player's slot index
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
    let kicker_slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let kicked_slot_index = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());

    // 2. Parse Accounts

    let [
        kicker_account,
        kicker_slot_account,
        kicked_account,
        team_account,
        kicked_slot_account,
        kicker_owner,
        kicked_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(kicker_owner)?;
    require_writable(kicked_account)?;
    require_writable(team_account)?;
    require_writable(kicked_slot_account)?;
    require_writable(kicked_owner)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    // Kicker: use load_checked_by_key (read-only, has signer)
    let kicker = PlayerAccount::load_checked_by_key(kicker_account, program_id)?;
    if &kicker.owner != kicker_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Kicked player: manual load (we don't have kicked player's wallet key)
    require_owner(kicked_account, program_id)?;
    let mut kicked_data_ref = kicked_account.try_borrow_mut_data()?;
    let kicked = unsafe { PlayerAccount::load_mut(&mut kicked_data_ref) };

    // Team: use load_checked_mut_by_key
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if kicker.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM for kicker
    require_extension(&*kicker, EXT_TEAM)?;

    // 5. Validate Kicker Authority

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Kicker in the team?
    if kicker.team == NULL_PUBKEY || &kicker.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Verify Kicker's Slot and Get Rank
    let (expected_kicker_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), kicker_slot_index);
    if kicker_slot_account.key() != &expected_kicker_slot {
        return Err(GameError::InvalidPDA.into());
    }
    require_owner(kicker_slot_account, program_id)?;

    let kicker_rank: u8;
    {
        let kicker_slot_data = kicker_slot_account.try_borrow_data()?;
        let kicker_slot = unsafe { TeamMemberSlot::load(&kicker_slot_data) };

        if kicker_slot.player != *kicker_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }
        kicker_rank = kicker_slot.rank;
    }

    // 7. Validate Kicked Player

    // Cannot kick yourself
    if kicked_account.key() == kicker_account.key() {
        return Err(GameError::InvalidParameter.into());
    }

    // Kicked player in the team?
    if kicked.team == NULL_PUBKEY || &kicked.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Verify kicked_owner matches kicked player's owner
    if &kicked.owner != kicked_owner.key() {
        return Err(GameError::InvalidAccount.into());
    }

    // 8. Verify Kicked Slot PDA and Get Target Rank
    let (expected_kicked_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), kicked_slot_index);
    if kicked_slot_account.key() != &expected_kicked_slot {
        return Err(GameError::InvalidPDA.into());
    }
    require_owner(kicked_slot_account, program_id)?;

    let kicked_rank: u8;
    {
        let kicked_slot_data = kicked_slot_account.try_borrow_data()?;
        let kicked_slot = unsafe { TeamMemberSlot::load(&kicked_slot_data) };

        if kicked_slot.player != *kicked_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        if &kicked_slot.team != team_account.key() {
            return Err(GameError::InvalidParameter.into());
        }

        kicked_rank = kicked_slot.rank;
    }

    // 9. Permission Check: kicker must have KICK permission AND outrank target
    if !team.can_kick(kicker_rank, kicked_rank) {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 10. Close Slot Account (refund rent to kicked player)

    close_account(kicked_slot_account, kicked_owner)?;

    // 9. Update Team

    let now = Clock::get()?.unix_timestamp;
    team.member_count = team.member_count.saturating_sub(1);
    team.last_activity = now;

    // 10. Update Kicked Player Account

    kicked.team = NULL_PUBKEY;
    kicked.team_slot_index = 0;

    // 11. Emit Event

    emit!(MemberKicked {
        team: *team_account.key(),
        team_name: team.name,
        kicked: *kicked_account.key(),
        kicked_by: *kicker_account.key(),
        timestamp: now,
    });

    Ok(())
}
