//! Append Terrain Anchors — DAO appends anchors to an existing city's terrain
//!
//! Instruction 8 (initialization range)
//!
//! Appends additional anchors to a city that already has terrain configured
//! (via `set_terrain`). This enables terrain data larger than a single
//! transaction by splitting anchor uploads across multiple transactions.
//!
//! # Accounts
//! 0. `[signer, writable]` DAO authority (payer for realloc)
//! 1. `[]` GameEngine account
//! 2. `[writable]` City PDA
//! 3. `[]` System program

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{Sysvar, rent::Rent},
};

use crate::{
    error::GameError,
    logic::terrain::ANCHOR_SIZE,
    state::{CityAccount, GameEngine},
};

/// Hard cap on total anchors per city (800 bytes trailing data at 8 bytes each)
const MAX_TOTAL_ANCHORS: u16 = 500;

/// Append terrain anchors to an existing city account.
///
/// The city must already have terrain configured (terrain_version > 0).
/// New anchors are appended after the existing ones and `anchor_count`
/// is updated. The account is reallocated to fit.
///
/// This enables cities with more anchors than fit in a single transaction
/// (~120 anchors per tx due to Solana's 1232-byte transaction limit).
///
/// # Accounts
///
/// | # | Writable | Signer | Description                                  |
/// |---|----------|--------|----------------------------------------------|
/// | 0 | Yes      | Yes    | DAO authority — must match `GameEngine.authority`, pays for realloc |
/// | 1 | No       | No     | GameEngine PDA — validates authority          |
/// | 2 | Yes      | No     | City PDA — target account to append anchors   |
/// | 3 | No       | No     | System program — required for Transfer CPI    |
///
/// # Instruction Data (after 2-byte discriminator)
///
/// | Offset | Size    | Field         | Description                                    |
/// |--------|---------|---------------|------------------------------------------------|
/// | 0      | 2       | city_id (u16) | Must match city account's stored ID            |
/// | 2      | N × 8   | anchors       | Raw anchor data to append (x, y, mass, lift, push_x, push_y each) |
///
/// # Errors
///
/// - `MissingRequiredSignature` — account 0 is not a signer
/// - `Unauthorized` — signer does not match `GameEngine.authority`
/// - `IllegalOwner` — city account not owned by this program
/// - `InvalidInstructionData` — data too short, not aligned to 8 bytes, city_id mismatch, or total exceeds 500
/// - `InvalidCityId` — city's stored game_engine doesn't match account 1
/// - `InvalidSeeds` — city account address doesn't match derived PDA
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [dao_authority, game_engine_account, city_account]);

    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::Unauthorized.into());
    }

    if unsafe { city_account.owner() } != program_id {
        return Err(ProgramError::IllegalOwner);
    }

    // Parse instruction data ─────────────────────────────────
    // Minimum: city_id (2 bytes) + at least one anchor (8 bytes)
    if data.len() < 2 + ANCHOR_SIZE {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([data[0], data[1]]);
    let anchor_bytes = &data[2..];

    // Anchor data must be aligned to ANCHOR_SIZE
    if anchor_bytes.len() % ANCHOR_SIZE != 0 {
        msg!("Anchor data not aligned to 8 bytes");
        return Err(ProgramError::InvalidInstructionData);
    }

    let new_anchor_count = (anchor_bytes.len() / ANCHOR_SIZE) as u16;

    // Verify city PDA ────────────────────────────────────────
    if city_account.data_len() < CityAccount::SIZE {
        return Err(ProgramError::AccountDataTooSmall);
    }

    let stored_city_id;
    let stored_bump;
    let existing_anchor_count;
    {
        let city_data = city_account.try_borrow()?;
        let city = unsafe { &*(city_data.as_ptr() as *const CityAccount) };
        stored_city_id = city.city_id;
        stored_bump = city.bump;
        existing_anchor_count = city.anchor_count;

        if &city.game_engine != game_engine_account.address() {
            return Err(GameError::InvalidCityId.into());
        }

        // Terrain must be initialized (set_terrain called first)
        if city.terrain_version == 0 {
            msg!("Terrain not initialized — call set_terrain first");
            return Err(ProgramError::InvalidAccountData);
        }
    }

    if city_id != stored_city_id {
        return Err(ProgramError::InvalidInstructionData);
    }

    let expected_pda = CityAccount::create_pda(game_engine_account.address(), city_id, stored_bump)?;
    if city_account.address() != &expected_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Validate total won't exceed cap
    let total_anchors = existing_anchor_count.checked_add(new_anchor_count)
        .ok_or(ProgramError::InvalidInstructionData)?;
    if total_anchors > MAX_TOTAL_ANCHORS {
        msg!("Total anchors would exceed max");
        return Err(ProgramError::InvalidInstructionData);
    }

    // Realloc───────
    let new_size = CityAccount::account_size(total_anchors);
    let current_size = city_account.data_len();

    if new_size > current_size {
        let rent = Rent::get()?;
        let required_lamports = rent.try_minimum_balance(new_size)?;
        let current_lamports = city_account.lamports();
        let lamports_needed = required_lamports.saturating_sub(current_lamports);

        if lamports_needed > 0 {
            pinocchio_system::instructions::Transfer {
                from: dao_authority,
                to: city_account,
                lamports: lamports_needed,
            }.invoke()?;
        }

        city_account.resize(new_size)?;
    }

    // Append anchors
    {
        let mut city_data = city_account.try_borrow_mut()?;

        // Update anchor count
        let city = unsafe { &mut *(city_data.as_mut_ptr() as *mut CityAccount) };
        city.anchor_count = total_anchors;

        // Copy new anchors after existing ones
        let dst_start = CityAccount::SIZE + existing_anchor_count as usize * ANCHOR_SIZE;
        let dst_end = dst_start + new_anchor_count as usize * ANCHOR_SIZE;
        city_data[dst_start..dst_end].copy_from_slice(anchor_bytes);
    }

    // Emit event────
    crate::emit!(crate::events::TerrainSet {
        city: *city_account.address(),
        city_id,
        anchor_count: total_anchors,
        terrain_seed: 0, // header unchanged, seed not re-read
    });

    Ok(())
}
