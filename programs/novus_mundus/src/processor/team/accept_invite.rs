use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{Pubkey, find_program_address},
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{
        PlayerAccount, TeamAccount, TeamMemberSlot, TeamInviteAccount, NULL_PUBKEY,
        require_extension, unlock_extension_if_eligible, EXT_INVENTORY, EXT_TEAM,
    },
    constants::{TEAM_SLOT_SEED, TEAM_INVITE_SEED},
    helpers::close_account,
    validation::{require_signer, require_writable, require_key_match, require_owner, require_empty, require_initialized},
    emit,
    events::InviteAccepted,
};

/// Accept a team invite
///
/// Player accepts pending team invite and joins the team.
/// Creates a TeamMemberSlot and closes the TeamInviteAccount.
/// Invite must not be expired.
///
/// # Accounts
/// - [writable] player: PlayerAccount (accepting invite)
/// - [writable] team: TeamAccount (team being joined)
/// - [writable] invite: TeamInviteAccount PDA (to be closed)
/// - [writable] member_slot: TeamMemberSlot PDA (to be created)
/// - [writable] invite_refund: Account to receive invite rent refund (usually inviter)
/// - [signer, writable] owner: Player wallet (pays for slot rent)
/// - [] system_program: System program
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Slot index to occupy
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
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
        player_account,
        team_account,
        invite_account,
        member_slot_account,
        invite_refund,
        owner,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(invite_account)?;
    require_writable(member_slot_account)?;
    require_writable(invite_refund)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 4. Pre-checks and extension unlock (before mutable load to avoid borrow conflict)
    {
        let data = player_account.try_borrow_data()?;
        let player = unsafe { PlayerAccount::load(&data) };
        if &player.owner != owner.key() {
            return Err(GameError::Unauthorized.into());
        }
        require_extension(player, EXT_INVENTORY)?;
    }
    unlock_extension_if_eligible(player_account, owner, EXT_TEAM)?;

    // 4a. Load Accounts mutably (using by_key for kingdom scoping)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 5. Verify and Validate Invite

    // Verify invite PDA
    let (expected_invite, _) = find_program_address(
        &[TEAM_INVITE_SEED, team_account.key().as_ref(), player_account.key().as_ref()],
        program_id,
    );

    if invite_account.key() != &expected_invite {
        return Err(GameError::InvalidPDA.into());
    }

    // Invite must exist
    require_initialized(invite_account).map_err(|_| GameError::InviteNotFound)?;
    require_owner(invite_account, program_id)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Load and validate invite data
    {
        let invite_data = invite_account.try_borrow_data()?;
        let invite = unsafe { TeamInviteAccount::load(&invite_data) };

        // Verify invite is for this team and player
        if &invite.team != team_account.key() {
            return Err(GameError::InviteNotFound.into());
        }

        if &invite.invitee != player_account.key() {
            return Err(GameError::InviteNotFound.into());
        }

        // Check expiration
        if invite.is_expired(now) {
            // Close expired invite
            drop(invite_data);
            close_account(invite_account, invite_refund)?;
            return Err(GameError::InviteExpired.into());
        }
    }

    // 6. Validate Player Can Join

    // Team disbanded?
    if team.is_disbanded() {
        // Close invite (team no longer exists)
        close_account(invite_account, invite_refund)?;
        return Err(GameError::TeamDisbanded.into());
    }

    // Already in a team?
    if player.team != NULL_PUBKEY {
        // Close invite
        close_account(invite_account, invite_refund)?;
        return Err(GameError::AlreadyInTeam.into());
    }

    // Team full?
    if team.is_full() {
        // Close invite
        close_account(invite_account, invite_refund)?;
        return Err(GameError::TeamFull.into());
    }

    // Slot index within bounds?
    if slot_index >= team.max_members {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Verify Slot PDA and Availability
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]

    let (expected_slot, slot_bump) = TeamMemberSlot::derive_pda(team_account.key(), slot_index);

    if member_slot_account.key() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // Slot must not exist
    require_empty(member_slot_account).map_err(|_| GameError::SlotOccupied)?;

    // 8. Close Invite Account (refund rent)

    close_account(invite_account, invite_refund)?;

    // 9. Create Member Slot Account

    let slot_lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(TeamMemberSlot::LEN);

    let slot_bump_seed = [slot_bump];
    let slot_index_bytes = slot_index.to_le_bytes();
    let slot_seeds = pinocchio::seeds!(TEAM_SLOT_SEED, team_account.key().as_ref(), &slot_index_bytes, &slot_bump_seed);
    let slot_signer = pinocchio::instruction::Signer::from(&slot_seeds);

    CreateAccount {
        from: owner,
        to: member_slot_account,
        lamports: slot_lamports,
        space: TeamMemberSlot::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[slot_signer])?;

    // 10. Initialize Slot Data

    let mut slot_data = member_slot_account.try_borrow_mut_data()?;
    let slot = unsafe { TeamMemberSlot::load_mut(&mut slot_data) };

    *slot = TeamMemberSlot::init(
        *team_account.key(),
        *player_account.key(),
        now,
        slot_index,
        slot_bump,
        TeamMemberSlot::RANK_3, // Invited members join at rank 3 (higher than public join)
    );

    drop(slot_data);

    // 11. Update Team

    team.member_count = team.member_count.saturating_add(1);
    team.last_activity = now;

    // 12. Update Player Account

    player.team = *team_account.key();
    player.team_slot_index = slot_index;

    // 13. Emit Event

    emit!(InviteAccepted {
        team: *team_account.key(),
        team_name: team.name,
        player: *player_account.key(),
        member_count: team.member_count,
        timestamp: now,
    });

    Ok(())
}
