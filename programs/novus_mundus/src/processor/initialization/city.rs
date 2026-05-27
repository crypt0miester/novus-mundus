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
    events::CityInitialized,
    logic::location::{is_valid_latitude, is_valid_longitude},
    state::{CityAccount, CityType, GameEngine},
    utils::read_u16,
};

/// Create a new city within a kingdom (DAO only)
/// KINGDOM-SCOPED: Cities exist within a specific kingdom
///
/// Instruction data format (64 bytes; 59 pre-knobs):
/// ```text
/// [0..2]   city_id: u16 (little-endian)
/// [2..34]  name: [u8; 32] (UTF-8, zero-padded)
/// [34..42] latitude: f64 (little-endian)
/// [42..50] longitude: f64 (little-endian)
/// [50..54] biome_seed: u32 (little-endian) — replaces radius_km
/// [54]     city_type: u8 (0=Capital, 1=Resource, 2=Combat, 3=Trade)
/// [55..57] width_grid: u16 (little-endian)
/// [57..59] height_grid: u16 (little-endian)
/// [59]     water_level_delta: i8 (per-city biome knob; 0 = procedural default)
/// [60]     temp_bias: i8
/// [61]     moisture_bias: i8
/// [62]     coast: u8 (0=none, 1..=8 = N/NE/E/SE/S/SW/W/NW)
/// [63]     landmass_seed: u8 (0=no mask, >0 carves landmass blobs)
/// ```
///
/// # Accounts
/// 0. `[WRITE, SIGNER]` dao_authority - Must match GameEngine.authority
/// 1. `[WRITE]` city_account - PDA derived from [game_engine, city_id] (will be created)
/// 2. `[]` game_engine - GameEngine account for authority validation and kingdom scoping
/// 3. `[]` system_program - System Program
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        dao_authority,
        city_account,
        game_engine_account,
        _system_program,
    ]);

    // 2. Parse Instruction Data

    if instruction_data.len() < 64 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = read_u16(instruction_data, 0, "city.city_id")?;

    let mut name = [0u8; 32];
    name.copy_from_slice(&instruction_data[2..34]);

    let latitude = f64::from_le_bytes([
        instruction_data[34],
        instruction_data[35],
        instruction_data[36],
        instruction_data[37],
        instruction_data[38],
        instruction_data[39],
        instruction_data[40],
        instruction_data[41],
    ]);

    let longitude = f64::from_le_bytes([
        instruction_data[42],
        instruction_data[43],
        instruction_data[44],
        instruction_data[45],
        instruction_data[46],
        instruction_data[47],
        instruction_data[48],
        instruction_data[49],
    ]);

    let biome_seed = u32::from_le_bytes([
        instruction_data[50],
        instruction_data[51],
        instruction_data[52],
        instruction_data[53],
    ]);

    let city_type_u8 = instruction_data[54];
    let width_grid = u16::from_le_bytes([instruction_data[55], instruction_data[56]]);
    let height_grid = u16::from_le_bytes([instruction_data[57], instruction_data[58]]);
    let water_level_delta = instruction_data[59] as i8;
    let temp_bias = instruction_data[60] as i8;
    let moisture_bias = instruction_data[61] as i8;
    let coast = instruction_data[62];
    let landmass_seed = instruction_data[63];

    // 3. Validate Instruction Data

    if !is_valid_latitude(latitude) {
        return Err(GameError::InvalidLatitude.into());
    }

    if !is_valid_longitude(longitude) {
        return Err(GameError::InvalidLongitude.into());
    }

    if width_grid == 0 || height_grid == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    if coast > 8 {
        return Err(GameError::InvalidParameter.into());
    }

    let city_type = CityType::from_u8(city_type_u8).ok_or(GameError::InvalidParameter)?;

    // 4. Validate GameEngine and DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Verify DAO authority
    if dao_authority.address() != &game_engine_data.authority {
        return Err(GameError::DaoRequired.into());
    }

    if !dao_authority.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate City PDA (kingdom-scoped)
    let (expected_city_address, bump) =
        CityAccount::derive_pda(game_engine_account.address(), city_id);

    if city_account.address() != &expected_city_address {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Create City Account

    let city_id_bytes = city_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        CITY_SEED,
        game_engine_account.address(),
        &city_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    // Calculate rent for city account
    let lamports = crate::utils::rent_exempt_const(CityAccount::SIZE);

    // Create account
    CreateAccount {
        from: dao_authority,
        to: city_account,
        lamports,
        space: CityAccount::SIZE as u64,
        owner: &crate::ID,
    }
    .invoke_signed(&[signer])?;

    // 7. Initialize City Account Data

    let now = Clock::get()?.unix_timestamp;

    let city_data = unsafe { CityAccount::load_mut(city_account)? };

    city_data.account_key = crate::state::AccountKey::City as u8;
    city_data.game_engine = *game_engine_account.address();
    city_data.city_id = city_id;
    city_data.name = name;
    city_data.latitude = latitude;
    city_data.longitude = longitude;
    city_data.city_type = city_type as u8;
    city_data.players_present = 0;
    city_data.active_encounters = 0;
    city_data.total_encounters_spawned = 0;
    city_data.founded_at = now;
    city_data.min_encounter_level = 1;
    city_data.max_encounter_level = 100;
    city_data.bump = bump;
    city_data._padding1 = [0; 1];
    city_data.arena_season_id = 0;
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

    // Emit CityInitialized event
    emit!(CityInitialized {
        city: *city_account.address(),
        city_index: city_id,
        timestamp: now,
    });

    Ok(())
}
