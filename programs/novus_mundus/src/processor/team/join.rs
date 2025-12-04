use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{
        PlayerAccount, TeamAccount,
        unlock_extension_if_eligible, require_extension, EXT_RALLY, EXT_TEAM,
    },
    validation::{require_signer, require_writable},
};

/// Join a team (open teams - no invite required for MVP)
///
/// Player joins an existing team if there's space.
/// Future: Add invite system for invite-only teams.
///
/// # Accounts
/// - [writable] player: PlayerAccount (joiner)
/// - [writable] team: TeamAccount to join
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

    // 3a. PREREQUISITE: Require EXT_RALLY to be unlocked before teams
    // Player must create/join a rally before joining a team (user journey)
    require_extension(player_data, EXT_RALLY)?;

    // 3b. Unlock EXT_TEAM extension if not already unlocked
    // This is the fifth step in the user journey
    unlock_extension_if_eligible(player_account, owner, player_data, EXT_TEAM)?;

    // 4. Validate Player Can Join

    // Team disbanded?
    if team_data.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Already in a team?
    if player_data.has_team {
        return Err(GameError::AlreadyInTeam.into());
    }

    // Team full?
    if team_data.member_count >= TeamAccount::MAX_MEMBERS as u8 {
        return Err(GameError::TeamFull.into());
    }

    // 5. Add Player to Team

    team_data.add_member(*owner.key())?;

    // 6. Update Player Account

    player_data.team = *team_account.key();
    player_data.has_team = true;

    Ok(())
}
