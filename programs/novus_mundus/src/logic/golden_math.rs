/// Golden Ratio Mathematics for Deterministic Progression
///
/// This module provides pure mathematical functions using the golden ratio
/// family (φ, √φ, φ², 1/φ) for deterministic game progression.
///
/// # Philosophy
/// - No randomness, no gambling - pure deterministic math
/// - Uses irrational numbers (f64) for maximum precision
/// - Converts to integer only at final output step
///
/// # Key Properties
/// - (√φ)² = φ — Every 2 levels equals one golden ratio multiplier
/// - φ × (1/φ) = 1 — Inverse relationships for diminishing returns
/// - φ² = φ + 1 — Self-similar scaling for legendary tiers
use crate::constants::{GOLDEN_ROOT, PHI};

/// Calculate √φ raised to power n (golden root power)
///
/// This is the primary progression function.
/// - Level 0: 1.0x
/// - Level 1: 1.272x (√φ)
/// - Level 2: 1.618x (φ)
/// - Level 4: 2.618x (φ²)
/// - Level 10: ~11.09x (= φ⁵, since (√φ)^10 = φ⁵)
/// - Level 50: ~167,761x (will be capped in practice)
///
/// # Arguments
/// * `n` - Power (typically hero level)
///
/// # Returns
/// The multiplier as f64
#[inline]
pub fn golden_root_power(n: u32) -> f64 {
    // √φ^n, precomputed. Baked bit-for-bit from `libm::pow(GOLDEN_ROOT, n)`
    match GOLDEN_ROOT_POW.get(n as usize) {
        Some(&v) => v,
        None => libm::pow(GOLDEN_ROOT, n as f64),
    }
}

#[rustfmt::skip]
const GOLDEN_ROOT_POW: [f64; 101] = [
    1.0, 1.272019649514069, 1.618033988749895, 2.0581710272714924,
    2.618033988749895, 3.3301906767855614, 4.23606797749979, 5.388361704057054,
    6.854101966249686, 8.718552380842615, 11.090169943749476, 14.106914084899671,
    17.944271909999163, 22.825466465742288, 29.03444185374864, 36.93238055064196,
    46.978713763747805, 59.75784701638425, 76.01315561749645, 96.69022756702621,
    122.99186938124426, 156.44807458341046, 199.0050249987407, 253.1383021504367,
    321.99689437998495, 409.58637673384715, 521.0019193787257, 662.7246788842839,
    842.9988137587108, 1072.3110556181311, 1364.0007331374366, 1735.0357345024152,
    2206.9995468961474, 2807.3467901205463, 3571.000280033584, 4542.382524622962,
    5777.999826929732, 7349.729314743508, 9349.000106963316, 11892.111839366471,
    15126.999933893048, 19241.841154109978, 24476.000040856365, 31133.95299347645,
    39602.999974749415, 50375.794147586435, 64079.00001560578, 81509.7471410629,
    103681.9999903552, 131885.5412886493, 167761.000005961, 213395.28842971224,
    271442.9999963162, 345280.82971836155, 439204.0000022772, 558676.1181480738,
    710646.9999985935, 903956.9478664354, 1149851.0000008708, 1462633.0660145092,
    1860497.9999994643, 2366590.013880945, 3010349.0000003353, 3829223.0798954545,
    4870846.9999998, 6195813.093776399, 7881196.000000135, 10025036.173671855,
    12752042.999999935, 16220849.267448254, 20633239.00000007, 26245885.44112011,
    33385282.000000007, 42466734.708568364, 54018521.00000008, 68712620.14968848,
    87403803.00000009, 111179354.85825685, 141422324.00000018, 179891975.00794533,
    228826127.0000003, 291071329.8662022, 370248451.0000005, 470963304.87414753,
    599074578.0000008, 762034634.7403498, 969323029.0000013, 1232997939.6144974,
    1568397607.0000021, 1995032574.3548472, 2537720636.000004, 3228030513.9693446,
    4106118243.0000057, 5223063088.324192, 6643838879.00001, 8451093602.293537,
    10749957122.000015, 13674156690.61773, 17393796001.000027, 22125250292.91127,
    28143753123.000046,
];

/// Calculate buff value at a given level using golden root scaling
///
/// Formula: base × (√φ)^level
///
/// # Arguments
/// * `base` - Base buff value (e.g., from template)
/// * `level` - Current level (1-based)
///
/// # Returns
/// Scaled buff value, capped at u64::MAX
#[inline]
pub fn calculate_buff_at_level(base: u64, level: u32) -> u64 {
    if level == 0 || base == 0 {
        return base;
    }

    let multiplier = golden_root_power(level);
    let result = base as f64 * multiplier;

    // Cap to prevent overflow
    if result >= u64::MAX as f64 {
        u64::MAX
    } else {
        result as u64
    }
}

/// Calculate encounter level deterministically
///
/// Uses golden ratio to distribute levels across spawn indices.
///
/// # Arguments
/// * `min_level` - City minimum level
/// * `max_level` - City maximum level
/// * `spawn_index` - Encounter spawn index
///
/// # Returns
/// Encounter level
#[inline]
pub fn deterministic_encounter_level(min_level: u8, max_level: u8, spawn_index: u64) -> u8 {
    if max_level <= min_level {
        return min_level;
    }

    let range = max_level.saturating_sub(min_level) as u64;

    // Use golden ratio for distribution
    let position = ((spawn_index as f64 * PHI) % 1.0 * range as f64) as u64;

    min_level.saturating_add(position.min(range) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::PHI_SQUARED;

    #[test]
    fn test_golden_root_power() {
        // Level 0 = 1.0x
        assert!((golden_root_power(0) - 1.0).abs() < 0.0001);

        // Level 1 = √φ ≈ 1.272
        assert!((golden_root_power(1) - GOLDEN_ROOT).abs() < 0.0001);

        // Level 2 = φ ≈ 1.618
        assert!((golden_root_power(2) - PHI).abs() < 0.0001);

        // Level 4 = φ² ≈ 2.618
        assert!((golden_root_power(4) - PHI_SQUARED).abs() < 0.0001);
    }

    #[test]
    fn test_calculate_buff_at_level() {
        let base = 1000u64;

        // Level 1: base × √φ
        let level1 = calculate_buff_at_level(base, 1);
        assert_eq!(level1, 1272); // 1000 × 1.272

        // Level 2: base × φ
        let level2 = calculate_buff_at_level(base, 2);
        assert_eq!(level2, 1618); // 1000 × 1.618

        // Level 10: base × (√φ)^10 = base × φ⁵ ≈ 11.09
        let level10 = calculate_buff_at_level(base, 10);
        assert_eq!(level10, 11090); // 1000 × 11.0901699...
    }

    #[test]
    fn golden_root_pow_table_matches_libm() {
        // The baked LUT must reproduce libm::pow(GOLDEN_ROOT, n) bit-for-bit
        // over the whole table — anti-drift / paste-typo guard. Exact f64
        // equality: the literals round-trip and use the same libm the table
        // was generated from.
        assert_eq!(GOLDEN_ROOT_POW.len(), 101);
        for n in 0u32..101 {
            let expected = if n == 0 {
                1.0
            } else {
                libm::pow(GOLDEN_ROOT, n as f64)
            };
            assert_eq!(GOLDEN_ROOT_POW[n as usize], expected, "n {n}");
            // And golden_root_power must return the table value for in-range n.
            assert_eq!(golden_root_power(n), expected, "fn n {n}");
        }
    }
}
