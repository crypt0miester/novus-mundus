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
    if n == 0 {
        return 1.0;
    }
    libm::pow(GOLDEN_ROOT, n as f64)
}

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

    let range = (max_level - min_level) as u64;

    // Use golden ratio for distribution
    let position = ((spawn_index as f64 * PHI) % 1.0 * range as f64) as u64;

    min_level + position.min(range) as u8
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
}
