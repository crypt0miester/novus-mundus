use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, GameEngine, RallyAccount, RallyParticipant, RallyStatus},
};

/// Speedup type constants - what phase/target to speed up
/// - GATHER (0): Speed up participant's travel TO rally point (payer: participant OR leader)
/// - MARCH (1): Speed up army's march to target (payer: leader only)
/// - RETURN (2): Speed up participant's return home (payer: that participant only)
pub const SPEEDUP_GATHER: u8 = 0;
pub const SPEEDUP_MARCH: u8 = 1;
pub const SPEEDUP_RETURN: u8 = 2;

/// Speed up rally travel (gather, march, or return)
///
/// # Speedup Types
/// - Gather (0): Speed up a participant's travel to rally point
///   - Valid during: Gathering phase
///   - Payer: ANYONE willing to pay gems
/// - March (1): Speed up the entire army's march to target
///   - Valid during: Marching phase
///   - Payer: ANYONE willing to pay gems
/// - Return (2): Speed up a participant's return journey
///   - Valid during: Returning phase
///   - Payer: ANYONE willing to pay gems
///
/// # Tier System (same gem cost for all types)
/// - Tier 1: 50% time reduction, 1x gem cost
/// - Tier 2: 75% time reduction, 2x gem cost
/// - Tier 3: 87.5% time reduction, 4x gem cost
///
/// Instruction data format:
/// ```text
/// [0] speedup_type: u8 (0=Gather, 1=March, 2=Return)
/// [1] speedup_tier: u8 (1, 2, or 3)
/// ```
///
/// # Accounts
/// 0. `[WRITE]` rally_account - The rally
/// 1. `[WRITE]` rally_participant - Participant being sped up (ignored for March)
/// 2. `[WRITE]` payer_player - Player paying for speedup
/// 3. `[SIGNER]` payer_owner - Payer's wallet
/// 4. `[]` game_engine - For gem cost configuration
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        rally_account,
        rally_participant_account,
        payer_player_account,
        payer_owner,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Parse Instruction Data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let speedup_type = instruction_data[0];
    let speedup_tier = instruction_data[1];

    if speedup_tier < 1 || speedup_tier > 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Validate Signer
    if !payer_owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Game Engine
    let game_engine_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_ref) };

    // 5. Load Payer (anyone can pay for speedup)
    let mut payer_data_ref = payer_player_account.try_borrow_mut_data()?;
    let payer_data = unsafe { PlayerAccount::load_mut(&mut payer_data_ref) };

    // Validate payer_owner matches the PlayerAccount owner
    // (ensures gems are deducted from the correct account)
    if !payer_data.is_owner(payer_owner.key()) {
        return Err(GameError::InvalidParameter.into());
    }

    let now = Clock::get()?.unix_timestamp;

    // 6. Calculate tier multipliers (same for all speedup types)
    let (time_multiplier, tier_cost_multiplier): (f64, u64) = match speedup_tier {
        1 => (0.5, 1),    // 50% of time remains, 1x gem cost
        2 => (0.25, 2),   // 25% of time remains, 2x gem cost
        3 => (0.125, 4),  // 12.5% of time remains, 4x gem cost
        _ => return Err(GameError::InvalidParameter.into()),
    };

    // 7. Process based on speedup type
    match speedup_type {
        // ============================================================
        // GATHER: Speed up participant's travel to rally point
        // ============================================================
        SPEEDUP_GATHER => {
            let rally_data_ref = rally_account.try_borrow_data()?;
            let rally_data = unsafe { RallyAccount::load(&rally_data_ref) };

            let mut participant_data_ref = rally_participant_account.try_borrow_mut_data()?;
            let participant_data = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

            // Validate rally is in Gathering phase
            if rally_data.status != RallyStatus::Gathering as u8 {
                return Err(GameError::RallyNotGathering.into());
            }

            // Validate participant belongs to this rally
            if participant_data.rally_id != rally_data.id ||
               participant_data.rally_creator != rally_data.creator {
                return Err(GameError::NotRallyParticipant.into());
            }

            // Validate not already arrived
            if participant_data.arrived_at_rally {
                return Err(GameError::ParticipantAlreadyArrived.into());
            }

            if now >= participant_data.arrives_at_rally {
                return Err(GameError::ParticipantAlreadyArrived.into());
            }

            // Calculate and apply speedup
            let remaining_seconds = participant_data.arrives_at_rally - now;
            let remaining_minutes = ((remaining_seconds as f64) / 60.0).ceil() as u64;

            if remaining_minutes == 0 {
                return Err(GameError::InvalidParameter.into());
            }

            let gems_per_minute = game_engine.gameplay_config.gem_cost_per_minute_speedup;
            let total_gem_cost = remaining_minutes
                .saturating_mul(gems_per_minute as u64)
                .saturating_mul(tier_cost_multiplier);

            if payer_data.gems < total_gem_cost {
                return Err(GameError::InsufficientGems.into());
            }

            payer_data.gems = payer_data.gems.saturating_sub(total_gem_cost);

            let new_remaining = (remaining_seconds as f64 * time_multiplier) as i64;
            participant_data.arrives_at_rally = now + new_remaining;
        }

        // ============================================================
        // MARCH: Speed up entire army's march to target
        // ============================================================
        SPEEDUP_MARCH => {
            let mut rally_data_ref = rally_account.try_borrow_mut_data()?;
            let rally_data = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

            // Validate rally is in Marching phase
            if rally_data.status != RallyStatus::Marching as u8 {
                return Err(GameError::RallyNotMarching.into());
            }

            if now >= rally_data.arrive_at {
                return Err(GameError::InvalidParameter.into()); // Already arrived
            }

            // Calculate and apply speedup
            let remaining_seconds = rally_data.arrive_at - now;
            let remaining_minutes = ((remaining_seconds as f64) / 60.0).ceil() as u64;

            if remaining_minutes == 0 {
                return Err(GameError::InvalidParameter.into());
            }

            let gems_per_minute = game_engine.gameplay_config.gem_cost_per_minute_speedup;
            let total_gem_cost = remaining_minutes
                .saturating_mul(gems_per_minute as u64)
                .saturating_mul(tier_cost_multiplier);

            if payer_data.gems < total_gem_cost {
                return Err(GameError::InsufficientGems.into());
            }

            payer_data.gems = payer_data.gems.saturating_sub(total_gem_cost);

            let new_remaining = (remaining_seconds as f64 * time_multiplier) as i64;
            rally_data.arrive_at = now + new_remaining;
        }

        // ============================================================
        // RETURN: Speed up participant's return journey
        // ============================================================
        SPEEDUP_RETURN => {
            let rally_data_ref = rally_account.try_borrow_data()?;
            let rally_data = unsafe { RallyAccount::load(&rally_data_ref) };

            let mut participant_data_ref = rally_participant_account.try_borrow_mut_data()?;
            let participant_data = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

            // Validate participant belongs to this rally
            if participant_data.rally_id != rally_data.id ||
               participant_data.rally_creator != rally_data.creator {
                return Err(GameError::NotRallyParticipant.into());
            }

            // Validate return has started (covers early leavers who have return_started_at > 0)
            // Early leavers can speedup even if rally is still in Gathering phase
            if participant_data.return_started_at == 0 {
                // Not started returning yet - check if rally is in Returning/Cancelled
                if rally_data.status != RallyStatus::Returning as u8
                    && rally_data.status != RallyStatus::Cancelled as u8 {
                    return Err(GameError::NotReturningYet.into());
                }
                return Err(GameError::NotReturningYet.into());
            }

            if participant_data.returned {
                return Err(GameError::ParticipantAlreadyReturned.into());
            }

            let return_completes_at = participant_data.return_started_at +
                participant_data.return_duration as i64;

            if now >= return_completes_at {
                return Err(GameError::ParticipantAlreadyReturned.into());
            }

            // Calculate and apply speedup
            let remaining_seconds = return_completes_at - now;
            let remaining_minutes = ((remaining_seconds as f64) / 60.0).ceil() as u64;

            if remaining_minutes == 0 {
                return Err(GameError::InvalidParameter.into());
            }

            let gems_per_minute = game_engine.gameplay_config.gem_cost_per_minute_speedup;
            let total_gem_cost = remaining_minutes
                .saturating_mul(gems_per_minute as u64)
                .saturating_mul(tier_cost_multiplier);

            if payer_data.gems < total_gem_cost {
                return Err(GameError::InsufficientGems.into());
            }

            payer_data.gems = payer_data.gems.saturating_sub(total_gem_cost);

            // Reduce remaining duration
            let new_remaining = (remaining_seconds as f64 * time_multiplier) as i32;
            let elapsed = (now - participant_data.return_started_at) as i32;
            participant_data.return_duration = elapsed + new_remaining;
        }

        _ => return Err(GameError::InvalidParameter.into()),
    }

    Ok(())
}
