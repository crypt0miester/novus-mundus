use crate::logic::safe_math::{apply_bp, chain_bp};
use crate::logic::{get_time_multiplier, get_time_of_day, ActivityType};
use crate::state::{EconomicConfig, EncounterAccount, GameplayConfig};

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
    let multiplier = 10000i32.saturating_add(deviation) as u32;

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
pub fn calculate_level_multiplier(level: u8, scaling_exp: f32, scaling_divisor: u32) -> u64 {
    if level == 0 || scaling_divisor == 0 {
        return 10000; // 1.0x fallback
    }

    // Use f64 for precision
    let level_f = level as f64;
    // Fast path: every shipped config uses exponent 1.5, and level^1.5 is
    // exactly level * sqrt(level) — one libm::sqrt instead of the full
    // libm::pow log/exp path.
    let scaled = if scaling_exp == 1.5 {
        level_f * libm::sqrt(level_f)
    } else {
        libm::pow(level_f, scaling_exp as f64)
    };
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
pub fn should_award_fragments(
    level: u8,
    rarity: u8,
    has_fragment_drops: bool,
    _drop_rate_bonus_bps: u16,
) -> bool {
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
pub fn should_award_gems(
    level: u8,
    rarity: u8,
    has_gem_drops: bool,
    _drop_rate_bonus_bps: u16,
) -> bool {
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
    let combined_mult = chain_bp(osc_mult as u64, &[level_mult, time_mult_bp]).unwrap_or(10000); // Fallback to 1.0x

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
pub fn calculate_fragment_amount(
    level: u8,
    rarity: u8,
    synchrony_bonus_bps: u16,
    time_mult: f64,
) -> u64 {
    // Base amounts using golden ratio family (deterministic)
    // These are close to Fibonacci sequence: 2, 3, 5, 8, 13
    let base = match rarity {
        0 => 2,  // Common: ~3 × 1/φ
        1 => 3,  // Uncommon: baseline
        2 => 5,  // Rare: ~3 × √φ (Fibonacci!)
        3 => 8,  // Epic: ~3 × φ² (Fibonacci!)
        4 => 13, // Legendary: ~3 × φ³ (Fibonacci!)
        _ => 2,
    };

    // Level scaling: √φ per 10 levels (deterministic).
    let level_mult_bp = FRAGMENT_LEVEL_MULT_BP[level as usize];

    // Apply synchrony bonus
    let synchrony_mult = 10000u64.saturating_add(synchrony_bonus_bps as u64);

    // Apply time-of-day bonus
    let time_mult_bp = (time_mult * 10000.0) as u64;

    // Calculate final amount using interleaved multiply/divide (no u128!)
    chain_bp(base as u64, &[level_mult_bp, synchrony_mult, time_mult_bp]).unwrap_or(base as u64)
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
pub fn calculate_gem_amount(
    level: u8,
    rarity: u8,
    synchrony_bonus_bps: u16,
    time_mult: f64,
) -> u64 {
    // Base amounts using Fibonacci sequence (deterministic)
    let base = match rarity {
        0 => 1, // Common: Fibonacci 1
        1 => 2, // Uncommon: Fibonacci 2
        2 => 3, // Rare: Fibonacci 3
        3 => 5, // Epic: Fibonacci 5
        4 => 8, // Legendary: Fibonacci 8
        _ => 1,
    };

    // Level scaling: √φ per 20 levels (slower than fragments).
    // Level 20: √φ ≈ 1.27x · Level 40: φ ≈ 1.62x · Level 80: φ² ≈ 2.62x.
    // Precomputed LUT baked from (libm::pow(GOLDEN_ROOT, level/20.0) * 10000.0)
    // as u64 — identical output, TS mirror at calculators/rewards.ts:289 stays
    // in parity. See the bit-equality test below.
    let level_mult_bp = GEM_LEVEL_MULT_BP[level as usize];

    // Apply synchrony bonus
    let synchrony_mult = 10000u64.saturating_add(synchrony_bonus_bps as u64);

    // Apply time-of-day bonus
    let time_mult_bp = (time_mult * 10000.0) as u64;

    // Calculate final amount using interleaved multiply/divide (no u128!)
    chain_bp(base as u64, &[level_mult_bp, synchrony_mult, time_mult_bp]).unwrap_or(base as u64)
}

// Fragment level multiplier in bp, indexed by level (u8): √φ per 10 levels.
// = (libm::pow(GOLDEN_ROOT, level/10.0) * 10000.0) as u64, baked bit-for-bit.
#[rustfmt::skip]
const FRAGMENT_LEVEL_MULT_BP: [u64; 256] = [
    10000, 10243, 10492, 10748, 11010, 11278, 11553, 11834,
    12122, 12417, 12720, 13029, 13347, 13672, 14005, 14346,
    14695, 15053, 15420, 15795, 16180, 16574, 16977, 17391,
    17814, 18248, 18693, 19148, 19614, 20092, 20581, 21082,
    21596, 22122, 22660, 23212, 23778, 24357, 24950, 25557,
    26180, 26817, 27470, 28139, 28825, 29527, 30246, 30982,
    31737, 32510, 33301, 34112, 34943, 35794, 36666, 37559,
    38473, 39410, 40370, 41353, 42360, 43392, 44448, 45531,
    46640, 47776, 48939, 50131, 51352, 52602, 53883, 55195,
    56539, 57916, 59327, 60772, 62251, 63767, 65320, 66911,
    68541, 70210, 71919, 73671, 75465, 77303, 79185, 81114,
    83089, 85112, 87185, 89308, 91483, 93711, 95993, 98331,
    100725, 103178, 105691, 108265, 110901, 113602, 116368, 119202,
    122105, 125079, 128125, 131245, 134441, 137715, 141069, 144504,
    148023, 151628, 155320, 159103, 162977, 166946, 171012, 175176,
    179442, 183812, 188288, 192874, 197571, 202382, 207310, 212359,
    217530, 222828, 228254, 233813, 239507, 245339, 251314, 257434,
    263703, 270125, 276703, 283441, 290344, 297414, 304657, 312076,
    319676, 327461, 335436, 343604, 351972, 360543, 369323, 378317,
    387530, 396967, 406635, 416537, 426681, 437071, 447715, 458618,
    469787, 481227, 492946, 504951, 517247, 529844, 542746, 555964,
    569503, 583371, 597578, 612130, 627037, 642307, 657949, 673971,
    690384, 707197, 724419, 742060, 760131, 778642, 797604, 817027,
    836924, 857305, 878183, 899568, 921475, 943915, 966902, 990448,
    1014568, 1039275, 1064584, 1090509, 1117066, 1144269, 1172135, 1200679,
    1229918, 1259870, 1290550, 1321978, 1354172, 1387149, 1420930, 1455533,
    1490978, 1527287, 1564480, 1602579, 1641606, 1681583, 1722533, 1764481,
    1807450, 1851466, 1896554, 1942739, 1990050, 2038512, 2088155, 2139006,
    2191096, 2244455, 2299113, 2355101, 2412454, 2471203, 2531383, 2593028,
    2656174, 2720858, 2787118, 2854991, 2924517, 2995735, 3068689, 3143419,
    3219968, 3298382, 3378706, 3460985, 3545269, 3631604, 3720043, 3810635,
    3903433, 3998490, 4095863, 4195607, 4297780, 4402442, 4509652, 4619472,
];

// Gem level multiplier in bp, indexed by level (u8): √φ per 20 levels.
// = (libm::pow(GOLDEN_ROOT, level/20.0) * 10000.0) as u64, baked bit-for-bit.
#[rustfmt::skip]
const GEM_LEVEL_MULT_BP: [u64; 256] = [
    10000, 10121, 10243, 10367, 10492, 10619, 10748, 10878,
    11010, 11143, 11278, 11414, 11553, 11692, 11834, 11977,
    12122, 12269, 12417, 12568, 12720, 12874, 13029, 13187,
    13347, 13508, 13672, 13837, 14005, 14174, 14346, 14519,
    14695, 14873, 15053, 15235, 15420, 15606, 15795, 15986,
    16180, 16376, 16574, 16774, 16977, 17183, 17391, 17601,
    17814, 18030, 18248, 18469, 18693, 18919, 19148, 19380,
    19614, 19852, 20092, 20335, 20581, 20830, 21082, 21338,
    21596, 21857, 22122, 22390, 22660, 22935, 23212, 23493,
    23778, 24065, 24357, 24651, 24950, 25252, 25557, 25867,
    26180, 26497, 26817, 27142, 27470, 27803, 28139, 28480,
    28825, 29174, 29527, 29884, 30246, 30612, 30982, 31357,
    31737, 32121, 32510, 32903, 33301, 33704, 34112, 34525,
    34943, 35366, 35794, 36227, 36666, 37110, 37559, 38013,
    38473, 38939, 39410, 39887, 40370, 40859, 41353, 41854,
    42360, 42873, 43392, 43917, 44448, 44986, 45531, 46082,
    46640, 47204, 47776, 48354, 48939, 49531, 50131, 50737,
    51352, 51973, 52602, 53239, 53883, 54535, 55195, 55863,
    56539, 57224, 57916, 58617, 59327, 60045, 60772, 61507,
    62251, 63005, 63767, 64539, 65320, 66111, 66911, 67721,
    68541, 69370, 70210, 71059, 71919, 72790, 73671, 74563,
    75465, 76378, 77303, 78238, 79185, 80144, 81114, 82095,
    83089, 84095, 85112, 86142, 87185, 88240, 89308, 90389,
    91483, 92590, 93711, 94845, 95993, 97155, 98331, 99521,
    100725, 101944, 103178, 104427, 105691, 106970, 108265, 109575,
    110901, 112243, 113602, 114977, 116368, 117777, 119202, 120645,
    122105, 123583, 125079, 126593, 128125, 129675, 131245, 132833,
    134441, 136068, 137715, 139382, 141069, 142776, 144504, 146253,
    148023, 149815, 151628, 153463, 155320, 157200, 159103, 161028,
    162977, 164950, 166946, 168967, 171012, 173081, 175176, 177296,
    179442, 181614, 183812, 186037, 188288, 190567, 192874, 195208,
    197571, 199962, 202382, 204831, 207310, 209819, 212359, 214929,
];

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

        // Time-of-day bonus: φ multiplier should increase drops.
        // Uses a high level + rarity so the amounts are large enough that
        // integer truncation in chain_bp doesn't distort the ratio.
        let baseline = calculate_fragment_amount(80, 4, 0, 1.0);
        let with_phi = calculate_fragment_amount(80, 4, 0, 1.618);
        assert!(with_phi > baseline);
        // Should be approximately 1.618x (φ)
        let ratio = with_phi as f64 / baseline as f64;
        assert!(ratio > 1.5 && ratio < 1.7);
    }

    #[test]
    fn test_gem_amount_time_bonus() {
        // Gems should also benefit from time-of-day bonus.
        // High level + rarity keeps amounts large enough for a meaningful ratio.
        let baseline = calculate_gem_amount(100, 4, 0, 1.0);
        let with_phi = calculate_gem_amount(100, 4, 0, 1.618);
        assert!(with_phi > baseline);
        // Should be approximately 1.618x (φ)
        let ratio = with_phi as f64 / baseline as f64;
        assert!(ratio > 1.5 && ratio < 1.7);
    }

    #[test]
    fn level_mult_tables_match_libm() {
        // The baked LUTs must reproduce (libm::pow(GOLDEN_ROOT, level/d) *
        // 10000.0) as u64 bit-for-bit over the whole u8 range — anti-drift /
        // paste-typo guard, and proof the on-chain output is unchanged (so the
        // Math.pow mirror in calculators/rewards.ts stays in parity).
        use crate::constants::GOLDEN_ROOT;
        for level in 0u32..256 {
            let frag = (libm::pow(GOLDEN_ROOT, level as f64 / 10.0) * 10000.0) as u64;
            let gem = (libm::pow(GOLDEN_ROOT, level as f64 / 20.0) * 10000.0) as u64;
            assert_eq!(FRAGMENT_LEVEL_MULT_BP[level as usize], frag, "fragment level {level}");
            assert_eq!(GEM_LEVEL_MULT_BP[level as usize], gem, "gem level {level}");
        }
    }
}
