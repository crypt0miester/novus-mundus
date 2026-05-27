//! Create Castle — DAO instruction to create a new castle.
//!
//! Instruction 270.
//!
//! Creates a `CastleAccount` plus `N²` `LocationAccount`s — one per
//! cell in the castle's `footprint_size × footprint_size` plot. Every
//! footprint cell is gated at create time on:
//!
//!   1. AABB containment inside the city's `(width_grid, height_grid)`
//!      plot — anchor + (N-1) in each axis must stay inside the city.
//!   2. Biome passability — water cells reject (`TerrainImpassable`).
//!   3. Unoccupied state — a pre-existing `LocationAccount` (player or
//!      encounter camping where the castle wants to land) rejects with
//!      `CellOccupied`.
//!
//! The castle's stored `latitude` / `longitude` (microdegrees) is the
//! **anchor corner** of the footprint, not the centre. Cells extend at
//! positive offsets: `cells = { (anchor_grid_lat + dlat, anchor_grid_long
//! + dlong) for dlat, dlong in 0..N }`.
//!
//! Only callable by DAO authority.

use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        CASTLE_PROTECTION_DURATION, CASTLE_SEED, CASTLE_STATUS_VACANT, CASTLE_TIER_MULTIPLIER_BPS,
        COURT_CASH_PER_DAY, COURT_NOVI_PER_DAY, KING_CASH_PER_DAY, KING_LOOT_CUT_BPS,
        KING_NOVI_PER_DAY, LOCATION_SEED, MEMBER_CASH_PER_DAY, MEMBER_NOVI_PER_DAY,
    },
    emit,
    error::GameError,
    events::CastleCreated,
    logic::{biome, location::castle_fits_in_city_grid},
    state::{CastleAccount, CityAccount, GameEngine, LocationAccount, OCCUPANT_CASTLE},
    validation::require_empty,
};

/// Max N for an N×N castle footprint. N=4 = 16 cells ≈ 64k CU for the
/// create-time Location creates; well inside the 200k CU budget per tx.
/// N=5+ would crowd the budget and would need a two-phase create.
pub const MAX_FOOTPRINT_SIZE: u8 = 4;

/// Create Castle instruction data (50 bytes; 49 pre-cut + 1 footprint_size).
/// - city_id: u16 (bytes 0-1)
/// - castle_id: u16 (bytes 2-3)
/// - tier: u8 (byte 4)
/// - latitude: i32 (bytes 5-8) — anchor corner, grid units (×10,000)
/// - longitude: i32 (bytes 9-12) — anchor corner, grid units (×10,000)
/// - min_level: u8 (byte 13)
/// - min_networth_millions: u8 (byte 14)
/// - min_troops_thousands: u8 (byte 15)
/// - name_len: u8 (byte 16)
/// - name: [u8; 32] (bytes 17-48)
/// - footprint_size: u8 (byte 49) — 1..=MAX_FOOTPRINT_SIZE

