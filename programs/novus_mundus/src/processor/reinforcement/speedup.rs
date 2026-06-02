use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::reinforcement::ReinforcementSpeedup,
    state::{GameEngine, PlayerAccount, ReinforcementAccount, ReinforcementStatus},
    utils::read_u8,
    validation::{require_owner, require_signer, require_writable},
};

/// Speed-up tiers for reinforcement travel
pub const SPEEDUP_TIER_1: u8 = 1; // 50% of time remains
pub const SPEEDUP_TIER_2: u8 = 2; // 25% of time remains

/// Speed up reinforcement travel by spending gems
///
/// Can speed up either outbound travel (Traveling) or return travel (Returning).
/// Only the sender can speed up their reinforcement.
///
/// Tiered speed-up system:
/// - Tier 1: 50% of time remains (1x gem cost)
/// - Tier 2: 25% of time remains (2x gem cost)
///
/// # Accounts
/// 0. `[SIGNER]` sender_owner: Sender's wallet
/// 1. `[WRITE]` sender_player: Sender's PlayerAccount PDA (pays gems)
/// 2. `[WRITE]` reinforcement_account: ReinforcementAccount PDA
/// 3. `[]` game_engine: GameEngine PDA (for gem cost config)
///
/// # Instruction Data
/// - speedup_tier: u8 (1 byte) - 1 or 2
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        sender_owner,
        sender_player,
        reinforcement_account,
        game_engine,
    ]);

    // 2. Parse Instruction Data
    let speedup_tier = read_u8(instruction_data, 0, "reinforcement_speedup.speedup_tier")?;
    if speedup_tier < SPEEDUP_TIER_1 || speedup_tier > SPEEDUP_TIER_2 {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Validate Accounts
    require_signer(sender_owner)?;
    require_writable(sender_player)?;
    require_writable(reinforcement_account)?;
    require_owner(sender_player, program_id)?;
    require_owner(reinforcement_account, program_id)?;

    // 4. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load Sender Player
    let mut sender_data_ref = sender_player.try_borrow_mut()?;
    let sender = unsafe { PlayerAccount::load_mut(&mut sender_data_ref) };

    // Validate sender ownership
    if &sender.owner != sender_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Load Reinforcement
    let mut reinf_data_ref = reinforcement_account.try_borrow_mut()?;
    let reinf = unsafe { ReinforcementAccount::load_mut(&mut reinf_data_ref) };

    // Validate sender owns this reinforcement
    if &reinf.sender != sender_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Validate Status (must be Traveling or Returning)
    let status = reinf.get_status();
    if status != ReinforcementStatus::Traveling && status != ReinforcementStatus::Returning {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Calculate Remaining Time based on status
    let remaining_seconds = if status == ReinforcementStatus::Traveling {
        // Outbound travel
        let arrival = reinf.arrives_at;
        if now >= arrival {
            return Err(GameError::TravelNotComplete.into()); // Already arrived
        }
        arrival.saturating_sub(now)
    } else {
        // Return travel
        let return_arrival = reinf
            .return_started_at
            .saturating_add(reinf.return_duration as i64);
        if now >= return_arrival {
            return Err(GameError::ReturnNotComplete.into()); // Already returned
        }
        return_arrival.saturating_sub(now)
    };

    // Integer ceiling division: (a + b - 1) / b
    let remaining_minutes = (remaining_seconds as u64).saturating_add(59) / 60;
    if remaining_minutes == 0 {
        // Less than a minute remaining
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Calculate Time Reduction
    let (time_multiplier, tier_cost_multiplier): (f64, u64) = match speedup_tier {
        SPEEDUP_TIER_1 => (0.5, 1),  // 50% of time remains, 1x gem cost
        SPEEDUP_TIER_2 => (0.25, 2), // 25% of time remains, 2x gem cost
        _ => return Err(GameError::InvalidParameter.into()),
    };

    let new_remaining_seconds = (remaining_seconds as f64 * time_multiplier) as i64;

    // 10. Calculate Gem Cost
    let game_engine_data_ref = game_engine.try_borrow()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data_ref) };

    let gems_per_minute = game_engine_state
        .gameplay_config
        .gem_cost_per_minute_speedup;
    let base_gem_cost = remaining_minutes.saturating_mul(gems_per_minute as u64);
    let total_gem_cost = base_gem_cost.saturating_mul(tier_cost_multiplier);

    // 11. Validate and Deduct Gems
    if sender.gems < total_gem_cost {
        return Err(GameError::InsufficientGems.into());
    }
    sender.gems = sender.gems.saturating_sub(total_gem_cost);

    // 12. Update Arrival Time based on status
    let (speedup_type_value, new_eta) = if status == ReinforcementStatus::Traveling {
        // Update outbound arrival
        let new_arrival = now.saturating_add(new_remaining_seconds);
        reinf.arrives_at = new_arrival;
        // Also update travel_duration to reflect the speedup
        // (so has_arrived() calculates correctly)
        let elapsed = now.saturating_sub(reinf.sent_at);
        reinf.travel_duration = elapsed.saturating_add(new_remaining_seconds) as i32;
        (1u8, new_arrival)
    } else {
        // Update return arrival by adjusting return_duration
        let elapsed = now.saturating_sub(reinf.return_started_at);
        let new_arrival = now.saturating_add(new_remaining_seconds);
        reinf.return_duration = elapsed.saturating_add(new_remaining_seconds) as i32;
        (2u8, new_arrival)
    };

    // Emit event
    emit!(ReinforcementSpeedup {
        reinforcement: *reinforcement_account.address(),
        sender: reinf.sender,
        sender_name: sender.name,
        receiver: reinf.destination,
        speedup_type: speedup_type_value,
        gems_spent: total_gem_cost,
        new_eta,
        timestamp: now,
    });

    Ok(())
}
