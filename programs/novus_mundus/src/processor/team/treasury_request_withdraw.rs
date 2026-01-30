use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, TreasuryRequest, require_extension, EXT_TEAM, NULL_PUBKEY},
    constants::TREASURY_REQUEST_SEED,
    validation::{require_signer, require_writable, require_key_match, require_owner, require_empty},
    emit,
    events::TreasuryWithdrawRequested,
};

/// Request a treasury withdrawal (for amounts exceeding instant limits)
///
/// Creates a TreasuryRequest PDA with cooldown period.
/// After cooldown, requester can execute. Higher rank can approve early or reject.
/// Only one pending request per member at a time.
///
/// # Accounts
/// - [] player: PlayerAccount (requester)
/// - [] member_slot: TeamMemberSlot (for rank verification)
/// - [] team: TeamAccount
/// - [writable] request: TreasuryRequest PDA (to be created)
/// - [signer, writable] owner: Player's wallet (pays for request PDA)
/// - [] system_program: System program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount to withdraw
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Member's slot index
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 18 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let team_id = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let slot_index = u16::from_le_bytes(instruction_data[16..18].try_into().unwrap());

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    let [
        player_account,
        member_slot_account,
        team_account,
        request_account,
        owner,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(request_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let player = PlayerAccount::load_checked_by_key(player_account, program_id)?;
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    let team = TeamAccount::load_checked_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*player, EXT_TEAM)?;

    // 5. Validate Player is in Team

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if player.team == NULL_PUBKEY || &player.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Verify Member Slot and Get Rank

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

    // 7. Check Treasury Permission

    if !team.has_treasury_access(rank) {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 8. Check Treasury Has Enough Funds

    if team.treasury < amount {
        return Err(GameError::InsufficientTeamTreasury.into());
    }

    // 9. Verify Request PDA and Check No Existing Request

    let (expected_request, request_bump) = TreasuryRequest::derive_pda(team_account.key(), player_account.key());

    if request_account.key() != &expected_request {
        return Err(GameError::InvalidPDA.into());
    }

    // Request account must not exist (only one pending request per member)
    require_empty(request_account).map_err(|_| GameError::TreasuryRequestPending)?;

    // 10. Create Request Account

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let cooldown_seconds = team.get_cooldown_seconds();

    let request_lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(TreasuryRequest::LEN);

    let request_bump_seed = [request_bump];
    let request_seeds = pinocchio::seeds!(
        TREASURY_REQUEST_SEED,
        team_account.key().as_ref(),
        player_account.key().as_ref(),
        &request_bump_seed
    );
    let request_signer = pinocchio::instruction::Signer::from(&request_seeds);

    CreateAccount {
        from: owner,
        to: request_account,
        lamports: request_lamports,
        space: TreasuryRequest::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[request_signer])?;

    // 11. Initialize Request Data

    let mut request_data = request_account.try_borrow_mut_data()?;
    let request = unsafe { TreasuryRequest::load_mut(&mut request_data) };

    *request = TreasuryRequest::init(
        *team_account.key(),
        *player_account.key(),
        amount,
        now,
        cooldown_seconds,
        request_bump,
    );

    // 12. Emit Event

    emit!(TreasuryWithdrawRequested {
        team: *team_account.key(),
        team_name: team.name,
        requester: *player_account.key(),
        amount,
        timestamp: now,
    });

    Ok(())
}
