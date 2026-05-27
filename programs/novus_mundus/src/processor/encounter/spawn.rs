use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{ENCOUNTER_SEED, LOCATION_SEED},
    emit,
    error::GameError,
    events::EncounterSpawned,
    helpers::burn_tokens,
    logic::{
        can_spawn_rarity_at_time, get_rarity_spawn_weight, get_time_of_day, safe_math::apply_bp,
    },
    state::{CityAccount, EncounterAccount, LocationAccount, PlayerAccount, OCCUPANT_ENCOUNTER},
    types::EncounterType,
    validation::{require_key_match, require_signer, require_writable},
};

/// Spawn an encounter in a city
///
/// Two modes:
/// 1. **Player-initiated**: Anyone can spawn Common/Uncommon/Rare by burning NOVI
/// 2. **Auto-spawn**: Backend/DAO can auto-spawn encounters for game balance
///
/// # Player-initiated spawn
/// - Requires player in city
/// - Burns NOVI (1k/5k/25k based on rarity)
/// - Only Common/Uncommon/Rare (is_player_spawnable)
///
/// # Auto-spawn (authority = game_engine.authority)
/// - No player required
/// - No NOVI burn cost
/// - Can spawn any type (including Epic/Legendary)
/// - Used for automated encounter generation
///
/// # Anti-Spam Mechanics
/// - City-level encounter limit (scales with population)
/// - Burn cost for player spawns
/// - Random location generation within city radius
///
/// # Accounts
/// - [signer, writable] payer: Pays for encounter account creation (can be backend)
/// - [writable] player: PlayerAccount (spawner) - Can be any account for auto-spawns
/// - [writable] city: CityAccount (where encounter spawns)
/// - [writable] encounter: New EncounterAccount (PDA to be created)
/// - [writable] player_token_account: Player's Novi tokens (for burning, unused in auto-spawn)
/// - [writable] novi_mint: NOVI mint
/// - [] game_engine: GameEngine PDA (for burn authority and auto-spawn check)
/// - [signer] authority: Player wallet OR game_engine authority for auto-spawn
/// - [] system_program: System program
/// - [] spawn_location: LocationAccount for spawn cell (validates cell not occupied by player)
///
/// # Instruction Data
/// - encounter_type: u8 - Type to spawn (0=Common, 1=Uncommon, 2=Rare, or Epic/Legendary for auto-spawn)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        payer,
        player_account,
        city_account,
        encounter_account,
        player_token_account,
        novi_mint,
        game_engine_account,
        authority,
        system_program,
        spawn_location_account,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(authority)?;
    require_writable(city_account)?;
    require_writable(encounter_account)?;
    require_writable(spawn_location_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "enounter.spawn.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Parse Instruction Data
    //    [0]     encounter_type: u8
    //    [1..5]  grid_lat: i32 (LE)
    //    [5..9]  grid_long: i32 (LE)

    if instruction_data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let encounter_type = EncounterType::try_from(instruction_data[0])?;
    let client_grid_lat = i32::from_le_bytes([
        instruction_data[1],
        instruction_data[2],
        instruction_data[3],
        instruction_data[4],
    ]);
    let client_grid_long = i32::from_le_bytes([
        instruction_data[5],
        instruction_data[6],
        instruction_data[7],
        instruction_data[8],
    ]);

    // 4. Load GameEngine to Check Auto-Spawn vs Player-Spawn

    let game_engine_data = game_engine_account.try_borrow()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data) };

    // Check if this is an auto-spawn (authority is game_engine.authority)
    let is_auto_spawn = authority.address() == &game_engine_data.authority;

    // 5. Validate Encounter Type Based on Spawn Mode

    if is_auto_spawn {
        // Auto-spawn: Can spawn any encounter type (including Epic/Legendary)
        // No restrictions
    } else {
        // Player-spawn: Only Common/Uncommon/Rare
        if !encounter_type.is_player_spawnable() {
            return Err(GameError::DaoRequired.into());
        }

        // Player spawns require player account validation
        require_writable(player_account)?;

        let mut player_account_data = player_account.try_borrow_mut()?;
        let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };

        // Verify player ownership
        if &player_data.owner != authority.address() {
            return Err(GameError::Unauthorized.into());
        }
    }

    // 6. Load City Data

    let city_data = unsafe { CityAccount::load_mut(&city_account)? };

    // Verify player is in city (skip for auto-spawn)
    if !is_auto_spawn {
        let mut player_account_data = player_account.try_borrow_mut()?;
        let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
        if player_data.current_city != city_data.city_id {
            return Err(GameError::WrongCity.into());
        }
    }

    // 6. Check City Encounter Limit (Dynamic Scaling)

    let combat = &game_engine_data.combat_config;
    if !city_data.can_spawn_encounter(
        combat.base_encounters_per_city,
        combat.encounters_per_player_count,
        combat.max_encounters_per_city,
    ) {
        return Err(GameError::CityEncounterLimitReached.into());
    }

    // 6a. Check Time-of-Day Spawn Restrictions (DETERMINISTIC)
    // Legendary encounters only spawn during DeepNight/Dawn/Evening
    // Epic encounters only spawn during night periods
    // This creates "the midnight hunt" mechanic for rare encounters

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let time_of_day = get_time_of_day(now, city_data.longitude);

    if !can_spawn_rarity_at_time(time_of_day, encounter_type as u8) {
        return Err(GameError::WrongTimeForEncounter.into());
    }

    // 7. Burn Novi Cost (Player-Spawn Only)

    if !is_auto_spawn {
        let base_burn_cost = encounter_type.spawn_cost();

        if base_burn_cost > 0 {
            // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
            let dao_adjusted_cost = apply_bp(
                base_burn_cost,
                game_engine_data.economic_config.cost_multiplier as u64,
            )
            .ok_or(GameError::MathOverflow)?;

            // 7a. Apply Time-Based Spawn Cost Discount (DETERMINISTIC)
            // Spawning at optimal time = cheaper (spawn weight as discount)
            // - Rare at Dawn/Dusk (φ² weight) = cost / φ² = 38% of base cost
            // - Legendary at DeepNight (φ² weight) = cost / φ² = 38% of base cost
            // - Common at Midday (√φ weight) = cost / √φ = 79% of base cost
            let spawn_weight = get_rarity_spawn_weight(time_of_day, encounter_type as u8);
            let adjusted_burn_cost = if spawn_weight > 1.0 {
                // Higher weight = discount (divide cost by weight)
                (dao_adjusted_cost as f64 / spawn_weight) as u64
            } else {
                // Lower weight = premium (multiply cost by inverse)
                (dao_adjusted_cost as f64 / spawn_weight) as u64
            };

            let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
            let bump_seed = [game_engine_data.bump];
            let seeds = crate::seeds!(
                crate::constants::GAME_ENGINE_SEED,
                &kingdom_id_bytes,
                &bump_seed
            );
            let signer = pinocchio::cpi::Signer::from(&seeds);

            // Burn tokens from player
            burn_tokens(
                player_token_account,
                novi_mint,
                authority,
                adjusted_burn_cost,
                &[signer],
            )?;
        }
    }
    // Auto-spawns skip NOVI burning (free for automation)

    // 8. Validate Client-Provided Spawn Location
    //
    // Client passes grid_lat/grid_long (computed off-chain, e.g. golden spiral).
    // Program validates the position is within city radius.
    // This avoids SBF float precision issues with on-chain trig.

    let spawn_grid_lat = client_grid_lat;
    let spawn_grid_long = client_grid_long;

    // Validate coords fall inside the city's square plot (AABB).
    let spawn_lat = LocationAccount::from_grid(spawn_grid_lat);
    let spawn_long = LocationAccount::from_grid(spawn_grid_long);
    if !city_data.contains_coord(spawn_lat, spawn_long) {
        return Err(GameError::OutOfRange.into());
    }

    // 8. Biome Passability Check — encounters cannot spawn on water.
    city_data.require_passable_at(spawn_lat, spawn_long)?;

    // 8a. Validate Spawn Location PDA
    //
    // Encounters claim their spawn cell to prevent:
    // - Players moving into the encounter's position
    // - Other encounters spawning on top
    //
    // The cell is released when the encounter is defeated or despawns.

    let spawn_city_bytes = city_data.city_id.to_le_bytes();
    let spawn_lat_bytes = spawn_grid_lat.to_le_bytes();
    let spawn_long_bytes = spawn_grid_long.to_le_bytes();

    let (expected_spawn_location, spawn_location_bump) = LocationAccount::derive_pda(
        game_engine_account.address(),
        city_data.city_id,
        spawn_grid_lat,
        spawn_grid_long,
    );

    if spawn_location_account.address() != &expected_spawn_location {
        return Err(GameError::InvalidPDA.into());
    }

    // 9. Generate Encounter ID (Per-City Counter)
    // (Need this early to set as occupant in LocationAccount)

    let encounter_id = city_data.total_encounters_spawned;

    // 10. Derive Encounter PDA (need this for LocationAccount occupant)

    let city_id_bytes = city_data.city_id.to_le_bytes();
    let encounter_id_bytes = encounter_id.to_le_bytes();
    let (expected_encounter, encounter_bump) = Address::find_program_address(
        &[
            ENCOUNTER_SEED,
            game_engine_account.address().as_ref(),
            &city_id_bytes,
            &encounter_id_bytes,
        ],
        program_id,
    );

    if encounter_account.address() != &expected_encounter {
        crate::msg!("encounter PDA mismatch");
        return Err(GameError::InvalidPDA.into());
    }

    // 8b. Create or Occupy Spawn Location Cell

    let spawn_location_len = spawn_location_account.data_len();

    if spawn_location_len == 0 {
        // Create new LocationAccount for encounter
        let location_lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);

        let loc_bump_seed = [spawn_location_bump];
        let location_seeds = crate::seeds!(
            LOCATION_SEED,
            game_engine_account.address(),
            &spawn_city_bytes,
            &spawn_lat_bytes,
            &spawn_long_bytes,
            &loc_bump_seed
        );
        let location_signer = pinocchio::cpi::Signer::from(&location_seeds);

        CreateAccount {
            from: payer,
            to: spawn_location_account,
            lamports: location_lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }
        .invoke_signed(&[location_signer])?;

        let mut location_data = spawn_location_account.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        location.account_key = crate::state::AccountKey::Location as u8;
        location.game_engine = *game_engine_account.address();
        location.grid_lat = spawn_grid_lat;
        location.grid_long = spawn_grid_long;
        location.city_id = city_data.city_id;
        location.bump = spawn_location_bump;
        location.occupant_type = OCCUPANT_ENCOUNTER;
        location.occupant = *encounter_account.address();
        location.occupied_since = now;
        location.location_creator = *payer.address();
        location.reserved_arrival_time = 0; // Encounters don't travel
    } else {
        // Cell exists - check if available
        let mut location_data = spawn_location_account.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        // Validate grid coordinates match
        if location.grid_lat != spawn_grid_lat || location.grid_long != spawn_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        // Cell must be empty (players and encounters block spawns)
        if location.is_occupied() {
            return Err(GameError::CellOccupied.into());
        }

        // Claim the cell for the encounter. Heal: re-stamp discriminator +
        // game_engine in case the cell came from an older build that omitted
        // them.
        location.account_key = crate::state::AccountKey::Location as u8;
        location.game_engine = *game_engine_account.address();
        location.occupant_type = OCCUPANT_ENCOUNTER;
        location.occupant = *encounter_account.address();
        location.occupied_since = now;
        location.location_creator = *payer.address();
        location.reserved_arrival_time = 0; // Encounters don't travel
    }

    // 11. Create Encounter Account (with 0 attackers initially - minimal size!)

    let space = EncounterAccount::calculate_len(0);
    let lamports = pinocchio::sysvars::rent::Rent::get()?.try_minimum_balance(space)?;

    let enc_bump_seed = [encounter_bump];
    let seeds = crate::seeds!(
        ENCOUNTER_SEED,
        game_engine_account.address(),
        &city_id_bytes,
        &encounter_id_bytes,
        &enc_bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer, // Payer pays rent (can be backend for auto-spawns!)
        to: encounter_account,
        lamports,
        space: space as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 12. Initialize Encounter Data
    // (clock already obtained above for time-of-day check)

    let mut encounter_account_data = encounter_account.try_borrow_mut()?;
    let encounter_data = unsafe { EncounterAccount::load_mut(&mut encounter_account_data) };

    // NEW: Calculate Level-Based Stats

    // Determine encounter level based on city range and player level (if player spawn)
    let encounter_level =
        calculate_encounter_level(city_data, encounter_type, player_account, is_auto_spawn)?;

    // Level-scaled health, multiplied by rarity. With the rarity multiplier
    // (Common 1×, Legendary 5×, WorldEvent 10×) high-rarity encounters scale
    // tankier per level so they don't collapse to commodity HP at L100.
    let base_health = encounter_type.base_health();
    let health_mult_bps = encounter_type.level_health_multiplier_bps() as u64;
    let level_health_bonus = (encounter_level as u64)
        .saturating_mul(game_engine_data.gameplay_config.health_per_level)
        .saturating_mul(health_mult_bps)
        / 10000;
    let total_health = base_health.saturating_add(level_health_bonus);

    // Level-scaled defense (damage reduction in basis points), also rarity-multiplied.
    // Defense reduces incoming damage: damage_taken = damage * (10000 - defense) / 10000.
    let defense_mult_bps = encounter_type.level_defense_multiplier_bps() as u64;
    let defense = ((encounter_level as u64)
        .saturating_mul(game_engine_data.gameplay_config.defense_per_level as u64)
        .saturating_mul(defense_mult_bps)
        / 10000)
        .min(9000) as u32; // Cap at 90% reduction to keep encounters beatable

    *encounter_data = EncounterAccount {
        account_key: crate::state::AccountKey::Encounter as u8,
        game_engine: *game_engine_account.address(),
        id: encounter_id,
        city_id: city_data.city_id,
        level: encounter_level,
        rarity: encounter_type as u8,
        _padding0: [0; 4],
        location_lat: spawn_lat,
        location_long: spawn_long,
        spawned_at: now,
        despawn_at: now + encounter_type.despawn_duration(),
        health: total_health,
        max_health: total_health,
        defense,
        _padding1: [0; 4],
        attacker_count: 0,
        bump: encounter_bump,
        _padding2: [0; 6],
    };

    // 13. Update City Counters

    city_data.active_encounters = city_data.active_encounters.saturating_add(1);
    city_data.total_encounters_spawned = city_data.total_encounters_spawned.saturating_add(1);

    // 14. Emit EncounterSpawned event
    emit!(EncounterSpawned {
        encounter: *encounter_account.address(),
        city: *city_account.address(),
        encounter_type: encounter_type as u8,
        level: encounter_level,
        x: spawn_grid_lat,
        y: spawn_grid_long,
        timestamp: now,
    });

    Ok(())
}

