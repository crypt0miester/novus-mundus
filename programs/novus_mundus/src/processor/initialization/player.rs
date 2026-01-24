use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{PLAYER_SEED, GAME_ENGINE_SEED, LOCATION_SEED, STARTER_LOCKED_NOVI},
    error::GameError,
    state::{PlayerAccount, GameEngine, CityAccount, LocationAccount},
    validation::{require_signer, require_writable, require_key_match, require_owner, derive_pda},
    token_helpers::get_or_create_associated_token_account,
    helpers::mint_tokens,
    emit,
    events::PlayerCreated,
};

/// Initialize a new player account and NOVI token account
///
/// Creates:
/// 1. Player account PDA - holds all gameplay state
/// 2. Associated Token Account (ATA) - holds NOVI tokens for gameplay
///
/// Player account includes:
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
/// 1. `[writable]` player - Player account PDA to create ([b"player", owner.key()])
/// 2. `[signer, writable]` owner - Player's wallet (pays for account creation)
/// 3. `[writable]` player_token_account - Player's NOVI token ATA
/// 4. `[writable]` game_engine - GameEngine PDA (for config and novi_mint, increments total_players)
/// 5. `[]` novi_mint - NOVI token mint
/// 6. `[writable]` starting_city - CityAccount where player starts
/// 7. `[writable]` spawn_location - LocationAccount for spawn cell
/// 8. `[]` system_program - System program for account creation
/// 9. `[]` token_program - SPL Token program
/// 10. `[]` associated_token_program - Associated Token program
///
/// # Instruction Data
/// [0..2] starting_city_id: u16 (little-endian) - City ID where player spawns
///
/// # PDA Derivation
/// Seeds: `[b"player", owner.key()]`
/// The player account is deterministic per wallet
///
/// # Returns
/// - `Ok(())` on successful initialization
/// - `Err(GameError::CityNotFound)` if city doesn't exist or ID mismatch
///
/// # Implementation Notes
/// - Player spawns at city center coordinates
/// - New player protection is set from GameEngine.gameplay_config
/// - Account creation uses system program CPI
/// - created_at timestamp is set from Clock sysvar
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts
    let [
        player,
        owner,
        player_token_account,
        game_engine,
        novi_mint,
        starting_city,
        spawn_location,
        system_program,
        token_program,
        _associated_token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Parse Instruction Data
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let starting_city_id = u16::from_le_bytes([data[0], data[1]]);

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

    // City must be owned by this program
    require_owner(starting_city, program_id)?;

    // 4. Derive and Validate Player PDA

    let (expected_player, bump) = derive_pda(
        &[PLAYER_SEED, owner.key()],
        program_id,
    );

    if player.key() != &expected_player {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. Load and Validate City

    let city_data = unsafe { CityAccount::load_mut(starting_city)? };

    // Verify city ID matches instruction data
    if city_data.city_id != starting_city_id {
        return Err(GameError::CityNotFound.into());
    }

    // Validate city PDA
    CityAccount::validate_pda(starting_city, city_data)?;

    // Get city coordinates for player spawn
    let spawn_lat = city_data.latitude;
    let spawn_long = city_data.longitude;

    // 6. Load GameEngine for config (mutable to increment total_players)
    require_writable(game_engine)?;
    let mut game_engine_data_ref = game_engine.try_borrow_mut_data()?;
    let game_engine_data = unsafe { GameEngine::load_mut(&mut game_engine_data_ref) };

    // Verify novi_mint matches GameEngine configuration
    if novi_mint.key() != &game_engine_data.novi_mint {
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

    // 7. Get Current Timestamp
    let clock = Clock::get()?;
    let created_at = clock.unix_timestamp;

    // 8. Calculate Rent and Create Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(PlayerAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(PLAYER_SEED, owner.key(), &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: owner,
        to: player,
        lamports,
        space: PlayerAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 9. Initialize Player Data with Starting City and Resources

    let mut player_data_ref = player.try_borrow_mut_data()?;
    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data_ref)
    };

    // Initialize with starter resources and city
    *player_data = PlayerAccount::init_with_city(
        *owner.key(),
        created_at,
        bump,
        starting_city_id,
        spawn_lat,
        spawn_long,
        protection_duration,
    );

    // Set default name as "Player #X"
    player_data.set_default_name(player_number);

    // 10. Increment city players_present
    city_data.players_present = city_data.players_present.saturating_add(1);

    // 11. Create Spawn Location Cell

    // Quantize spawn coordinates to grid
    let spawn_grid_lat = LocationAccount::to_grid(spawn_lat);
    let spawn_grid_long = LocationAccount::to_grid(spawn_long);

    // Update player coords to grid cell center
    let cell_center_lat = LocationAccount::from_grid(spawn_grid_lat);
    let cell_center_long = LocationAccount::from_grid(spawn_grid_long);
    player_data.current_lat = cell_center_lat;
    player_data.current_long = cell_center_long;

    // Derive spawn location PDA
    let city_bytes = starting_city_id.to_le_bytes();
    let lat_bytes = spawn_grid_lat.to_le_bytes();
    let long_bytes = spawn_grid_long.to_le_bytes();

    let (expected_spawn_pda, spawn_location_bump) = pinocchio::pubkey::find_program_address(
        &[LOCATION_SEED, &city_bytes, &lat_bytes, &long_bytes],
        program_id,
    );

    if spawn_location.key() != &expected_spawn_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Create or occupy spawn location
    let spawn_location_len = spawn_location.data_len();

    if spawn_location_len == 0 {
        // Create new location account
        let rent = pinocchio::sysvars::rent::Rent::get()?;
        let location_lamports = rent.minimum_balance(LocationAccount::LEN);

        let loc_bump_seed = [spawn_location_bump];
        let location_seeds = pinocchio::seeds!(
            LOCATION_SEED,
            &city_bytes,
            &lat_bytes,
            &long_bytes,
            &loc_bump_seed
        );
        let location_signer = pinocchio::instruction::Signer::from(&location_seeds);

        CreateAccount {
            from: owner,
            to: spawn_location,
            lamports: location_lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[location_signer])?;

        let mut location_data = spawn_location.try_borrow_mut_data()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        location.grid_lat = spawn_grid_lat;
        location.grid_long = spawn_grid_long;
        location.city_id = starting_city_id;
        location.bump = spawn_location_bump;
        location.occupant_type = crate::state::OCCUPANT_PLAYER;
        location.occupant = *player.key();
        location.occupied_since = created_at;
        location.location_creator = *owner.key();
        location.reserved_arrival_time = 0; // Player starts at location (not traveling)
    } else {
        // Location exists, check if occupied
        let mut location_data = spawn_location.try_borrow_mut_data()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        if location.grid_lat != spawn_grid_lat || location.grid_long != spawn_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        // Check if occupied (new player can't spawn on occupied cell)
        if location.is_occupied() {
            return Err(GameError::CellOccupied.into());
        }

        location.occupant_type = crate::state::OCCUPANT_PLAYER;
        location.occupant = *player.key();
        location.occupied_since = created_at;
        location.location_creator = *owner.key();
        location.reserved_arrival_time = 0; // Player starts at location (not traveling)
    }

    // 12. Create Player's NOVI Token Account (ATA)

    get_or_create_associated_token_account(
        owner,                      // Payer
        player_token_account,       // The ATA to create
        owner,                      // ATA owner
        novi_mint,                  // Token mint (NOVI)
        system_program,
        token_program,
    )?;

    // 12. Mint Starter NOVI Tokens to Player
    // This matches the locked_novi starter amount in PlayerAccount::init_with_city
    let bump_seed = [game_engine_data.bump];
    let seeds = pinocchio::seeds!(GAME_ENGINE_SEED, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    mint_tokens(
        novi_mint,
        player_token_account,
        game_engine,
        STARTER_LOCKED_NOVI,
        &[signer],
    )?;

    // Emit PlayerCreated event
    emit!(PlayerCreated {
        player: *player.key(),
        user: *owner.key(),
        city: *starting_city.key(),
        timestamp: created_at,
    });

    Ok(())
}
