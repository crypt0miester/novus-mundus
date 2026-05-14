use pinocchio::{
    AccountView,
    error::ProgramError,
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
    types::TravelType,
    validation::require_owner,
};

/// Cancel intracity travel and return to origin position
///
/// When cancelled, player returns to their original position within the city.
/// This instruction handles two scenarios:
/// 1. Normal cancel: Close destination, reserve origin
/// 2. Bumped cancel: Destination already stolen, just reserve origin
///
/// No instruction data required
///
/// # Accounts
/// 0. `[WRITE]` player_account - Traveling player
/// 1. `[SIGNER, WRITE]` owner - Player's wallet (pays for return location)
/// 2. `[]` current_city - City player is in (for validation)
/// 3. `[WRITE]` dest_location - Destination LocationAccount (to close, may be empty if bumped)
/// 4. `[WRITE]` dest_creator_refund - Account to receive destination location rent refund
/// 5. `[WRITE]` return_location - LocationAccount for origin position (to reserve)
/// 6. `[]` system_program - For creating return location account
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        owner,
        current_city_account,
        dest_location_account,
        dest_creator_refund,
        return_location_account,
        _system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

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

    require_owner(current_city_account, program_id)?;
    let city_data = unsafe { CityAccount::load(&current_city_account)? };

    // 5. Validate Currently Traveling Intracity

    if player_data.travel_type != TravelType::Intracity as u8 {
        return Err(GameError::NotTraveling.into());
    }

    // 6. Validate City Matches

    if player_data.current_city != city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
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

    // 8. Calculate Return Travel Time (proportional to progress)

    let return_travel_time_seconds = (total_duration as f64 * progress) as i64;

    // 9. Validate Destination Location
    //
    // Two cases:
    // A) We still own the destination - close it and refund (deferred until after CPI)
    // B) We were bumped - destination is gone or owned by someone else

    let dest_grid_lat = LocationAccount::to_grid(player_data.traveling_to_lat);
    let dest_grid_long = LocationAccount::to_grid(player_data.traveling_to_long);

    let city_bytes = player_data.current_city.to_le_bytes();

    let (expected_dest_pda, _) = LocationAccount::derive_pda(
        &player_data.game_engine,
        player_data.current_city,
        dest_grid_lat,
        dest_grid_long,
    );

    if dest_location_account.address() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let dest_location_len = dest_location_account.data_len();
    let mut was_bumped = false;
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
        } else {
            // We don't own it - we were bumped
            was_bumped = true;
        }
    } else {
        // Destination doesn't exist - we were bumped
        was_bumped = true;
    }

    // 10. Reserve Return Location (origin position)
    // NOTE: CreateAccount CPI must happen BEFORE close_account's unsafe lamport
    // manipulation, otherwise the runtime's balance tracking gets confused.

    let return_grid_lat = LocationAccount::to_grid(player_data.current_lat);
    let return_grid_long = LocationAccount::to_grid(player_data.current_long);

    let return_lat_bytes = return_grid_lat.to_le_bytes();
    let return_long_bytes = return_grid_long.to_le_bytes();

    let (expected_return_pda, return_bump) = LocationAccount::derive_pda(
        &player_data.game_engine,
        player_data.current_city,
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
            &city_bytes,
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
        return_location.city_id = player_data.current_city;
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

    // 10b. Close Destination Location (deferred from step 9)
    // This uses unsafe lamport manipulation, so it MUST happen after all CPIs
    if should_close_dest {
        close_account(dest_location_account, dest_creator_refund)?;
    }

    // 11. Update Player Travel State
    //
    // Reverse the travel - now going back to origin
    // Player keeps traveling_to_lat/long pointing to where they were going,
    // but we set arrival_time for return journey

    // Swap - now traveling back to current_lat/current_long (origin)
    let origin_lat = player_data.current_lat;
    let origin_long = player_data.current_long;
    player_data.traveling_to_lat = origin_lat;
    player_data.traveling_to_long = origin_long;
    player_data.departure_time = now;
    player_data.arrival_time = now + return_travel_time_seconds;
    // travel_type stays Intracity
    // travel_speed_locked stays the same

    // 12. Emit Event

    emit!(TravelCancelled {
        player: *player_account.address(),
        player_name: player_data.name,
        is_intercity: false,
        was_bumped,
        timestamp: now,
    });

    Ok(())
}
