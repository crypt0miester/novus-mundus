use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamInviteAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    constants::TEAM_INVITE_SEED,
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::InviteCancelled,
};

/// Cancel a pending team invite
///
/// Member with PERM_INVITE can cancel an invite.
/// Closes the TeamInviteAccount and refunds rent to caller.
///
/// # Accounts
/// - [] member_player: PlayerAccount (member with invite permission)
/// - [] member_slot: TeamMemberSlot (for rank verification)
/// - [] team: TeamAccount
/// - [writable] invite: TeamInviteAccount PDA (to be closed)
/// - [] invitee_player: PlayerAccount of invitee (for PDA derivation)
/// - [signer, writable] member_owner: Member's wallet (receives rent refund)
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Member's slot index
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());

    // 2. Parse Accounts

    let [
        member_account,
        member_slot_account,
        team_account,
        invite_account,
        invitee_account,
        member_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(member_owner)?;
    require_writable(member_owner)?;
    require_writable(invite_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let member = PlayerAccount::load_checked_by_key(member_account, program_id)?;
    if &member.owner != member_owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let team = TeamAccount::load_checked_by_key(team_account, program_id)?;
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

        // Check PERM_INVITE permission
        if !team.rank_has_permission(slot.rank, TeamAccount::PERM_INVITE) {
            return Err(GameError::InsufficientTeamPermissions.into());
        }
    }

    // 6. Verify Invite PDA

    let (expected_invite, _) = Address::find_program_address(
        &[TEAM_INVITE_SEED, team_account.address().as_ref(), invitee_account.address().as_ref()],
        program_id,
    );

    if invite_account.address() != &expected_invite {
        return Err(GameError::InvalidPDA.into());
    }

    // Invite must exist
    require_initialized(invite_account).map_err(|_| GameError::InviteNotFound)?;
    require_owner(invite_account, program_id)?;

    // Verify invite is for this team
    let invitee_pubkey: pinocchio::Address;
    {
        let invite_data = invite_account.try_borrow()?;
        let invite = unsafe { TeamInviteAccount::load(&invite_data) };

        if &invite.team != team_account.address() {
            return Err(GameError::InviteNotFound.into());
        }

        invitee_pubkey = invite.invitee;
    }

    // 7. Close Invite Account (refund rent to caller)

    close_account(invite_account, member_owner)?;

    // 8. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(InviteCancelled {
        team: *team_account.address(),
        team_name: team.name,
        invitee: invitee_pubkey,
        cancelled_by: *member_account.address(),
        timestamp: now,
    });

    Ok(())
}
