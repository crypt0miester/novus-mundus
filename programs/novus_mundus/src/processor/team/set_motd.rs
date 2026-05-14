use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::MotdUpdated,
};

/// Set team message of the day (MOTD)
///
/// Member with PERM_MOTD can set a message visible to all members.
/// Max 32 bytes UTF-8.
///
/// # Accounts
/// - [] member_player: PlayerAccount (member with MOTD permission)
/// - [] member_slot: TeamMemberSlot (for rank verification)
/// - [writable] team: TeamAccount
/// - [signer] member_owner: Member's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Member's slot index
/// - motd_len: u8 (1 byte) - Length of MOTD
/// - motd: [u8; N] - MOTD content (up to 32 bytes)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 11 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let motd_len = instruction_data[10] as usize;

    if motd_len > TeamAccount::MAX_MOTD_LEN {
        return Err(GameError::InvalidParameter.into());
    }

    if instruction_data.len() < 11 + motd_len {
        return Err(ProgramError::InvalidInstructionData);
    }

    let motd_bytes = &instruction_data[11..11 + motd_len];

    // Validate UTF-8
    let _motd_str = core::str::from_utf8(motd_bytes)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

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

    if member.team == NULL_PUBKEY || &member.team != team_account.address() {
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

        // Check PERM_MOTD permission
        if !team.rank_has_permission(slot.rank, TeamAccount::PERM_MOTD) {
            return Err(GameError::InsufficientTeamPermissions.into());
        }
    }

    // 6. Update MOTD

    team.motd[..motd_len].copy_from_slice(motd_bytes);
    // Zero out remaining bytes
    if motd_len < TeamAccount::MAX_MOTD_LEN {
        team.motd[motd_len..].fill(0);
    }
    team.motd_len = motd_len as u8;

    // 7. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(MotdUpdated {
        team: *team_account.address(),
        team_name: team.name,
        updated_by: *member_account.address(),
        timestamp: now,
    });

    Ok(())
}
