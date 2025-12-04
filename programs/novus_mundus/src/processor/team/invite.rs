use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, player::NULL_PUBKEY, require_extension, EXT_TEAM, EXT_RALLY},
    constants::TEAM_INVITE_EXPIRY,
    validation::{require_signer, require_writable},
};

/// Invite a player to join team
///
/// Team leader or members can invite players.
/// Invite expires after TEAM_INVITE_EXPIRY (7 days).
///
/// # Accounts
/// - [] inviter_player: PlayerAccount (team member sending invite)
/// - [writable] invitee_player: PlayerAccount (player being invited)
/// - [] team: TeamAccount
/// - [signer] inviter_owner: Inviter's wallet
///
/// # Instruction Data
/// None (invitee is derived from account)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        inviter_player_account,
        invitee_player_account,
        team_account,
        inviter_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(inviter_owner)?;
    require_writable(invitee_player_account)?;

    // 3. Load Accounts

    let mut inviter_account_data = inviter_player_account.try_borrow_mut_data()?;
    let mut invitee_account_data = invitee_player_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let inviter_data = unsafe { PlayerAccount::load_mut(&mut inviter_account_data) };
    let invitee_data = unsafe { PlayerAccount::load_mut(&mut invitee_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &inviter_data.owner != inviter_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_TEAM for inviter
    require_extension(inviter_data, EXT_TEAM)?;

    // 3b. Require EXT_RALLY for invitee (prerequisite for teams)
    require_extension(invitee_data, EXT_RALLY)?;

    // 4. Validate Inviter Is Team Member

    // Team disbanded?
    if team_data.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if !inviter_data.has_team {
        return Err(GameError::NotInTeam.into());
    }

    if &inviter_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 5. Validate Invitee Can Be Invited

    // Already in a team?
    if invitee_data.has_team {
        return Err(GameError::AlreadyInTeam.into());
    }

    // Already has pending invite?
    if invitee_data.pending_team_invite != NULL_PUBKEY {
        return Err(GameError::AlreadyInvited.into());
    }

    // Team full?
    if team_data.member_count >= TeamAccount::MAX_MEMBERS as u8 {
        return Err(GameError::TeamFull.into());
    }

    // 6. Create Invite

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    invitee_data.pending_team_invite = *team_account.key();
    invitee_data.team_invite_expires_at = now + TEAM_INVITE_EXPIRY;

    Ok(())
}
