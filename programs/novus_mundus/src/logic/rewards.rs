use crate::state::{EconomicConfig, GameplayConfig, EncounterAccount};
use crate::constants::GOLDEN_ROOT;
use crate::logic::{get_time_of_day, get_time_multiplier, ActivityType};
use crate::logic::safe_math::{apply_bp, chain_bp};

/// Calculate oscillating multiplier for encounter rewards
///
/// Uses deterministic sine wave based on:
/// - Current timestamp (when encounter dies)
/// - Encounter spawn time (phase shift - prevents manipulation)
/// - Encounter ID (additional entropy)
/// - Rarity-based frequency and amplitude
///
/// # Security Features
/// - Deterministic (same inputs = same output)
/// - Phase shift prevents "waiting for peak" exploitation
/// - Can't be simulated off-chain (don't know exact death time)
///
/// # Returns
/// Multiplier in basis points (10000 = 1.0x, 15000 = 1.5x)
pub fn calculate_oscillation_multiplier(
    current_time: i64,
    spawn_time: i64,
    encounter_id: u64,
    frequency: f32,
    amplitude_bp: u32,
) -> u32 {
    // Phase shift based on spawn time + encounter ID (prevents timing attacks)
    let phase_shift = (spawn_time as f64 / 1000.0) + (encounter_id as f64 / 100.0);

    // Calculate oscillation: sin(time * frequency * 2π + phase)
    let time = (current_time as f64 / 1000.0) + phase_shift; // Convert to seconds
    let oscillation = libm::sin(time * (frequency as f64) * 2.0 * core::f64::consts::PI); // [-1, 1]

    // Map oscillation [-1, 1] to [base - amplitude, base + amplitude]
    // oscillation * amplitude_bp gives the deviation from 10000 (1.0x)
    let deviation = (oscillation * amplitude_bp as f64) as i32;
    let multiplier = (10000i32 + deviation) as u32;

    // Clamp to reasonable range (0.2x to 2.0x)
    multiplier.max(2000).min(20000)
}

/// Calculate level scaling multiplier (exponential growth)
///
/// Formula: (level ^ exponent) / divisor
///
/// # Example
/// - Level 1: (1^1.5) / 10 = 0.1 → 1000 bp (0.1x)
/// - Level 10: (10^1.5) / 10 = 3.16 → 31600 bp (3.16x)
/// - Level 50: (50^1.5) / 10 = 35.35 → 353500 bp (35.35x)
/// - Level 100: (100^1.5) / 10 = 100 → 1000000 bp (100x)
///
/// # Returns
/// Multiplier in basis points (10000 = 1.0x)
pub fn calculate_level_multiplier(
    level: u8,
    scaling_exp: f32,
    scaling_divisor: u32,
) -> u64 {
    if level == 0 || scaling_divisor == 0 {
        return 10000; // 1.0x fallback
    }

    // Use f64 for precision
    let level_f = level as f64;
    let scaled = libm::pow(level_f, scaling_exp as f64);
    let multiplier_f = scaled / scaling_divisor as f64;

    // Convert to basis points (1.0 = 10000)
    (multiplier_f * 10000.0) as u64
}

/// Determine if Novi should be awarded (Deterministic System)
///
/// Uses golden ratio family for deterministic thresholds based on level + rarity.
/// No randomness - higher level + rarity = guaranteed Novi above thresholds.
///
/// # Thresholds (using golden ratio)
/// - Level >= 61 AND rarity >= 3 (Epic): Always award Novi (φ² tier)
/// - Level >= 41 AND rarity >= 2 (Rare): Always award Novi (φ tier)
/// - Level >= 21 AND rarity >= 1 (Uncommon): Award Novi (√φ tier)
/// - Level < 21 OR Common: No Novi
///
/// # Returns
/// true if Novi should be awarded
pub fn should_award_novi(level: u8, rarity: u8) -> bool {
    // Deterministic thresholds based on level + rarity tiers
    // Uses golden ratio progression for tier unlocks

    // φ² tier (Legendary/Epic at high levels): Always Novi
    if level >= 61 && rarity >= 3 {
        return true;
    }

    // φ tier (Rare+ at mid-high levels): Always Novi
    if level >= 41 && rarity >= 2 {
        return true;
    }

    // √φ tier (Uncommon+ at mid levels): Novi awarded
    if level >= 21 && rarity >= 1 {
        return true;
    }

    // Below threshold: No Novi (deterministic)
    false
}

