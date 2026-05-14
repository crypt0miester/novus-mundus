use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, TreasuryRequest, require_extension, EXT_TEAM, NULL_PUBKEY},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::TreasuryRequestApproved,
};

/// Approve a treasury withdrawal request (higher rank)
///
/// Higher ranked member approves a pending request, executing it immediately.
/// Approver must STRICTLY outrank the requester (lower rank number == higher rank).
/// Request PDA is closed, rent returned to requester.
///
/// This ix requires the *requester's* slot account so we can
/// verify the approver outranks the requester at *current* rank, not via a
/// permission heuristic. Without this, two RANK_1 co-leaders could
/// cross-approve each other's requests and drain the treasury without leader
/// involvement.
///
/// # Accounts
/// - [] approver_player: PlayerAccount (approver)
/// - [] approver_slot: TeamMemberSlot (for approver rank)
/// - [] requester_slot: TeamMemberSlot (for requester's current rank)
/// - [writable] requester_player: PlayerAccount (receives funds)
/// - [writable] team: TeamAccount
/// - [writable] request: TreasuryRequest PDA (to be closed)
/// - [writable] requester_refund: Account to receive request rent refund
/// - [signer] approver_owner: Approver's wallet
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - approver_slot_index: u16 (2 bytes) - Approver's slot index
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let approver_slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());

    // 2. Parse Accounts

    let [
        approver_account,
        approver_slot_account,
        requester_slot_account,
        requester_account,
        team_account,
        request_account,
        requester_refund,
        approver_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(approver_owner)?;
    require_writable(requester_account)?;
    require_writable(team_account)?;
    require_writable(request_account)?;
    require_writable(requester_refund)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let approver = PlayerAccount::load_checked_by_key(approver_account, program_id)?;
    if &approver.owner != approver_owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if approver.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*approver, EXT_TEAM)?;

    // 5. Validate Approver is in Team

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if approver.team == NULL_PUBKEY || &approver.team != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Verify Approver Slot and Get Rank

    let (expected_approver_slot, _) = TeamMemberSlot::derive_pda(team_account.address(), approver_slot_index);
    if approver_slot_account.address() != &expected_approver_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(approver_slot_account, program_id)?;

    let approver_rank: u8;
    {
        let slot_data = approver_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *approver_account.address() {
            return Err(GameError::NotSlotOwner.into());
        }

        approver_rank = slot.rank;
    }

    // 7. Load and Validate Request

    let (expected_request, _) = TreasuryRequest::derive_pda(team_account.address(), requester_account.address());
    if request_account.address() != &expected_request {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(request_account).map_err(|_| GameError::TreasuryRequestNotFound)?;
    require_owner(request_account, program_id)?;

    let amount: u64;
    {
        let request_data = request_account.try_borrow()?;
        let request = unsafe { TreasuryRequest::load(&request_data) };

        // Verify request is for this team and requester
        if &request.team != team_account.address() {
            return Err(GameError::InvalidParameter.into());
        }

        if &request.requester != requester_account.address() {
            return Err(GameError::InvalidParameter.into());
        }

        // Check request hasn't expired
        let clock = Clock::get()?;
        if request.is_expired(clock.unix_timestamp) {
            drop(request_data);
            close_account(request_account, requester_refund)?;
            return Err(GameError::TreasuryRequestExpired.into());
        }

        amount = request.amount;
    }

    // 8. Load Requester to Get Their Rank

    // Manual load since we don't have requester's wallet
    require_owner(requester_account, program_id)?;

    let requester_slot_index: u16;
    {
        let requester_data = requester_account.try_borrow()?;
        let requester = unsafe { PlayerAccount::load(&requester_data) };

        // Verify requester is still in team
        if requester.team != *team_account.address() {
            drop(requester_data);
            close_account(request_account, requester_refund)?;
            return Err(GameError::NotTeamMember.into());
        }

        requester_slot_index = requester.team_slot_index;
    }

    // Load requester's slot to get their CURRENT rank, then enforce
    // approver_rank < requester_rank STRICTLY. Equal ranks cannot approve each
    // other (closes the co-leader cross-approval drain).
    let (expected_requester_slot, _) = TeamMemberSlot::derive_pda(team_account.address(), requester_slot_index);
    if requester_slot_account.address() != &expected_requester_slot {
        return Err(GameError::InvalidPDA.into());
    }
    require_owner(requester_slot_account, program_id)?;

    let requester_rank: u8;
    {
        let slot_data = requester_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };
        if slot.player != *requester_account.address() {
            return Err(GameError::NotSlotOwner.into());
        }
        requester_rank = slot.rank;
    }

    // Strict rank check: a smaller `rank` number means a HIGHER position
    // (RANK_0 = Leader, RANK_1 = Co-leader, RANK_2 = Officer, RANK_3 = Member).
    // The approver must strictly outrank the requester. Equal ranks are rejected.
    if approver_rank >= requester_rank {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 9. Check Treasury Has Funds

    if team.treasury < amount {
        // Treasury balance changed since request was made
        close_account(request_account, requester_refund)?;
        return Err(GameError::InsufficientTeamTreasury.into());
    }

    // 10. Execute Withdrawal - Load requester mutably

    let mut requester_data = requester_account.try_borrow_mut()?;
    let requester = unsafe { PlayerAccount::load_mut(&mut requester_data) };

    team.treasury = team.treasury.saturating_sub(amount);
    requester.cash_on_hand = requester.cash_on_hand.saturating_add(amount);

    drop(requester_data);

    // 11. Close Request Account (rent to requester refund)

    close_account(request_account, requester_refund)?;

    // 12. Update Team Activity

    let clock = Clock::get()?;
    team.last_activity = clock.unix_timestamp;

    // 13. Emit Event

    emit!(TreasuryRequestApproved {
        team: *team_account.address(),
        team_name: team.name,
        approver: *approver_account.address(),
        requester: *requester_account.address(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
