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

/// Withdraw from team treasury
///
/// Team leader can withdraw cash from treasury for team activities.
/// Future: Add permission system for treasury management.
///
/// # Accounts
/// - [writable] leader_player: PlayerAccount (team leader)
/// - [writable] team: TeamAccount
/// - [signer] leader_owner: Leader's wallet
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Cash to withdraw
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        leader_account,
        team_account,
        leader_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(leader_owner)?;
    require_writable(leader_account)?;
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

    let mut leader_account_data = leader_account.try_borrow_mut_data()?;
    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let leader_data = unsafe { PlayerAccount::load_mut(&mut leader_account_data) };
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Verify ownership
    if &leader_data.owner != leader_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(leader_data, EXT_TEAM)?;

    // 5. Validate Leader Authority

    // Is signer the team leader?
    if &team_data.leader != leader_owner.key() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Leader in the team?
    if !leader_data.has_team || &leader_data.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Validate Treasury Has Funds

    if team_data.treasury < amount {
        return Err(GameError::InsufficientTeamTreasury.into());
    }

    // 7. Transfer Cash from Treasury

    team_data.treasury = team_data.treasury.saturating_sub(amount);
    leader_data.cash_on_hand = leader_data.cash_on_hand.saturating_add(amount);

    Ok(())
}