/// Calculate encounter level based on city, rarity, and nearby players (DETERMINISTIC)
///
/// # Strategy
/// - Use city's level range as bounds
/// - For player spawns: spawn at player's level (deterministic)
/// - For auto-spawns: use golden ratio distribution within city range
/// - Higher rarity = spawns closer to player level
///
/// # Arguments
/// - city_data: City where encounter spawns
/// - encounter_type: Rarity of encounter
/// - player_account: Player spawning (if player spawn)
/// - is_auto_spawn: Whether this is an automated spawn
///
/// # Returns
/// Encounter level (1-100)
fn calculate_encounter_level(
    city_data: &CityAccount,
    _encounter_type: EncounterType,
    player_account: &AccountView,
    is_auto_spawn: bool,
) -> Result<u8, ProgramError> {
    let min = city_data.min_encounter_level;
    let max = city_data.max_encounter_level;

    if is_auto_spawn {
        // Auto-spawn: Use deterministic golden ratio distribution
        // Uses encounter_id for deterministic level assignment
        let spawn_index = city_data.total_encounters_spawned as u64;
        Ok(crate::logic::deterministic_encounter_level(
            min,
            max,
            spawn_index,
        ))
    } else {
        // Player spawn: Spawn at player's level (deterministic, no variance)
        let player_account_data = player_account.try_borrow()?;
        let player_data = unsafe { PlayerAccount::load(&player_account_data) };

        let player_level = player_data.level;

        // Deterministic: Clamp player level to city range
        let target_level = player_level.clamp(min, max);

        Ok(target_level)
    }
}
