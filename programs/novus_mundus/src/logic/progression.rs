use crate::{
    error::GameError,
    logic::{get_time_multiplier_bp, get_time_of_day, safe_math::apply_bp, ActivityType},
    state::PlayerAccount,
};

/// XP required to advance *into* `level` (the per-level cost, deducted on level-up).
///
/// Growth base is the golden ratio φ ≈ 1.618 — matching the rest of the
/// deterministic progression math, and keeping mid/late levels reachable for a
/// steady free player (a ×2.5 base put level 21 at ~6 billion cumulative XP).
/// Level 1->2: 100 XP
/// Level 2->3: 161 XP
/// Level 3->4: 261 XP
/// Level 4->5: 423 XP
pub fn xp_required_for_level(level: u8) -> u64 {
    if level == 0 || level == 1 {
        return 0;
    }

    // Exponential formula: 100 * φ^(level-2)
    let base: f64 = 100.0;
    let exponent = (level as f64) - 2.0;

    (base * libm::pow(crate::constants::PHI, exponent)) as u64
}

/// Grant XP to player with time-of-day bonus and handle level-ups
///
/// Golden hours (Dawn/Dusk) provide φ² (2.618x) XP bonus for enlightenment!
/// Night time provides √φ (1.272x) bonus for wisdom.
///
/// # Arguments
/// * `player` - Mutable reference to PlayerAccount
/// * `base_xp` - Base XP amount before time bonus
/// * `now` - Current unix timestamp
///
/// # Returns
/// (levels_gained, new_level, overflow_xp)
pub fn grant_xp_with_time_bonus(
    player: &mut PlayerAccount,
    base_xp: u64,
    now: i64,
) -> Result<(u8, u8, u64), GameError> {
    let time_of_day = get_time_of_day(now, player.current_long);
    let xp_bp = get_time_multiplier_bp(time_of_day, ActivityType::XPGain) as u64;
    let time_xp = apply_bp(base_xp, xp_bp).unwrap_or(base_xp);

    // Apply hero XP gain buff (multiplicative)
    // Formula: xp × (10000 + hero_xp_gain_bps) / 10000
    let xp_amount = if player.hero_xp_gain_bps() > 0 {
        let hero_multiplier = 10000u64 + player.hero_xp_gain_bps() as u64;
        time_xp.saturating_mul(hero_multiplier) / 10000
    } else {
        time_xp
    };

    grant_xp(player, xp_amount)
}

/// Grant XP to player and handle level-ups (without time bonus)
/// Use grant_xp_with_time_bonus for time-aware XP grants.
/// Returns (levels_gained, new_level, overflow_xp)
pub fn grant_xp(player: &mut PlayerAccount, xp_amount: u64) -> Result<(u8, u8, u64), GameError> {
    let mut current_xp = player.current_xp.saturating_add(xp_amount);
    let mut current_level = player.level;
    let mut levels_gained = 0u8;

    // Check for level-ups
    loop {
        let xp_for_next = xp_required_for_level(current_level + 1);

        if current_xp >= xp_for_next && current_level < 255 {
            current_xp = current_xp.saturating_sub(xp_for_next);
            current_level += 1;
            levels_gained += 1;
        } else {
            break;
        }
    }

    // Update player state
    player.current_xp = current_xp;
    player.level = current_level;

    // Update max stamina on level-up
    if levels_gained > 0 {
        crate::logic::update_max_stamina_for_tier(player);
    }

    Ok((levels_gained, current_level, current_xp))
}

/// Calculate XP rewards for various actions
pub fn calculate_xp_reward(action: XpAction) -> u64 {
    match action {
        XpAction::DefeatPlayer { target_level } => {
            // More XP for defeating higher-level players
            50 + (target_level as u64 * 10)
        }
        XpAction::DefeatEncounter { rarity } => {
            // XP scales with encounter rarity
            match rarity {
                0 => 10,  // Common
                1 => 25,  // Uncommon
                2 => 50,  // Rare
                3 => 100, // Epic
                4 => 250, // Legendary
                5 => 500, // World Event
                _ => 0,
            }
        }
        XpAction::CompleteTravel { distance_km } => {
            // 1 XP per km traveled
            distance_km as u64
        }
        XpAction::CollectResources { amount } => {
            // 1 XP per 1000 resources collected
            amount / 1000
        }
    }
}

/// Actions that grant XP
pub enum XpAction {
    DefeatPlayer { target_level: u8 },
    DefeatEncounter { rarity: u8 },
    CompleteTravel { distance_km: u32 },
    CollectResources { amount: u64 },
}

/// Daily reward amounts (calculated with subscription tier multipliers)
pub struct DailyRewards {
    pub cash: u64,
    pub produce: u64,
    pub xp: u64,
}

/// Calculate daily rewards with subscription tier multipliers
///
/// Base values come from GameplayConfig (DAO-adjustable).
/// Multiplier comes from player's subscription tier (incentivizes higher tiers!).
///
/// # Arguments
/// * `player_tier` - Player's subscription tier (0-3)
/// * `gameplay_config` - GameplayConfig with base reward values
/// * `subscription_tiers` - Array of 4 subscription tier configs
///
/// # Returns
/// Daily reward amounts with tier multipliers applied
pub fn calculate_daily_rewards(
    player_tier: u8,
    gameplay_config: &crate::state::GameplayConfig,
    subscription_tiers: &[crate::state::SubscriptionTier; 4],
) -> Result<DailyRewards, GameError> {
    let base_cash = gameplay_config.daily_cash_base;
    let base_produce = gameplay_config.daily_produce_base;
    let base_xp = gameplay_config.daily_xp_base;

    // Get tier multiplier (tier 0-3, basis points: 10000 = 1.0x)
    let tier_index = player_tier.min(3) as usize;
    let tier = &subscription_tiers[tier_index];
    let multiplier = tier.daily_reward_multiplier;

    // Apply multiplier to all rewards (basis points: divide by 10000, no u128!)
    let cash = apply_bp(base_cash, multiplier as u64).ok_or(GameError::MathOverflow)?;

    let produce = apply_bp(base_produce, multiplier as u64).ok_or(GameError::MathOverflow)?;

    let xp = apply_bp(base_xp, multiplier as u64).ok_or(GameError::MathOverflow)?;

    Ok(DailyRewards { cash, produce, xp })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xp_required() {
        // 100 * φ^(level-2)
        assert_eq!(xp_required_for_level(1), 0);
        assert_eq!(xp_required_for_level(2), 100);
        assert_eq!(xp_required_for_level(3), 161);
        assert_eq!(xp_required_for_level(4), 261);
    }
}
