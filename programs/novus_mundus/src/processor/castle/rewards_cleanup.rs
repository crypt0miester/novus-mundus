//! Rewards Cleanup - Clean up team castle reward accounts during transition
//!
//! Instruction 284
//!
//! Permissionless instruction to clean up TeamCastleRewardAccount
//! PDAs during castle ownership transition. Closes the reward tracking
//! accounts and returns rent to original members.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::CastleTransitionProgress,
    state::{
        CastleAccount, TeamCastleRewardAccount,
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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let _crank = &accounts[0];
    let castle_account = &accounts[1];
    let member_account = &accounts[2];
    let reward_account = &accounts[3];
    let rent_recipient = &accounts[4];

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle is in transitioning state
    if castle.status != CASTLE_STATUS_TRANSITIONING {
        return Err(GameError::CastleTransitioning.into());
    }

    // Verify reward account PDA
    require_owner(reward_account, program_id)?;

    let (expected_reward_pda, _) = TeamCastleRewardAccount::derive_pda(
        castle_account.key(),
        member_account.key(),
    );
    if reward_account.key() != &expected_reward_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(reward_account).map_err(|_| GameError::NoRewardsToClaim)?;

    // Verify reward account belongs to this castle
    let reward_data = reward_account.try_borrow_data()?;
    let reward = unsafe { TeamCastleRewardAccount::load(&reward_data) };

    if reward.castle != *castle_account.key() {
        return Err(GameError::InvalidPDA.into());
    }

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
        castle: *castle_account.key(),
        phase: PHASE_REWARDS,
        cleaned_count,
        total_count,
        timestamp: now,
    });

    Ok(())
}