/// Determine number of reward types based on level (Deterministic System)
///
/// Uses level-based thresholds with no randomness.
/// Higher levels unlock more reward types deterministically.
///
/// - Level 1-5: 1 type (cash only)
/// - Level 6-15: 2 types (cash + produce)
/// - Level 16-30: 3 types (cash + produce + weapons)
/// - Level 31-50: 4 types
/// - Level 51+: 5 types (all types)
pub fn calculate_reward_type_count(level: u8) -> u8 {
    if level < 6 {
        1 // Cash only
    } else if level < 16 {
        2 // Cash + produce
    } else if level < 31 {
        3 // Cash + produce + weapons
    } else if level < 51 {
        4 // + vehicles
    } else {
        5 // All types
    }
}

/// Determine which reward types to award (Deterministic System)
///
/// No randomness - rewards are based purely on level thresholds.
/// Higher levels unlock more reward types deterministically.
///
/// # Priority order (lower levels unlock basic resources first)
/// 1. Cash (always)
/// 2. Produce (level 3+)
/// 3. Weapons (level 5+)
/// 4. Vehicles (level 20+)
/// 5. Novi (based on should_award_novi threshold)
///
/// # Returns
/// (award_produce, award_weapons, award_vehicles, award_novi)
pub fn determine_reward_types(
    level: u8,
    _type_count: u8,
    award_novi: bool,
) -> (bool, bool, bool, bool) {
    // Deterministic: level thresholds unlock reward types
    let award_produce = level >= 3;
    let award_weapons = level >= 5;
    let award_vehicles = level >= 20;

    (award_produce, award_weapons, award_vehicles, award_novi)
}


/// Determine if fragments should be awarded (Deterministic System)
///
/// Uses level + rarity thresholds with no randomness.
/// Fragments drop based on tier thresholds (similar to Novi but easier).
///
/// # Thresholds
/// - Level >= 31 AND rarity >= 2 (Rare): Always fragments
/// - Level >= 16 AND rarity >= 1 (Uncommon): Always fragments
/// - Level >= 1 AND has_fragment_drops: Always fragments (research unlock)
pub fn should_award_fragments(level: u8, rarity: u8, has_fragment_drops: bool, _drop_rate_bonus_bps: u16) -> bool {
    // Must have unlocked fragment drops via research
    if !has_fragment_drops {
        return false;
    }

    // Deterministic: if research unlocked, fragments always drop based on tier
    // Higher level/rarity = guaranteed, but even low level gets fragments with research

    // φ² tier: High level + rare = guaranteed
    if level >= 31 && rarity >= 2 {
        return true;
    }

    // φ tier: Mid level + uncommon = guaranteed
    if level >= 16 && rarity >= 1 {
        return true;
    }

    // √φ tier: Any level with research unlock = fragments (but amount scales)
    // Research investment guarantees fragment drops
    true
}

/// Determine if gems should be awarded (Deterministic System)
///
/// Gems are rarer than fragments - require higher thresholds.
/// Uses level + rarity thresholds with no randomness.
///
/// # Thresholds (stricter than fragments)
/// - Level >= 71 AND rarity >= 3 (Epic): Always gems
/// - Level >= 41 AND rarity >= 2 (Rare): Always gems
/// - Level >= 21 AND rarity >= 1 (Uncommon) AND has_gem_drops: Gems awarded
pub fn should_award_gems(level: u8, rarity: u8, has_gem_drops: bool, _drop_rate_bonus_bps: u16) -> bool {
    // Must have unlocked gem drops via research
    if !has_gem_drops {
        return false;
    }

    // φ² tier: Very high level + epic/legendary = guaranteed gems
    if level >= 71 && rarity >= 3 {
        return true;
    }

    // φ tier: High level + rare = guaranteed gems
    if level >= 41 && rarity >= 2 {
        return true;
    }

    // √φ tier: Mid level + uncommon with research = gems
    if level >= 21 && rarity >= 1 {
        return true;
    }

    // Below threshold: No gems (deterministic)
    false
}

