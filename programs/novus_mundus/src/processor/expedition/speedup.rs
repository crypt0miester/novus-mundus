//! Speedup Expedition Processor
//!
//! Allows a player to speed up an active expedition by spending gems.
//! The remaining time is reduced based on the speedup tier selected.
//!
//! # Speedup Tiers
//! - Tier 1: Reduce remaining time by 50%, costs 1x gems per minute
//! - Tier 2: Reduce remaining time by 75%, costs 2x gems per minute
//!
//! # Cost Formula
//! `gem_cost = remaining_minutes × gems_per_minute × tier_multiplier`

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::EXPEDITION_SEED,
    error::GameError,
    state::{PlayerAccount, ExpeditionAccount},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::ExpeditionSpeedup,
};

/// Gems cost per minute of speedup (base rate)
pub const EXPEDITION_SPEEDUP_GEMS_PER_MINUTE: u64 = 100;

/// Speedup an active expedition
///
/// Reduces the remaining expedition time by spending gems.
/// The expedition's effective end time is moved closer to now.
///
/// # Speedup Tiers
/// - Tier 1: 50% time reduction, 1x gem cost
/// - Tier 2: 75% time reduction, 2x gem cost
///
/// # Accounts
/// 0. `[signer]` owner - Player's wallet
/// 1. `[writable]` player_account - PlayerAccount PDA
/// 2. `[writable]` expedition_account - ExpeditionAccount PDA
///
/// # Instruction Data
/// - speedup_tier: u8 (1 byte) - 1 or 2
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let owner = &accounts[0];
    let player_account = &accounts[1];
    let expedition_account = &accounts[2];

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(expedition_account)?;
    require_owner(player_account, program_id)?;
    require_owner(expedition_account, program_id)?;

    // 3. Parse Instruction Data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let speedup_tier = instruction_data[0];
    if speedup_tier < 1 || speedup_tier > 2 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Validate ExpeditionAccount PDA
    let (expected_expedition_pda, _) = pinocchio::pubkey::find_program_address(
        &[EXPEDITION_SEED, owner.key().as_ref()],
        program_id,
    );

    if expedition_account.key() != &expected_expedition_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Check expedition exists
    if expedition_account.data_len() == 0 {
        return Err(GameError::NoExpeditionInProgress.into());
    }

    // 6. Load Player Data
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 7. Verify ownership
    if !player_data.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 8. Get current time
    let now = Clock::get()?.unix_timestamp;

    // 9. Load and modify expedition
    let mut expedition_data_ref = expedition_account.try_borrow_mut_data()?;
    let expedition = unsafe { ExpeditionAccount::load_mut(&mut expedition_data_ref) };

    // Verify expedition belongs to this player
    if &expedition.player != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 10. Calculate end time and remaining time
    let end_time = expedition.end_time();

    // Check expedition is not already complete
    if now >= end_time {
        return Err(GameError::ExpeditionAlreadyComplete.into());
    }

    let remaining_seconds = end_time - now;
    let remaining_minutes = ((remaining_seconds as f64) / 60.0).ceil() as u64;

    if remaining_minutes == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 11. Calculate tier effects
    let (time_reduction_bps, cost_multiplier): (u64, u64) = match speedup_tier {
        1 => (5000, 1),  // 50% reduction, 1x cost
        2 => (7500, 2),  // 75% reduction, 2x cost
        _ => return Err(GameError::InvalidParameter.into()),
    };

    // 12. Calculate gem cost (based on time being reduced, not remaining)
    let seconds_to_reduce = (remaining_seconds as u64)
        .saturating_mul(time_reduction_bps)
        / 10000;
    let minutes_to_reduce = (seconds_to_reduce / 60).max(1);

    let gem_cost = minutes_to_reduce
        .saturating_mul(EXPEDITION_SPEEDUP_GEMS_PER_MINUTE)
        .saturating_mul(cost_multiplier);

    // 13. Validate sufficient gems
    if player_data.gems < gem_cost {
        return Err(GameError::InsufficientGems.into());
    }

    // 14. Deduct gems
    player_data.gems = player_data.gems
        .checked_sub(gem_cost)
        .ok_or(GameError::MathOverflow)?;

    // 15. Apply speedup by adjusting start_time forward
    // This makes the expedition appear to have started earlier, thus ending sooner
    let time_saved = (remaining_seconds as u64)
        .saturating_mul(time_reduction_bps)
        / 10000;

    expedition.start_time = expedition.start_time
        .saturating_sub(time_saved as i64);

    let new_end_time = expedition.end_time();

    // 16. Emit event
    emit!(ExpeditionSpeedup {
        player: *owner.key(),
        speedup_seconds: time_saved,
        gems_spent: gem_cost,
        new_eta: new_end_time,
        timestamp: now,
    });

    Ok(())
}
