//! Claim Master Arena Reward (Instruction 235)
//!
//! Top 10 leaderboard players claim their master reward after season ends.
//! Can only be claimed once per player per season, before claim deadline.
//! Permissionless - can be called by anyone.
//!
//! # Accounts
//! 0. `[WRITE]` participant_account: ArenaParticipantAccount
//! 1. `[WRITE]` arena_season: ArenaSeasonAccount
//! 2. `[WRITE]` player_account: PlayerAccount (receives locked_novi)
//! 3. `[]` player_owner: Wallet that owns the player account
//! 4. `[WRITE]` player_novi_ata: Player's NOVI token account
//! 5. `[WRITE]` novi_mint: NOVI mint
//! 6. `[]` game_engine: GameEngine PDA (mint authority)
//! 7. `[]` token_program: Token program

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::{ARENA_PRIZE_DISTRIBUTION, GAME_ENGINE_SEED},
    error::GameError,
    state::{ArenaSeasonAccount, ArenaParticipantAccount, ArenaStatus, PlayerAccount, GameEngine},
    validation::{require_owner, require_writable, require_key_match, require_data_len},
    helpers::{mint_tokens, validate_token_account_owner},
};

/// Instruction data for claim_master_reward
/// - season_id: u32 (4 bytes)
/// Total: 4 bytes
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        participant_account,
        arena_season,
        player_account,
        player_owner,
        player_novi_ata,
        novi_mint,
        game_engine,
        token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate token accounts
    require_writable(player_novi_ata)?;
    require_writable(novi_mint)?;
    require_key_match(token_program, &pinocchio_token::ID)?;

    // SECURITY: Verify token account belongs to the PlayerAccount PDA
    validate_token_account_owner(player_novi_ata, player_account.key())?;

    // 3. Parse Instruction Data (4 bytes minimum)
    if instruction_data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let season_id = u32::from_le_bytes([
        instruction_data[0], instruction_data[1],
        instruction_data[2], instruction_data[3],
    ]);

    // 4. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load Arena Season
    require_owner(arena_season, program_id)?;
    require_data_len(arena_season, ArenaSeasonAccount::LEN)?;
    let mut season_data = arena_season.try_borrow_mut_data()?;
    let season = unsafe { &mut *(season_data.as_mut_ptr() as *mut ArenaSeasonAccount) };

    // Verify season_id
    if season.season_id != season_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Season must be finalized (or later)
    if season.status < ArenaStatus::Finalized as u8 {
        return Err(GameError::ArenaSeasonNotFinalized.into());
    }

    // Must be before claim deadline
    if now > season.claim_deadline {
        return Err(GameError::ArenaClaimDeadlinePassed.into());
    }

    let _season_authority = season.authority;

    // 6. Load Participant using player_account PDA for derivation (kingdom-scoped)
    let mut participant = ArenaParticipantAccount::load_checked_mut(
        participant_account,
        game_engine.key(),
        season_id,
        player_account.key(),
        program_id,
    )?;

    // Check if already claimed
    if participant.master_reward_claimed {
        return Err(GameError::ArenaMasterRewardAlreadyClaimed.into());
    }

    // 7. Find player's rank on leaderboard
    let player_key = participant.player;
    let mut rank: Option<usize> = None;

    for i in 0..season.leaderboard_count as usize {
        if season.leaderboard[i].player == player_key {
            rank = Some(i);
            break;
        }
    }

    // Must be on leaderboard to claim master reward
    let rank_idx = match rank {
        Some(idx) => idx,
        None => return Err(GameError::ArenaNotOnLeaderboard.into()),
    };

    // Check if this rank's reward was already claimed (shouldn't happen with bump check, but safety)
    if season.leaderboard_claimed[rank_idx] {
        return Err(GameError::ArenaMasterRewardAlreadyClaimed.into());
    }

    // 8. Calculate reward based on rank (safe math)
    let prize_bps = ARENA_PRIZE_DISTRIBUTION[rank_idx] as u64;
    let reward = season.master_prize_pool
        .saturating_mul(prize_bps)
        .checked_div(10_000)
        .unwrap_or(0);

    // 9. Update participant
    participant.master_reward_claimed = true;

    drop(participant);

    // 10. Update season
    season.leaderboard_claimed[rank_idx] = true;
    season.prize_remaining = season.prize_remaining.saturating_sub(reward);

    drop(season_data);

    // 11. Load GameEngine for mint authority (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
    let bump_seed = [game_engine_data.bump];
    let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
    let seeds = pinocchio::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);
    drop(game_engine_data);

    // 12. Mint NOVI tokens to player's token account
    mint_tokens(
        novi_mint,
        player_novi_ata,
        game_engine,
        reward,
        &[signer],
    )?;

    // 13. Update player's locked_novi balance (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut(player_account, game_engine.key(), player_owner.key(), program_id)?;
    player.locked_novi = player.locked_novi.saturating_add(reward);

    Ok(())
}
