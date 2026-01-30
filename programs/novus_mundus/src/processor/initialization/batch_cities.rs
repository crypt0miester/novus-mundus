//! Batch City Initialization
//!
//! Instruction 5
//!
//! DAO-only instruction to initialize multiple cities for a kingdom in a single transaction.
//! Uses predefined city data from INITIAL_CITIES constant.
//! Must be called multiple times to initialize all cities (due to account limits).

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{CityAccount, GameEngine},
    constants::{CITY_SEED, INITIAL_CITIES},
    emit,
    events::KingdomCitiesInitialized,
};

/// Maximum cities to initialize per batch (limited by account count in transaction)
pub const MAX_CITIES_PER_BATCH: usize = 8;

/// Batch City Initialization
///
/// Creates multiple cities for a kingdom using predefined city data.
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
/// - start_city_id: u16 (first city ID in batch, e.g., 0, 8, 16, 24, ...)
/// - count: u8 (number of cities to create, max MAX_CITIES_PER_BATCH)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse instruction data
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
    // Minimum: authority + game_engine + count cities + system_program
    let min_accounts = 2 + count + 1;
    if accounts.len() < min_accounts {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let dao_authority = &accounts[0];
    let game_engine_account = &accounts[1];
    let city_accounts = &accounts[2..2 + count];
    let _system_program = &accounts[2 + count];

    // 3. Validate signer
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // 4. Load and validate GameEngine
    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    // Verify DAO authority
    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Get rent for city accounts
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(CityAccount::SIZE);
    let now = Clock::get()?.unix_timestamp;

    // 6. Initialize each city
    for i in 0..count {
        let city_id = start_city_id + i as u16;
        let city_account = &city_accounts[i];

        // Validate city_id is within range
        if (city_id as usize) >= INITIAL_CITIES.len() {
            return Err(GameError::InvalidCityId.into());
        }

        // Get predefined city data
        let (expected_id, name_str, latitude, longitude, radius_km, city_type) = &INITIAL_CITIES[city_id as usize];

        // Sanity check city_id
        if *expected_id != city_id {
            return Err(GameError::InvalidCityId.into());
        }

        // Derive and validate city PDA
        let (expected_city_pda, bump) = CityAccount::derive_pda(game_engine_account.key(), city_id);
        if city_account.key() != &expected_city_pda {
            return Err(ProgramError::InvalidSeeds);
        }

        // Create city account
        let city_id_bytes = city_id.to_le_bytes();
        let bump_seed = [bump];
        let seeds = pinocchio::seeds!(CITY_SEED, game_engine_account.key(), &city_id_bytes, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

        CreateAccount {
            from: dao_authority,
            to: city_account,
            lamports,
            space: CityAccount::SIZE as u64,
            owner: &crate::ID,
        }.invoke_signed(&[signer])?;

        // Initialize city data
        let city_data = unsafe { CityAccount::load_mut(city_account)? };

        city_data.game_engine = *game_engine_account.key();
        city_data.city_id = city_id;

        // Copy name (max 32 bytes)
        let name_bytes = name_str.as_bytes();
        let name_len = name_bytes.len().min(32);
        city_data.name[..name_len].copy_from_slice(&name_bytes[..name_len]);

        city_data.latitude = *latitude;
        city_data.longitude = *longitude;
        city_data.radius_km = *radius_km;
        city_data.city_type = *city_type as u8;
        city_data.players_present = 0;
        city_data.active_encounters = 0;
        city_data.total_encounters_spawned = 0;
        city_data.founded_at = now;
        city_data.min_encounter_level = 1;
        city_data.max_encounter_level = 100;
        city_data.bump = bump;
        city_data._padding1 = [0; 1];
        city_data.arena_season_id = 0;
    }

    // Emit KingdomCitiesInitialized event after batch completes
    emit!(KingdomCitiesInitialized {
        kingdom_id: game_engine.kingdom_id,
        game_engine: *game_engine_account.key(),
        start_city_id,
        cities_count: count as u8,
        initialized_at: now,
    });

    Ok(())
}
