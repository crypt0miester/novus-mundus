use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::TreasuryWithdraw,
    state::{require_extension, PlayerAccount, TeamAccount, TeamMemberSlot, EXT_TEAM, NULL_PUBKEY},
    utils::{read_u16, read_u64},
    validation::{require_owner, require_signer, require_writable},
};

/// Withdraw from team treasury (instant - within limits)
///
/// For amounts within instant_limit and daily_cap, withdraw immediately.
/// For larger amounts, use treasury_request_withdraw instead.
///
/// Security checks:
/// - Rank must have PERM_TREASURY permission
/// - Amount must be <= instant_limit for rank
/// - Amount must be <= remaining daily_cap for rank
/// - Treasury must have sufficient balance
///
/// # Accounts
/// - [writable] player: PlayerAccount (withdrawer)
/// - [writable] member_slot: TeamMemberSlot (for rank and daily tracking)
/// - [writable] team: TeamAccount
/// - [signer] owner: Player's wallet
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount to withdraw
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Member's slot index
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let amount = read_u64(instruction_data, 0, "amount")?;
    let team_id = read_u64(instruction_data, 8, "team_id")?;
    let slot_index = read_u16(instruction_data, 16, "slot_index")?;

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        member_slot_account,
        team_account,
        owner,
    ]);

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(member_slot_account)?;
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

    // 5. Validate Player is in Team

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    if player.team_address() == NULL_PUBKEY || &player.team_address() != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // 6. Verify and Load Member Slot

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.address(), slot_index);
    if member_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    require_owner(member_slot_account, program_id)?;

    let mut slot_data = member_slot_account.try_borrow_mut()?;
    let slot = unsafe { TeamMemberSlot::load_mut(&mut slot_data) };

    // Verify slot belongs to this player
    if slot.player != *player_account.address() {
        return Err(GameError::NotSlotOwner.into());
    }

    let rank = slot.rank;

    // 7. Check Treasury Permission

    if !team.has_treasury_access(rank) {
        return Err(GameError::InsufficientTeamPermissions.into());
    }

    // 8. Get Current Time and Check Daily Limits

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Reset daily counter if it's a new day
    slot.reset_daily_if_needed(now);

    let withdrawn_today = slot.treasury_withdrawn_today;

    // 9. Check Instant Withdrawal Limits

    if !team.can_withdraw_instant(rank, amount, withdrawn_today) {
        // Amount exceeds instant limit or daily cap
        // User should use treasury_request_withdraw for larger amounts
        return Err(GameError::TreasuryWithdrawExceedsLimit.into());
    }

    // 10. Check Treasury Balance

    if team.treasury < amount {
        return Err(GameError::InsufficientTeamTreasury.into());
    }

    // 11. Execute Withdrawal

    team.treasury = team.treasury.saturating_sub(amount);
    player.cash_on_hand = player.cash_on_hand.saturating_add(amount);

    // 12. Record Withdrawal for Daily Tracking

    slot.record_withdrawal(amount);

    // 13. Update Team Activity

    team.last_activity = now;

    // 14. Emit Event

    emit!(TreasuryWithdraw {
        team: *team_account.address(),
        team_name: team.name,
        withdrawer: *player_account.address(),
        amount,
        new_balance: team.treasury,
        timestamp: now,
    });

    Ok(())
}
