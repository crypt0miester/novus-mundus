use pinocchio::{AccountView, Address, ProgramResult};

use crate::{
    emit,
    error::GameError,
    events::TreasuryDeposit,
    state::{require_extension, PlayerAccount, TeamAccount, EXT_TEAM, NULL_PUBKEY},
    utils::read_u64,
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
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let amount = read_u64(instruction_data, 0, "amount")?;
    let team_id = read_u64(instruction_data, 8, "team_id")?;

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        team_account,
        owner,
    ]);

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*player, EXT_TEAM)?;

    // 5. Validate Player Is Team Member

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if player.team_address() == NULL_PUBKEY {
        return Err(GameError::NotInTeam.into());
    }

    if &player.team_address() != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Validate Player Has Sufficient Cash

    if player.cash_on_hand < amount {
        return Err(GameError::InsufficientCash.into());
    }

    // 7. Transfer Cash to Treasury

    player.cash_on_hand = player.cash_on_hand.saturating_sub(amount);

    team.treasury = team.treasury.saturating_add(amount);

    // 8. Emit Event

    use pinocchio::sysvars::{clock::Clock, Sysvar};
    let now = Clock::get()?.unix_timestamp;

    emit!(TreasuryDeposit {
        team: *team_account.address(),
        team_name: team.name,
        depositor: *player_account.address(),
        amount,
        new_balance: team.treasury,
        timestamp: now,
    });

    Ok(())
}
