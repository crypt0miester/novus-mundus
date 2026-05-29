use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{TEAM_INVITE_SEED, TEAM_SLOT_SEED},
    emit,
    error::GameError,
    events::InviteAccepted,
    helpers::close_account,
    state::{
        require_extension, unlock_extension_if_eligible, PlayerAccount, TeamAccount,
        TeamInviteAccount, TeamMemberSlot, EXT_INVENTORY, EXT_TEAM, NULL_PUBKEY,
    },
    utils::{read_u16, read_u64},
    validation::{
        require_empty, require_initialized, require_key_match, require_owner, require_signer,
        require_writable,
    },
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
/// - [] leader: Team leader's PlayerAccount (read-only; drives tier-based capacity)
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Slot index to occupy
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let team_id = read_u64(instruction_data, 0, "team_id")?;
    let slot_index = read_u16(instruction_data, 8, "slot_index")?;

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        team_account,
        invite_account,
        member_slot_account,
        invite_refund,
        owner,
        system_program,
        leader_account,
    ]);

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
        let data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&data) };
        if &player.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }
        require_extension(player, EXT_INVENTORY)?;
    }
    unlock_extension_if_eligible(player_account, owner, EXT_TEAM)?;

    // 4a. Load Accounts mutably (using by_key for kingdom scoping)
    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    let team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 5. Verify and Validate Invite

    // Verify invite PDA
    let (expected_invite, _) = Address::find_program_address(
        &[
            TEAM_INVITE_SEED,
            team_account.address().as_ref(),
            player_account.address().as_ref(),
        ],
        program_id,
    );

    if invite_account.address() != &expected_invite {
        return Err(GameError::InvalidPDA.into());
    }

    // Invite must exist
    require_initialized(invite_account).map_err(|_| GameError::InviteNotFound)?;
    require_owner(invite_account, program_id)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Load and validate invite data
    {
        let invite_data = invite_account.try_borrow()?;
        let invite = unsafe { TeamInviteAccount::load(&invite_data) };

        // Verify invite is for this team and player
        if &invite.team != team_account.address() {
            return Err(GameError::InviteNotFound.into());
        }

        if &invite.invitee != player_account.address() {
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
    if player.team_address() != NULL_PUBKEY {
        // Close invite
        close_account(invite_account, invite_refund)?;
        return Err(GameError::AlreadyInTeam.into());
    }

    // Refresh capacity from the leader's current subscription tier. The leader's
    // PlayerAccount is passed read-only; verify it matches the team's stored
    // leader before trusting its tier.
    require_key_match(leader_account, &team.leader)?;
    let leader_tier =
        PlayerAccount::load_checked_by_key(leader_account, program_id)?.get_effective_tier(now);
    team.refresh_capacity(leader_tier);

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

    let (expected_slot, slot_bump) = TeamMemberSlot::derive_pda(team_account.address(), slot_index);

    if member_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // Slot must not exist
    require_empty(member_slot_account).map_err(|_| GameError::SlotOccupied)?;

    // 8. Close Invite Account (refund rent)

    close_account(invite_account, invite_refund)?;

    // 9. Create Member Slot Account

    let slot_lamports = crate::utils::rent_exempt_const(TeamMemberSlot::LEN);

    let slot_bump_seed = [slot_bump];
    let slot_index_bytes = slot_index.to_le_bytes();
    let slot_seeds = crate::seeds!(
        TEAM_SLOT_SEED,
        team_account.address(),
        &slot_index_bytes,
        &slot_bump_seed
    );
    let slot_signer = pinocchio::cpi::Signer::from(&slot_seeds);

    CreateAccount {
        from: owner,
        to: member_slot_account,
        lamports: slot_lamports,
        space: TeamMemberSlot::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[slot_signer])?;

    // 10. Initialize Slot Data

    let mut slot_data = member_slot_account.try_borrow_mut()?;
    let slot = unsafe { TeamMemberSlot::load_mut(&mut slot_data) };

    *slot = TeamMemberSlot::init(
        *team_account.address(),
        *player_account.address(),
        now,
        slot_index,
        slot_bump,
        TeamMemberSlot::RANK_3, // Invited members join at rank 3 (higher than public join)
        team.membership_epoch,  // joined_at_epoch: snapshot current war-table epoch
    );

    drop(slot_data);

    // 11. Update Team

    team.member_count = team.member_count.saturating_add(1);
    team.last_activity = now;

    // 12. Update Player Account

    player.set_team_address(*team_account.address());
    player.set_team_slot_index(slot_index);

    // 13. Emit Event

    emit!(InviteAccepted {
        team: *team_account.address(),
        team_name: team.name,
        player: *player_account.address(),
        member_count: team.member_count,
        timestamp: now,
    });

    Ok(())
}
