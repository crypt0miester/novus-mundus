use crate::{
    logic::{
        is_fibonacci,
        safe_math::{apply_bp, chain_bp},
    },
    state::EconomicConfig,
};

/// Calculate consumption value from locked NOVI amount (Deterministic System)
///
/// This is PURE LOGIC - no token burning happens here, just calculation.
/// The actual SPL burning must happen in the processor layer.
///
/// # Deterministic Formula (Golden Ratio Based)
/// ```text
/// base_multiplier = novi_consumption_base from config (13.75x = 137500 bp)
/// secondary_multiplier = secondary_multiplier_base from config (√φ = 1.272x = 12720 bp)
/// base = amount × base_multiplier × secondary_multiplier × synchrony
/// final = base × fibonacci_bonus_base if fibonacci amount, else base
/// ```
///
/// # No Randomness - Fully Deterministic
/// - Uses single base values from config (no min/max ranges!)
/// - Fibonacci bonus uses φ (golden ratio) = 1.618x from config
/// - Time-of-day variance applied at processor layer
/// - All calculations fully reproducible
///
/// # Arguments
/// * `novi_amount` - Amount of NOVI to consume
/// * `synchrony` - Synchrony multiplier (1.0 = no bonus)
/// * `economic_config` - GameEngine economic configuration
///
/// # Returns
/// Generated power/value from consuming the NOVI
///
/// # Example
/// ```ignore
/// let power = consume_novi_logic(100, 10000, &economic_config);
/// // power is fully deterministic
/// ```
pub fn consume_novi_logic(
    novi_amount: u64,
    synchrony_bp: u32,
    economic_config: &EconomicConfig,
) -> u64 {
    // Base multiplier: Direct from config (deterministic, no min/max!)
    // Default: 137500 bp = 13.75x
    let base_mult_bp = economic_config.novi_consumption_base;

    // Secondary multiplier: Direct from config (deterministic, no min/max!)
    // Default: 12720 bp = √φ = 1.272x (golden ratio harmony)
    let secondary_mult_bp = economic_config.secondary_multiplier_base as u64;

    // Calculate base consumption value using interleaved multiply/divide (no u128!)
    // Formula: novi × base_mult / 10000 × secondary_mult / 10000 × synchrony / 10000
    let base_value = chain_bp(
        novi_amount,
        &[base_mult_bp, secondary_mult_bp, synchrony_bp as u64],
    )
    .unwrap_or(0);

    // Apply Fibonacci bonus deterministically using golden ratio from config
    // Default: φ = 1.618x = 16180 bp for exact Fibonacci matches
    if is_fibonacci(novi_amount) {
        let fibonacci_bonus_bp = economic_config.fibonacci_bonus_base as u64;
        apply_bp(base_value, fibonacci_bonus_bp).unwrap_or(base_value)
    } else {
        base_value
    }
}

/// Calculate synchrony factor for a player
///
/// Synchrony affects consumption efficiency and combat outcomes.
///
/// All bonuses are configured via GameEngine (DAO-controlled, using basis points).
///
/// # Formula
/// ```text
/// base = 10000 (100% = 1.0x)
/// + subscription_tier_bonus (from SubscriptionTier config)
/// + happiness_bonus (0 to happiness_synchrony_max based on average happiness)
/// + reputation_bonus (from reputation_synchrony_bonuses array)
/// + level_bonus (level * level_synchrony_bonus_per_level)
/// ```
///
/// # Arguments
/// * `player` - Player account with stats
/// * `gameplay_config` - GameplayConfig with synchrony bonus settings
/// * `subscription_tiers` - Array of 4 subscription tiers with synchrony bonuses
/// * `now` - Current timestamp for subscription expiration check
///
/// # Returns
/// Synchrony multiplier (1.0 = base, higher = better)
pub fn calculate_synchrony(
    player: &crate::state::PlayerAccount,
    gameplay_config: &crate::state::GameplayConfig,
    subscription_tiers: &[crate::state::SubscriptionTier; 4],
    now: i64,
) -> u32 {
    let mut synchrony_bp = 10000u32; // Start at 100% = 1.0x (in basis points)

    // 1. Subscription tier bonus (from tier config, using effective tier for expiration)
    let tier_index = player.get_effective_tier(now) as usize;
    synchrony_bp = synchrony_bp.saturating_add(subscription_tiers[tier_index].synchrony_bonus);

    // 2. Happiness bonus (0 to happiness_synchrony_max based on average happiness)
    // Average both defensive and operative happiness (0.0-1.0 scale)
    let avg_happiness = (player.happiness_defensive + player.happiness_operative) / 2.0;
    let happiness_bonus = ((avg_happiness * gameplay_config.happiness_synchrony_max as f32) as u32)
        .min(gameplay_config.happiness_synchrony_max);
    synchrony_bp = synchrony_bp.saturating_add(happiness_bonus);

    // 3. Reputation bonus (from config array)
    // Reputation ranks: Novice(0), Skilled(1k), Veteran(5k), Elite(20k), Legendary(100k)
    let reputation_bonus = if player.reputation >= 100_000 {
        gameplay_config.reputation_synchrony_bonuses[4] // Legendary
    } else if player.reputation >= 20_000 {
        gameplay_config.reputation_synchrony_bonuses[3] // Elite
    } else if player.reputation >= 5_000 {
        gameplay_config.reputation_synchrony_bonuses[2] // Veteran
    } else if player.reputation >= 1_000 {
        gameplay_config.reputation_synchrony_bonuses[1] // Skilled
    } else {
        gameplay_config.reputation_synchrony_bonuses[0] // Novice
    };
    synchrony_bp = synchrony_bp.saturating_add(reputation_bonus);

    // 4. Level bonus (level * level_synchrony_bonus_per_level)
    let level_bonus =
        (player.level as u32).saturating_mul(gameplay_config.level_synchrony_bonus_per_level);
    synchrony_bp = synchrony_bp.saturating_add(level_bonus);

    // Synchrony multiplier in basis points (10000 = 1.0x).
    synchrony_bp
}