/// Complete loot pool calculation for an encounter
///
/// Combines:
/// - Base rewards (from config)
/// - Level scaling (exponential)
/// - Oscillation (time-based variance)
/// - Time-of-day bonus (night attacks = better loot!)
/// - Level-based reward types (DETERMINISTIC - no randomness!)
///
/// # Time-of-Day Bonus (Golden Ratio Based)
/// - DeepNight: φ (1.618x) - Stealth operations, best loot!
/// - Dawn/Dusk: √φ (1.272x) - Golden hours, good loot
/// - Midday: 1/φ (0.618x) - Bright/busy time, reduced loot
pub fn calculate_encounter_loot_pool(
    encounter: &EncounterAccount,
    current_time: i64,
    player_long: f64,
    economic_config: &EconomicConfig,
    gameplay_config: &GameplayConfig,
) -> EncounterLootPool {
    let rarity_idx = encounter.rarity.min(4) as usize;

    // 1. Oscillation multiplier (time-based variance)
    let osc_mult = calculate_oscillation_multiplier(
        current_time,
        encounter.spawned_at,
        encounter.id,
        economic_config.encounter_oscillation_freq[rarity_idx],
        economic_config.encounter_oscillation_amp[rarity_idx],
    );

    // 2. Level scaling multiplier (exponential growth)
    let level_mult = calculate_level_multiplier(
        encounter.level,
        gameplay_config.loot_level_scaling_exp,
        gameplay_config.loot_level_scaling_divisor,
    );

    // 3. Time-of-day bonus (night attacks get better loot!)
    let time_of_day = get_time_of_day(current_time, player_long);
    let time_mult = get_time_multiplier(time_of_day, ActivityType::LootDrop);
    let time_mult_bp = (time_mult * 10000.0) as u64;

    // 4. Combined multiplier using interleaved multiply/divide (no u128!)
    // Chain: osc × level / 10000 × time / 10000
    let combined_mult = chain_bp(osc_mult as u64, &[level_mult, time_mult_bp])
        .unwrap_or(10000); // Fallback to 1.0x

    // 4. Determine if Novi should be awarded
    let award_novi = should_award_novi(encounter.level, encounter.rarity);

    // 5. Determine number of reward types
    let type_count = calculate_reward_type_count(encounter.level);

    // 6. Determine which types to award (DETERMINISTIC - level thresholds)
    let (award_produce, award_weapons, award_vehicles, final_award_novi) =
        determine_reward_types(encounter.level, type_count, award_novi);

    // 7. Apply multiplier to base rewards (only for awarded types)
    EncounterLootPool {
        total_cash: apply_multiplier(
            economic_config.encounter_base_cash[rarity_idx],
            combined_mult,
        ),
        total_novi: if final_award_novi {
            apply_multiplier(
                economic_config.encounter_base_novi[rarity_idx],
                combined_mult,
            )
        } else {
            0
        },
        total_weapons: if award_weapons {
            apply_multiplier(
                economic_config.encounter_base_weapons[rarity_idx],
                combined_mult,
            )
        } else {
            0
        },
        total_produce: if award_produce {
            apply_multiplier(
                economic_config.encounter_base_produce[rarity_idx],
                combined_mult,
            )
        } else {
            0
        },
        total_vehicles: if award_vehicles {
            apply_multiplier(
                economic_config.encounter_base_vehicles[rarity_idx],
                combined_mult,
            )
        } else {
            0
        },
        // Fragments and gems calculated separately based on player research
        total_fragments: 0,
        total_gems: 0,
    }
}

