use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{TEAM_INVITE_EXPIRY, TEAM_INVITE_SEED},
    emit,
    error::GameError,
    events::InviteSent,
    state::{
        require_extension, PlayerAccount, TeamAccount, TeamInviteAccount, TeamMemberSlot,
        EXT_INVENTORY, EXT_TEAM, NULL_PUBKEY,
    },
    utils::{read_i64, read_u16, read_u64},
    validation::{
        require_empty, require_key_match, require_owner, require_signer, require_writable,
    },
};

/// Invite a player to join team
///
/// Member with PERM_INVITE can invite players. Creates a TeamInviteAccount PDA.
/// Invite expires after TEAM_INVITE_EXPIRY (7 days).
/// Multiple teams can invite the same player (each creates separate PDA).
///
/// # Accounts
/// - [] inviter_player: PlayerAccount (member sending invite)
/// - [] inviter_slot: TeamMemberSlot (for rank verification)
/// - [] invitee_player: PlayerAccount (player being invited)
/// - [] team: TeamAccount
/// - [writable] invite: TeamInviteAccount PDA (to be created)
/// - [signer, writable] inviter_owner: Inviter's wallet (pays for invite rent)
/// - [] system_program: System program
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Inviter's slot index
/// - expires_in_seconds: i64 (8 bytes) - Optional custom expiry (0 = use default 7 days)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let team_id = read_u64(instruction_data, 0, "team_id")?;
    let slot_index = read_u16(instruction_data, 8, "slot_index")?;

    let expires_in_seconds = if instruction_data.len() >= 18 {
        read_i64(instruction_data, 10, "expires_in_seconds")?
    } else {
        0 // Use default
    };

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        inviter_player_account,
        inviter_slot_account,
        invitee_player_account,
        team_account,
        invite_account,
        inviter_owner,
        system_program,
    ]);

    // 3. Validate Accounts

    require_signer(inviter_owner)?;
    require_writable(inviter_owner)?;
    require_writable(invite_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    // Inviter: use load_checked_by_key (read-only, has signer)
    let inviter = PlayerAccount::load_checked_by_key(inviter_player_account, program_id)?;
    if &inviter.owner != inviter_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Invitee: manual load (we don't have invitee's wallet key)
    require_owner(invitee_player_account, program_id)?;
    let invitee_data_ref = invitee_player_account.try_borrow()?;
    let invitee = unsafe { PlayerAccount::load(&invitee_data_ref) };

    // Team: use load_checked_by_key (read-only)
    let team = TeamAccount::load_checked_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom for all parties
    if inviter.game_engine != team.game_engine || invitee.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM for inviter
    require_extension(&*inviter, EXT_TEAM)?;

    // 4b. Require EXT_INVENTORY for invitee (prerequisite for team join)
    require_extension(invitee, EXT_INVENTORY)?;

    // 5. Validate Inviter Is In Team

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Inviter in the team?
    if inviter.team_address() == NULL_PUBKEY || &inviter.team_address() != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // 5a. Verify Inviter Slot and Check Permission

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.address(), slot_index);
    if inviter_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(inviter_slot_account, program_id)?;

    {
        let slot_data = inviter_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *inviter_player_account.address() {
            return Err(GameError::NotSlotOwner.into());
        }

        // Check PERM_INVITE permission
        if !team.rank_has_permission(slot.rank, TeamAccount::PERM_INVITE) {
            return Err(GameError::InsufficientTeamPermissions.into());
        }
    }

    // 6. Validate Invitee Can Be Invited

    // Already in a team?
    if invitee.team_address() != NULL_PUBKEY {
        return Err(GameError::AlreadyInTeam.into());
    }

    // Team full?
    if team.is_full() {
        return Err(GameError::TeamFull.into());
    }

    // Check invitee meets minimum level requirement
    if invitee.level < team.min_level_to_join {
        return Err(GameError::LevelTooLow.into());
    }

    drop(invitee_data_ref);

    // 7. Verify Invite PDA

    let (expected_invite, invite_bump) = Address::find_program_address(
        &[
            TEAM_INVITE_SEED,
            team_account.address().as_ref(),
            invitee_player_account.address().as_ref(),
        ],
        program_id,
    );

    if invite_account.address() != &expected_invite {
        return Err(GameError::InvalidPDA.into());
    }

    // Invite must not already exist
    require_empty(invite_account).map_err(|_| GameError::AlreadyInvited)?;

    // 8. Create Invite Account

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let expires_at = if expires_in_seconds > 0 {
        now.saturating_add(expires_in_seconds)
    } else {
        now.saturating_add(TEAM_INVITE_EXPIRY)
    };

    let invite_lamports = crate::utils::rent_exempt_const(TeamInviteAccount::LEN);

    let invite_bump_seed = [invite_bump];
    let invite_seeds = crate::seeds!(
        TEAM_INVITE_SEED,
        team_account.address(),
        invitee_player_account.address(),
        &invite_bump_seed
    );
    let invite_signer = pinocchio::cpi::Signer::from(&invite_seeds);

    CreateAccount {
        from: inviter_owner,
        to: invite_account,
        lamports: invite_lamports,
        space: TeamInviteAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[invite_signer])?;

    // 9. Initialize Invite Data

    let mut invite_data = invite_account.try_borrow_mut()?;
    let invite = unsafe { TeamInviteAccount::load_mut(&mut invite_data) };

    *invite = TeamInviteAccount::init(
        *team_account.address(),
        *invitee_player_account.address(),
        invite_bump,
        *inviter_player_account.address(),
        now,
        expires_at,
    );

    // 10. Emit Event

    emit!(InviteSent {
        team: *team_account.address(),
        team_name: team.name,
        invitee: *invitee_player_account.address(),
        inviter: *inviter_player_account.address(),
        timestamp: now,
    });

    Ok(())
}
