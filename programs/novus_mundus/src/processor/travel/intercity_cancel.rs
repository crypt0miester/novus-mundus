use pinocchio::{
    AccountView,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::TravelCancelled,
    state::{PlayerAccount, CityAccount, LocationAccount, OCCUPANT_PLAYER},
    constants::LOCATION_SEED,
    helpers::close_account,
    logic::location::calculate_distance,
    validation::require_owner,
};

/// Cancel intercity travel and return to origin city
///
/// When cancelled, player returns to origin city CENTER (not their original position).
/// This instruction:
/// 1. Closes the reserved destination cell (refunds rent to creator)
/// 2. Reserves a cell at origin city center
/// 3. Reverses travel direction with appropriate return time
///
/// No instruction data required
///
/// # Accounts
/// 0. `[WRITE]` player_account - Traveling player
/// 1. `[SIGNER, WRITE]` owner - Player's wallet (pays for return location)
/// 2. `[WRITE]` origin_city - Original departure city (increment players_present)
/// 3. `[]` destination_city - Original destination city (for distance calc)
/// 4. `[WRITE]` dest_location - Current destination LocationAccount (to close)
/// 5. `[WRITE]` dest_creator_refund - Account to receive destination location rent refund
/// 6. `[WRITE]` return_location - LocationAccount for origin city center (to reserve)
/// 7. `[]` system_program - For creating return location account
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        owner,
        origin_city_account,
        destination_city_account,
        dest_location_account,
        dest_creator_refund,
        return_location_account,
        _system_program,
    ]);

    // 2. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 3. Load Accounts

    let mut player_data = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    // Verify owner matches
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    require_owner(origin_city_account, program_id)?;
    require_owner(destination_city_account, program_id)?;
    let origin_city_data = unsafe { CityAccount::load_mut(origin_city_account)? };
    let destination_city_data = unsafe { CityAccount::load(&destination_city_account)? };

    // 5. Validate Currently Traveling Intercity

    if !player_data.is_traveling_intercity() {
        return Err(GameError::NotTraveling.into());
    }

    // 6. Validate Cities Match Travel State

    if player_data.origin_city != origin_city_data.city_id {
        return Err(GameError::CityNotFound.into());
    }

    if player_data.destination_city != destination_city_data.city_id {
        return Err(GameError::CityNotFound.into());
    }

    // 7. Calculate Current Progress

    let now = Clock::get()?.unix_timestamp;

    let elapsed = now - player_data.departure_time;
    let total_duration = player_data.arrival_time - player_data.departure_time;

    // Prevent division by zero
    if total_duration <= 0 {
        return Err(GameError::InvalidParameter.into());
    }

    let progress = elapsed as f64 / total_duration as f64;
    let progress = progress.max(0.0).min(1.0); // Clamp to [0, 1]

    // 8. Calculate Distance Already Traveled

    let total_distance_km = calculate_distance(
        origin_city_data.latitude,
        origin_city_data.longitude,
        destination_city_data.latitude,
        destination_city_data.longitude,
    );

    let distance_traveled_km = total_distance_km * progress;

    // 9. Calculate Return Travel Time (using locked speed)

    let return_travel_time_seconds = ((distance_traveled_km / player_data.travel_speed_locked as f64) * 3600.0) as i64;

    // 10. VALIDATE DESTINATION LOCATION
    //
    // Two cases:
    // A) We still own the destination - close it and refund (deferred until after CPI)
    // B) We were bumped - destination is gone or owned by someone else

    // Use the player's ACTUAL reserved destination grid, not the
    // city center. `intercity_start` lets the player pick any cell inside the
    // destination city radius, so re-deriving against `destination_city_data.latitude/longitude`
    // (the city center) would brick the cancel for any non-center destination.
    let dest_grid_lat = LocationAccount::to_grid(player_data.traveling_to_lat);
    let dest_grid_long = LocationAccount::to_grid(player_data.traveling_to_long);

    let (expected_dest_pda, _) = LocationAccount::derive_pda(
        &player_data.game_engine,
        player_data.destination_city,
        dest_grid_lat,
        dest_grid_long,
    );

    if dest_location_account.address() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let dest_location_len = dest_location_account.data_len();
    let mut should_close_dest = false;

    if dest_location_len > 0 {
        // Destination exists - check if we own it
        let dest_data = dest_location_account.try_borrow()?;
        let dest_location = unsafe { LocationAccount::load(&dest_data) };

        if dest_location.is_occupied_by(player_account.address()) {
            // We own it - validate refund recipient now, close after CPI
            if dest_creator_refund.address() != &dest_location.location_creator {
                return Err(GameError::InvalidParameter.into());
            }
            should_close_dest = true;
        }
        // If we don't own it, we were bumped - skip closing (someone else owns it now)
    }
    // If destination doesn't exist, we were bumped - skip closing

    // 11. RESERVE RETURN LOCATION (origin city center)
    // NOTE: CreateAccount CPI must happen BEFORE close_account's unsafe lamport
    // manipulation, otherwise the runtime's balance tracking gets confused.

    let return_grid_lat = LocationAccount::to_grid(origin_city_data.latitude);
    let return_grid_long = LocationAccount::to_grid(origin_city_data.longitude);

    let origin_city_bytes = player_data.origin_city.to_le_bytes();
    let return_lat_bytes = return_grid_lat.to_le_bytes();
    let return_long_bytes = return_grid_long.to_le_bytes();

    let (expected_return_pda, return_bump) = LocationAccount::derive_pda(
        &player_data.game_engine,
        player_data.origin_city,
        return_grid_lat,
        return_grid_long,
    );

    if return_location_account.address() != &expected_return_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let return_location_len = return_location_account.data_len();

    if return_location_len == 0 {
        // Create new return location account
        let lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);

        let bump_seed = [return_bump];
        let ge_bytes = player_data.game_engine;
        let location_seeds = crate::seeds!(
            LOCATION_SEED,
            &ge_bytes,
            &origin_city_bytes,
            &return_lat_bytes,
            &return_long_bytes,
            &bump_seed
        );
        let location_signer = pinocchio::cpi::Signer::from(&location_seeds);

        CreateAccount {
            from: owner,
            to: return_location_account,
            lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[location_signer])?;

        let mut return_data = return_location_account.try_borrow_mut()?;
        let return_location = unsafe { LocationAccount::load_mut(&mut return_data) };

        return_location.account_key = crate::state::AccountKey::Location as u8;
        return_location.grid_lat = return_grid_lat;
        return_location.grid_long = return_grid_long;
        return_location.city_id = player_data.origin_city;
        return_location.bump = return_bump;
        return_location.occupant_type = OCCUPANT_PLAYER;
        return_location.occupant = *player_account.address();
        return_location.occupied_since = now;
        return_location.location_creator = *owner.address();
        return_location.reserved_arrival_time = now + return_travel_time_seconds;
    } else {
        // Return location exists - check if available
        let mut return_data = return_location_account.try_borrow_mut()?;
        let return_location = unsafe { LocationAccount::load_mut(&mut return_data) };

        if return_location.grid_lat != return_grid_lat || return_location.grid_long != return_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        // Cell must be empty or already owned by this player
        if return_location.is_occupied() && !return_location.is_occupied_by(player_account.address()) {
            return Err(GameError::CellOccupied.into());
        }

        return_location.occupant_type = OCCUPANT_PLAYER;
        return_location.occupant = *player_account.address();
        return_location.occupied_since = now;
        return_location.location_creator = *owner.address();
        return_location.reserved_arrival_time = now + return_travel_time_seconds;
    }

    // 11b. Close Destination Location (deferred from step 10)
    // This uses unsafe lamport manipulation, so it MUST happen after all CPIs
    if should_close_dest {
        close_account(dest_location_account, dest_creator_refund)?;
    }

    // 12. Reverse the Travel

    player_data.destination_city = player_data.origin_city; // Going back now
    player_data.departure_time = now; // Reset departure to now
    player_data.arrival_time = now + return_travel_time_seconds;

    // 13. Increment origin city player count (they're coming back)

    origin_city_data.players_present = origin_city_data.players_present
        .saturating_add(1);

    // 14. Emit Event

    emit!(TravelCancelled {
        player: *player_account.address(),
        player_name: player_data.name,
        is_intercity: true,
        was_bumped: false, // Intercity travel doesn't have bumping mechanics
        timestamp: now,
    });

    Ok(())
}
