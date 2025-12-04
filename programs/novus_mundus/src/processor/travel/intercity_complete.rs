use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, CityAccount, LocationAccount},
    constants::LOCATION_SEED,
    types::TravelType,
    logic::{
        location::calculate_distance_meters,
        grant_xp_with_time_bonus,
        calculate_xp_reward,
        XpAction,
    },
};

/// Complete intercity travel (arrive at destination city)
///
/// The destination cell was already reserved at travel_start.
/// This instruction verifies the reservation, updates player coordinates,
/// and increments destination city's player count.
///
/// No instruction data required
///
/// # Accounts
/// 0. `[WRITE]` player_account - Traveling player
/// 1. `[SIGNER]` owner - Player's wallet
/// 2. `[]` origin_city - Origin city (for XP calculation)
/// 3. `[WRITE]` destination_city - Destination city (increment players_present)
/// 4. `[WRITE]` destination_location - LocationAccount for destination cell (already reserved)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        owner,
        origin_city_account,
        destination_city_account,
        destination_location_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 3. Load Player Data

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };

    // 4. Validate Player Ownership

    if !player_data.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate Intercity Travel In Progress

    if player_data.travel_type != TravelType::Intercity as u8 {
        return Err(GameError::NotTraveling.into());
    }

    // 6. Validate Arrival Time Reached

    let now = Clock::get()?.unix_timestamp;
    if now < player_data.arrival_time {
        return Err(GameError::TravelNotComplete.into());
    }

    // 7. Load City Data

    let origin_city_data = unsafe { CityAccount::load(&origin_city_account)? };
    let destination_city_data = unsafe { CityAccount::load_mut(destination_city_account)? };

    // 7a. Validate Origin City

    if player_data.origin_city != origin_city_data.city_id {
        return Err(GameError::CityNotFound.into());
    }

    // 7b. Calculate Distance and Grant XP

    let distance_meters = calculate_distance_meters(
        origin_city_data.latitude,
        origin_city_data.longitude,
        destination_city_data.latitude,
        destination_city_data.longitude,
    );
    let distance_km = (distance_meters / 1000.0) as u32;

    let xp_amount = calculate_xp_reward(XpAction::CompleteTravel { distance_km });
    grant_xp_with_time_bonus(player_data, xp_amount, now)?;

    // 8. Quantize Destination City Center to Grid Cell

    let dest_grid_lat = LocationAccount::to_grid(destination_city_data.latitude);
    let dest_grid_long = LocationAccount::to_grid(destination_city_data.longitude);

    // Convert grid back to cell center for actual coordinates
    let cell_center_lat = LocationAccount::from_grid(dest_grid_lat);
    let cell_center_long = LocationAccount::from_grid(dest_grid_long);

    // 9. Validate Destination Location PDA

    let new_city_id = player_data.destination_city;
    let city_bytes = new_city_id.to_le_bytes();
    let lat_bytes = dest_grid_lat.to_le_bytes();
    let long_bytes = dest_grid_long.to_le_bytes();

    let (expected_location_pda, _) = pinocchio::pubkey::find_program_address(
        &[LOCATION_SEED, &city_bytes, &lat_bytes, &long_bytes],
        program_id,
    );

    if destination_location_account.key() != &expected_location_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 10. Verify Player Already Owns Destination (reserved at travel_start)
    {
        let mut location_data = destination_location_account.try_borrow_mut_data()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        // Verify grid coordinates match
        if location.grid_lat != dest_grid_lat || location.grid_long != dest_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        // Verify player owns this cell (was reserved at start)
        if !location.is_occupied_by(player_account.key()) {
            return Err(GameError::NotCellOccupant.into());
        }

        // Update occupied_since to arrival time, clear reserved_arrival_time (arrived)
        location.occupied_since = now;
        location.reserved_arrival_time = 0;
    }

    // 11. Update Player Location

    player_data.current_city = new_city_id;
    player_data.travel_type = TravelType::None as u8;
    player_data.origin_city = 0;
    player_data.destination_city = 0;
    player_data.departure_time = 0;
    player_data.arrival_time = -1;
    player_data.travel_speed_locked = 0.0;

    // Set player coordinates to grid cell center
    player_data.current_lat = cell_center_lat;
    player_data.current_long = cell_center_long;

    // 12. Increment Destination City Player Count

    destination_city_data.players_present = destination_city_data.players_present
        .saturating_add(1);

    Ok(())
}