/// Accounts (6 fixed + N²):
/// 0. [signer] DAO authority
/// 1. [writable] Castle account (PDA to create)
/// 2. [] Game engine
/// 3. [] City account (for biome_seed, width_grid, height_grid, lat/long)
/// 4. [] System program
/// 5. [] Rent sysvar
/// 6+. [writable] N² Location PDAs (row-major: dlat outer, dlong inner)

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse instruction data.
    if instruction_data.len() < 50 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let castle_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
    let tier = instruction_data[4];
    let latitude = i32::from_le_bytes([
        instruction_data[5],
        instruction_data[6],
        instruction_data[7],
        instruction_data[8],
    ]);
    let longitude = i32::from_le_bytes([
        instruction_data[9],
        instruction_data[10],
        instruction_data[11],
        instruction_data[12],
    ]);
    let min_level = instruction_data[13];
    let min_networth_millions = instruction_data[14];
    let min_troops_thousands = instruction_data[15];
    let name_len = instruction_data[16];
    let footprint_size = instruction_data[49];

    if tier > 4 {
        return Err(GameError::InvalidCastleTier.into());
    }
    if footprint_size == 0 || footprint_size > MAX_FOOTPRINT_SIZE {
        return Err(GameError::InvalidParameter.into());
    }

    let mut name = [0u8; 32];
    let copy_len = (name_len as usize).min(32);
    if instruction_data.len() >= 17 + copy_len {
        name[..copy_len].copy_from_slice(&instruction_data[17..17 + copy_len]);
    }

    // 2. Account count: 6 fixed + N² location PDAs.
    let n = footprint_size as usize;
    let n_squared = n.checked_mul(n).ok_or(ProgramError::ArithmeticOverflow)?;
    let min_accounts = 6usize
        .checked_add(n_squared)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if accounts.len() < min_accounts {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    crate::extract_accounts!(
        accounts,
        [
            dao_authority,
            castle_account,
            game_engine_account,
            city_account,
            _system_program,
            _rent_sysvar,
        ]
    );
    let location_accounts = &accounts[6..6 + n_squared];

    // 3. Validate DAO authority.
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    {
        let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
        if dao_authority.address() != &game_engine.authority {
            return Err(GameError::DaoRequired.into());
        }
    }

    // 4. Load + validate the city the castle is being placed in.
    let city_data = unsafe { CityAccount::load(city_account)? };
    if city_data.city_id != city_id {
        return Err(GameError::CityNotFound.into());
    }
    if &city_data.game_engine != game_engine_account.address() {
        return Err(GameError::KingdomMismatch.into());
    }
    CityAccount::validate_pda(city_account, city_data)?;

    // 5. Anchor is in grid units (×10,000) — same precision as
    // LocationAccount. Compute centre-relative offsets to validate
    // AABB fit + biome passability per footprint cell.
    let anchor_grid_lat = latitude;
    let anchor_grid_long = longitude;
    let city_grid_lat = LocationAccount::to_grid(city_data.latitude);
    let city_grid_long = LocationAccount::to_grid(city_data.longitude);
    let anchor_ox = anchor_grid_long.saturating_sub(city_grid_long);
    let anchor_oy = anchor_grid_lat.saturating_sub(city_grid_lat);

    if !castle_fits_in_city_grid(
        anchor_ox,
        anchor_oy,
        footprint_size,
        city_data.width_grid,
        city_data.height_grid,
    ) {
        return Err(GameError::OutOfRange.into());
    }

    // 6. Every footprint cell must land on a passable biome.
    // Failing here means the DAO needs to pick a different anchor;
    // castles can't straddle water at create time.
    for dlat in 0..(n as i32) {
        for dlong in 0..(n as i32) {
            let cell_ox = anchor_ox.saturating_add(dlong);
            let cell_oy = anchor_oy.saturating_add(dlat);
            if !biome::is_passable_biome(city_data.biome_at_offset(cell_ox, cell_oy)) {
                return Err(GameError::TerrainImpassable.into());
            }
        }
    }

    // 7. Create the CastleAccount.
    let city_id_bytes = city_id.to_le_bytes();
    let castle_id_bytes = castle_id.to_le_bytes();
    let (expected_pda, bump) =
        CastleAccount::derive_pda(game_engine_account.address(), city_id, castle_id);
    if castle_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }
    require_empty(castle_account).map_err(|_| GameError::CastleAlreadyExists)?;

    let lamports = crate::utils::rent_exempt_const(CastleAccount::LEN);
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        CASTLE_SEED,
        game_engine_account.address(),
        &city_id_bytes,
        &castle_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: castle_account,
        lamports,
        space: CastleAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    let now = Clock::get()?.unix_timestamp;

    // 8. Initialize castle data.
    {
        let mut castle_data = castle_account.try_borrow_mut()?;
        let castle = unsafe { CastleAccount::load_mut(&mut castle_data) };

        castle.account_key = crate::state::AccountKey::Castle as u8;
        castle.game_engine = *game_engine_account.address();
        castle.castle_id = castle_id;
        castle.city_id = city_id;
        castle.tier = tier;
        castle.status = CASTLE_STATUS_VACANT;
        castle.bump = bump;

        castle.name = name;
        castle.name_len = name_len.min(32);

        castle.latitude = latitude;
        castle.longitude = longitude;
        castle.footprint_size = footprint_size;

        castle.king = pinocchio::Address::new_from_array([0u8; 32]);
        castle.team = pinocchio::Address::new_from_array([0u8; 32]);
        castle.claimed_at = 0;
        castle.contest_end_at = 0;

        castle.garrison_count = 0;
        castle.max_garrison = if tier == 0 { 0 } else { 25 };

        castle.court_count = 0;
        castle.max_court = match tier {
            0 => 0,
            1 => 1,
            _ => 3,
        };
        castle.court_appointment_cooldown = 0;

        castle.fortification_level = 0;
        castle.treasury_level = 0;
        castle.chambers_level = 0;
        castle.watchtower_level = 0;
        castle.armory_level = 0;

        castle.upgrade_type = 0;
        castle.upgrade_target_level = 0;
        castle.upgrade_end_at = 0;

        castle.min_level = min_level;
        castle.min_networth_millions = min_networth_millions;
        castle.min_troops_thousands = min_troops_thousands;
        castle.protection_duration = CASTLE_PROTECTION_DURATION;

        castle.tier_multiplier_bps = CASTLE_TIER_MULTIPLIER_BPS[tier as usize];
        castle.king_loot_cut_bps = KING_LOOT_CUT_BPS;
        castle.king_novi_per_day = KING_NOVI_PER_DAY;
        castle.king_cash_per_day = KING_CASH_PER_DAY;
        castle.court_novi_per_day = COURT_NOVI_PER_DAY;
        castle.court_cash_per_day = COURT_CASH_PER_DAY;
        castle.member_novi_per_day = MEMBER_NOVI_PER_DAY;
        castle.member_cash_per_day = MEMBER_CASH_PER_DAY;

        castle.times_claimed = 0;
        castle.successful_defenses = 0;
        castle.failed_defenses = 0;
        castle.total_rewards_distributed = 0;

        castle.transition_garrison_cleaned = 0;
        castle.transition_court_cleaned = false;
        castle.transition_rewards_cleaned = 0;
        castle.transition_new_king = pinocchio::Address::new_from_array([0u8; 32]);
    }

    // 9. Create N² LocationAccounts, one per footprint cell. Row-major:
    // outer loop dlat, inner dlong. Caller must pass the location PDAs in
    // the same order (idx = dlat * N + dlong).
    let location_lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);
    for dlat in 0..(n as i32) {
        for dlong in 0..(n as i32) {
            let cell_grid_lat = anchor_grid_lat.saturating_add(dlat);
            let cell_grid_long = anchor_grid_long.saturating_add(dlong);
            let idx = (dlat as usize)
                .checked_mul(n)
                .and_then(|v| v.checked_add(dlong as usize))
                .ok_or(ProgramError::ArithmeticOverflow)?;
            let loc_account = &location_accounts[idx];

            let (expected_loc_pda, loc_bump) = LocationAccount::derive_pda(
                game_engine_account.address(),
                city_id,
                cell_grid_lat,
                cell_grid_long,
            );
            if loc_account.address() != &expected_loc_pda {
                return Err(GameError::InvalidPDA.into());
            }
            // A pre-existing LocationAccount means a player or encounter
            // is camped here. The DAO needs to evict (or wait) before
            // landing the castle on this cell.
            if loc_account.data_len() != 0 {
                return Err(GameError::CellOccupied.into());
            }

            let lat_bytes = cell_grid_lat.to_le_bytes();
            let long_bytes = cell_grid_long.to_le_bytes();
            let bump_arr = [loc_bump];
            let loc_seeds = crate::seeds!(
                LOCATION_SEED,
                game_engine_account.address(),
                &city_id_bytes,
                &lat_bytes,
                &long_bytes,
                &bump_arr
            );
            let loc_signer = pinocchio::cpi::Signer::from(&loc_seeds);

            CreateAccount {
                from: dao_authority,
                to: loc_account,
                lamports: location_lamports,
                space: LocationAccount::LEN as u64,
                owner: program_id,
            }
            .invoke_signed(&[loc_signer])?;

            let mut loc_data = loc_account.try_borrow_mut()?;
            let loc = unsafe { LocationAccount::load_mut(&mut loc_data) };

            loc.account_key = crate::state::AccountKey::Location as u8;
            loc.game_engine = *game_engine_account.address();
            loc.grid_lat = cell_grid_lat;
            loc.grid_long = cell_grid_long;
            loc.city_id = city_id;
            loc.bump = loc_bump;
            loc.occupant_type = OCCUPANT_CASTLE;
            loc.occupant = *castle_account.address();
            loc.occupied_since = now;
            loc.location_creator = *dao_authority.address();
            loc.reserved_arrival_time = 0;
        }
    }

    // 10. Emit event.
    emit!(CastleCreated {
        castle: *castle_account.address(),
        castle_name: name,
        city_id,
        castle_id,
        tier,
        timestamp: now,
    });

    Ok(())
}