/// Calculate fragment amount for loot (Deterministic System)
///
/// Uses golden ratio family for rarity scaling.
/// Base amounts scale with √φ per rarity tier.
///
/// # Base amounts by rarity (deterministic)
/// - Common: 2 fragments (1/φ scaled)
/// - Uncommon: 3 fragments (baseline)
/// - Rare: 5 fragments (√φ scaled)
/// - Epic: 8 fragments (φ scaled)
/// - Legendary: 13 fragments (φ² scaled, Fibonacci!)
///
/// Scaled by level using √φ per 10 levels
///
/// # Time-of-Day Bonus
/// Golden hours (Dawn/Dusk) and DeepNight give better fragment drops.
/// Uses LootDrop ActivityType multiplier.
pub fn calculate_fragment_amount(level: u8, rarity: u8, synchrony_bonus_bps: u16, time_mult: f64) -> u64 {
    // Base amounts using golden ratio family (deterministic)
    // These are close to Fibonacci sequence: 2, 3, 5, 8, 13
    let base = match rarity {
        0 => 2,   // Common: ~3 × 1/φ
        1 => 3,   // Uncommon: baseline
        2 => 5,   // Rare: ~3 × √φ (Fibonacci!)
        3 => 8,   // Epic: ~3 × φ² (Fibonacci!)
        4 => 13,  // Legendary: ~3 × φ³ (Fibonacci!)
        _ => 2,
    };

    // Level scaling: √φ per 10 levels (deterministic)
    // Level 10: √φ ≈ 1.27x
    // Level 20: φ ≈ 1.62x
    // Level 40: φ² ≈ 2.62x
    let level_exponent = level as f64 / 10.0;
    let level_mult = libm::pow(GOLDEN_ROOT, level_exponent);
    let level_mult_bp = (level_mult * 10000.0) as u64;

    // Apply synchrony bonus
    let synchrony_mult = 10000u64 + synchrony_bonus_bps as u64;

    // Apply time-of-day bonus
    let time_mult_bp = (time_mult * 10000.0) as u64;

    // Calculate final amount using interleaved multiply/divide (no u128!)
    chain_bp(base as u64, &[level_mult_bp, synchrony_mult, time_mult_bp])
        .unwrap_or(base as u64)
}

/// Calculate gem amount for loot (Deterministic System)
///
/// Uses golden ratio family for rarity scaling (rarer than fragments).
/// Base amounts are Fibonacci numbers scaled by 1/φ.
///
/// # Base amounts by rarity (deterministic)
/// - Common: 1 gem
/// - Uncommon: 2 gems (Fibonacci!)
/// - Rare: 3 gems (Fibonacci!)
/// - Epic: 5 gems (Fibonacci!)
/// - Legendary: 8 gems (Fibonacci!)
///
/// Scaled by level using √φ per 20 levels (slower than fragments)
///
/// # Time-of-Day Bonus
/// Golden hours (Dawn/Dusk) and DeepNight give better gem drops.
/// Uses LootDrop ActivityType multiplier.
pub fn calculate_gem_amount(level: u8, rarity: u8, synchrony_bonus_bps: u16, time_mult: f64) -> u64 {
    // Base amounts using Fibonacci sequence (deterministic)
    let base = match rarity {
        0 => 1,   // Common: Fibonacci 1
        1 => 2,   // Uncommon: Fibonacci 2
        2 => 3,   // Rare: Fibonacci 3
        3 => 5,   // Epic: Fibonacci 5
        4 => 8,   // Legendary: Fibonacci 8
        _ => 1,
    };

    // Level scaling: √φ per 20 levels (slower than fragments)
    // Level 20: √φ ≈ 1.27x
    // Level 40: φ ≈ 1.62x
    // Level 80: φ² ≈ 2.62x
    let level_exponent = level as f64 / 20.0;
    let level_mult = libm::pow(GOLDEN_ROOT, level_exponent);
    let level_mult_bp = (level_mult * 10000.0) as u64;

    // Apply synchrony bonus
    let synchrony_mult = 10000u64 + synchrony_bonus_bps as u64;

    // Apply time-of-day bonus
    let time_mult_bp = (time_mult * 10000.0) as u64;

    // Calculate final amount using interleaved multiply/divide (no u128!)
    chain_bp(base as u64, &[level_mult_bp, synchrony_mult, time_mult_bp])
        .unwrap_or(base as u64)
}

#[inline]
fn apply_multiplier(base: u64, multiplier: u64) -> u64 {
    apply_bp(base, multiplier).unwrap_or(0)
}

