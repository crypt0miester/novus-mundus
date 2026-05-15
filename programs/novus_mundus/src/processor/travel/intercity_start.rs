use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::msg;

use crate::{
    emit,
    error::GameError,
    events::IntercityTravelStarted,
    state::{PlayerAccount, CityAccount, GameEngine, LocationAccount, OCCUPANT_PLAYER},
    constants::LOCATION_SEED,
    helpers::{close_account, estate::{load_estate_for_player, require_stables, stables_travel_reduction_bps}},
    logic::{
        location::{calculate_distance, apply_travel_speed_bonuses, is_within_city_bounds},
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
/// [0..2]  destination_city_id: u16 (little-endian)
/// [2..6]  dest_grid_lat: i32 (little-endian) - destination grid latitude
/// [6..10] dest_grid_long: i32 (little-endian) - destination grid longitude
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (10 required, 1 optional for stealing)

    crate::extract_accounts!(accounts, [
        player_account,
        owner,
        origin_city_account,
        destination_city_account,
        game_engine_account,
        origin_location_account,
        destination_location_account,
        _origin_creator_refund,
        _system_program,
        estate_account,
    ]);

    // Optional: bumped player account (required when stealing a reservation)
    let bumped_player_account = accounts.get(10);

    // 2. Parse Instruction Data

    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let destination_city_id = crate::utils::read_u16(instruction_data, 0, "destination_city_id")?;
    let dest_grid_lat = i32::from_le_bytes([instruction_data[2], instruction_data[3], instruction_data[4], instruction_data[5]]);
    let dest_grid_long = i32::from_le_bytes([instruction_data[6], instruction_data[7], instruction_data[8], instruction_data[9]]);

    // 3. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts (kingdom-scoped)
    //
    // Validate via load_checked (which borrows RefCell), then drop the borrow
    // and use unsafe raw pointer access instead. This avoids holding RefCell
    // borrows during CreateAccount CPI which would cause AccountBorrowFailed.

    msg!("IC_START: loading accounts");
    { let _ = GameEngine::load_checked_by_key(game_engine_account, program_id)?; }
    let game_engine_data = unsafe { &*(game_engine_account.data_ptr() as *const GameEngine) };

    { let _ = PlayerAccount::load_checked_mut(player_account, game_engine_account.address(), owner.address(), program_id)?; }
    let player_data = unsafe { &mut *(player_account.data_ptr() as *mut PlayerAccount) };
    msg!("IC_START: accounts loaded ok");

    require_owner(origin_city_account, program_id)?;
    require_owner(destination_city_account, program_id)?;
    let origin_city_data = unsafe { CityAccount::load_mut(origin_city_account)? };
    let destination_city_data = unsafe { CityAccount::load(&destination_city_account)? };

    // 5b. HARD GATE: Require Stables building for travel
    let estate = load_estate_for_player(estate_account, player_data, program_id)?;
    require_stables(estate, 1)?;

    // 6. Validate Not Already Traveling

    if player_data.is_traveling_any() {
        return Err(GameError::AlreadyTraveling.into());
    }

    // 6a. Validate Not In Active Rally (must leave/complete rally first)
    if player_data.rally_stats().current_rallies_joined > 0 {
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
    let time_adjusted = (base_travel_time_seconds as f64 / travel_multiplier) as i64;

    // 9b. Apply Stables travel time reduction
    let stables_reduction = stables_travel_reduction_bps(estate);
    let travel_time_seconds = if stables_reduction > 0 {
        let reduction_factor = 10000u64.saturating_sub(stables_reduction as u64);
        (time_adjusted as u64).saturating_mul(reduction_factor) / 10000
    } else {
        time_adjusted as u64
    } as i64;

    let arrival_time = now + travel_time_seconds;

    // 10. RESERVE DESTINATION FIRST (prevents race condition)
    //
    // Destination grid coordinates are provided by the client.
    // Validate they fall within the destination city bounds.

    let dest_lat_f64 = LocationAccount::from_grid(dest_grid_lat);
    let dest_long_f64 = LocationAccount::from_grid(dest_grid_long);

    if !is_within_city_bounds(
        dest_lat_f64,
        dest_long_f64,
        destination_city_data.latitude,
        destination_city_data.longitude,
        destination_city_data.radius_km,
    ) {
        return Err(GameError::DestinationOutsideCity.into());
    }

    // 10a. Terrain Passability Check
    {
        let (ox, oy) = crate::logic::terrain::city_offset(
            dest_grid_lat, dest_grid_long,
            destination_city_data.latitude, destination_city_data.longitude,
        );
        if !destination_city_data.is_terrain_passable(destination_city_account, ox, oy) {
            return Err(GameError::TerrainImpassable.into());
        }
    }

    let dest_city_bytes = destination_city_id.to_le_bytes();
    let dest_lat_bytes = dest_grid_lat.to_le_bytes();
    let dest_long_bytes = dest_grid_long.to_le_bytes();

    let (expected_dest_pda, dest_bump) = LocationAccount::derive_pda(
        game_engine_account.address(),
        destination_city_id,
        dest_grid_lat,
        dest_grid_long,
    );

    if destination_location_account.address() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let dest_location_len = destination_location_account.data_len();

    if dest_location_len == 0 {
        // Create new destination location account
        msg!("IC_START: creating dest location (CPI)");
        let lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);

        let bump_seed = [dest_bump];
        let location_seeds = crate::seeds!(
            LOCATION_SEED,
            game_engine_account.address(),
            &dest_city_bytes,
            &dest_lat_bytes,
            &dest_long_bytes,
            &bump_seed
        );
        let location_signer = pinocchio::cpi::Signer::from(&location_seeds);

        CreateAccount {
            from: owner,
            to: destination_location_account,
            lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[location_signer])?;
        msg!("IC_START: CPI done ok");

        // Use unsafe raw pointer to avoid holding RefMut across close_account
        let dest_location = unsafe { &mut *(destination_location_account.data_ptr() as *mut LocationAccount) };

        dest_location.account_key = crate::state::AccountKey::Location as u8;
        dest_location.grid_lat = dest_grid_lat;
        dest_location.grid_long = dest_grid_long;
        dest_location.city_id = destination_city_id;
        dest_location.bump = dest_bump;
        dest_location.occupant_type = OCCUPANT_PLAYER;
        dest_location.occupant = *player_account.address();
        dest_location.occupied_since = now;
        dest_location.location_creator = *owner.address();
        dest_location.reserved_arrival_time = arrival_time;
    } else {
        // Destination exists - check if available or can be stolen
        // Use unsafe raw pointer to avoid holding RefMut across close_account
        let dest_location = unsafe { &mut *(destination_location_account.data_ptr() as *mut LocationAccount) };

        if dest_location.grid_lat != dest_grid_lat || dest_location.grid_long != dest_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        if dest_location.is_occupied() && !dest_location.is_occupied_by(player_account.address()) {
            // Cell is occupied by someone else - check if we can steal it
            if dest_location.can_steal_reservation(arrival_time) {
                // We can steal! Need bumped player account to reverse their travel
                let bumped_player = bumped_player_account
                    .ok_or(GameError::InvalidParameter)?;

                // Validate bumped player is the current occupant
                if bumped_player.address() != &dest_location.occupant {
                    return Err(GameError::InvalidParameter.into());
                }

                // M-08: Verify bumped player account is owned by this program
                // to prevent attacker-supplied account spoofing.
                require_owner(bumped_player, program_id)?;

                // Reverse the bumped player's travel (unsafe raw pointer)
                let bumped = unsafe { &mut *(bumped_player.data_ptr() as *mut PlayerAccount) };

                // M-08: Verify bumped player is in the same kingdom (game_engine)
                // before mutating their state.
                if bumped.game_engine != player_data.game_engine {
                    return Err(GameError::InvalidParameter.into());
                }

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
                // M-08: Reset travel_speed_locked since this is a fresh (reversed) travel.
                bumped.travel_speed_locked = 0.0;
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
        dest_location.occupant = *player_account.address();
        dest_location.occupied_since = now;
        dest_location.location_creator = *owner.address();
        dest_location.reserved_arrival_time = arrival_time;
    }

    // 11. VACATE ORIGIN (after destination is secured)

    let origin_grid_lat = LocationAccount::to_grid(player_data.current_lat);
    let origin_grid_long = LocationAccount::to_grid(player_data.current_long);

    let (expected_origin_pda, _) = LocationAccount::derive_pda(
        game_engine_account.address(),
        player_data.current_city,
        origin_grid_lat,
        origin_grid_long,
    );

    if origin_location_account.address() != &expected_origin_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Validate origin location occupant
    msg!("IC_START: validating origin occupant");
    {
        let origin_data = origin_location_account.try_borrow()?;
        let origin_location = unsafe { LocationAccount::load(&origin_data) };

        if !origin_location.is_occupied_by(player_account.address()) {
            return Err(GameError::NotCellOccupant.into());
        }
    }
    msg!("IC_START: origin validated ok");

    // Close origin location account (refund rent to the traveling player's owner)
    msg!("IC_START: closing origin location");
    close_account(origin_location_account, owner)?;
    msg!("IC_START: close done ok");

    // 12. Update Player State

    player_data.travel_type = TravelType::Intercity as u8;
    player_data.origin_city = player_data.current_city;
    player_data.destination_city = destination_city_id;
    player_data.departure_time = now;
    player_data.arrival_time = arrival_time;
    player_data.travel_speed_locked = effective_speed; // Lock effective speed for cancel calculations
    // Persist the destination coordinates so intercity_cancel can re-derive
    // the reserved-destination PDA. `intercity_start` lets the player pick
    // any cell inside the destination city radius, so cancel must use the
    // player's actual reservation rather than the city center.
    player_data.traveling_to_lat = LocationAccount::from_grid(dest_grid_lat);
    player_data.traveling_to_long = LocationAccount::from_grid(dest_grid_long);

    // 13. Decrement Origin City Player Count

    origin_city_data.players_present = origin_city_data.players_present
        .saturating_sub(1);

    // 14. Emit Event

    emit!(IntercityTravelStarted {
        player: *player_account.address(),
        player_name: player_data.name,
        from_city: *origin_city_account.address(),
        to_city: *destination_city_account.address(),
        arrival_at: arrival_time,
        timestamp: now,
    });

    Ok(())
}
