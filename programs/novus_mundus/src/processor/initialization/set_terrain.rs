//! Set Terrain — DAO writes terrain data onto an existing city account
//!
//! Instruction 7 (initialization range)
//!
//! Replaces all terrain data (header + anchors) on a city account,
//! reallocating the account to fit the new anchor array.
//!
//! # Accounts
//! 0. `[signer, writable]` DAO authority (payer for realloc)
//! 1. `[]` GameEngine account
//! 2. `[writable]` City PDA
//! 3. `[]` System program
//!
//! # Instruction Data
//! - city_id: u16 (2 bytes — for PDA verification)
//! - terrain payload: serialized via `parse_terrain_header` layout
//!   - terrain_seed: u32 (4 bytes)
//!   - water_line: u8 (1 byte)
//!   - peak_line: u8 (1 byte)
//!   - anchor_count: u16 (2 bytes)
//!   - terrain_version: u8 (1 byte)
//!   - _reserved: [u8; 7] (7 bytes)
//!   - anchors: [Anchor × N] (N × 8 bytes)

use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events,
    logic::terrain::{self, ANCHOR_SIZE, TERRAIN_HEADER_SIZE},
    state::{CityAccount, GameEngine},
};

/// Maximum anchors per city to stay within transaction limits
const MAX_ANCHORS: u16 = 100;

/// Set or replace terrain data on an existing CityAccount.
///
/// This is a DAO-only instruction that writes terrain header fields
/// (seed, water_line, peak_line, anchor_count, version) into the city's
/// fixed struct, then copies the variable-length anchor array into trailing
/// account data beyond `CityAccount::SIZE`.
///
/// The account is reallocated to exactly `CityAccount::SIZE + anchor_count * 8`
/// bytes. When growing, the DAO authority pays additional rent via a system
/// Transfer CPI. When shrinking, excess lamports remain on the city account.
///
/// # Accounts
///
/// | # | Writable | Signer | Description                                  |
/// |---|----------|--------|----------------------------------------------|
/// | 0 | Yes      | Yes    | DAO authority — must match `GameEngine.authority`, pays for realloc |
/// | 1 | No       | No     | GameEngine PDA — validates authority          |
/// | 2 | Yes      | No     | City PDA — target account to write terrain    |
/// | 3 | No       | No     | System program — required for Transfer CPI    |
///
/// # Instruction Data (after 2-byte discriminator)
///
/// | Offset | Size           | Field           | Description                            |
/// |--------|----------------|-----------------|----------------------------------------|
/// | 0      | 2              | city_id (u16)   | Must match city account's stored ID    |
/// | 2      | 4              | terrain_seed    | Deterministic noise seed               |
/// | 6      | 1              | water_line      | Elevation ≤ this = water (impassable)  |
/// | 7      | 1              | peak_line       | Elevation ≥ this = mountain (impassable)|
/// | 8      | 2              | anchor_count    | Number of anchors (max 100)            |
/// | 10     | 1              | terrain_version | Data format version                    |
/// | 11     | 7              | _reserved       | Zero padding                           |
/// | 18     | anchor_count×8 | anchors         | Each: x(i16) y(i16) mass(u8) lift(u8) push_x(i8) push_y(i8) |
///
/// # Errors
///
/// - `MissingRequiredSignature` — account 0 is not a signer
/// - `Unauthorized` — signer does not match `GameEngine.authority`
/// - `IllegalOwner` — city account not owned by this program
/// - `InvalidInstructionData` — data too short, city_id mismatch, or anchor_count > 100
/// - `InvalidCityId` — city's stored game_engine doesn't match account 1
/// - `InvalidSeeds` — city account address doesn't match derived PDA
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // ── Parse accounts ─────────────────────────────────────────
    crate::extract_accounts!(accounts, [dao_authority, game_engine_account, city_account]);
    // accounts[3] = system program (needed for Transfer CPI)

    // Verify signer
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load and verify game engine
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Verify DAO authority
    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::Unauthorized.into());
    }

    // Verify city account ownership
    if unsafe { city_account.owner() } != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    // ── Parse instruction data ─────────────────────────────────
    // city_id (2) + terrain header (16) = 18 minimum bytes
    if data.len() < 2 + TERRAIN_HEADER_SIZE {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([data[0], data[1]]);
    let terrain_data = &data[2..];

    // Parse terrain header
    let (terrain_seed, water_line, peak_line, anchor_count, terrain_version) =
        terrain::parse_terrain_header(terrain_data);

    // Validate anchor count
    if anchor_count > MAX_ANCHORS {
        msg!("Too many anchors");
        return Err(ProgramError::InvalidInstructionData);
    }

    // Validate we have enough data for all anchors
    let expected_len = 2 + TERRAIN_HEADER_SIZE + anchor_count as usize * ANCHOR_SIZE;
    if data.len() < expected_len {
        msg!("Instruction data too short for anchor count");
        return Err(ProgramError::InvalidInstructionData);
    }

    // ── Verify city PDA ────────────────────────────────────────
    // Load city to get its bump, then verify PDA
    if city_account.data_len() < CityAccount::SIZE {
        return Err(ProgramError::AccountDataTooSmall);
    }

    let stored_city_id;
    let stored_bump;
    {
        let city_data = city_account.try_borrow()?;
        let city = unsafe { &*(city_data.as_ptr() as *const CityAccount) };
        stored_city_id = city.city_id;
        stored_bump = city.bump;

        // Verify city belongs to this game engine
        if &city.game_engine != game_engine_account.address() {
            return Err(GameError::InvalidCityId.into());
        }
    }

    // Verify city_id matches
    if city_id != stored_city_id {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Verify PDA
    let expected_pda =
        CityAccount::create_pda(game_engine_account.address(), city_id, stored_bump)?;
    if city_account.address() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // ── Realloc ────────────────────────────────────────────────
    let new_size = CityAccount::account_size(anchor_count);
    let current_size = city_account.data_len();

    if new_size != current_size {
        let rent = Rent::get()?;
        let required_lamports = rent.try_minimum_balance(new_size)?;
        let current_lamports = city_account.lamports();

        if new_size > current_size {
            // Growing — payer sends additional rent
            let lamports_needed = required_lamports.saturating_sub(current_lamports);
            if lamports_needed > 0 {
                pinocchio_system::instructions::Transfer {
                    from: dao_authority,
                    to: city_account,
                    lamports: lamports_needed,
                }
                .invoke()?;
            }
        }
        // Shrinking — excess lamports stay on account (no refund needed)
        city_account.resize(new_size)?;
    }

    // Write terrain data
    {
        let mut city_data = city_account.try_borrow_mut()?;
        let city = unsafe { &mut *(city_data.as_mut_ptr() as *mut CityAccount) };

        // Write terrain header fields
        city.terrain_seed = terrain_seed;
        city.water_line = water_line;
        city.peak_line = peak_line;
        city.anchor_count = anchor_count;
        city.terrain_version = terrain_version;

        // Write anchor bytes to trailing data
        if anchor_count > 0 {
            let anchor_src = &terrain_data
                [TERRAIN_HEADER_SIZE..TERRAIN_HEADER_SIZE + anchor_count as usize * ANCHOR_SIZE];
            let dst_start = CityAccount::SIZE;
            let dst_end = dst_start + anchor_count as usize * ANCHOR_SIZE;
            city_data[dst_start..dst_end].copy_from_slice(anchor_src);
        }
    }

    // ── Emit event ─────────────────────────────────────────────
    emit!(events::TerrainSet {
        city: *city_account.address(),
        city_id,
        anchor_count,
        terrain_seed,
    });

    Ok(())
}
