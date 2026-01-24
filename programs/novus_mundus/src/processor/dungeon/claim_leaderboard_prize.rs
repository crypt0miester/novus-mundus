//! Claim Dungeon Leaderboard Prize (Instruction 259)
//!
//! Top 10 leaderboard players claim their weekly prize after the week ends.
//! Can only be claimed once per player per week.
//!
//! # Accounts
//! 0. `[SIGNER]` owner: Player's wallet
//! 1. `[WRITE]` player_account: PlayerAccount PDA
//! 2. `[WRITE]` leaderboard: DungeonLeaderboard PDA
//! 3. `[WRITE]` player_novi_ata: Player's NOVI token account
//! 4. `[WRITE]` novi_mint: NOVI mint
//! 5. `[]` game_engine: GameEngine PDA (mint authority)
//! 6. `[]` token_program: Token program
//!
//! # Instruction Data
//! - dungeon_id: u16 (2 bytes)
//! - week_number: u16 (2 bytes)

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::{PRIZE_DISTRIBUTION, GAME_ENGINE_SEED},
    error::GameError,
    state::{PlayerAccount, DungeonLeaderboard, GameEngine},
    validation::{require_signer, require_writable, require_owner, require_key_match, require_data_len},
    helpers::{mint_tokens, validate_token_account_owner},
    emit,
    events::DungeonLeaderboardPrizeClaimed,
};

/// Seconds per week (7 days)
const SECONDS_PER_WEEK: i64 = 7 * 24 * 60 * 60;

/// Calculate current week number from timestamp
fn get_week_number(timestamp: i64) -> u16 {
    // Week starts from Unix epoch (Thursday Jan 1, 1970)
    // For game purposes, we use simple week calculation
    (timestamp / SECONDS_PER_WEEK) as u16
}

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        owner,
        player_account,
        leaderboard_account,
        player_novi_ata,
        novi_mint,
        game_engine,
        token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate signer and writables
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(leaderboard_account)?;
    require_writable(player_novi_ata)?;
    require_writable(novi_mint)?;
    require_key_match(token_program, &pinocchio_token::ID)?;

    // SECURITY: Verify token account belongs to the PlayerAccount PDA
    validate_token_account_owner(player_novi_ata, player_account.key())?;

    // 3. Parse instruction data
    if instruction_data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let dungeon_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let week_number = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);

    // 4. Load clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let current_week = get_week_number(now);

    // Verify week has ended (can only claim past weeks)
    if week_number >= current_week {
        return Err(GameError::LeaderboardWeekNotEnded.into());
    }

    // 5. Load player
    let mut player = PlayerAccount::load_checked_mut(player_account, owner.key(), program_id)?;

    // 6. Load and validate leaderboard PDA
    require_owner(leaderboard_account, program_id)?;

    let (expected_pda, lb_bump) = DungeonLeaderboard::derive_pda(dungeon_id, week_number);
    if leaderboard_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_data_len(leaderboard_account, DungeonLeaderboard::LEN)?;
    let mut lb_data = leaderboard_account.try_borrow_mut_data()?;
    let leaderboard = unsafe { DungeonLeaderboard::load_mut(&mut lb_data) };

    // Verify leaderboard matches
    if leaderboard.dungeon_id != dungeon_id || leaderboard.week_number != week_number {
        return Err(GameError::InvalidParameter.into());
    }

    // Verify bump matches
    if leaderboard.bump != lb_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Find player's rank on leaderboard
    let rank = leaderboard.find_rank(player_account.key())
        .ok_or(GameError::NotOnLeaderboard)?;

    // Check if already claimed
    if leaderboard.is_claimed(rank) {
        return Err(GameError::LeaderboardPrizeAlreadyClaimed.into());
    }

    // 8. Calculate prize based on rank
    let prize_bps = PRIZE_DISTRIBUTION[rank] as u64;
    let prize_amount = leaderboard.prize_pool
        .saturating_mul(prize_bps)
        .checked_div(10_000)
        .unwrap_or(0);

    // Get score for event
    let score = leaderboard.leaderboard[rank].score;

    // 9. Mark as claimed
    leaderboard.mark_claimed(rank);

    // Store player name for event
    let player_name = player.name;

    // Drop borrows before CPI
    drop(lb_data);

    // 10. Load GameEngine for mint authority
    let game_engine_data = GameEngine::load_checked(game_engine, program_id)?;
    let bump_seed = [game_engine_data.bump];
    let seeds = pinocchio::seeds!(GAME_ENGINE_SEED, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);
    drop(game_engine_data);

    // 11. Mint NOVI tokens to player's token account
    if prize_amount > 0 {
        mint_tokens(
            novi_mint,
            player_novi_ata,
            game_engine,
            prize_amount,
            &[signer],
        )?;

        // Update player's locked_novi balance
        player.locked_novi = player.locked_novi.saturating_add(prize_amount);
    }

    drop(player);

    // 12. Emit event
    emit!(DungeonLeaderboardPrizeClaimed {
        player: *player_account.key(),
        player_name,
        dungeon_id,
        week_number,
        rank: rank as u8,
        score,
        prize_amount,
        timestamp: now,
    });

    Ok(())
}
