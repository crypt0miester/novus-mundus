use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    logic::{grant_xp_with_time_bonus, calculate_daily_rewards, safe_math::apply_bp_bonus},
    state::{PlayerAccount, GameEngine},
    validation::{require_signer, require_writable},
};

/// Claim daily reward
///
/// Players can claim daily rewards once per 24 hours.
/// Rewards include cash, produce, and XP.
///
/// Reward amounts are DAO-configurable (via GameplayConfig).
/// Higher subscription tiers get multipliers (e.g., Legendary gets 3x rewards!).
///
/// # Accounts
/// - [writable] player: PlayerAccount
/// - [writable] player_owner: Player's wallet
/// - [] game_engine: GameEngine (for reward config and subscription tier multipliers)
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        player_owner,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(player_owner)?;  // CRITICAL: Prevents anyone claiming rewards for others
    require_writable(player_owner)?;
    require_writable(player_account)?;

    // 3. Load Clock

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Accounts

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let mut game_engine_account_data = game_engine_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
    let game_engine_data = unsafe { GameEngine::load_mut(&mut game_engine_account_data) };

    // Verify ownership
    if &player_data.owner != player_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Check if Daily Rewards are Unlocked (Research System)

    // Check if player has unlocked daily rewards through research
    if !player_data.has_daily_rewards {
        return Err(GameError::FeatureLocked.into());
    }

    // 6. Check Cooldown (Using Research field)

    // Now using last_daily_claim field from research system
    let time_since_last_claim = now - player_data.last_daily_claim;
    let cooldown = game_engine_data.gameplay_config.daily_reward_cooldown;

    if time_since_last_claim < cooldown {
        return Err(GameError::ClaimCooldownActive.into());
    }

    // 7. Calculate Rewards with Subscription Tier Multipliers

    // Base values from GameplayConfig, multiplied by player's effective subscription tier
    // Higher tiers get better rewards! (Rookie: 1.0x, Expert: 1.5x, Epic: 2.0x, Legendary: 3.0x)
    // Note: Uses effective tier to handle expired subscriptions
    let effective_tier = player_data.get_effective_tier(now);
    let mut rewards = calculate_daily_rewards(
        effective_tier,
        &game_engine_data.gameplay_config,
        &game_engine_data.subscription_tiers,
    )?;

    // 8. Apply Research Buffs

    // Apply research daily reward multiplier (basis points, no u128!)
    // e.g., 35000 bps = 3.5x multiplier (level 7 Daily Rewards research)
    if player_data.research_daily_reward_bps > 0 {
        rewards.cash = apply_bp_bonus(rewards.cash, player_data.research_daily_reward_bps)
            .unwrap_or(rewards.cash);
        rewards.produce = apply_bp_bonus(rewards.produce, player_data.research_daily_reward_bps)
            .unwrap_or(rewards.produce);
        rewards.xp = apply_bp_bonus(rewards.xp, player_data.research_daily_reward_bps)
            .unwrap_or(rewards.xp);
    }

    // 9. Grant Rewards

    // Cash reward
    player_data.cash_on_hand = player_data.cash_on_hand
        .saturating_add(rewards.cash);

    // Produce reward
    player_data.produce = player_data.produce
        .saturating_add(rewards.produce);

    // XP reward (also handles level-ups) - with time-of-day bonus!
    // Golden hours (Dawn/Dusk) grant φ² bonus, night grants √φ bonus
    let (_levels_gained, _new_level, _overflow) = grant_xp_with_time_bonus(player_data, rewards.xp, now)?;

    // 10. Update Claim Timestamp

    // Update the research system's daily claim timestamp
    player_data.last_daily_claim = now;

    Ok(())
}
