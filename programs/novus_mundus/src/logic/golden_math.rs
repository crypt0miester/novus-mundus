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

use crate::constants::{PHI, GOLDEN_ROOT, PHI_SQUARED, PHI_INVERSE, GOLDEN_ANGLE};

/// Calculate √φ raised to power n (golden root power)
///
/// This is the primary progression function.
/// - Level 0: 1.0x
/// - Level 1: 1.272x (√φ)
/// - Level 2: 1.618x (φ)
/// - Level 4: 2.618x (φ²)
/// - Level 10: ~10.86x
/// - Level 50: ~362,000x (will be capped in practice)
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

/// Calculate φ raised to power n (golden ratio power)
///
/// Used for Fibonacci bonuses and tier scaling.
/// - n=0: 1.0x
/// - n=1: 1.618x (φ)
/// - n=2: 2.618x (φ²)
/// - n=3: 4.236x (φ³)
///
/// # Arguments
/// * `n` - Power
///
/// # Returns
/// The multiplier as f64
#[inline]
pub fn phi_power(n: u32) -> f64 {
    if n == 0 {
        return 1.0;
    }
    libm::pow(PHI, n as f64)
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

/// Calculate deterministic level-up buff increase
///
/// Each level grants a fixed increase based on golden root.
/// The increase is: base × ((√φ)^level - (√φ)^(level-1))
///
/// This is the DELTA between levels, not the total.
///
/// # Arguments
/// * `base` - Base buff value from template
/// * `level` - Level being attained (1-based)
///
/// # Returns
/// The buff increase for this level
#[inline]
pub fn calculate_level_up_increase(base: u64, level: u32) -> u64 {
    if level <= 1 || base == 0 {
        return 0; // No increase at level 1 or below
    }

    let current_total = calculate_buff_at_level(base, level);
    let previous_total = calculate_buff_at_level(base, level - 1);

    current_total.saturating_sub(previous_total)
}

/// Get rarity multiplier using golden ratio family
///
/// - Common: 1/φ ≈ 0.618x (below average)
/// - Uncommon: 1.0x (baseline)
/// - Rare: √φ ≈ 1.272x
/// - Epic: φ ≈ 1.618x
/// - Legendary: φ² ≈ 2.618x
///
/// # Arguments
/// * `rarity` - Rarity index (0-4)
///
/// # Returns
/// Multiplier as f64
#[inline]
pub fn rarity_multiplier(rarity: u8) -> f64 {
    match rarity {
        0 => PHI_INVERSE,  // Common: 0.618x
        1 => 1.0,          // Uncommon: 1.0x (baseline)
        2 => GOLDEN_ROOT,  // Rare: 1.272x
        3 => PHI,          // Epic: 1.618x
        4 => PHI_SQUARED,  // Legendary: 2.618x
        _ => 1.0,
    }
}

/// Get city type multiplier for a specific stat category
///
/// City types provide bonuses to different activities:
/// - Capital (0): Balanced - 1.0x all
/// - Resource (1): Collection bonus - √φ for economy
/// - Combat (2): Attack/Defense bonus - √φ for combat
/// - Trade (3): Economy bonus - φ for trade operations
///
/// # Arguments
/// * `city_type` - City type (0-3)
/// * `stat_category` - 0=combat, 1=economy, 2=collection
///
/// # Returns
/// Multiplier as f64
#[inline]
pub fn city_type_multiplier(city_type: u8, stat_category: u8) -> f64 {
    match (city_type, stat_category) {
        // Capital: balanced
        (0, _) => 1.0,
        // Resource: collection bonus
        (1, 2) => GOLDEN_ROOT, // Collection: √φ
        (1, _) => 1.0,
        // Combat: attack/defense bonus
        (2, 0) => GOLDEN_ROOT, // Combat: √φ
        (2, _) => 1.0,
        // Trade: economy bonus
        (3, 1) => PHI, // Economy: φ
        (3, _) => 1.0,
        // Unknown
        _ => 1.0,
    }
}

/// Calculate level scaling multiplier (exponential growth)
///
/// Uses golden root for smooth exponential progression:
/// multiplier = (√φ)^(level / divisor)
///
/// # Arguments
/// * `level` - Entity level
/// * `divisor` - Scales the growth rate (higher = slower growth)
///
/// # Returns
/// Multiplier as f64
#[inline]
pub fn level_scaling_multiplier(level: u8, divisor: u8) -> f64 {
    if level == 0 || divisor == 0 {
        return 1.0;
    }

    let exponent = level as f64 / divisor as f64;
    libm::pow(GOLDEN_ROOT, exponent)
}

/// Calculate golden spiral position for deterministic spawning
///
/// Uses the golden angle to distribute points evenly in a spiral pattern.
/// This creates visually pleasing, non-clustering spawn positions.
///
/// # Arguments
/// * `index` - Spawn index (0, 1, 2, ...)
/// * `center_lat` - City center latitude
/// * `center_lon` - City center longitude
/// * `max_radius_km` - Maximum spawn radius in km
///
/// # Returns
/// (latitude, longitude) of spawn position
#[inline]
pub fn golden_spiral_position(
    index: u64,
    center_lat: f64,
    center_lon: f64,
    max_radius_km: f32,
) -> (f64, f64) {
    // Golden angle creates optimal distribution
    let angle = index as f64 * GOLDEN_ANGLE;

    // Radius grows with sqrt(index) for uniform area distribution
    let radius_factor = libm::sqrt(index as f64) / 10.0;
    let radius_km = radius_factor.min(1.0) * max_radius_km as f64;

    // Convert km to degrees (approximate)
    let km_per_degree = 111.0; // ~111km per degree latitude
    let lat_offset = radius_km * libm::cos(angle) / km_per_degree;
    let lon_offset = radius_km * libm::sin(angle) / km_per_degree;

    (center_lat + lat_offset, center_lon + lon_offset)
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

/// Apply multiplier to base value and convert to integer
///
/// Final step in calculations - converts f64 result to u64.
///
/// # Arguments
/// * `base` - Base value
/// * `multiplier` - f64 multiplier
///
/// # Returns
/// Result as u64, saturated at u64::MAX
#[inline]
pub fn apply_multiplier(base: u64, multiplier: f64) -> u64 {
    let result = base as f64 * multiplier;
    if result >= u64::MAX as f64 {
        u64::MAX
    } else if result < 0.0 {
        0
    } else {
        result as u64
    }
}

/// Apply multiplier and return u32 (for basis point style values)
#[inline]
pub fn apply_multiplier_u32(base: u32, multiplier: f64) -> u32 {
    let result = base as f64 * multiplier;
    if result >= u32::MAX as f64 {
        u32::MAX
    } else if result < 0.0 {
        0
    } else {
        result as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_rarity_multiplier() {
        assert!((rarity_multiplier(0) - PHI_INVERSE).abs() < 0.0001);
        assert!((rarity_multiplier(1) - 1.0).abs() < 0.0001);
        assert!((rarity_multiplier(2) - GOLDEN_ROOT).abs() < 0.0001);
        assert!((rarity_multiplier(3) - PHI).abs() < 0.0001);
        assert!((rarity_multiplier(4) - PHI_SQUARED).abs() < 0.0001);
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

        // Level 10: base × (√φ)^10 ≈ 10.86
        let level10 = calculate_buff_at_level(base, 10);
        assert!(level10 > 10000 && level10 < 11000);
    }

    #[test]
    fn test_level_up_increase() {
        let base = 1000u64;

        // Level 1→2 increase
        let inc2 = calculate_level_up_increase(base, 2);
        let expected = calculate_buff_at_level(base, 2) - calculate_buff_at_level(base, 1);
        assert_eq!(inc2, expected);
    }
}
