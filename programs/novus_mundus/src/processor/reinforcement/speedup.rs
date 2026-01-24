use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{ReinforcementAccount, ReinforcementStatus, PlayerAccount, GameEngine},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::reinforcement::ReinforcementSpeedup,
};

/// Speed-up tiers for reinforcement travel
pub const SPEEDUP_TIER_1: u8 = 1;  // 50% of time remains
pub const SPEEDUP_TIER_2: u8 = 2;  // 25% of time remains

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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        sender_owner,
        sender_player,
        reinforcement_account,
        game_engine,
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
    let mut sender_data_ref = sender_player.try_borrow_mut_data()?;
    let sender = unsafe { PlayerAccount::load_mut(&mut sender_data_ref) };

    // Validate sender ownership
    if &sender.owner != sender_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Load Reinforcement
    let mut reinf_data_ref = reinforcement_account.try_borrow_mut_data()?;
    let reinf = unsafe { ReinforcementAccount::load_mut(&mut reinf_data_ref) };

    // Validate sender owns this reinforcement
    if &reinf.sender != sender_owner.key() {
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
        arrival - now
    } else {
        // Return travel
        let return_arrival = reinf.return_started_at + reinf.return_duration as i64;
        if now >= return_arrival {
            return Err(GameError::ReturnNotComplete.into()); // Already returned
        }
        return_arrival - now
    };

    // Integer ceiling division: (a + b - 1) / b
    let remaining_minutes = (remaining_seconds as u64 + 59) / 60;
    if remaining_minutes == 0 {
        // Less than a minute remaining
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Calculate Time Reduction
    let (time_multiplier, tier_cost_multiplier): (f64, u64) = match speedup_tier {
        SPEEDUP_TIER_1 => (0.5, 1),    // 50% of time remains, 1x gem cost
        SPEEDUP_TIER_2 => (0.25, 2),   // 25% of time remains, 2x gem cost
        _ => return Err(GameError::InvalidParameter.into()),
    };

    let new_remaining_seconds = (remaining_seconds as f64 * time_multiplier) as i64;

    // 10. Calculate Gem Cost
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data_ref) };

    let gems_per_minute = game_engine_state.gameplay_config.gem_cost_per_minute_speedup;
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
        let new_arrival = now + new_remaining_seconds;
        reinf.arrives_at = new_arrival;
        // Also update travel_duration to reflect the speedup
        // (so has_arrived() calculates correctly)
        let elapsed = now - reinf.sent_at;
        reinf.travel_duration = (elapsed + new_remaining_seconds) as i32;
        (1u8, new_arrival)
    } else {
        // Update return arrival by adjusting return_duration
        let elapsed = now - reinf.return_started_at;
        let new_arrival = now + new_remaining_seconds;
        reinf.return_duration = (elapsed + new_remaining_seconds) as i32;
        (2u8, new_arrival)
    };

    // Emit event
    emit!(ReinforcementSpeedup {
        reinforcement: *reinforcement_account.key(),
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
