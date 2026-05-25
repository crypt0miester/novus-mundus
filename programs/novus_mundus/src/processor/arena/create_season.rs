//! Create Arena Season (Instruction 230)
//! KINGDOM-SCOPED: Arena seasons exist within a kingdom
//!
//! Creates a new arena season for a kingdom. Only callable by DAO authority.
//! Auto-increments the season_id within the kingdom.
//!
//! # Accounts
//! 0. `[WRITE]` arena_season: ArenaSeasonAccount PDA (to be created)
//! 1. `[SIGNER, WRITE]` authority: Season authority (DAO)
//! 2. `[]` game_engine: GameEngine PDA (for kingdom scoping)
//! 3. `[]` system_program: System program

use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        ARENA_CLAIM_DEADLINE, ARENA_MIN_POINTS_FOR_LEADERBOARD, ARENA_SEASON_DURATION,
        ARENA_SEASON_SEED,
    },
    emit,
    error::GameError,
    events::KingdomArenaSeasonStarted,
    state::{
        ArenaLeaderboardEntry, ArenaSeasonAccount, ArenaStatus, GameEngine,
        ARENA_SEASON_ACCOUNT_SIZE,
    },
    utils::{read_u32, read_u64, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};

/// Instruction data for create_season
/// - season_id: u32 (4 bytes) - Season identifier within kingdom
/// - master_prize_pool: u64 (8 bytes)
/// - daily_prize_pool: u64 (8 bytes)
/// - daily_distribution_cap: u64 (8 bytes)
/// - min_level_required: u8 (1 byte)
/// Total: 29 bytes
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        arena_season,
        authority,
        game_engine,
        system_program,
    ]);

    // 2. Validate Accounts
    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(arena_season)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Load and validate GameEngine - authority must be game authority (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
    if authority.address() != &game_engine_data.game_authority {
        return Err(GameError::Unauthorized.into());
    }
    let kingdom_id = game_engine_data.kingdom_id;

    // 4. Parse Instruction Data (29 bytes minimum)
    let season_id = read_u32(instruction_data, 0, "create_season.season_id")?;

    let master_prize_pool = read_u64(instruction_data, 4, "create_season.master_prize_pool")?;

    let daily_prize_pool = read_u64(instruction_data, 12, "create_season.daily_prize_pool")?;

    let daily_distribution_cap =
        read_u64(instruction_data, 20, "create_season.daily_distribution_cap")?;

    let min_level_required = read_u8(instruction_data, 28, "create_season.min_level_required")?;

    // 5. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 6. Verify and create Arena Season PDA (kingdom-scoped)
    let (expected_pda, bump) = ArenaSeasonAccount::derive_pda(game_engine.address(), season_id);
    if arena_season.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Check account doesn't already exist
    if !arena_season.is_data_empty() {
        return Err(GameError::ArenaSeasonAlreadyExists.into());
    }
    let lamports = crate::utils::rent_exempt_const(ARENA_SEASON_ACCOUNT_SIZE);

    let bump_seed = [bump];
    let season_id_bytes = season_id.to_le_bytes();
    let seeds = crate::seeds!(
        ARENA_SEASON_SEED,
        game_engine.address(),
        &season_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: authority,
        to: arena_season,
        lamports,
        space: ARENA_SEASON_ACCOUNT_SIZE as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 7. Initialize ArenaSeasonAccount
    let mut data_ref = arena_season.try_borrow_mut()?;
    let season = unsafe { ArenaSeasonAccount::load_mut(&mut data_ref) };

    // Calculate timing
    let start_time = now;
    let end_time = now + ARENA_SEASON_DURATION;
    let claim_deadline = end_time + ARENA_CLAIM_DEADLINE;
    let current_day = (now / crate::constants::SECONDS_PER_DAY) as u32;

    *season = ArenaSeasonAccount {
        account_key: crate::state::AccountKey::ArenaSeason as u8,
        // Kingdom reference
        game_engine: *game_engine.address(),

        // Identity
        season_id,
        city_id: 0, // 0 = kingdom-wide arena
        authority: *authority.address(),

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

    // Emit KingdomArenaSeasonStarted event
    emit!(KingdomArenaSeasonStarted {
        kingdom_id,
        game_engine: *game_engine.address(),
        season_id,
        start_time,
        end_time,
        prize_pool: master_prize_pool,
    });

    Ok(())
}
