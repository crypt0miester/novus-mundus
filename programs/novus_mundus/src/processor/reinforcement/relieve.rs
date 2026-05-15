use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
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
    events::reinforcement::ReinforcementRelieved,
};

/// Relieve reinforcement (destination owner sends units back)
///
/// The destination owner can relieve (send back) reinforcements they've received.
/// Useful if destination no longer needs the help or wants to free up capacity.
///
/// # Accounts
/// 0. `[SIGNER]` destination_owner: Destination owner's wallet
/// 1. `[WRITE]` destination_player: Destination's PlayerAccount PDA
/// 2. `[WRITE]` reinforcement_account: ReinforcementAccount PDA
/// 3. `[]` sender_city: CityAccount for sender's home city
/// 4. `[]` destination_city: CityAccount for destination's city
/// 5. `[]` game_engine: GameEngine PDA (for theme speed)
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        destination_owner,
        destination_player,
        reinforcement_account,
        sender_city,
        destination_city,
        game_engine,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(destination_owner)?;
    require_writable(destination_player)?;
    require_writable(reinforcement_account)?;
    require_owner(destination_player, program_id)?;
    require_owner(reinforcement_account, program_id)?;

    // 3. Validate Destination Ownership
    let mut dest_data_ref = destination_player.try_borrow_mut()?;
    let dest = unsafe { PlayerAccount::load_mut(&mut dest_data_ref) };

    if &dest.owner != destination_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load Reinforcement
    let mut reinf_data_ref = reinforcement_account.try_borrow_mut()?;
    let reinf = unsafe { ReinforcementAccount::load_mut(&mut reinf_data_ref) };

    // 6. Validate Destination matches
    if reinf.destination != dest.owner {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Validate Status (must be Active - can't relieve traveling units)
    let status = reinf.get_status();
    if status != ReinforcementStatus::Active {
        return Err(GameError::ReinforcementNotActive.into());
    }

    // 8. Validate Destination Type (only Player for now)
    if reinf.get_destination_type() != ReinforcementTarget::Player {
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Calculate survival ratio and update aggregates
    let (unit_survival_bps, weapon_survival_bps) = dest.reinforcement_survival_ratio();

    // Calculate return amounts (original × survival ratio)
    let return_def_1 = reinf.units_def_1.saturating_mul(unit_survival_bps) / 10000;
    let return_def_2 = reinf.units_def_2.saturating_mul(unit_survival_bps) / 10000;
    let return_def_3 = reinf.units_def_3.saturating_mul(unit_survival_bps) / 10000;
    let return_melee = reinf.melee_weapons.saturating_mul(weapon_survival_bps) / 10000;
    let return_ranged = reinf.ranged_weapons.saturating_mul(weapon_survival_bps) / 10000;
    let return_siege = reinf.siege_weapons.saturating_mul(weapon_survival_bps) / 10000;

    // Subtract from destination aggregates (single team-section borrow).
    if let Some(t) = dest.team_section_mut() {
        t.reinforcement_def_1 = t.reinforcement_def_1.saturating_sub(return_def_1);
        t.reinforcement_def_2 = t.reinforcement_def_2.saturating_sub(return_def_2);
        t.reinforcement_def_3 = t.reinforcement_def_3.saturating_sub(return_def_3);
        t.reinforcement_melee = t.reinforcement_melee.saturating_sub(return_melee);
        t.reinforcement_ranged = t.reinforcement_ranged.saturating_sub(return_ranged);
        t.reinforcement_siege = t.reinforcement_siege.saturating_sub(return_siege);
        t.reinforcement_original_units = t.reinforcement_original_units.saturating_sub(reinf.total_units());
        t.reinforcement_original_weapons = t.reinforcement_original_weapons.saturating_sub(reinf.total_weapons());
        t.reinforcement_source_count = t.reinforcement_source_count.saturating_sub(1);
    }

    // Store survival-adjusted return amounts in the ReinforcementAccount
    // These will be used by process_return to give back the correct amounts
    reinf.units_def_1 = return_def_1;
    reinf.units_def_2 = return_def_2;
    reinf.units_def_3 = return_def_3;
    reinf.melee_weapons = return_melee;
    reinf.ranged_weapons = return_ranged;
    reinf.siege_weapons = return_siege;

    // 10. Calculate Return Travel Time
    // H-03: Verify city accounts are owned by this program and match expected PDAs.
    require_owner(sender_city, program_id)?;
    require_owner(destination_city, program_id)?;
    let (expected_sender_city_pda, _) =
        CityAccount::derive_pda(game_engine.address(), reinf.sender_city);
    if sender_city.address() != &expected_sender_city_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    let (expected_dest_city_pda, _) =
        CityAccount::derive_pda(game_engine.address(), reinf.destination_city);
    if destination_city.address() != &expected_dest_city_pda {
        return Err(ProgramError::InvalidSeeds);
    }
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
        let game_engine_data_ref = game_engine.try_borrow()?;
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

    // 11. Update Status to Returning
    reinf.status = ReinforcementStatus::Returning as u8;
    reinf.return_started_at = now;
    reinf.return_duration = return_duration;
    reinf.relieved_by_destination = true; // Mark as destination-initiated

    // Emit event
    emit!(ReinforcementRelieved {
        reinforcement: *reinforcement_account.address(),
        sender: reinf.sender,
        sender_name: [0u8; 48], // Sender player account not loaded
        receiver: reinf.destination,
        receiver_name: dest.name,
        units: [reinf.units_def_1, reinf.units_def_2, reinf.units_def_3],
        timestamp: now,
    });

    Ok(())
}
