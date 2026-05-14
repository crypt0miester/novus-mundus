//! Create Dungeon Leaderboard (Instruction 260)
//!
//! Creates a new weekly leaderboard for a dungeon. Permissionless crank.
//! The leaderboard for a given (dungeon_id, week_number) can only be created once.
//! KINGDOM-SCOPED: Each kingdom has its own dungeon leaderboards.
//!
//! # Accounts
//! 0. `[SIGNER, WRITE]` payer: Pays for account creation
//! 1. `[]` dungeon_template: DungeonTemplate PDA (verifies dungeon exists)
//! 2. `[WRITE]` leaderboard: DungeonLeaderboard PDA (to be created)
//! 3. `[]` game_engine: GameEngine PDA (for kingdom scoping)
//! 4. `[]` system_program: System program
//!
//! # Instruction Data
//! - dungeon_id: u16 (2 bytes)
//! - week_number: u16 (2 bytes) - must be current week or future
//! - prize_pool: u64 (8 bytes) - initial prize pool (optional, can be 0)

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::DUNGEON_LEADERBOARD_SEED,
    error::GameError,
    state::{DungeonTemplate, DungeonLeaderboard, GameEngine},
    validation::{require_signer, require_writable},
    emit,
    events::KingdomDungeonLeaderboardCreated,
};

/// Seconds per week (7 days)
const SECONDS_PER_WEEK: i64 = 7 * 24 * 60 * 60;

/// Calculate current week number from timestamp
fn get_week_number(timestamp: i64) -> u16 {
    (timestamp / SECONDS_PER_WEEK) as u16
}

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        payer,
        dungeon_template_account,
        leaderboard_account,
        game_engine,
        _system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate signer
    require_signer(payer)?;
    require_writable(payer)?;
    require_writable(leaderboard_account)?;

    // 3. Parse instruction data
    if instruction_data.len() < 12 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let dungeon_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let week_number = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
    let prize_pool = u64::from_le_bytes([
        instruction_data[4], instruction_data[5], instruction_data[6], instruction_data[7],
        instruction_data[8], instruction_data[9], instruction_data[10], instruction_data[11],
    ]);

    // 4. Validate dungeon exists
    let _template = DungeonTemplate::load_checked(dungeon_template_account, dungeon_id, program_id)?;

    // 4b. Load GameEngine for kingdom_id
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let kingdom_id = {
        let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
        game_engine_data.kingdom_id
    };

    // 5. Validate week number is current or future
    let clock = Clock::get()?;
    let current_week = get_week_number(clock.unix_timestamp);

    if week_number < current_week {
        return Err(GameError::InvalidParameter.into()); // Can't create past leaderboards
    }

    // 6. Verify leaderboard doesn't already exist
    if leaderboard_account.lamports() > 0 {
        return Err(GameError::AccountAlreadyExists.into());
    }

    // 7. Verify PDA (kingdom-scoped)
    let (expected_pda, bump) = DungeonLeaderboard::derive_pda(game_engine.address(), dungeon_id, week_number);
    if leaderboard_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 8. Create account
    let lamports = crate::utils::rent_exempt_const(DungeonLeaderboard::LEN);

    let dungeon_id_bytes = dungeon_id.to_le_bytes();
    let week_bytes = week_number.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        DUNGEON_LEADERBOARD_SEED,
        game_engine.address(),
        &dungeon_id_bytes,
        &week_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: leaderboard_account,
        lamports,
        space: DungeonLeaderboard::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 9. Initialize leaderboard
    let mut lb_data = leaderboard_account.try_borrow_mut()?;
    let leaderboard = unsafe { DungeonLeaderboard::load_mut(&mut lb_data) };

    leaderboard.account_key = crate::state::AccountKey::DungeonLeaderboard as u8;
    leaderboard.game_engine = *game_engine.address();
    leaderboard.dungeon_id = dungeon_id;
    leaderboard.week_number = week_number;
    leaderboard.leaderboard_count = 0;
    leaderboard.bump = bump;
    leaderboard.claimed_mask = 0;
    leaderboard.prize_pool = prize_pool;

    // Initialize empty leaderboard entries
    for i in 0..10 {
        leaderboard.leaderboard[i].player = pinocchio::Address::new_from_array([0u8; 32]);
        leaderboard.leaderboard[i].score = 0;
    }

    // Emit KingdomDungeonLeaderboardCreated event
    emit!(KingdomDungeonLeaderboardCreated {
        kingdom_id,
        game_engine: *game_engine.address(),
        dungeon_id,
        week_number,
        prize_pool,
    });

    Ok(())
}
