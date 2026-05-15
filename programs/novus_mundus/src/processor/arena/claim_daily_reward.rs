//! Claim Daily Arena Reward (Instruction 234)
//!
//! Claims daily participation reward for a player. Permissionless - can be called by anyone.
//! Requires minimum 5 battles in rolling 24h window.
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
    AccountView,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::{
        SECONDS_PER_DAY, ARENA_MIN_BATTLES_FOR_DAILY_REWARD, ARENA_MAX_DAILY_BATTLES,
        ARENA_DAILY_BASE_REWARD, GAME_ENGINE_SEED,
    },
    error::GameError,
    state::{ArenaSeasonAccount, ArenaParticipantAccount, ArenaStatus, PlayerAccount, GameEngine},
    validation::{require_owner, require_writable, require_key_match, require_data_len},
    helpers::{mint_tokens, validate_token_account_owner},
    utils::read_u32,
};

/// Instruction data for claim_daily_reward
/// - season_id: u32 (4 bytes)
/// Total: 4 bytes
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        participant_account,
        arena_season,
        player_account,
        player_owner,
        player_novi_ata,
        novi_mint,
        game_engine,
        token_program,
    ]);

    // 2. Validate token accounts
    require_writable(player_novi_ata)?;
    require_writable(novi_mint)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "claim_daily_reward.novi_mint",
        GameError::InvalidMint,
    );
    require_key_match(token_program, &pinocchio_token::ID)?;

    // Verify token account belongs to the PlayerAccount PDA
    validate_token_account_owner(player_novi_ata, player_account.address())?;

    // 3. Parse Instruction Data (4 bytes minimum)
    let season_id = read_u32(instruction_data, 0, "claim_daily_reward.season_id")?;

    // 4. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let today = (now / SECONDS_PER_DAY) as u32;

    // 5. Load Arena Season
    require_owner(arena_season, program_id)?;
    require_data_len(arena_season, ArenaSeasonAccount::LEN)?;
    let mut season_data = arena_season.try_borrow_mut()?;
    let season = unsafe { &mut *(season_data.as_mut_ptr() as *mut ArenaSeasonAccount) };

    // Verify season_id
    if season.season_id != season_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Season must be active
    if season.status != ArenaStatus::Active as u8 {
        return Err(GameError::ArenaSeasonNotActive.into());
    }

    let _season_authority = season.authority;

    // Check and reset daily distribution counter if new day
    season.check_and_reset_daily(today);

    // Check if daily pool has remaining funds
    let remaining_today = season.daily_distribution_cap
        .saturating_sub(season.distributed_today);
    if remaining_today == 0 {
        return Err(GameError::ArenaDailyPoolExhausted.into());
    }

    // 6. Load Participant using player_account PDA for derivation (kingdom-scoped)
    let mut participant = ArenaParticipantAccount::load_checked_mut(
        participant_account,
        game_engine.address(),
        season_id,
        player_account.address(),
        program_id,
    )?;

    // Check if already claimed today
    if participant.daily_reward_claimed_day == today {
        return Err(GameError::ArenaDailyRewardAlreadyClaimed.into());
    }

    // Count battles in rolling 24h window
    let battles_today = participant.count_battles_in_window(now, SECONDS_PER_DAY);

    // Must have minimum battles to claim
    if battles_today < ARENA_MIN_BATTLES_FOR_DAILY_REWARD {
        return Err(GameError::ArenaMinBattlesNotMet.into());
    }

    // 7. Calculate daily reward using SEASON CUMULATIVE wins/losses
    let base_reward = calculate_daily_reward(
        battles_today,
        participant.wins,
        participant.losses,
    );

    // Cap to remaining daily pool and overall daily pool
    let actual_reward = base_reward
        .min(remaining_today)
        .min(season.daily_prize_pool);

    // 8. Update participant
    participant.daily_reward_claimed_day = today;

    drop(participant);

    // 9. Update season
    season.distributed_today = season.distributed_today.saturating_add(actual_reward);
    season.daily_prize_pool = season.daily_prize_pool.saturating_sub(actual_reward);

    drop(season_data);

    // 10. Load GameEngine for mint authority (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
    let bump_seed = [game_engine_data.bump];
    let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
    let seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);
    drop(game_engine_data);

    // 11. Mint NOVI tokens to player's token account
    mint_tokens(
        novi_mint,
        player_novi_ata,
        game_engine,
        actual_reward,
        &[signer],
    )?;

    // 12. Update player's locked_novi balance (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut(player_account, game_engine.address(), player_owner.address(), program_id)?;
    player.locked_novi = player.locked_novi.saturating_add(actual_reward);

    Ok(())
}

/// Calculate daily reward based on battles fought and season win rate
fn calculate_daily_reward(battles_fought_today: u8, season_wins: u32, season_losses: u32) -> u64 {
    // Scale by battles fought TODAY (5-10 maps to 0.5x-1.0x)
    let battle_multiplier = (battles_fought_today as u64)
        .saturating_mul(10_000)
        .checked_div(ARENA_MAX_DAILY_BATTLES as u64)
        .unwrap_or(0);

    // Win rate bonus based on SEASON CUMULATIVE performance
    // This rewards consistent play - if you skip days, your win rate stays low
    let total = season_wins.saturating_add(season_losses);
    let win_rate_bps = if total > 0 {
        (season_wins as u64)
            .saturating_mul(10_000)
            .checked_div(total as u64)
            .unwrap_or(5000)
            .max(5000)
    } else {
        5000 // No battles yet = neutral 50%
    };
    let win_bonus = win_rate_bps.saturating_sub(5000); // 0-5000 bonus

    // Apply multipliers to base reward
    let reward = ARENA_DAILY_BASE_REWARD
        .saturating_mul(battle_multiplier)
        .checked_div(10_000)
        .unwrap_or(0);

    let bonus = reward
        .saturating_mul(win_bonus)
        .checked_div(10_000)
        .unwrap_or(0);

    reward.saturating_add(bonus)
}
