use pinocchio::{AccountView, Address, ProgramResult};

use crate::{
    emit,
    error::GameError,
    events::TreasuryRequestRejected,
    helpers::close_account,
    state::{
        require_extension, PlayerAccount, TeamAccount, TeamMemberSlot, TreasuryRequest, EXT_TEAM,
        NULL_PUBKEY,
    },
    utils::{read_bytes32, read_u16, read_u64},
    validation::{require_initialized, require_owner, require_signer, require_writable},
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
/// - requester_pubkey: Address (32 bytes) - Requester's player account for PDA derivation
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let team_id = read_u64(instruction_data, 0, "team_id")?;
    let rejecter_slot_index = read_u16(instruction_data, 8, "rejecter_slot_index")?;
    let requester_pubkey = Address::from(read_bytes32(instruction_data, 10, "requester_pubkey")?);

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        rejecter_account,
        rejecter_slot_account,
        team_account,
        request_account,
        requester_refund,
        rejecter_owner,
    ]);

    // 3. Validate Accounts

    require_signer(rejecter_owner)?;
    require_writable(request_account)?;
    require_writable(requester_refund)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let rejecter = PlayerAccount::load_checked_by_key(rejecter_account, program_id)?;
    if &rejecter.owner != rejecter_owner.address() {
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

    if rejecter.team_address() == NULL_PUBKEY || &rejecter.team_address() != team_account.address()
    {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Verify Rejecter Slot and Get Rank

    let (expected_rejecter_slot, _) =
        TeamMemberSlot::derive_pda(team_account.address(), rejecter_slot_index);
    if rejecter_slot_account.address() != &expected_rejecter_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(rejecter_slot_account, program_id)?;

    let rejecter_rank: u8;
    {
        let slot_data = rejecter_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *rejecter_account.address() {
            return Err(GameError::NotSlotOwner.into());
        }

        rejecter_rank = slot.rank;
    }

    // 7. Check Rejecter Has Authority (RANK_0 or RANK_1)

    if rejecter_rank > TeamMemberSlot::RANK_1 {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 8. Verify and Load Request

    let (expected_request, _) =
        TreasuryRequest::derive_pda(team_account.address(), &requester_pubkey);
    if request_account.address() != &expected_request {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(request_account).map_err(|_| GameError::TreasuryRequestNotFound)?;
    require_owner(request_account, program_id)?;

    // Validate request belongs to this team
    {
        let request_data = request_account.try_borrow()?;
        let request = unsafe { TreasuryRequest::load(&request_data) };

        if &request.team != team_account.address() {
            return Err(GameError::InvalidParameter.into());
        }

        if &request.requester != &requester_pubkey {
            return Err(GameError::InvalidParameter.into());
        }
    }

    // 9. Close Request Account (rent to requester refund)

    close_account(request_account, requester_refund)?;

    // 10. Emit Event

    use pinocchio::sysvars::{clock::Clock, Sysvar};
    let now = Clock::get()?.unix_timestamp;

    emit!(TreasuryRequestRejected {
        team: *team_account.address(),
        team_name: team.name,
        rejector: *rejecter_account.address(),
        requester: requester_pubkey,
        timestamp: now,
    });

    Ok(())
}
