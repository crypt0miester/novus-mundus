use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::IntercityTravelStarted,
    state::{PlayerAccount, CityAccount, GameEngine, LocationAccount, OCCUPANT_PLAYER},
    constants::LOCATION_SEED,
    helpers::close_account,
    logic::{
        location::{calculate_distance, apply_travel_speed_bonuses},
        get_time_of_day,
        get_time_multiplier,
        ActivityType,
    },
    types::TravelType,
    validation::require_owner,
};

/// Start intercity travel (move between cities)
///
/// Reserves destination cell BEFORE vacating origin to prevent race conditions.
/// Supports speed-based reservation stealing: if destination is occupied by a
/// traveling player and we would arrive BEFORE them, we can steal the reservation.
///
/// Instruction data format:
/// ```text
/// [0..2] destination_city_id: u16 (little-endian)
/// ```
///
/// # Accounts
/// 0. `[WRITE]` player_account - Player initiating travel
/// 1. `[SIGNER, WRITE]` owner - Player's wallet (pays for destination location rent)
/// 2. `[WRITE]` origin_city - Current city (decrement players_present)
/// 3. `[]` destination_city - Target city (for coordinates and validation)
/// 4. `[]` game_engine - For theme speed
/// 5. `[WRITE]` origin_location - LocationAccount for current cell (to vacate)
/// 6. `[WRITE]` destination_location - LocationAccount for destination city center (to reserve)
/// 7. `[WRITE]` origin_creator_refund - Account to receive origin location rent refund
/// 8. `[]` system_program - For creating destination location account
/// 9. `[WRITE]` (optional) bumped_player - Player being bumped (required when stealing)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (9 required, 1 optional for stealing)

    if accounts.len() < 9 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let player_account = &accounts[0];
    let owner = &accounts[1];
    let origin_city_account = &accounts[2];
    let destination_city_account = &accounts[3];
    let game_engine_account = &accounts[4];
    let origin_location_account = &accounts[5];
    let destination_location_account = &accounts[6];
    let origin_creator_refund = &accounts[7];
    let _system_program = &accounts[8];

    // Optional: bumped player account (required when stealing a reservation)
    let bumped_player_account = accounts.get(9);

    // 2. Parse Instruction Data

    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let destination_city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);

    // 3. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts

    let mut player_data = PlayerAccount::load_checked_mut(player_account, owner.key(), program_id)?;

    require_owner(origin_city_account, program_id)?;
    require_owner(destination_city_account, program_id)?;
    let origin_city_data = unsafe { CityAccount::load_mut(origin_city_account)? };
    let destination_city_data = unsafe { CityAccount::load(&destination_city_account)? };
    let game_engine_data = GameEngine::load_checked(game_engine_account, program_id)?;

    // 6. Validate Not Already Traveling

    if player_data.is_traveling_any() {
        return Err(GameError::AlreadyTraveling.into());
    }

    // 6a. Validate Not In Active Rally (must leave/complete rally first)
    if player_data.rally_stats.current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // 7. Validate Origin City Matches

    if player_data.current_city != origin_city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }

    // 8. Validate Destination City

    if destination_city_id == player_data.current_city {
        return Err(GameError::InvalidParameter.into()); // Already in that city
    }

    if destination_city_data.city_id != destination_city_id {
        return Err(GameError::CityNotFound.into());
    }

    // 9. Calculate Travel Time with Speed Bonuses

    let now = Clock::get()?.unix_timestamp;

    let distance_km = calculate_distance(
        origin_city_data.latitude,
        origin_city_data.longitude,
        destination_city_data.latitude,
        destination_city_data.longitude,
    );

    // Get base theme speed from game engine
    let current_theme = game_engine_data.theme_config.current_theme as usize;
    let base_speed_kmh = game_engine_data.gameplay_config.theme_travel_speeds_kmh[current_theme];

    // Get subscription speed bonus
    let effective_tier = player_data.get_effective_tier(now);
    let subscription_bonus_bps = game_engine_data
        .subscription_tiers[effective_tier as usize]
        .travel_speed_bonus_bps;

    // Apply speed bonuses (subscription + research if available)
    // TODO: Add research bonus when research section is loaded
    let effective_speed = apply_travel_speed_bonuses(base_speed_kmh, subscription_bonus_bps, 0);

    // Calculate base travel time in seconds
    let base_travel_time_seconds = ((distance_km / effective_speed as f64) * 3600.0) as i64;

    // 9a. Apply Time-of-Day Travel Bonus (DETERMINISTIC)
    let time_of_day = get_time_of_day(now, origin_city_data.longitude);
    let travel_multiplier = get_time_multiplier(time_of_day, ActivityType::Traveling);
    let travel_time_seconds = (base_travel_time_seconds as f64 / travel_multiplier) as i64;

    let arrival_time = now + travel_time_seconds;

    // 10. RESERVE DESTINATION FIRST (prevents race condition)
    //
    // Destination is the destination city's center, quantized to grid cell.
    // This ensures no one can take our destination while we're traveling.

    let dest_grid_lat = LocationAccount::to_grid(destination_city_data.latitude);
    let dest_grid_long = LocationAccount::to_grid(destination_city_data.longitude);

    let dest_city_bytes = destination_city_id.to_le_bytes();
    let dest_lat_bytes = dest_grid_lat.to_le_bytes();
    let dest_long_bytes = dest_grid_long.to_le_bytes();

    let (expected_dest_pda, dest_bump) = pinocchio::pubkey::find_program_address(
        &[LOCATION_SEED, &dest_city_bytes, &dest_lat_bytes, &dest_long_bytes],
        program_id,
    );

    if destination_location_account.key() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let dest_location_len = destination_location_account.data_len();

    if dest_location_len == 0 {
        // Create new destination location account
        let rent = pinocchio::sysvars::rent::Rent::get()?;
        let lamports = rent.minimum_balance(LocationAccount::LEN);

        let bump_seed = [dest_bump];
        let location_seeds = pinocchio::seeds!(
            LOCATION_SEED,
            &dest_city_bytes,
            &dest_lat_bytes,
            &dest_long_bytes,
            &bump_seed
        );
        let location_signer = pinocchio::instruction::Signer::from(&location_seeds);

        CreateAccount {
            from: owner,
            to: destination_location_account,
            lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[location_signer])?;

        let mut dest_location_data = destination_location_account.try_borrow_mut_data()?;
        let dest_location = unsafe { LocationAccount::load_mut(&mut dest_location_data) };

        dest_location.grid_lat = dest_grid_lat;
        dest_location.grid_long = dest_grid_long;
        dest_location.city_id = destination_city_id;
        dest_location.bump = dest_bump;
        dest_location.occupant_type = OCCUPANT_PLAYER;
        dest_location.occupant = *player_account.key();
        dest_location.occupied_since = now;
        dest_location.location_creator = *owner.key();
        dest_location.reserved_arrival_time = arrival_time;
    } else {
        // Destination exists - check if available or can be stolen
        let mut dest_location_data = destination_location_account.try_borrow_mut_data()?;
        let dest_location = unsafe { LocationAccount::load_mut(&mut dest_location_data) };

        if dest_location.grid_lat != dest_grid_lat || dest_location.grid_long != dest_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        if dest_location.is_occupied() && !dest_location.is_occupied_by(player_account.key()) {
            // Cell is occupied by someone else - check if we can steal it
            if dest_location.can_steal_reservation(arrival_time) {
                // We can steal! Need bumped player account to reverse their travel
                let bumped_player = bumped_player_account
                    .ok_or(GameError::InvalidParameter)?;

                // Validate bumped player is the current occupant
                if bumped_player.key() != &dest_location.occupant {
                    return Err(GameError::InvalidParameter.into());
                }

                // Reverse the bumped player's travel
                let mut bumped_data = bumped_player.try_borrow_mut_data()?;
                let bumped = unsafe { PlayerAccount::load_mut(&mut bumped_data) };

                // Calculate how far they've traveled (proportional time)
                let bumped_total_time = bumped.arrival_time - bumped.departure_time;
                let bumped_elapsed = now - bumped.departure_time;
                let progress = if bumped_total_time > 0 {
                    (bumped_elapsed as f64 / bumped_total_time as f64).min(1.0).max(0.0)
                } else {
                    0.0
                };

                // Return time is proportional to progress made
                let return_time_seconds = (bumped_total_time as f64 * progress) as i64;

                // Reverse their travel - they go back to origin city
                bumped.destination_city = bumped.origin_city;
                bumped.departure_time = now;
                bumped.arrival_time = now + return_time_seconds;
                // travel_type stays Intercity - they need to run cancel to complete

                // Note: bumped player loses their destination reservation
                // They must run intercity_cancel to reserve their return cell
            } else {
                // Can't steal - cell is occupied by arrived player or encounter
                return Err(GameError::CellOccupied.into());
            }
        }

        // Reserve the destination (either was empty, ours, or we just stole it)
        dest_location.occupant_type = OCCUPANT_PLAYER;
        dest_location.occupant = *player_account.key();
        dest_location.occupied_since = now;
        dest_location.location_creator = *owner.key();
        dest_location.reserved_arrival_time = arrival_time;
    }

    // 11. VACATE ORIGIN (after destination is secured)

    let origin_grid_lat = LocationAccount::to_grid(player_data.current_lat);
    let origin_grid_long = LocationAccount::to_grid(player_data.current_long);

    let origin_city_bytes = player_data.current_city.to_le_bytes();
    let origin_lat_bytes = origin_grid_lat.to_le_bytes();
    let origin_long_bytes = origin_grid_long.to_le_bytes();

    let (expected_origin_pda, _) = pinocchio::pubkey::find_program_address(
        &[LOCATION_SEED, &origin_city_bytes, &origin_lat_bytes, &origin_long_bytes],
        program_id,
    );

    if origin_location_account.key() != &expected_origin_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Validate origin location and get creator for refund
    let origin_creator: Pubkey;
    {
        let origin_data = origin_location_account.try_borrow_data()?;
        let origin_location = unsafe { LocationAccount::load(&origin_data) };

        if !origin_location.is_occupied_by(player_account.key()) {
            return Err(GameError::NotCellOccupant.into());
        }

        origin_creator = origin_location.location_creator;
    }

    // Validate refund recipient matches stored creator
    if origin_creator_refund.key() != &origin_creator {
        return Err(GameError::InvalidParameter.into());
    }

    // Close origin location account (refund rent to creator)
    close_account(origin_location_account, origin_creator_refund)?;

    // 12. Update Player State

    player_data.travel_type = TravelType::Intercity as u8;
    player_data.origin_city = player_data.current_city;
    player_data.destination_city = destination_city_id;
    player_data.departure_time = now;
    player_data.arrival_time = arrival_time;
    player_data.travel_speed_locked = effective_speed; // Lock effective speed for cancel calculations

    // 13. Decrement Origin City Player Count

    origin_city_data.players_present = origin_city_data.players_present
        .saturating_sub(1);

    // 14. Emit Event

    emit!(IntercityTravelStarted {
        player: *player_account.key(),
        player_name: player_data.name,
        from_city: *origin_city_account.key(),
        to_city: *destination_city_account.key(),
        arrival_at: arrival_time,
        timestamp: now,
    });

    Ok(())
}
