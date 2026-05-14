use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::TravelSpeedup,
    state::{PlayerAccount, GameEngine},
    types::TravelType,
};

/// Speed-up tiers for travel
/// Each tier reduces remaining travel time
pub const SPEEDUP_TIER_1: u8 = 1;  // 50% of time remains
pub const SPEEDUP_TIER_2: u8 = 2;  // 25% of time remains

/// Speed up current travel by spending gems
///
/// Tiered speed-up system:
/// - Tier 1: 50% of time remains (arrive in half the remaining time)
/// - Tier 2: 25% of time remains (arrive in quarter of remaining time)
///
/// Gem cost is calculated based on remaining time and tier:
/// cost = (remaining_minutes * gems_per_minute * tier_multiplier)
///
/// Instruction data format:
/// ```text
/// [0] speedup_tier: u8 (1, 2, or 3)
/// ```
///
/// # Accounts
/// 0. `[WRITE]` player_account - Player speeding up travel
/// 1. `[SIGNER]` owner - Player's wallet
/// 2. `[]` game_engine - For gem cost configuration
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        owner,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Parse Instruction Data

    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let speedup_tier = instruction_data[0];

    if speedup_tier < SPEEDUP_TIER_1 || speedup_tier > SPEEDUP_TIER_2 {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts (kingdom-scoped)

    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let mut player_data = PlayerAccount::load_checked_mut(player_account, game_engine_account.address(), owner.address(), program_id)?;

    // 6. Validate Currently Traveling

    if !player_data.is_traveling_any() {
        return Err(GameError::NotTraveling.into());
    }

    // 7. Calculate Remaining Time

    let now = Clock::get()?.unix_timestamp;

    if now >= player_data.arrival_time {
        // Already arrived, nothing to speed up
        return Err(GameError::TravelNotComplete.into()); // Reusing error - already at destination
    }

    let remaining_seconds = (player_data.arrival_time - now) as u64;
    // Integer ceiling division: (a + b - 1) / b
    let remaining_minutes = (remaining_seconds + 59) / 60;

    if remaining_minutes == 0 {
        // Less than a minute remaining, no need to speed up
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Calculate Time Reduction Based on Tier
    //
    // Tier 1: 50% of time remains (multiply remaining by 0.5)
    // Tier 2: 25% of time remains (multiply remaining by 0.25)

    let (time_multiplier, tier_cost_multiplier): (f64, u64) = match speedup_tier {
        SPEEDUP_TIER_1 => (0.5, 1),    // 50% of time remains, 1x gem cost
        SPEEDUP_TIER_2 => (0.25, 2),   // 25% of time remains, 2x gem cost
        _ => return Err(GameError::InvalidParameter.into()),
    };

    let new_remaining_seconds = (remaining_seconds as f64 * time_multiplier) as i64;

    // 9. Calculate Gem Cost
    //
    // Base cost: gems_per_minute * remaining_minutes
    // Final cost: base_cost * tier_multiplier

    let gems_per_minute = game_engine_data.gameplay_config.gem_cost_per_minute_speedup;
    let base_gem_cost = remaining_minutes.saturating_mul(gems_per_minute as u64);
    let total_gem_cost = base_gem_cost.saturating_mul(tier_cost_multiplier);

    // 10. Validate Player Has Enough Gems

    if player_data.gems < total_gem_cost {
        return Err(GameError::InsufficientGems.into());
    }

    // 11. Deduct Gems

    player_data.gems = player_data.gems.saturating_sub(total_gem_cost);

    // 12. Update Arrival Time

    player_data.arrival_time = now + new_remaining_seconds;

    // 13. Update LocationAccount reserved_arrival_time
    //
    // Note: We don't update LocationAccount here because:
    // - It would require passing the destination location account
    // - The location's reserved_arrival_time is used for speed-based stealing
    // - A player speeding up doesn't change their "claim" on the destination
    // - They still arrive at the new time, just faster
    //
    // If we wanted to update it, we'd need to add the destination_location account
    // and update its reserved_arrival_time field.

    // 14. Emit Event

    let is_intercity = player_data.travel_type == TravelType::Intercity as u8;

    emit!(TravelSpeedup {
        player: *player_account.address(),
        player_name: player_data.name,
        is_intercity,
        speedup_tier,
        gems_spent: total_gem_cost,
        new_eta: player_data.arrival_time,
        timestamp: now,
    });

    Ok(())
}
