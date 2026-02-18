use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, GameEngine, EstateAccount, BuildingStatus, BuildingType},
};

/// Speed-up tiers for building construction
pub const SPEEDUP_TIER_1: u8 = 1;  // 50% of time remains
pub const SPEEDUP_TIER_2: u8 = 2;  // 25% of time remains

/// Speed up building construction/upgrade by spending gems
///
/// Tiered speed-up system (same as travel):
/// - Tier 1: 50% of time remains
/// - Tier 2: 25% of time remains
///
/// Gem cost = remaining_minutes * gems_per_minute * tier_multiplier
///
/// Instruction data format:
/// [0] building_type: u8 (which building to speed up)
/// [1] speedup_tier: u8 (1 or 2)
///
/// # Accounts
/// 0. `[WRITE]` player_account - Player speeding up construction
/// 1. `[WRITE]` estate_account - Estate containing the building
/// 2. `[SIGNER]` owner - Player's wallet
/// 3. `[]` game_engine - For gem cost configuration
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        player_account,
        estate_account,
        owner,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Parse Instruction Data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let building_type_u8 = instruction_data[0];
    let speedup_tier = instruction_data[1];

    let building_type = BuildingType::from_u8(building_type_u8)
        .ok_or(ProgramError::InvalidInstructionData)?;

    if speedup_tier < SPEEDUP_TIER_1 || speedup_tier > SPEEDUP_TIER_2 {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Validate Signer
    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts
    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let mut player_data = PlayerAccount::load_checked_mut(player_account, game_engine_account.key(), owner.key(), program_id)?;
    let mut estate_data = EstateAccount::load_checked_mut(estate_account, player_account.key(), owner.key(), program_id)?;

    // 5. Find the building
    let building = estate_data.find_building_mut(building_type)
        .ok_or(GameError::BuildingRequired)?;

    // 6. Validate building is under construction or upgrading
    let is_building = building.status == BuildingStatus::Building as u8;
    let is_upgrading = building.status == BuildingStatus::Upgrading as u8;
    if !is_building && !is_upgrading {
        return Err(GameError::BuildingNotActive.into());
    }

    // 7. Calculate Remaining Time
    let now = Clock::get()?.unix_timestamp;

    if now >= building.construction_ends {
        // Already complete, nothing to speed up
        return Err(GameError::InvalidParameter.into());
    }

    let remaining_seconds = (building.construction_ends - now) as u64;
    let remaining_minutes = (remaining_seconds + 59) / 60;

    if remaining_minutes == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Calculate Time Reduction
    let (time_multiplier, tier_cost_multiplier): (f64, u64) = match speedup_tier {
        SPEEDUP_TIER_1 => (0.5, 1),
        SPEEDUP_TIER_2 => (0.25, 2),
        _ => return Err(GameError::InvalidParameter.into()),
    };

    let new_remaining_seconds = (remaining_seconds as f64 * time_multiplier) as i64;

    // 9. Calculate Gem Cost
    let gems_per_minute = game_engine_data.gameplay_config.gem_cost_per_minute_speedup;
    let base_gem_cost = remaining_minutes.saturating_mul(gems_per_minute as u64);
    let total_gem_cost = base_gem_cost.saturating_mul(tier_cost_multiplier);

    // 10. Validate Player Has Enough Gems
    if player_data.gems < total_gem_cost {
        return Err(GameError::InsufficientGems.into());
    }

    // 11. Deduct Gems
    player_data.gems = player_data.gems.saturating_sub(total_gem_cost);

    // 12. Update Construction End Time
    let new_construction_ends = now + new_remaining_seconds;
    building.construction_ends = new_construction_ends;

    Ok(())
}
