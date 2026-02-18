//! Batch City Initialization
//!
//! Instruction 5
//!
//! DAO-only instruction to initialize multiple cities for a kingdom in a single transaction.
//! City data (name, coordinates, radius, type) is passed via instruction data.
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
    constants::CITY_SEED,
    emit,
    events::KingdomCitiesInitialized,
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
/// - For each city:
///   - name_len: u8 (max 32)
///   - name: [u8; name_len]
///   - latitude: f64
///   - longitude: f64
///   - radius_km: f32
///   - city_type: u8
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
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

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Get rent for city accounts
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(CityAccount::SIZE);
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

        // Parse latitude (f64), longitude (f64), radius_km (f32), city_type (u8)
        // Total: 8 + 8 + 4 + 1 = 21 bytes
        if offset + 21 > instruction_data.len() {
            return Err(ProgramError::InvalidInstructionData);
        }

        let latitude = f64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        offset += 8;

        let longitude = f64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        offset += 8;

        let radius_km = f32::from_le_bytes(
            instruction_data[offset..offset + 4].try_into().unwrap()
        );
        offset += 4;

        let city_type = instruction_data[offset];
        offset += 1;

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

        city_data.account_key = crate::state::AccountKey::City as u8;
        city_data.game_engine = *game_engine_account.key();
        city_data.city_id = city_id;

        // Copy name
        let copy_len = name_len.min(32);
        city_data.name[..copy_len].copy_from_slice(&name_bytes[..copy_len]);

        city_data.latitude = latitude;
        city_data.longitude = longitude;
        city_data.radius_km = radius_km;
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

        // Terrain — initialized empty (no anchors = all terrain passable)
        city_data.terrain_seed = 0;
        city_data.water_line = 0;
        city_data.peak_line = 255;
        city_data.anchor_count = 0;
        city_data.terrain_version = 0;
        city_data._terrain_reserved = [0; 7];
    }

    // Emit KingdomCitiesInitialized event
    emit!(KingdomCitiesInitialized {
        kingdom_id: game_engine.kingdom_id,
        game_engine: *game_engine_account.key(),
        start_city_id,
        cities_count: count as u8,
        initialized_at: now,
    });

    Ok(())
}
