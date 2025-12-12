//! Create Arena Season (Instruction 230)
//!
//! Creates a new arena season for a city. Only callable by DAO authority.
//! Auto-increments the city's arena_season_id.
//!
//! # Accounts
//! 0. `[WRITE]` arena_season: ArenaSeasonAccount PDA (to be created)
//! 1. `[SIGNER, WRITE]` authority: Season authority (DAO)
//! 2. `[]` game_engine: GameEngine PDA
//! 3. `[WRITE]` city_account: CityAccount PDA
//! 4. `[]` system_program: System program

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        ARENA_SEASON_SEED, ARENA_SEASON_DURATION, ARENA_CLAIM_DEADLINE,
        ARENA_MIN_POINTS_FOR_LEADERBOARD,
    },
    error::GameError,
    state::{
        ArenaSeasonAccount, ArenaLeaderboardEntry, ArenaStatus, GameEngine, CityAccount,
        ARENA_SEASON_ACCOUNT_SIZE,
    },
    validation::{require_signer, require_writable, require_key_match, require_owner},
};

/// Instruction data for create_season
/// - city_id: u16 (2 bytes)
/// - master_prize_pool: u64 (8 bytes)
/// - daily_prize_pool: u64 (8 bytes)
/// - daily_distribution_cap: u64 (8 bytes)
/// - min_level_required: u8 (1 byte)
/// Total: 27 bytes
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        arena_season,
        authority,
        game_engine,
        city_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(arena_season)?;
    require_writable(city_account)?;
    require_owner(city_account, program_id)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Load and validate GameEngine - authority must be game authority
    let game_engine_data = GameEngine::load_checked(game_engine, program_id)?;
    if authority.key() != &game_engine_data.game_authority {
        return Err(GameError::Unauthorized.into());
    }
    drop(game_engine_data);

    // 4. Parse Instruction Data (27 bytes minimum)
    if instruction_data.len() < 27 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);

    let master_prize_pool = u64::from_le_bytes([
        instruction_data[2], instruction_data[3], instruction_data[4], instruction_data[5],
        instruction_data[6], instruction_data[7], instruction_data[8], instruction_data[9],
    ]);

    let daily_prize_pool = u64::from_le_bytes([
        instruction_data[10], instruction_data[11], instruction_data[12], instruction_data[13],
        instruction_data[14], instruction_data[15], instruction_data[16], instruction_data[17],
    ]);

    let daily_distribution_cap = u64::from_le_bytes([
        instruction_data[18], instruction_data[19], instruction_data[20], instruction_data[21],
        instruction_data[22], instruction_data[23], instruction_data[24], instruction_data[25],
    ]);

    let min_level_required = instruction_data[26];

    // 5. Load and validate City PDA, increment arena_season_id
    let city = unsafe { CityAccount::load_mut(city_account)? };
    if city.city_id != city_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Verify City PDA
    CityAccount::validate_pda(city_account, city)?;

    // Increment season ID for this city
    let season_id = city.arena_season_id.saturating_add(1);
    city.arena_season_id = season_id;

    // 6. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 7. Verify and create Arena Season PDA
    let (expected_pda, bump) = ArenaSeasonAccount::derive_pda(authority.key(), season_id);
    if arena_season.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Check account doesn't already exist
    if !arena_season.data_is_empty() {
        return Err(GameError::ArenaSeasonAlreadyExists.into());
    }

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(ARENA_SEASON_ACCOUNT_SIZE);

    let bump_seed = [bump];
    let season_id_bytes = season_id.to_le_bytes();
    let seeds = pinocchio::seeds!(
        ARENA_SEASON_SEED,
        authority.key().as_ref(),
        &season_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: authority,
        to: arena_season,
        lamports,
        space: ARENA_SEASON_ACCOUNT_SIZE as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize ArenaSeasonAccount
    let mut data_ref = arena_season.try_borrow_mut_data()?;
    let season = unsafe { ArenaSeasonAccount::load_mut(&mut data_ref) };

    // Calculate timing
    let start_time = now;
    let end_time = now + ARENA_SEASON_DURATION;
    let claim_deadline = end_time + ARENA_CLAIM_DEADLINE;
    let current_day = (now / crate::constants::SECONDS_PER_DAY) as u32;

    *season = ArenaSeasonAccount {
        // Identity
        season_id,
        city_id,
        authority: *authority.key(),

        // Timing
        start_time,
        end_time,
        claim_deadline,
        status: ArenaStatus::Active as u8, // Start active immediately

        // Leaderboard
        leaderboard: [ArenaLeaderboardEntry::default(); 10],
        leaderboard_count: 0,
        leaderboard_claimed: [false; 10],

        // Prize Pool
        master_prize_pool,
        daily_prize_pool,
        daily_distribution_cap,
        distributed_today: 0,
        last_distribution_day: current_day,
        _padding1: [0; 4],
        prize_remaining: master_prize_pool,

        // Thresholds
        min_level_required,
        _padding2: [0; 7],
        min_points_for_leaderboard: ARENA_MIN_POINTS_FOR_LEADERBOARD,
        total_battles: 0,
        bump,
        _reserved: [0; 7],
    };

    Ok(())
}
