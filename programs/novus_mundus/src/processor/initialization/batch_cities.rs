//! Batch City Initialization
//!
//! Instruction 5
//!
//! DAO-only instruction to initialize multiple cities for a kingdom in a single transaction.
//! City data (name, coordinates, radius, type) is passed via instruction data.
//! Must be called multiple times to initialize all cities (due to account limits).

use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::CITY_SEED,
    emit,
    error::GameError,
    events::KingdomCitiesInitialized,
    logic::location::{is_valid_latitude, is_valid_longitude},
    state::{CityAccount, GameEngine},
};

/// Maximum cities to initialize per batch (limited by account count in transaction)
pub const MAX_CITIES_PER_BATCH: usize = 8;

/// Batch City Initialization
///
/// Creates multiple cities for a kingdom using city data from instruction data.
///
/// # Accounts
/// 0. `[signer, writable]` DAO authority (payer)
/// 1. `[]` GameEngine account
/// 2. `[writable]` City 1 PDA
/// 3. `[writable]` City 2 PDA
/// ... (up to MAX_CITIES_PER_BATCH city accounts)
/// N. `[]` System program
///
/// # Instruction Data
/// - start_city_id: u16
/// - count: u8
/// - For each city (per-city fixed block: 30 bytes after name):
///   - name_len: u8 (max 32)
///   - name: [u8; name_len]
///   - latitude: f64
///   - longitude: f64
///   - biome_seed: u32
///   - city_type: u8
///   - width_grid: u16
///   - height_grid: u16
///   - water_level_delta: i8
///   - temp_bias: i8
///   - moisture_bias: i8
///   - coast: u8
///   - landmass_seed: u8
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse header
    if instruction_data.len() < 3 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let start_city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let count = instruction_data[2] as usize;

    // Validate count
    if count == 0 || count > MAX_CITIES_PER_BATCH {
        return Err(GameError::InvalidParameter.into());
    }

    // 2. Parse accounts
    let min_accounts = 2 + count + 1;
    if accounts.len() < min_accounts {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    crate::extract_accounts!(accounts, [dao_authority, game_engine_account]);
    let city_accounts = &accounts[2..2 + count];
    let _system_program = &accounts[2 + count];

    // 3. Validate signer
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // 4. Load and validate GameEngine
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Get rent for city accounts
    let lamports = crate::utils::rent_exempt_const(CityAccount::SIZE);
    let now = Clock::get()?.unix_timestamp;

    // 6. Parse city data from instruction and initialize each city
    let mut offset = 3usize; // skip header (start_city_id + count)

    for i in 0..count {
        let city_id = start_city_id + i as u16;
        let city_account = &city_accounts[i];

        // Parse name_len
        if offset >= instruction_data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }
        let name_len = instruction_data[offset] as usize;
        offset += 1;

        if name_len > 32 || offset + name_len > instruction_data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }
        let name_bytes = &instruction_data[offset..offset + name_len];
        offset += name_len;

        // Parse latitude (f64), longitude (f64), biome_seed (u32), city_type (u8),
        // width_grid (u16), height_grid (u16), water_level_delta (i8),
        // temp_bias (i8), moisture_bias (i8), coast (u8), landmass_seed (u8).
        // Total: 8 + 8 + 4 + 1 + 2 + 2 + 5 = 30 bytes.
        if offset + 30 > instruction_data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let latitude = f64::from_le_bytes(instruction_data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let longitude =
            f64::from_le_bytes(instruction_data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        if !is_valid_latitude(latitude) {
            return Err(GameError::InvalidLatitude.into());
        }
        if !is_valid_longitude(longitude) {
            return Err(GameError::InvalidLongitude.into());
        }

        let biome_seed =
            u32::from_le_bytes(instruction_data[offset..offset + 4].try_into().unwrap());
        offset += 4;

        let city_type = instruction_data[offset];
        offset += 1;

        let width_grid =
            u16::from_le_bytes(instruction_data[offset..offset + 2].try_into().unwrap());
        offset += 2;

        let height_grid =
            u16::from_le_bytes(instruction_data[offset..offset + 2].try_into().unwrap());
        offset += 2;

        if width_grid == 0 || height_grid == 0 {
            return Err(GameError::InvalidParameter.into());
        }

        let water_level_delta = instruction_data[offset] as i8;
        offset += 1;
        let temp_bias = instruction_data[offset] as i8;
        offset += 1;
        let moisture_bias = instruction_data[offset] as i8;
        offset += 1;
        let coast = instruction_data[offset];
        offset += 1;
        let landmass_seed = instruction_data[offset];
        offset += 1;

        // coast bearing is 0..=8 (0 = no coast). Reject out-of-range so a
        // typo'd payload can't silently disable the gradient.
        if coast > 8 {
            return Err(GameError::InvalidParameter.into());
        }

        // Derive and validate city PDA
        let (expected_city_pda, bump) =
            CityAccount::derive_pda(game_engine_account.address(), city_id);
        if city_account.address() != &expected_city_pda {
            return Err(ProgramError::InvalidSeeds);
        }

        // Create city account
        let city_id_bytes = city_id.to_le_bytes();
        let bump_seed = [bump];
        let seeds = crate::seeds!(
            CITY_SEED,
            game_engine_account.address(),
            &city_id_bytes,
            &bump_seed
        );
        let signer = pinocchio::cpi::Signer::from(&seeds);

        CreateAccount {
            from: dao_authority,
            to: city_account,
            lamports,
            space: CityAccount::SIZE as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;

        // Initialize city data
        let city_data = unsafe { CityAccount::load_mut(city_account)? };

        city_data.account_key = crate::state::AccountKey::City as u8;
        city_data.game_engine = *game_engine_account.address();
        city_data.city_id = city_id;

        // Copy name
        let copy_len = name_len.min(32);
        city_data.name[..copy_len].copy_from_slice(&name_bytes[..copy_len]);

        city_data.latitude = latitude;
        city_data.longitude = longitude;
        city_data.city_type = city_type;
        city_data.players_present = 0;
        city_data.active_encounters = 0;
        city_data.total_encounters_spawned = 0;
        city_data.founded_at = now;
        city_data.min_encounter_level = 1;
        city_data.max_encounter_level = 100;
        city_data.bump = bump;
        city_data._padding1 = [0; 1];
        city_data.arena_season_id = 0;

        // Biome layout — fixed-size, no trailing variable data.
        city_data.biome_seed = biome_seed;
        city_data.width_grid = width_grid;
        city_data.height_grid = height_grid;
        city_data.layout_version = 2;
        city_data.water_level_delta = water_level_delta;
        city_data.temp_bias = temp_bias;
        city_data.moisture_bias = moisture_bias;
        city_data.coast = coast;
        city_data.landmass_seed = landmass_seed;
        city_data._biome_reserved = [0; 2];
    }

    // Emit KingdomCitiesInitialized event
    emit!(KingdomCitiesInitialized {
        kingdom_id: game_engine.kingdom_id,
        game_engine: *game_engine_account.address(),
        start_city_id,
        cities_count: count as u8,
        initialized_at: now,
    });

    Ok(())
}
