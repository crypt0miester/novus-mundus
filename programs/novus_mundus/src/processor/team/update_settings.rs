use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::TeamSettingsUpdated,
};

/// Update team settings
///
/// Member with PERM_SETTINGS can update:
/// - Public/private status (whether anyone can join without invite)
/// - Minimum level to join
///
/// # Settings Bitfield
/// - Bit 0: SETTING_PUBLIC - Anyone can join without invite
/// - Bit 1: SETTING_AUTO_ACCEPT - Auto-accept join requests (future use)
///
/// # Accounts
/// - [] member_player: PlayerAccount (member with settings permission)
/// - [] member_slot: TeamMemberSlot (for rank verification)
/// - [writable] team: TeamAccount
/// - [signer] member_owner: Member's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Member's slot index
/// - settings: u8 (1 byte) - New settings bitfield
/// - min_level_to_join: u8 (1 byte) - Minimum player level to join (1-255)
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
    let slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let settings = instruction_data[10];
    let min_level_to_join = instruction_data[11];

    // Validate min_level
    if min_level_to_join == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    let [
        member_account,
        member_slot_account,
        team_account,
        member_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(member_owner)?;
    require_writable(team_account)?;

    // 4. Load Accounts

    let member = PlayerAccount::load_checked(member_account, member_owner.key(), program_id)?;
    let mut team = TeamAccount::load_checked_mut(team_account, team_id, program_id)?;

    // 4a. Require EXT_TEAM
    require_extension(&*member, EXT_TEAM)?;

    // 5. Validate Member Is In Team

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if member.team == NULL_PUBKEY || &member.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 5a. Verify Member Slot and Check Permission

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), slot_index);
    if member_slot_account.key() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(member_slot_account, program_id)?;

    {
        let slot_data = member_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *member_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        // Check PERM_SETTINGS permission
        if !team.rank_has_permission(slot.rank, TeamAccount::PERM_SETTINGS) {
            return Err(GameError::InsufficientTeamPermissions.into());
        }
    }

    // 6. Update Settings

    team.settings = settings;
    team.min_level_to_join = min_level_to_join;

    // 7. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(TeamSettingsUpdated {
        team: *team_account.key(),
        team_name: team.name,
        updated_by: *member_account.key(),
        timestamp: now,
    });

    Ok(())
}
