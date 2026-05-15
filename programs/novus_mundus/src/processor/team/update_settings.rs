use pinocchio::{
    AccountView,
    Address,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable, require_owner},
    utils::{read_u8, read_u16, read_u64},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let team_id = read_u64(instruction_data, 0, "team_id")?;
    let slot_index = read_u16(instruction_data, 8, "slot_index")?;
    let settings = read_u8(instruction_data, 10, "settings")?;
    let min_level_to_join = read_u8(instruction_data, 11, "min_level_to_join")?;

    // Validate min_level
    if min_level_to_join == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        member_account,
        member_slot_account,
        team_account,
        member_owner,
    ]);

    // 3. Validate Accounts

    require_signer(member_owner)?;
    require_writable(team_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let member = PlayerAccount::load_checked_by_key(member_account, program_id)?;
    if &member.owner != member_owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if member.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*member, EXT_TEAM)?;

    // 5. Validate Member Is In Team

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if member.team_address() == NULL_PUBKEY || &member.team_address() != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // 5a. Verify Member Slot and Check Permission

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.address(), slot_index);
    if member_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(member_slot_account, program_id)?;

    {
        let slot_data = member_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *member_account.address() {
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
        team: *team_account.address(),
        team_name: team.name,
        updated_by: *member_account.address(),
        timestamp: now,
    });

    Ok(())
}
