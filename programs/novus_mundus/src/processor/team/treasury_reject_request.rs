use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, TreasuryRequest, require_extension, EXT_TEAM, NULL_PUBKEY},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::TreasuryRequestRejected,
};

/// Reject a treasury withdrawal request (higher rank)
///
/// Higher ranked member rejects a pending request.
/// Request PDA is closed, rent returned to requester.
/// Only leader (RANK_0) or high rank (RANK_1) can reject requests.
///
/// # Accounts
/// - [] rejecter_player: PlayerAccount (rejecter)
/// - [] rejecter_slot: TeamMemberSlot (for rejecter rank)
/// - [] team: TeamAccount
/// - [writable] request: TreasuryRequest PDA (to be closed)
/// - [writable] requester_refund: Account to receive request rent refund
/// - [signer] rejecter_owner: Rejecter's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - rejecter_slot_index: u16 (2 bytes) - Rejecter's slot index
/// - requester_pubkey: Pubkey (32 bytes) - Requester's player account for PDA derivation
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 42 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let rejecter_slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let requester_pubkey = Pubkey::from(
        <[u8; 32]>::try_from(&instruction_data[10..42]).unwrap()
    );

    // 2. Parse Accounts

    let [
        rejecter_account,
        rejecter_slot_account,
        team_account,
        request_account,
        requester_refund,
        rejecter_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(rejecter_owner)?;
    require_writable(request_account)?;
    require_writable(requester_refund)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let rejecter = PlayerAccount::load_checked_by_key(rejecter_account, program_id)?;
    if &rejecter.owner != rejecter_owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    let team = TeamAccount::load_checked_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if rejecter.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*rejecter, EXT_TEAM)?;

    // 5. Validate Rejecter is in Team

    if rejecter.team == NULL_PUBKEY || &rejecter.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Verify Rejecter Slot and Get Rank

    let (expected_rejecter_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), rejecter_slot_index);
    if rejecter_slot_account.key() != &expected_rejecter_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(rejecter_slot_account, program_id)?;

    let rejecter_rank: u8;
    {
        let slot_data = rejecter_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *rejecter_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        rejecter_rank = slot.rank;
    }

    // 7. Check Rejecter Has Authority (RANK_0 or RANK_1)

    if rejecter_rank > TeamMemberSlot::RANK_1 {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 8. Verify and Load Request

    let (expected_request, _) = TreasuryRequest::derive_pda(team_account.key(), &requester_pubkey);
    if request_account.key() != &expected_request {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(request_account).map_err(|_| GameError::TreasuryRequestNotFound)?;
    require_owner(request_account, program_id)?;

    // Validate request belongs to this team
    {
        let request_data = request_account.try_borrow_data()?;
        let request = unsafe { TreasuryRequest::load(&request_data) };

        if &request.team != team_account.key() {
            return Err(GameError::InvalidParameter.into());
        }

        if &request.requester != &requester_pubkey {
            return Err(GameError::InvalidParameter.into());
        }
    }

    // 9. Close Request Account (rent to requester refund)

    close_account(request_account, requester_refund)?;

    // 10. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(TreasuryRequestRejected {
        team: *team_account.key(),
        team_name: team.name,
        rejector: *rejecter_account.key(),
        requester: requester_pubkey,
        timestamp: now,
    });

    Ok(())
}
