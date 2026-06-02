use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::LOCATION_SEED,
    emit,
    error::GameError,
    events::IntracityTravelStarted,
    helpers::{
        close_account,
        estate::{load_estate_for_player, require_stables, stables_travel_reduction_bps},
    },
    logic::{
        get_time_multiplier, get_time_of_day,
        location::{
            apply_travel_speed_bonuses, calculate_intracity_travel_time, is_valid_latitude,
            is_valid_longitude,
        },
        ActivityType,
    },
    state::{CityAccount, GameEngine, LocationAccount, PlayerAccount, OCCUPANT_PLAYER},
    types::TravelType,
    validation::require_owner,
};

/// Start intracity travel (move within same city)
///
/// Supports speed-based reservation stealing: if destination is occupied by a
/// traveling player and we would arrive BEFORE them, we can steal the reservation.
/// The bumped player's travel is reversed and they must run cancel to finalize.
///
/// Instruction data format:
/// ```text
/// [0..8]   destination_lat: f64 (little-endian)
/// [8..16]  destination_long: f64 (little-endian)
/// ```
///
/// # Accounts
/// 0. `[WRITE]` player_account - Player initiating travel
/// 1. `[SIGNER, WRITE]` owner - Player's wallet (pays for destination location rent)
/// 2. `[WRITE]` current_city - City player is currently in
/// 3. `[]` game_engine - For intracity speed
/// 4. `[WRITE]` origin_location - LocationAccount for player's current cell (to vacate)
/// 5. `[WRITE]` destination_location - LocationAccount for destination cell (to reserve)
/// 6. `[WRITE]` origin_creator_refund - Account to receive origin location rent refund
/// 7. `[]` system_program - For creating destination location account
/// 8. `[WRITE]` (optional) bumped_player - Player being bumped (required when stealing)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (9 required, 1 optional for stealing)

    crate::extract_accounts!(
        accounts,
        [
            player_account,
            owner,
            current_city_account,
            game_engine_account,
            origin_location_account,
            destination_location_account,
            _origin_creator_refund,
            _system_program,
            estate_account,
        ]
    );

    // Optional: bumped player account (required when stealing a reservation)
    let bumped_player_account = accounts.get(9);

    // 2. Parse Instruction Data

    if instruction_data.len() < 16 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let destination_lat = f64::from_le_bytes([
        instruction_data[0],
        instruction_data[1],
        instruction_data[2],
        instruction_data[3],
        instruction_data[4],
        instruction_data[5],
        instruction_data[6],
        instruction_data[7],
    ]);

    let destination_long = f64::from_le_bytes([
        instruction_data[8],
        instruction_data[9],
        instruction_data[10],
        instruction_data[11],
        instruction_data[12],
        instruction_data[13],
        instruction_data[14],
        instruction_data[15],
    ]);

    // 3. Validate Coordinates

    if !is_valid_latitude(destination_lat) {
        return Err(GameError::InvalidLatitude.into());
    }

    if !is_valid_longitude(destination_long) {
        return Err(GameError::InvalidLongitude.into());
    }

    // 4. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Accounts (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let player_data = PlayerAccount::load_checked_mut(
        player_account,
        game_engine_account.address(),
        owner.address(),
        program_id,
    )?;

    require_owner(current_city_account, program_id)?;
    let city_data = unsafe { CityAccount::load_mut(current_city_account)? };

    // 6b. HARD GATE: Require Stables building for travel
    let estate = load_estate_for_player(estate_account, player_data, program_id)?;
    require_stables(estate, 1)?;

    // 7. Validate Not Already Traveling

    if player_data.is_traveling_any() {
        return Err(GameError::AlreadyTraveling.into());
    }

    // 7a. Validate Not In Active Rally (must leave/complete rally first)
    if player_data.rally_stats().current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // 8. Validate Player in Correct City

    if player_data.current_city != city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }

    // 9. Validate Destination Within City Bounds (AABB).

    if !city_data.contains_coord(destination_lat, destination_long) {
        return Err(GameError::DestinationOutsideCity.into());
    }

    // 10. Calculate Travel Time with Speed Bonuses

    let now = Clock::get()?.unix_timestamp;

    // Get base walking speed
    let base_walking_speed = game_engine_data.gameplay_config.intracity_travel_speed_kmh;

    // Get subscription speed bonus
    let effective_tier = player_data.get_effective_tier(now);
    let subscription_bonus_bps =
        game_engine_data.subscription_tiers[effective_tier as usize].travel_speed_bonus_bps;

    // Apply speed bonuses (subscription + research if available)
    // TODO: Add research bonus when research section is loaded
    let effective_speed = apply_travel_speed_bonuses(base_walking_speed, subscription_bonus_bps, 0);

    let base_travel_time_seconds = calculate_intracity_travel_time(
        player_data.current_lat,
        player_data.current_long,
        destination_lat,
        destination_long,
        effective_speed,
    );

    // 10a. Apply Time-of-Day Travel Bonus (DETERMINISTIC)
    // Night travel is faster (empty streets): DeepNight/Evening = φ (1.618x speed)
    // Day travel is slower (crowds): Morning/Afternoon = 1/φ (0.618x speed)
    // Higher multiplier = faster = less travel time
    let time_of_day = get_time_of_day(now, city_data.longitude);
    let travel_multiplier = get_time_multiplier(time_of_day, ActivityType::Traveling);

    // Apply multiplier: higher multiplier = faster = divide time
    let time_adjusted = (base_travel_time_seconds as f64 / travel_multiplier) as i64;

    // Apply Stables travel time reduction
    let stables_reduction = stables_travel_reduction_bps(estate);
    let travel_time_seconds = if stables_reduction > 0 {
        let reduction_factor = 10000u64.saturating_sub(stables_reduction as u64);
        (time_adjusted as u64).saturating_mul(reduction_factor) / 10000
    } else {
        time_adjusted as u64
    } as i64;

    let arrival_time = now.saturating_add(travel_time_seconds);

    // 11. RESERVE DESTINATION FIRST (prevents race condition)
    //
    // Before vacating origin, we secure the destination cell.
    // This ensures no one else can take our destination while we're traveling.

    let dest_grid_lat = LocationAccount::to_grid(destination_lat);
    let dest_grid_long = LocationAccount::to_grid(destination_long);

    // 10b. Biome Passability Check
    city_data.require_passable_at(destination_lat, destination_long)?;

    let city_bytes = player_data.current_city.to_le_bytes();
    let dest_lat_bytes = dest_grid_lat.to_le_bytes();
    let dest_long_bytes = dest_grid_long.to_le_bytes();

    let (expected_dest_pda, dest_bump) = LocationAccount::derive_pda(
        game_engine_account.address(),
        player_data.current_city,
        dest_grid_lat,
        dest_grid_long,
    );

    if destination_location_account.address() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let dest_location_len = destination_location_account.data_len();

    if dest_location_len == 0 {
        // Create new destination location account
        let lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);

        let bump_seed = [dest_bump];
        let location_seeds = crate::seeds!(
            LOCATION_SEED,
            game_engine_account.address(),
            &city_bytes,
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
        }
        .invoke_signed(&[location_signer])?;

        let mut dest_location_data = destination_location_account.try_borrow_mut()?;
        let dest_location = unsafe { LocationAccount::load_mut(&mut dest_location_data) };

        dest_location.account_key = crate::state::AccountKey::Location as u8;
        dest_location.game_engine = *game_engine_account.address();
        dest_location.grid_lat = dest_grid_lat;
        dest_location.grid_long = dest_grid_long;
        dest_location.city_id = player_data.current_city;
        dest_location.bump = dest_bump;
        dest_location.occupant_type = OCCUPANT_PLAYER;
        dest_location.occupant = *player_account.address();
        dest_location.occupied_since = now;
        dest_location.location_creator = *owner.address();
        dest_location.reserved_arrival_time = arrival_time;
    } else {
        // Destination exists - check if available or can be stolen
        let mut dest_location_data = destination_location_account.try_borrow_mut()?;
        let dest_location = unsafe { LocationAccount::load_mut(&mut dest_location_data) };

        if dest_location.grid_lat != dest_grid_lat || dest_location.grid_long != dest_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        if dest_location.is_occupied() && !dest_location.is_occupied_by(player_account.address()) {
            // Cell is occupied by someone else - check if we can steal it
            if dest_location.can_steal_reservation(arrival_time) {
                // We can steal! Need bumped player account to reverse their travel
                let bumped_player = bumped_player_account.ok_or(GameError::InvalidParameter)?;

                // Validate bumped player is the current occupant
                if bumped_player.address() != &dest_location.occupant {
                    return Err(GameError::InvalidParameter.into());
                }

                // M-08: Verify bumped player account is owned by this program
                // to prevent attacker-supplied account spoofing.
                require_owner(bumped_player, program_id)?;

                // Reverse the bumped player's travel
                let mut bumped_data = bumped_player.try_borrow_mut()?;
                let bumped = unsafe { PlayerAccount::load_mut(&mut bumped_data) };

                // M-08: Verify bumped player is in the same kingdom (game_engine)
                // before mutating their state.
                if bumped.game_engine != player_data.game_engine {
                    return Err(GameError::InvalidParameter.into());
                }

                // Calculate how far they've traveled (proportional time)
                let bumped_total_time = bumped.arrival_time.saturating_sub(bumped.departure_time);
                let bumped_elapsed = now.saturating_sub(bumped.departure_time);
                let progress = if bumped_total_time > 0 {
                    (bumped_elapsed as f64 / bumped_total_time as f64)
                        .min(1.0)
                        .max(0.0)
                } else {
                    0.0
                };

                // Return time is proportional to progress made
                let return_time_seconds = (bumped_total_time as f64 * progress) as i64;

                // Reverse their travel - they go back to origin
                // For intracity: origin is their current_lat/current_long
                bumped.traveling_to_lat = bumped.current_lat;
                bumped.traveling_to_long = bumped.current_long;
                bumped.departure_time = now;
                bumped.arrival_time = now.saturating_add(return_time_seconds);
                // M-08: Reset travel_speed_locked since this is a fresh (reversed) travel.
                bumped.travel_speed_locked = 0.0;
                // travel_type stays Intracity - they need to run cancel to complete

                // Note: bumped player loses their destination reservation
                // They must run intracity_cancel to reserve their return cell
            } else {
                // Can't steal - cell is occupied by arrived player or encounter
                return Err(GameError::CellOccupied.into());
            }
        }

        // Reserve the destination (either was empty, ours, or we just stole it)
        // Heal: re-stamp discriminator + game_engine in case the cell came from
        // an older build that omitted them.
        dest_location.account_key = crate::state::AccountKey::Location as u8;
        dest_location.game_engine = *game_engine_account.address();
        dest_location.occupant_type = OCCUPANT_PLAYER;
        dest_location.occupant = *player_account.address();
        dest_location.occupied_since = now;
        dest_location.location_creator = *owner.address();
        dest_location.reserved_arrival_time = arrival_time;
    }

    // 12. VACATE ORIGIN (after destination is secured)

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
    {
        let origin_data = origin_location_account.try_borrow()?;
        let origin_location = unsafe { LocationAccount::load(&origin_data) };

        if !origin_location.is_occupied_by(player_account.address()) {
            return Err(GameError::NotCellOccupant.into());
        }
    }

    // Close origin location account (refund rent to owner)
    close_account(origin_location_account, owner)?;

    // 13. Update Player State

    player_data.travel_type = TravelType::Intracity as u8;
    player_data.traveling_to_lat = destination_lat;
    player_data.traveling_to_long = destination_long;
    player_data.departure_time = now;
    player_data.arrival_time = arrival_time;
    player_data.travel_speed_locked = effective_speed; // Lock speed for cancel calculations

    // 14. Emit Event

    emit!(IntracityTravelStarted {
        player: *player_account.address(),
        player_name: player_data.name,
        city: *current_city_account.address(),
        dest_x: dest_grid_lat,
        dest_y: dest_grid_long,
        arrival_at: arrival_time,
        timestamp: now,
    });

    Ok(())
}
