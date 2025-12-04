use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, player::NULL_PUBKEY, require_extension, unlock_extension_if_eligible, EXT_RALLY, EXT_TEAM},
    validation::{require_signer, require_writable},
};

/// Accept a team invite
///
/// Player accepts pending team invite and joins the team.
/// Invite must not be expired.
///
/// # Accounts
/// - [writable] player: PlayerAccount (accepting invite)
/// - [writable] team: TeamAccount (team being joined)
/// - [signer] owner: Player wallet
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        team_account,
        owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;

    // 3. Load Accounts

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_RALLY (prerequisite for teams)
    require_extension(player_data, EXT_RALLY)?;

    // 3b. Unlock EXT_TEAM on first team join via invite
    unlock_extension_if_eligible(player_account, owner, player_data, EXT_TEAM)?;

    // 4. Validate Player Has Pending Invite

    // No pending invite?
    if player_data.pending_team_invite == NULL_PUBKEY {
        return Err(GameError::InviteNotFound.into());
    }

    // Invite for this team?
    if &player_data.pending_team_invite != team_account.key() {
        return Err(GameError::InviteNotFound.into());
    }

    // Check expiration
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    if now >= player_data.team_invite_expires_at {
        // Clear expired invite
        player_data.pending_team_invite = NULL_PUBKEY;
        player_data.team_invite_expires_at = 0;
        return Err(GameError::InviteExpired.into());
    }

    // 5. Validate Player Can Join

    // Team disbanded?
    if team_data.is_disbanded() {
        // Clear invite (team no longer exists)
        player_data.pending_team_invite = NULL_PUBKEY;
        player_data.team_invite_expires_at = 0;
        return Err(GameError::TeamDisbanded.into());
    }

    // Already in a team?
    if player_data.has_team {
        // Clear invite
        player_data.pending_team_invite = NULL_PUBKEY;
        player_data.team_invite_expires_at = 0;
        return Err(GameError::AlreadyInTeam.into());
    }

    // Team full?
    if team_data.member_count >= TeamAccount::MAX_MEMBERS as u8 {
        // Clear invite
        player_data.pending_team_invite = NULL_PUBKEY;
        player_data.team_invite_expires_at = 0;
        return Err(GameError::TeamFull.into());
    }

    // 6. Add Player to Team

    team_data.add_member(*owner.key())?;

    // 7. Update Player Account

    player_data.team = *team_account.key();
    player_data.has_team = true;

    // Clear invite
    player_data.pending_team_invite = NULL_PUBKEY;
    player_data.team_invite_expires_at = 0;

    Ok(())
}
