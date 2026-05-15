use pinocchio::{
    AccountView,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::IntracityTravelCompleted,
    state::{PlayerAccount, CityAccount, LocationAccount},
    types::TravelType,
    validation::require_owner,
};

/// Complete intracity travel (arrive at coordinates within city)
///
/// The destination cell was already reserved at travel_start.
/// This instruction just verifies the reservation and updates player coordinates.
///
/// No instruction data required
///
/// # Accounts
/// 0. `[WRITE]` player_account - Traveling player
/// 1. `[SIGNER]` owner - Player's wallet
/// 2. `[]` current_city - City player is arriving in (for validation)
/// 3. `[WRITE]` destination_location - LocationAccount for destination cell (already reserved)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        owner,
        current_city_account,
        destination_location_account,
    ]);

    // 2. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 3. Load Player Data

    let mut player_data = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    // Verify owner matches
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate Intracity Travel In Progress

    if player_data.travel_type != TravelType::Intracity as u8 {
        return Err(GameError::NotTraveling.into());
    }

    // 6. Validate Arrival Time Reached

    let now = Clock::get()?.unix_timestamp;
    if now < player_data.arrival_time {
        return Err(GameError::TravelNotComplete.into());
    }

    // 7. Validate City
    require_owner(current_city_account, program_id)?;
    let city_data = unsafe { CityAccount::load(&current_city_account)? };
    if player_data.current_city != city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }

    // 8. Quantize Destination to Grid Cell

    let dest_grid_lat = LocationAccount::to_grid(player_data.traveling_to_lat);
    let dest_grid_long = LocationAccount::to_grid(player_data.traveling_to_long);

    // Convert grid back to cell center for actual coordinates
    let cell_center_lat = LocationAccount::from_grid(dest_grid_lat);
    let cell_center_long = LocationAccount::from_grid(dest_grid_long);

    // 9. Validate Destination Location PDA

    let (expected_location_pda, _) = LocationAccount::derive_pda(
        &player_data.game_engine,
        player_data.current_city,
        dest_grid_lat,
        dest_grid_long,
    );

    if destination_location_account.address() != &expected_location_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 10. Verify Player Already Owns Destination (reserved at travel_start)
    {
        let mut location_data = destination_location_account.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        // Verify grid coordinates match
        if location.grid_lat != dest_grid_lat || location.grid_long != dest_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        // Verify player owns this cell (was reserved at start)
        if !location.is_occupied_by(player_account.address()) {
            return Err(GameError::NotCellOccupant.into());
        }

        // Update occupied_since to arrival time, clear reserved_arrival_time (arrived)
        location.occupied_since = now;
        location.reserved_arrival_time = 0;
    }

    // 11. Update Player Coordinates (to grid cell center)

    player_data.current_lat = cell_center_lat;
    player_data.current_long = cell_center_long;

    // 12. Clear Travel State

    player_data.travel_type = TravelType::None as u8;
    player_data.traveling_to_lat = 0.0;
    player_data.traveling_to_long = 0.0;
    player_data.departure_time = 0;
    player_data.arrival_time = -1;

    // 13. Emit Event

    emit!(IntracityTravelCompleted {
        player: *player_account.address(),
        player_name: player_data.name,
        x: dest_grid_lat,
        y: dest_grid_long,
        timestamp: now,
    });

    Ok(())
}
