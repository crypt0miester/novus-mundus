use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{
        ReinforcementAccount, ReinforcementStatus, ReinforcementTarget, PlayerAccount,
    },
    validation::{require_writable, require_owner},
    emit,
    events::reinforcement::ReinforcementArrived,
};

/// Process reinforcement arrival (crank operation)
///
/// Called after travel time has elapsed to mark reinforcement as Active
/// and update the destination's aggregate totals.
///
/// Can be called by anyone (permissionless crank).
///
/// # Accounts
/// 0. `[WRITE]` reinforcement_account: ReinforcementAccount PDA
/// 1. `[WRITE]` destination_player: Destination's PlayerAccount PDA
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        reinforcement_account,
        destination_player,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_writable(reinforcement_account)?;
    require_writable(destination_player)?;
    require_owner(reinforcement_account, program_id)?;
    require_owner(destination_player, program_id)?;

    // 3. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Reinforcement
    let mut reinf_data_ref = reinforcement_account.try_borrow_mut_data()?;
    let reinf = unsafe { ReinforcementAccount::load_mut(&mut reinf_data_ref) };

    // 5. Validate Status is Traveling
    if reinf.get_status() != ReinforcementStatus::Traveling {
        return Err(GameError::ReinforcementNotActive.into());
    }

    // 6. Validate Arrival Time
    if !reinf.has_arrived(now) {
        return Err(GameError::TravelNotComplete.into());
    }

    // 7. Validate Destination Type (only Player for now, Castle support later)
    if reinf.get_destination_type() != ReinforcementTarget::Player {
        // Castle garrison arrival would be handled separately
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Validate Destination Account Matches
    let mut dest_data_ref = destination_player.try_borrow_mut_data()?;
    let dest = unsafe { PlayerAccount::load_mut(&mut dest_data_ref) };

    if dest.owner != reinf.destination {
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Update Destination Aggregates
    // Add units
    dest.reinforcement_def_1 = dest.reinforcement_def_1.saturating_add(reinf.units_def_1);
    dest.reinforcement_def_2 = dest.reinforcement_def_2.saturating_add(reinf.units_def_2);
    dest.reinforcement_def_3 = dest.reinforcement_def_3.saturating_add(reinf.units_def_3);

    // Add weapons
    dest.reinforcement_melee = dest.reinforcement_melee.saturating_add(reinf.melee_weapons);
    dest.reinforcement_ranged = dest.reinforcement_ranged.saturating_add(reinf.ranged_weapons);
    dest.reinforcement_siege = dest.reinforcement_siege.saturating_add(reinf.siege_weapons);

    // Track original totals for survival ratio calculation
    dest.reinforcement_original_units = dest.reinforcement_original_units
        .saturating_add(reinf.total_units());
    dest.reinforcement_original_weapons = dest.reinforcement_original_weapons
        .saturating_add(reinf.total_weapons());

    // Update hero buffs (use MAX, not sum - best hero wins)
    if reinf.hero_defense_bps > dest.reinforcement_hero_defense_bps {
        dest.reinforcement_hero_defense_bps = reinf.hero_defense_bps;
    }
    if reinf.hero_weapon_eff_bps > dest.reinforcement_hero_weapon_eff_bps {
        dest.reinforcement_hero_weapon_eff_bps = reinf.hero_weapon_eff_bps;
    }
    if reinf.hero_armor_eff_bps > dest.reinforcement_hero_armor_eff_bps {
        dest.reinforcement_hero_armor_eff_bps = reinf.hero_armor_eff_bps;
    }

    // Increment source count
    dest.reinforcement_source_count = dest.reinforcement_source_count.saturating_add(1);

    // 10. Mark Reinforcement as Active
    reinf.status = ReinforcementStatus::Active as u8;

    // Emit event
    emit!(ReinforcementArrived {
        reinforcement: *reinforcement_account.key(),
        sender: reinf.sender,
        receiver: reinf.destination,
        units: [reinf.units_def_1, reinf.units_def_2, reinf.units_def_3],
        timestamp: now,
    });

    Ok(())
}
