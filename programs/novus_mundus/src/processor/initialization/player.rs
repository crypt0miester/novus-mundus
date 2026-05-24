use pinocchio::{
    AccountView, error::ProgramError, Address, sysvars::{Sysvar, clock::Clock}
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{PLAYER_SEED, GAME_ENGINE_SEED, LOCATION_SEED, STARTER_LOCKED_NOVI, USER_SEED},
    error::GameError,
    state::{PlayerAccount, GameEngine, CityAccount, LocationAccount},
    validation::{require_signer, require_writable, require_key_match, require_owner, derive_pda},
    token_helpers::create_associated_token_account,
    helpers::{mint_tokens, validate_token_account_owner},
    utils::read_u16,
    emit,
    events::PlayerJoinedKingdom,
};

/// Initialize a new player account and NOVI token account
/// KINGDOM-SCOPED: Player is created within a specific kingdom
///
/// Creates:
/// 1. Player account PDA - holds all gameplay state
/// 2. Associated Token Account (ATA) - holds NOVI tokens for gameplay
///
/// Player account includes:
/// - Kingdom reference (game_engine)
/// - Locked NOVI (gameplay fuel, non-withdrawable)
/// - Units (defensive and operative)
/// - Resources (weapons, produce, vehicles, cash)
/// - Location data
/// - Statistics and progression
///
/// # Starter Resources (Rookie Tier Bonuses)
/// New players receive starter resources to begin playing immediately:
/// - 10 Defensive Unit 1, 10 Operative Unit 1
/// - 3 Melee Weapons, 2 Ranged Weapons, 2 Armor
/// - 20 Produce, 1000 Cash
/// - 100 Locked NOVI (instant gameplay start)
/// - 24-hour New Player Protection (no PvP attacks)
///
/// # Accounts Expected
/// 1. `[writable]` player - Player account PDA to create ([b"player", game_engine, owner.address()])
/// 2. `[signer, writable]` owner - Player's wallet (pays for account creation)
/// 3. `[writable]` player_token_account - Player's NOVI token ATA
/// 4. `[writable]` game_engine - GameEngine PDA (for config and novi_mint, increments total_players)
/// 5. `[]` novi_mint - NOVI token mint
/// 6. `[writable]` starting_city - CityAccount where player starts
/// 7. `[writable]` spawn_location - LocationAccount for spawn cell
/// 8. `[]` user - User account PDA ([b"user", owner.address()]) - must be created first
/// 9. `[]` system_program - System program for account creation
/// 10. `[]` token_program - SPL Token program
/// 11. `[]` associated_token_program - Associated Token program
///
/// # Instruction Data
/// [0..2] starting_city_id: u16 (little-endian) - City ID where player spawns
/// [2..10] spawn_lat: f64 (little-endian) - Spawn latitude (must be within city radius)
/// [10..18] spawn_long: f64 (little-endian) - Spawn longitude (must be within city radius)
///
/// # PDA Derivation
/// Seeds: `[b"player", game_engine.address(), owner.address()]`
/// The player account is deterministic per wallet within a kingdom
///
/// # Returns
/// - `Ok(())` on successful initialization
/// - `Err(GameError::CityNotFound)` if city doesn't exist or ID mismatch
/// - `Err(GameError::KingdomRegistrationClosed)` if registration is closed
///
/// # Implementation Notes
/// - Player spawns at city center coordinates
/// - New player protection is set from GameEngine.gameplay_config
/// - Account creation uses system program CPI
/// - created_at timestamp is set from Clock sysvar
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        player,
        owner,
        player_token_account,
        game_engine,
        novi_mint,
        starting_city,
        spawn_location,
        user,
        system_program,
        token_program,
        _associated_token_program,
    ]);

    // 2. Parse Instruction Data
    // [0..2] starting_city_id: u16
    // [2..10] spawn_lat: f64
    // [10..18] spawn_long: f64
    if data.len() < 18 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let starting_city_id = read_u16(data, 0, "player.starting_city_id")?;
    let spawn_lat = f64::from_le_bytes(data[2..10].try_into().unwrap());
    let spawn_long = f64::from_le_bytes(data[10..18].try_into().unwrap());

    // 3. Validate Accounts

    // Owner must sign (pays for account and proves ownership)
    require_signer(owner)?;

    // Player must be writable (we're creating/initializing it)
    require_writable(player)?;

    // Player token account must be writable
    require_writable(player_token_account)?;

    // Starting city must be writable (we increment players_present)
    require_writable(starting_city)?;

    // Verify system program
    require_key_match(system_program, &pinocchio_system::ID)?;

    // Verify user account exists and matches expected PDA
    let (expected_user, _user_bump) = derive_pda(
        &[USER_SEED, owner.address().as_ref()],
        program_id,
    );
    if user.address() != &expected_user {
        return Err(ProgramError::InvalidSeeds);
    }
    // User account must already be created (non-zero data)
    if user.data_len() == 0 {
        return Err(GameError::UserAccountNotCreated.into());
    }
    require_owner(user, program_id)?;

    // City must be owned by this program
    require_owner(starting_city, program_id)?;

    // 4. Load GameEngine for config (mutable to increment total_players)
    require_writable(game_engine)?;
    let mut game_engine_data_ref = game_engine.try_borrow_mut()?;
    let game_engine_data = unsafe { GameEngine::load_mut(&mut game_engine_data_ref) };

    // 4a. Validate GameEngine PDA
    let (expected_game_engine, _ge_bump) = GameEngine::derive_pda(game_engine_data.kingdom_id);
    if game_engine.address() != &expected_game_engine {
        return Err(GameError::InvalidPDA.into());
    }

    // 4b. Check if kingdom registration is open
    let clock = Clock::get()?;
    let created_at = clock.unix_timestamp;

    if !game_engine_data.registration_open {
        return Err(GameError::KingdomRegistrationClosed.into());
    }
    if game_engine_data.registration_closes_at > 0 && created_at > game_engine_data.registration_closes_at {
        return Err(GameError::KingdomRegistrationClosed.into());
    }

    // 5. Derive and Validate Player PDA (kingdom-scoped)

    let (expected_player, bump) = PlayerAccount::derive_pda(game_engine.address(), owner.address());

    if player.address() != &expected_player {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Load and Validate City (must be in same kingdom)

    let city_data = unsafe { CityAccount::load_mut(starting_city)? };

    // Verify city ID matches instruction data
    if city_data.city_id != starting_city_id {
        return Err(GameError::CityNotFound.into());
    }

    // Verify city is in the same kingdom
    if &city_data.game_engine != game_engine.address() {
        return Err(GameError::KingdomMismatch.into());
    }

    // Validate city PDA
    CityAccount::validate_pda(starting_city, city_data)?;

    // Validate spawn coordinates are within city radius
    {
        let dlat = spawn_lat - city_data.latitude;
        let dlong = spawn_long - city_data.longitude;
        // Approximate distance in km (1 degree ≈ 111 km)
        let dist_km = libm::sqrt((dlat * 111.0) * (dlat * 111.0) + (dlong * 111.0) * (dlong * 111.0));
        if dist_km > city_data.radius_km as f64 {
            return Err(GameError::OutOfRange.into());
        }
    }

    // Validate spawn location is passable terrain (not water or mountain)
    {
        let spawn_grid_lat = crate::state::LocationAccount::to_grid(spawn_lat);
        let spawn_grid_long = crate::state::LocationAccount::to_grid(spawn_long);
        let (ox, oy) = crate::logic::terrain::city_offset(
            spawn_grid_lat, spawn_grid_long,
            city_data.latitude, city_data.longitude,
        );
        if !city_data.is_terrain_passable(starting_city, ox, oy) {
            return Err(GameError::TerrainImpassable.into());
        }
    }

    // Verify novi_mint matches the program-binary singleton. NOVI is one
    // mint across all kingdoms, derived at compile time.
    if novi_mint.address().as_array() != &crate::constants::NOVI_MINT_ADDRESS {
        return Err(ProgramError::InvalidAccountData);
    }

    // Check max_players limit (0 = unlimited)
    if game_engine_data.max_players > 0 && game_engine_data.total_players >= game_engine_data.max_players {
        return Err(GameError::MaxPlayersReached.into());
    }

    // Increment total_players counter and get player number for default name
    game_engine_data.total_players = game_engine_data.total_players.saturating_add(1);
    let player_number = game_engine_data.total_players;

    // Get new player protection duration from config
    let protection_duration = game_engine_data.gameplay_config.new_player_protection_duration;

    // Read per-kingdom starter NOVI grant (raw units, 1 decimal). DAO-tunable.
    // Fall back to the compile-time constant when the config slot is 0 — the
    // field reused the byte offset of the prior `_reserved_consumption`, so
    // GameEngine PDAs initialized before this change have 0 there until the
    // DAO pushes a real value. Without the fallback, `mint_tokens` below
    // would reject `amount == 0` and brick new-player onboarding.
    let starter_locked_novi = {
        let configured = game_engine_data.economic_config.starter_locked_novi;
        if configured == 0 { STARTER_LOCKED_NOVI } else { configured }
    };

    // 7. Calculate Rent and Create Account

    let lamports = crate::utils::rent_exempt_const(PlayerAccount::LEN);

    let bump_seed = [bump];
    let seeds = crate::seeds!(PLAYER_SEED, game_engine.address(), owner.address(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: owner,
        to: player,
        lamports,
        space: PlayerAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Player Data with Starting City and Resources
    {
        let mut player_data_ref = player.try_borrow_mut()?;
        let player_data = unsafe {
            PlayerAccount::load_mut(&mut player_data_ref)
        };

        // Initialize with starter resources and city (kingdom-scoped)
        *player_data = PlayerAccount::init_with_city(
            *game_engine.address(),
            *owner.address(),
            created_at,
            bump,
            starting_city_id,
            spawn_lat,
            spawn_long,
            protection_duration,
            starter_locked_novi,
        );

        // Set default name as "Player #X"
        player_data.set_default_name(player_number);

        // Quantize spawn coordinates to grid
        let spawn_grid_lat = LocationAccount::to_grid(spawn_lat);
        let spawn_grid_long = LocationAccount::to_grid(spawn_long);

        // Update player coords to grid cell center
        let cell_center_lat = LocationAccount::from_grid(spawn_grid_lat);
        let cell_center_long = LocationAccount::from_grid(spawn_grid_long);
        player_data.current_lat = cell_center_lat;
        player_data.current_long = cell_center_long;

        // Calculate initial networth from starter assets
        player_data.networth = crate::logic::calculate_networth(
            player_data, &game_engine_data.economic_config
        )?;
    }
    // player_data_ref dropped here — required before CPIs that touch player account

    // 10. Increment city players_present
    city_data.players_present = city_data.players_present.saturating_add(1);

    // 11. Create Spawn Location Cell

    // Quantize spawn coordinates to grid
    let spawn_grid_lat = LocationAccount::to_grid(spawn_lat);
    let spawn_grid_long = LocationAccount::to_grid(spawn_long);

    // Derive spawn location PDA (kingdom-scoped)
    let city_bytes = starting_city_id.to_le_bytes();
    let lat_bytes = spawn_grid_lat.to_le_bytes();
    let long_bytes = spawn_grid_long.to_le_bytes();

    let (expected_spawn_pda, spawn_location_bump) = LocationAccount::derive_pda(
        game_engine.address(),
        starting_city_id,
        spawn_grid_lat,
        spawn_grid_long,
    );

    if spawn_location.address() != &expected_spawn_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Save game_engine values needed after dropping the borrow
    let kingdom_id = game_engine_data.kingdom_id;
    let ge_bump = game_engine_data.bump;

    // Drop game_engine borrow before CPIs that touch game_engine account
    drop(game_engine_data_ref);

    // Create or occupy spawn location
    let spawn_location_len = spawn_location.data_len();

    if spawn_location_len == 0 {
        // Create new location account
        let location_lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);

        let loc_bump_seed = [spawn_location_bump];
        let location_seeds = crate::seeds!(
            LOCATION_SEED,
            game_engine.address(),
            &city_bytes,
            &lat_bytes,
            &long_bytes,
            &loc_bump_seed
        );
        let location_signer = pinocchio::cpi::Signer::from(&location_seeds);

        CreateAccount {
            from: owner,
            to: spawn_location,
            lamports: location_lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[location_signer])?;

        let mut location_data = spawn_location.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        location.game_engine = *game_engine.address();
        location.grid_lat = spawn_grid_lat;
        location.grid_long = spawn_grid_long;
        location.city_id = starting_city_id;
        location.bump = spawn_location_bump;
        location.occupant_type = crate::state::OCCUPANT_PLAYER;
        location.occupant = *player.address();
        location.occupied_since = created_at;
        location.location_creator = *owner.address();
        location.reserved_arrival_time = 0;
    } else {
        // Location exists, check if occupied
        let mut location_data = spawn_location.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        if location.grid_lat != spawn_grid_lat || location.grid_long != spawn_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        // Check if occupied (new player can't spawn on occupied cell)
        if location.is_occupied() {
            return Err(GameError::CellOccupied.into());
        }

        location.occupant_type = crate::state::OCCUPANT_PLAYER;
        location.occupant = *player.address();
        location.occupied_since = created_at;
        location.location_creator = *owner.address();
        location.reserved_arrival_time = 0;
    }

    // 12. Create Player's NOVI Token Account (ATA)

    create_associated_token_account(
        owner,                      // Payer
        player_token_account,       // The ATA to create
        player,                     // ATA owner
        novi_mint,                  // Token mint (NOVI)
        system_program,
        token_program,
    )?;

    // defensive ATA-owner check after CreateIdempotent.
    validate_token_account_owner(player_token_account, player.address())?;

    // 13. Mint Starter NOVI Tokens to Player
    let kingdom_id_bytes = kingdom_id.to_le_bytes();
    let bump_seed = [ge_bump];
    let seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    mint_tokens(
        novi_mint,
        player_token_account,
        game_engine,
        starter_locked_novi,
        &[signer],
    )?;

    // Emit PlayerJoinedKingdom event
    emit!(PlayerJoinedKingdom {
        kingdom_id,
        game_engine: *game_engine.address(),
        player: *player.address(),
        owner: *owner.address(),
        joined_at: created_at,
    });

    Ok(())
}
