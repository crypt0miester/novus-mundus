//! Create Castle - DAO instruction to create a new castle
//!
//! Instruction 270
//!
//! Creates a new CastleAccount with DAO-specified configuration.
//! Only callable by DAO authority.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::CastleCreated,
    state::{CastleAccount, GameEngine},
    validation::{require_empty, require_owner},
    constants::{
        CASTLE_SEED, CASTLE_STATUS_VACANT,
        CASTLE_TIER_MULTIPLIER_BPS,
        KING_NOVI_PER_DAY, KING_CASH_PER_DAY,
        COURT_NOVI_PER_DAY, COURT_CASH_PER_DAY,
        MEMBER_NOVI_PER_DAY, MEMBER_CASH_PER_DAY,
        KING_LOOT_CUT_BPS, CASTLE_PROTECTION_DURATION,
    },
};

/// Create Castle instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - tier: u8 (byte 6)
/// - latitude: i32 (bytes 7-10)
/// - longitude: i32 (bytes 11-14)
/// - min_level: u8 (byte 15)
/// - min_networth_millions: u8 (byte 16)
/// - min_troops_thousands: u8 (byte 17)
/// - name_len: u8 (byte 18)
/// - name: [u8; 32] (bytes 19-50)

/// Accounts:
/// 0. [signer] DAO authority
/// 1. [writable] Castle account (PDA to create)
/// 2. [] Game engine
/// 3. [] System program
/// 4. [] Rent sysvar

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let dao_authority = &accounts[0];
    let castle_account = &accounts[1];
    let game_engine_account = &accounts[2];
    let _system_program = &accounts[3];
    let _rent_sysvar = &accounts[4];

    // Verify signer
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load game engine to verify DAO authority
    require_owner(game_engine_account, program_id)?;
    let game_engine_data = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // Parse instruction data
    if instruction_data.len() < 51 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
    let castle_id = u16::from_le_bytes([instruction_data[4], instruction_data[5]]);
    let tier = instruction_data[6];
    let latitude = i32::from_le_bytes([
        instruction_data[7],
        instruction_data[8],
        instruction_data[9],
        instruction_data[10],
    ]);
    let longitude = i32::from_le_bytes([
        instruction_data[11],
        instruction_data[12],
        instruction_data[13],
        instruction_data[14],
    ]);
    let min_level = instruction_data[15];
    let min_networth_millions = instruction_data[16];
    let min_troops_thousands = instruction_data[17];
    let name_len = instruction_data[18];

    // Validate tier
    if tier > 4 {
        return Err(GameError::InvalidCastleTier.into());
    }

    // Copy name
    let mut name = [0u8; 32];
    let copy_len = (name_len as usize).min(32);
    if instruction_data.len() >= 19 + copy_len {
        name[..copy_len].copy_from_slice(&instruction_data[19..19 + copy_len]);
    }

    // Derive PDA (kingdom-scoped)
    let city_id_bytes = city_id.to_le_bytes();
    let castle_id_bytes = castle_id.to_le_bytes();
    let (expected_pda, bump) = CastleAccount::derive_pda(game_engine_account.key(), city_id, castle_id);

    if castle_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Check account doesn't already exist
    require_empty(castle_account).map_err(|_| GameError::CastleAlreadyExists)?;

    // Create PDA account
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(CastleAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        CASTLE_SEED,
        game_engine_account.key().as_ref(),
        &city_id_bytes,
        &castle_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: castle_account,
        lamports,
        space: CastleAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize castle data
    let mut castle_data = castle_account.try_borrow_mut_data()?;
    let castle = unsafe { CastleAccount::load_mut(&mut castle_data) };

    // Identity
    castle.castle_id = castle_id;
    castle.city_id = city_id;
    castle.tier = tier;
    castle.status = CASTLE_STATUS_VACANT;
    castle.bump = bump;

    // Name
    castle.name = name;
    castle.name_len = name_len.min(32);

    // Location
    castle.latitude = latitude;
    castle.longitude = longitude;

    // Ruler info (vacant)
    castle.king = [0u8; 32];
    castle.team = [0u8; 32];
    castle.claimed_at = 0;
    castle.contest_end_at = 0;

    // Garrison tracking
    castle.garrison_count = 0;
    castle.max_garrison = if tier == 0 { 0 } else { 25 }; // Outposts have no garrison

    // Court tracking
    castle.court_count = 0;
    castle.max_court = match tier {
        0 => 0, // Outpost: no court
        1 => 1, // Keep: 1 position
        _ => 3, // Stronghold+: up to 3 positions
    };
    castle.court_appointment_cooldown = 0;

    // Upgrade levels (all start at 0)
    castle.fortification_level = 0;
    castle.treasury_level = 0;
    castle.chambers_level = 0;
    castle.watchtower_level = 0;
    castle.armory_level = 0;

    // No upgrade in progress
    castle.upgrade_type = 0;
    castle.upgrade_target_level = 0;
    castle.upgrade_end_at = 0;

    // DAO configuration - eligibility
    castle.min_level = min_level;
    castle.min_networth_millions = min_networth_millions;
    castle.min_troops_thousands = min_troops_thousands;
    castle.protection_duration = CASTLE_PROTECTION_DURATION;

    // DAO configuration - reward rates (use defaults from constants)
    castle.tier_multiplier_bps = CASTLE_TIER_MULTIPLIER_BPS[tier as usize];
    castle.king_loot_cut_bps = KING_LOOT_CUT_BPS;
    castle.king_novi_per_day = KING_NOVI_PER_DAY;
    castle.king_cash_per_day = KING_CASH_PER_DAY;
    castle.court_novi_per_day = COURT_NOVI_PER_DAY;
    castle.court_cash_per_day = COURT_CASH_PER_DAY;
    castle.member_novi_per_day = MEMBER_NOVI_PER_DAY;
    castle.member_cash_per_day = MEMBER_CASH_PER_DAY;

    // Statistics
    castle.times_claimed = 0;
    castle.successful_defenses = 0;
    castle.failed_defenses = 0;
    castle.total_rewards_distributed = 0;

    // Transition state (not transitioning)
    castle.transition_garrison_cleaned = 0;
    castle.transition_court_cleaned = false;
    castle.transition_rewards_cleaned = 0;
    castle.transition_new_king = [0u8; 32];

    // Emit event
    emit!(CastleCreated {
        castle: *castle_account.key(),
        castle_name: name,
        city_id,
        castle_id,
        tier,
        timestamp: now,
    });

    Ok(())
}
