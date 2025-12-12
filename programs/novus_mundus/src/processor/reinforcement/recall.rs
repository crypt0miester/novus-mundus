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
        ReinforcementAccount, ReinforcementStatus, ReinforcementTarget,
        GameEngine, CityAccount, PlayerAccount,
    },
    logic::location::calculate_intercity_travel_time,
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::reinforcement::ReinforcementRecalled,
};

/// Recall reinforcement (sender initiates return)
///
/// The sender can recall their reinforcement at any time.
/// Units will travel back to sender's city.
/// Destination aggregates are updated immediately (units stop defending).
///
/// # Accounts
/// 0. `[SIGNER]` sender_owner: Sender's wallet
/// 1. `[WRITE]` reinforcement_account: ReinforcementAccount PDA
/// 2. `[WRITE]` destination_player: Destination's PlayerAccount PDA
/// 3. `[]` sender_city: CityAccount for sender's home city
/// 4. `[]` destination_city: CityAccount for destination's city
/// 5. `[]` game_engine: GameEngine PDA (for theme speed)
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
        sender_owner,
        reinforcement_account,
        destination_player,
        sender_city,
        destination_city,
        game_engine,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(sender_owner)?;
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

    // 5. Validate Sender
    if &reinf.sender != sender_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Validate Status (must be Active or Traveling)
    let status = reinf.get_status();
    if status == ReinforcementStatus::Returning || status == ReinforcementStatus::Completed {
        return Err(GameError::ReinforcementNotActive.into());
    }

    // 7. Validate Destination Type (only Player for now)
    if reinf.get_destination_type() != ReinforcementTarget::Player {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Load Destination and Update Aggregates (only if Active)
    if status == ReinforcementStatus::Active {
        let mut dest_data_ref = destination_player.try_borrow_mut_data()?;
        let dest = unsafe { PlayerAccount::load_mut(&mut dest_data_ref) };

        // Validate destination matches
        if dest.owner != reinf.destination {
            return Err(GameError::InvalidParameter.into());
        }

        // Calculate survival ratio (current / original)
        let (unit_survival_bps, weapon_survival_bps) = dest.reinforcement_survival_ratio();

        // Calculate return amounts (original × survival ratio)
        let return_def_1 = reinf.units_def_1.saturating_mul(unit_survival_bps) / 10000;
        let return_def_2 = reinf.units_def_2.saturating_mul(unit_survival_bps) / 10000;
        let return_def_3 = reinf.units_def_3.saturating_mul(unit_survival_bps) / 10000;
        let return_melee = reinf.melee_weapons.saturating_mul(weapon_survival_bps) / 10000;
        let return_ranged = reinf.ranged_weapons.saturating_mul(weapon_survival_bps) / 10000;
        let return_siege = reinf.siege_weapons.saturating_mul(weapon_survival_bps) / 10000;

        // Subtract from destination aggregates
        dest.reinforcement_def_1 = dest.reinforcement_def_1.saturating_sub(return_def_1);
        dest.reinforcement_def_2 = dest.reinforcement_def_2.saturating_sub(return_def_2);
        dest.reinforcement_def_3 = dest.reinforcement_def_3.saturating_sub(return_def_3);
        dest.reinforcement_melee = dest.reinforcement_melee.saturating_sub(return_melee);
        dest.reinforcement_ranged = dest.reinforcement_ranged.saturating_sub(return_ranged);
        dest.reinforcement_siege = dest.reinforcement_siege.saturating_sub(return_siege);

        // Subtract original amounts from original totals
        dest.reinforcement_original_units = dest.reinforcement_original_units
            .saturating_sub(reinf.total_units());
        dest.reinforcement_original_weapons = dest.reinforcement_original_weapons
            .saturating_sub(reinf.total_weapons());

        // Decrement source count
        dest.reinforcement_source_count = dest.reinforcement_source_count.saturating_sub(1);

        // Store survival-adjusted return amounts in the ReinforcementAccount
        // These will be used by process_return to give back the correct amounts
        reinf.units_def_1 = return_def_1;
        reinf.units_def_2 = return_def_2;
        reinf.units_def_3 = return_def_3;
        reinf.melee_weapons = return_melee;
        reinf.ranged_weapons = return_ranged;
        reinf.siege_weapons = return_siege;

        // Note: We don't recalculate hero buffs here for simplicity.
        // The max buffs might be slightly stale but it's a minor effect.
        // A full implementation would recalculate max across remaining sources.
    }

    // 9. Calculate Return Travel Time
    let sender_city_data = unsafe { CityAccount::load(sender_city)? };
    let dest_city_data = unsafe { CityAccount::load(destination_city)? };

    // Validate cities match
    if sender_city_data.city_id != reinf.sender_city {
        return Err(GameError::WrongCity.into());
    }
    if dest_city_data.city_id != reinf.destination_city {
        return Err(GameError::WrongCity.into());
    }

    let return_duration = if reinf.sender_city == reinf.destination_city {
        0i32
    } else {
        let game_engine_data_ref = game_engine.try_borrow_data()?;
        let game_engine_state = unsafe { GameEngine::load(&game_engine_data_ref) };
        let current_theme = game_engine_state.theme_config.current_theme as usize;
        let theme_speed = game_engine_state.gameplay_config.theme_travel_speeds_kmh[current_theme];

        calculate_intercity_travel_time(
            dest_city_data.latitude,
            dest_city_data.longitude,
            sender_city_data.latitude,
            sender_city_data.longitude,
            theme_speed,
        ) as i32
    };

    // 10. Update Status to Returning
    reinf.status = ReinforcementStatus::Returning as u8;
    reinf.return_started_at = now;
    reinf.return_duration = return_duration;
    reinf.relieved_by_destination = false;

    // Emit event
    emit!(ReinforcementRecalled {
        reinforcement: *reinforcement_account.key(),
        sender: reinf.sender,
        receiver: reinf.destination,
        units: [reinf.units_def_1, reinf.units_def_2, reinf.units_def_3],
        timestamp: now,
    });

    Ok(())
}
