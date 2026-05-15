//! Rewards Cleanup - Clean up team castle reward accounts during transition
//!
//! Instruction 284
//!
//! Permissionless instruction to clean up TeamCastleRewardAccount
//! PDAs during castle ownership transition. Closes the reward tracking
//! accounts and returns rent to original members.

use pinocchio::{
    AccountView,
    Address,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::CastleTransitionProgress,
    state::{
        CastleAccount, PlayerAccount, TeamCastleRewardAccount,
    },
    constants::CASTLE_STATUS_TRANSITIONING,
    helpers::close_account,
    validation::{require_owner, require_initialized},
};

/// Phase constant for event
const PHASE_REWARDS: u8 = 2;

/// Crank Rewards Cleanup instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Crank (anyone can call)
/// 1. [writable] Castle account
/// 2. [] Member player account (for PDA derivation)
/// 3. [writable] Team castle reward account (to close)
/// 4. [writable] Rent recipient (member wallet)

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [
        _crank,
        castle_account,
        member_account,
        reward_account,
        rent_recipient,
    ]);

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle is in transitioning state
    if castle.status != CASTLE_STATUS_TRANSITIONING {
        return Err(GameError::CastleTransitioning.into());
    }

    // Verify reward account PDA
    require_owner(reward_account, program_id)?;

    let (expected_reward_pda, _) = TeamCastleRewardAccount::derive_pda(
        castle_account.address(),
        member_account.address(),
    );
    if reward_account.address() != &expected_reward_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(reward_account).map_err(|_| GameError::NoRewardsToClaim)?;

    // Verify reward account belongs to this castle
    let reward_data = reward_account.try_borrow()?;
    let reward = unsafe { TeamCastleRewardAccount::load(&reward_data) };

    if reward.castle != *castle_account.address() {
        return Err(GameError::InvalidPDA.into());
    }

    // Rent recipient must be the member's wallet (the player who
    // originally paid the rent for this reward tracking account). The
    // reward.member field stores the player PDA; load the player to obtain
    // their wallet (owner) and validate.
    if reward.member != *member_account.address() {
        return Err(GameError::InvalidAccount.into());
    }
    require_owner(member_account, program_id)?;
    let member_data = member_account.try_borrow()?;
    let member = unsafe { PlayerAccount::load(&member_data) };
    if rent_recipient.address() != &member.owner {
        return Err(GameError::InvalidAccount.into());
    }
    drop(member_data);

    // Update castle transition progress
    castle.transition_rewards_cleaned = castle.transition_rewards_cleaned.saturating_add(1);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Calculate progress
    let cleaned_count = castle.transition_rewards_cleaned;
    // Total is unknown ahead of time, use cleaned count as estimate
    let total_count = cleaned_count;

    // Drop borrow before closing
    drop(reward_data);

    // Close reward account
    close_account(reward_account, rent_recipient)?;

    // Emit event
    emit!(CastleTransitionProgress {
        castle: *castle_account.address(),
        phase: PHASE_REWARDS,
        cleaned_count,
        total_count,
        timestamp: now,
    });

    Ok(())
}