/// Loot pool for an entire encounter (to be distributed among attackers)
pub struct EncounterLootPool {
    pub total_cash: u64,
    pub total_novi: u64,
    pub total_weapons: u64,
    pub total_produce: u64,
    pub total_vehicles: u64,
    pub total_fragments: u64,
    pub total_gems: u64,
}

impl EncounterLootPool {
    /// Check if pool has any loot
    pub fn has_loot(&self) -> bool {
        self.total_cash > 0
            || self.total_novi > 0
            || self.total_weapons > 0
            || self.total_produce > 0
            || self.total_vehicles > 0
            || self.total_fragments > 0
            || self.total_gems > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_level_multiplier() {
        // Level 1: Should be ~0.1x
        let mult1 = calculate_level_multiplier(1, 1.5, 10);
        assert!(mult1 >= 900 && mult1 <= 1100); // ~1000 bp

        // Level 50: Should be ~35x
        let mult50 = calculate_level_multiplier(50, 1.5, 10);
        assert!(mult50 >= 340000 && mult50 <= 360000); // ~353500 bp

        // Level 100: Should be ~100x
        let mult100 = calculate_level_multiplier(100, 1.5, 10);
        assert!(mult100 >= 990000 && mult100 <= 1010000); // ~1000000 bp
    }

    #[test]
    fn test_novi_award_deterministic() {
        // Low level: Should never get Novi (deterministic)
        assert!(!should_award_novi(5, 4)); // Level 5 Legendary - below threshold
        assert!(!should_award_novi(20, 0)); // Level 20 Common - below threshold

        // Mid level + uncommon: Should get Novi
        assert!(should_award_novi(21, 1)); // Level 21 Uncommon - √φ tier

        // High level + rare: Should get Novi
        assert!(should_award_novi(41, 2)); // Level 41 Rare - φ tier

        // Very high level + epic: Should get Novi
        assert!(should_award_novi(61, 3)); // Level 61 Epic - φ² tier
    }

    #[test]
    fn test_reward_type_count_deterministic() {
        // Level 1: Always 1 type
        assert_eq!(calculate_reward_type_count(1), 1);

        // Level 10: 2 types
        assert_eq!(calculate_reward_type_count(10), 2);

        // Level 25: 3 types
        assert_eq!(calculate_reward_type_count(25), 3);

        // Level 40: 4 types
        assert_eq!(calculate_reward_type_count(40), 4);

        // Level 60: 5 types
        assert_eq!(calculate_reward_type_count(60), 5);
    }

    #[test]
    fn test_fragment_amount_golden_ratio() {
        // Test that fragment amounts follow golden ratio scaling
        // Using 1.0 as time multiplier (baseline)
        let common = calculate_fragment_amount(1, 0, 0, 1.0);
        let legendary = calculate_fragment_amount(1, 4, 0, 1.0);

        // Legendary should be ~6.5x common (13/2 = 6.5)
        assert!(legendary > common * 5);

        // Level scaling: level 20 should be ~φ× level 1
        let low_level = calculate_fragment_amount(1, 2, 0, 1.0);
        let high_level = calculate_fragment_amount(20, 2, 0, 1.0);
        assert!(high_level > low_level);

        // Time-of-day bonus: φ multiplier should increase drops
        let baseline = calculate_fragment_amount(10, 2, 0, 1.0);
        let with_phi = calculate_fragment_amount(10, 2, 0, 1.618);
        assert!(with_phi > baseline);
        // Should be approximately 1.618x
        let ratio = with_phi as f64 / baseline as f64;
        assert!(ratio > 1.5 && ratio < 1.7);
    }

    #[test]
    fn test_gem_amount_time_bonus() {
        // Gems should also benefit from time-of-day bonus
        let baseline = calculate_gem_amount(20, 2, 0, 1.0);
        let with_phi = calculate_gem_amount(20, 2, 0, 1.618);
        assert!(with_phi > baseline);
        // Should be approximately 1.618x
        let ratio = with_phi as f64 / baseline as f64;
        assert!(ratio > 1.5 && ratio < 1.7);
    }
}
