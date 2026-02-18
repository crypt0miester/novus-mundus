use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use pinocchio::msg;

use crate::{
    emit,
    error::GameError,
    events::IntracityTravelStarted,
    state::{PlayerAccount, CityAccount, GameEngine, LocationAccount, OCCUPANT_PLAYER},
    constants::LOCATION_SEED,
    helpers::{close_account, estate::{load_estate_for_player, require_stables, stables_travel_reduction_bps}},
    logic::{
        location::{is_within_city_bounds, calculate_intracity_travel_time, is_valid_latitude, is_valid_longitude, apply_travel_speed_bonuses},
        get_time_of_day,
        get_time_multiplier,
        ActivityType,
    },
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
    let current_city_account = &accounts[2];
    let game_engine_account = &accounts[3];
    let origin_location_account = &accounts[4];
    let destination_location_account = &accounts[5];
    let _origin_creator_refund = &accounts[6];
    let _system_program = &accounts[7];
    let estate_account = &accounts[8];

    // Optional: bumped player account (required when stealing a reservation)
    let bumped_player_account = accounts.get(9);

    // 2. Parse Instruction Data

    if instruction_data.len() < 16 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let destination_lat = f64::from_le_bytes([
        instruction_data[0], instruction_data[1], instruction_data[2], instruction_data[3],
        instruction_data[4], instruction_data[5], instruction_data[6], instruction_data[7],
    ]);

    let destination_long = f64::from_le_bytes([
        instruction_data[8], instruction_data[9], instruction_data[10], instruction_data[11],
        instruction_data[12], instruction_data[13], instruction_data[14], instruction_data[15],
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
    //
    // Validate via load_checked (which borrows RefCell), then drop the borrow
    // and use unsafe raw pointer access instead. This avoids holding RefCell
    // borrows during CreateAccount CPI which would cause AccountBorrowFailed.

    msg!("INTRA_START: loading accounts");
    { let _ = GameEngine::load_checked_by_key(game_engine_account, program_id)?; }
    let game_engine_data = unsafe { &*(game_engine_account.data_ptr() as *const GameEngine) };

    { let _ = PlayerAccount::load_checked_mut(player_account, game_engine_account.key(), owner.key(), program_id)?; }
    let player_data = unsafe { &mut *(player_account.data_ptr() as *mut PlayerAccount) };
    msg!("INTRA_START: accounts loaded ok");

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
    if player_data.rally_stats.current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // 8. Validate Player in Correct City

    if player_data.current_city != city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }

    // 9. Validate Destination Within City Bounds

    if !is_within_city_bounds(
        destination_lat,
        destination_long,
        city_data.latitude,
        city_data.longitude,
        city_data.radius_km,
    ) {
        return Err(GameError::DestinationOutsideCity.into());
    }

    // 10. Calculate Travel Time with Speed Bonuses

    let now = Clock::get()?.unix_timestamp;

    // Get base walking speed
    let base_walking_speed = game_engine_data.gameplay_config.intracity_travel_speed_kmh;

    // Get subscription speed bonus
    let effective_tier = player_data.get_effective_tier(now);
    let subscription_bonus_bps = game_engine_data
        .subscription_tiers[effective_tier as usize]
        .travel_speed_bonus_bps;

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

    let arrival_time = now + travel_time_seconds;

    // 11. RESERVE DESTINATION FIRST (prevents race condition)
    //
    // Before vacating origin, we secure the destination cell.
    // This ensures no one else can take our destination while we're traveling.

    let dest_grid_lat = LocationAccount::to_grid(destination_lat);
    let dest_grid_long = LocationAccount::to_grid(destination_long);

    // 10b. Terrain Passability Check
    {
        let (ox, oy) = crate::logic::terrain::city_offset(
            dest_grid_lat, dest_grid_long,
            city_data.latitude, city_data.longitude,
        );
        if !city_data.is_terrain_passable(current_city_account, ox, oy) {
            return Err(GameError::TerrainImpassable.into());
        }
    }

    let city_bytes = player_data.current_city.to_le_bytes();
    let dest_lat_bytes = dest_grid_lat.to_le_bytes();
    let dest_long_bytes = dest_grid_long.to_le_bytes();

    let (expected_dest_pda, dest_bump) = LocationAccount::derive_pda(
        game_engine_account.key(),
        player_data.current_city,
        dest_grid_lat,
        dest_grid_long,
    );

    if destination_location_account.key() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let dest_location_len = destination_location_account.data_len();

    if dest_location_len == 0 {
        // Create new destination location account
        msg!("INTRA_START: creating dest location (CPI)");
        let rent = pinocchio::sysvars::rent::Rent::get()?;
        let lamports = rent.minimum_balance(LocationAccount::LEN);

        let bump_seed = [dest_bump];
        let location_seeds = pinocchio::seeds!(
            LOCATION_SEED,
            game_engine_account.key().as_ref(),
            &city_bytes,
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
        msg!("INTRA_START: CPI done ok");

        let mut dest_location_data = destination_location_account.try_borrow_mut_data()?;
        let dest_location = unsafe { LocationAccount::load_mut(&mut dest_location_data) };

        dest_location.account_key = crate::state::AccountKey::Location as u8;
        dest_location.grid_lat = dest_grid_lat;
        dest_location.grid_long = dest_grid_long;
        dest_location.city_id = player_data.current_city;
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

                // Reverse their travel - they go back to origin
                // For intracity: origin is their current_lat/current_long
                bumped.traveling_to_lat = bumped.current_lat;
                bumped.traveling_to_long = bumped.current_long;
                bumped.departure_time = now;
                bumped.arrival_time = now + return_time_seconds;
                // travel_type stays Intracity - they need to run cancel to complete

                // Note: bumped player loses their destination reservation
                // They must run intracity_cancel to reserve their return cell
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

    // 12. VACATE ORIGIN (after destination is secured)

    let origin_grid_lat = LocationAccount::to_grid(player_data.current_lat);
    let origin_grid_long = LocationAccount::to_grid(player_data.current_long);

    let (expected_origin_pda, _) = LocationAccount::derive_pda(
        game_engine_account.key(),
        player_data.current_city,
        origin_grid_lat,
        origin_grid_long,
    );

    if origin_location_account.key() != &expected_origin_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Validate origin location occupant
    {
        let origin_data = origin_location_account.try_borrow_data()?;
        let origin_location = unsafe { LocationAccount::load(&origin_data) };

        if !origin_location.is_occupied_by(player_account.key()) {
            return Err(GameError::NotCellOccupant.into());
        }
    }

    // Close origin location account (refund rent to owner)
    msg!("INTRA_START: closing origin");
    close_account(origin_location_account, owner)?;
    msg!("INTRA_START: close done ok");

    // 13. Update Player State

    player_data.travel_type = TravelType::Intracity as u8;
    player_data.traveling_to_lat = destination_lat;
    player_data.traveling_to_long = destination_long;
    player_data.departure_time = now;
    player_data.arrival_time = arrival_time;
    player_data.travel_speed_locked = effective_speed; // Lock speed for cancel calculations

    // 14. Emit Event

    emit!(IntracityTravelStarted {
        player: *player_account.key(),
        player_name: player_data.name,
        city: *current_city_account.key(),
        dest_x: dest_grid_lat,
        dest_y: dest_grid_long,
        arrival_at: arrival_time,
        timestamp: now,
    });

    Ok(())
}
