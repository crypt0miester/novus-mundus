use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, require_extension, EXT_TEAM},
    validation::{require_signer, require_writable},
};

/// Deposit cash to team treasury
///
/// Team members can contribute cash to shared treasury.
/// Treasury can be used for team activities, raids, etc.
///
/// # Accounts
/// - [writable] player: PlayerAccount (depositor)
/// - [writable] team: TeamAccount
/// - [signer] owner: Player wallet
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Cash to deposit
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
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

    // 3. Parse Instruction Data

    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes([
        instruction_data[0],
        instruction_data[1],
        instruction_data[2],
        instruction_data[3],
        instruction_data[4],
        instruction_data[5],
        instruction_data[6],
        instruction_data[7],
    ]);

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load Accounts

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(player_data, EXT_TEAM)?;

    // 5. Validate Player Is Team Member

    // Team disbanded?
    if team_data.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if !player_data.has_team {
        return Err(GameError::NotInTeam.into());
    }

    if &player_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Validate Player Has Sufficient Cash

    if player_data.cash_on_hand < amount {
        return Err(GameError::InsufficientCash.into());
    }

    // 7. Transfer Cash to Treasury

    player_data.cash_on_hand = player_data.cash_on_hand
        .saturating_sub(amount);

    team_data.treasury = team_data.treasury
        .saturating_add(amount);

    Ok(())
}
