use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TreasuryRequest, require_extension, EXT_TEAM},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::TreasuryRequestCancelled,
};

/// Cancel a treasury withdrawal request (by requester)
///
/// Requester can cancel their own pending request at any time.
/// Request PDA is closed, rent returned to requester.
///
/// # Accounts
/// - [] player: PlayerAccount (requester)
/// - [] team: TeamAccount
/// - [writable] request: TreasuryRequest PDA (to be closed)
/// - [signer, writable] owner: Player's wallet (receives request rent refund)
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());

    // 2. Parse Accounts

    let [
        player_account,
        team_account,
        request_account,
        owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(request_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let player = PlayerAccount::load_checked_by_key(player_account, program_id)?;
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    let team = TeamAccount::load_checked_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom (if player still in team)
    if player.team != crate::state::NULL_PUBKEY && player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*player, EXT_TEAM)?;

    // 5. Validate Player is in Team (or was - they can still cancel)

    // Note: We allow cancellation even if player left team, as long as request belongs to them
    // This prevents orphaned requests

    // 6. Verify and Load Request

    let (expected_request, _) = TreasuryRequest::derive_pda(team_account.key(), player_account.key());
    if request_account.key() != &expected_request {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(request_account).map_err(|_| GameError::TreasuryRequestNotFound)?;
    require_owner(request_account, program_id)?;

    // Validate request belongs to this player and team
    {
        let request_data = request_account.try_borrow_data()?;
        let request = unsafe { TreasuryRequest::load(&request_data) };

        if &request.team != team_account.key() {
            return Err(GameError::InvalidParameter.into());
        }

        if &request.requester != player_account.key() {
            return Err(GameError::InvalidParameter.into());
        }
    }

    // 7. Close Request Account (rent to owner)

    close_account(request_account, owner)?;

    // 8. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(TreasuryRequestCancelled {
        team: *team_account.key(),
        team_name: team.name,
        requester: *player_account.key(),
        timestamp: now,
    });

    Ok(())
}
