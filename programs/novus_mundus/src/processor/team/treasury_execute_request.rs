use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, TreasuryRequest, require_extension, EXT_TEAM, NULL_PUBKEY},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::TreasuryRequestExecuted,
};

/// Execute a treasury withdrawal request after cooldown
///
/// Requester executes their own request after cooldown period has passed.
/// Validates requester still has treasury permission and is in team.
/// Request PDA is closed, rent returned to requester.
///
/// # Accounts
/// - [writable] player: PlayerAccount (requester, receives funds)
/// - [] member_slot: TeamMemberSlot (to verify still has permission)
/// - [writable] team: TeamAccount
/// - [writable] request: TreasuryRequest PDA (to be closed)
/// - [signer, writable] owner: Player's wallet (receives request rent refund)
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Member's slot index
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());

    // 2. Parse Accounts

    let [
        player_account,
        member_slot_account,
        team_account,
        request_account,
        owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(request_account)?;

    // 4. Load Accounts

    let mut player = PlayerAccount::load_checked_mut(player_account, owner.key(), program_id)?;
    let mut team = TeamAccount::load_checked_mut(team_account, team_id, program_id)?;

    // 4a. Require EXT_TEAM
    require_extension(&*player, EXT_TEAM)?;

    // 5. Validate Player is Still in Team

    if player.team == NULL_PUBKEY || &player.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Team not disbanded
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // 6. Verify Member Slot and Get Current Rank

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), slot_index);
    if member_slot_account.key() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(member_slot_account, program_id)?;

    let rank: u8;
    {
        let slot_data = member_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *player_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        rank = slot.rank;
    }

    // 7. Verify Requester Still Has Treasury Permission

    if !team.has_treasury_access(rank) {
        // Player was demoted and lost treasury access
        // Close the request and return error
        close_account(request_account, owner)?;
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 8. Verify and Load Request

    let (expected_request, _) = TreasuryRequest::derive_pda(team_account.key(), player_account.key());
    if request_account.key() != &expected_request {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(request_account).map_err(|_| GameError::TreasuryRequestNotFound)?;
    require_owner(request_account, program_id)?;

    let amount: u64;
    {
        let request_data = request_account.try_borrow_data()?;
        let request = unsafe { TreasuryRequest::load(&request_data) };

        // Verify request is for this team and player
        if &request.team != team_account.key() {
            return Err(GameError::InvalidParameter.into());
        }

        if &request.requester != player_account.key() {
            return Err(GameError::InvalidParameter.into());
        }

        // Check cooldown has passed
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        if !request.is_executable(now) {
            return Err(GameError::TreasuryRequestNotExecutable.into());
        }

        // Check request hasn't expired (7 days max)
        if request.is_expired(now) {
            drop(request_data);
            close_account(request_account, owner)?;
            return Err(GameError::TreasuryRequestExpired.into());
        }

        amount = request.amount;
    }

    // 9. Check Treasury Has Sufficient Funds

    if team.treasury < amount {
        // Treasury balance dropped since request was made
        close_account(request_account, owner)?;
        return Err(GameError::InsufficientTeamTreasury.into());
    }

    // 10. Execute Withdrawal

    team.treasury = team.treasury.saturating_sub(amount);
    player.cash_on_hand = player.cash_on_hand.saturating_add(amount);

    let new_balance = team.treasury;
    let event_team_name = team.name;

    // 11. Close Request Account (rent to owner)

    // Need to drop the mutable borrows first
    drop(player);
    drop(team);

    close_account(request_account, owner)?;

    // 12. Emit Event

    let clock = Clock::get()?;

    emit!(TreasuryRequestExecuted {
        team: *team_account.key(),
        team_name: event_team_name,
        executor: *player_account.key(),
        requester: *player_account.key(),
        amount,
        new_balance,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
