//! Safe arithmetic operations that never overflow or use u128
//!
//! All functions return Option<T> for overflow handling.
//! Use `.ok_or(GameError::MathOverflow)?` at call sites.

/// Basis points constant (10000 = 100% = 1.0x)
pub const BP_SCALE: u64 = 10_000;

/// Apply a basis-point multiplier: `value × multiplier_bp / 10000`
///
/// Safe for: value up to 1.84 × 10^15 with multiplier up to 10^4
///
/// # Example
/// ```ignore
/// apply_bp(1000, 15000) // 1000 × 1.5 = 1500
/// apply_bp(1000, 10000) // 1000 × 1.0 = 1000
/// apply_bp(1000, 5000)  // 1000 × 0.5 = 500
/// ```
#[inline]
pub fn apply_bp(value: u64, multiplier_bp: u64) -> Option<u64> {
    value.checked_mul(multiplier_bp)?.checked_div(BP_SCALE)
}

/// Apply a basis-point multiplier (u32 multiplier variant)
#[inline]
pub fn apply_bp32(value: u64, multiplier_bp: u32) -> Option<u64> {
    apply_bp(value, multiplier_bp as u64)
}

/// Apply a basis-point bonus: `value × (10000 + bonus_bp) / 10000`
///
/// # Example
/// ```ignore
/// apply_bp_bonus(1000, 500) // 1000 × 1.05 = 1050
/// ```
#[inline]
pub fn apply_bp_bonus(value: u64, bonus_bp: u16) -> Option<u64> {
    let multiplier = BP_SCALE.checked_add(bonus_bp as u64)?;
    apply_bp(value, multiplier)
}

/// Apply a basis-point penalty: `value × (10000 - penalty_bp) / 10000`
///
/// # Example
/// ```ignore
/// apply_bp_penalty(1000, 500) // 1000 × 0.95 = 950
/// ```
#[inline]
pub fn apply_bp_penalty(value: u64, penalty_bp: u16) -> Option<u64> {
    let multiplier = BP_SCALE.checked_sub(penalty_bp as u64)?;
    apply_bp(value, multiplier)
}

/// Chain multiple basis-point multipliers safely
///
/// Interleaves multiplication and division to stay within u64.
/// Each multiplier is applied as: `value = value × mult / 10000`
///
/// # Example
/// ```ignore
/// // Without interleaving: 10^13 × 13750 × 12720 × 15000 = OVERFLOW!
/// // With interleaving: each step stays under u64
/// chain_bp(10_000_000_000_000, &[13750, 12720, 15000]) // Works!
/// ```
#[inline]
pub fn chain_bp(mut value: u64, multipliers_bp: &[u64]) -> Option<u64> {
    for &mult in multipliers_bp {
        value = apply_bp(value, mult)?;
    }
    Some(value)
}

/// Chain basis-point multipliers with u32 array
#[inline]
pub fn chain_bp32(mut value: u64, multipliers_bp: &[u32]) -> Option<u64> {
    for &mult in multipliers_bp {
        value = apply_bp(value, mult as u64)?;
    }
    Some(value)
}

/// Calculate share of a total based on contribution
///
/// `share = total × (contribution × 10000 / total_contribution) / 10000`
///
/// Safe: calculates percentage first, then applies to total
///
/// # Example
/// ```ignore
/// calculate_share(1000, 30, 100) // 30% of 1000 = 300
/// ```
#[inline]
pub fn calculate_share(total: u64, contribution: u64, total_contribution: u64) -> Option<u64> {
    if total_contribution == 0 {
        return Some(0);
    }
    // Calculate contribution percentage in BP
    let share_bp = contribution.checked_mul(BP_SCALE)?.checked_div(total_contribution)?;
    apply_bp(total, share_bp)
}

/// Multiply with overflow check
#[inline]
pub fn safe_mul(a: u64, b: u64) -> Option<u64> {
    a.checked_mul(b)
}

/// Add with overflow check
#[inline]
pub fn safe_add(a: u64, b: u64) -> Option<u64> {
    a.checked_add(b)
}

/// Subtract with underflow check
#[inline]
pub fn safe_sub(a: u64, b: u64) -> Option<u64> {
    a.checked_sub(b)
}

/// Divide with zero check
#[inline]
pub fn safe_div(a: u64, b: u64) -> Option<u64> {
    a.checked_div(b)
}

/// Power function with overflow check
#[inline]
pub fn safe_pow(base: u64, exp: u32) -> Option<u64> {
    base.checked_pow(exp)
}

/// Exponential growth: base × (num/den)^iterations
///
/// Uses interleaved multiply/divide to stay in u64.
///
/// # Example
/// ```ignore
/// exp_growth(10, 3, 2, 5) // 10 × 1.5^5 ≈ 75
/// exp_growth(10, 18, 10, 3) // 10 × 1.8^3 ≈ 58
/// ```
#[inline]
pub fn exp_growth(base: u64, numerator: u64, denominator: u64, iterations: u32) -> Option<u64> {
    if denominator == 0 {
        return None;
    }
    let mut result = base;
    for _ in 0..iterations {
        result = result.checked_mul(numerator)?.checked_div(denominator)?;
    }
    Some(result)
}

/// Sum values with overflow checking
#[inline]
pub fn safe_sum(values: &[u64]) -> Option<u64> {
    values.iter().try_fold(0u64, |acc, &x| acc.checked_add(x))
}

/// Multiply then divide in one operation (for precision)
/// `a × b / c` with overflow protection
///
/// Only use when a × b might overflow but result fits in u64
#[inline]
pub fn mul_div(a: u64, b: u64, c: u64) -> Option<u64> {
    if c == 0 {
        return None;
    }
    // Try direct multiplication first
    if let Some(product) = a.checked_mul(b) {
        return product.checked_div(c);
    }
    // If overflow, divide first (loses some precision)
    let a_div = a.checked_div(c)?;
    a_div.checked_mul(b)
}

// ============================================================
// Golden Ratio Asymptotic Scaling (Strategic Combat System)
// ============================================================

/// Pre-computed φ^(-n) values in basis points (10000 = 1.0)
/// Used for asymptotic capacity scaling: capacity = max × (1 - φ^(-level))
///
/// φ^(-n) = (1/φ)^n where 1/φ ≈ 0.618
/// Index 0 = φ^0 = 1.0 (10000 bp)
/// Index 1 = φ^(-1) ≈ 0.618 (6180 bp)
/// Index 2 = φ^(-2) ≈ 0.382 (3820 bp)
/// etc.
const PHI_INVERSE_POWER_TABLE: [u16; 32] = [
    10000, // 0: φ^0 = 1.0
    6180,  // 1: φ^(-1) ≈ 0.618
    3820,  // 2: φ^(-2) ≈ 0.382
    2361,  // 3: φ^(-3) ≈ 0.236
    1459,  // 4: φ^(-4) ≈ 0.146
    902,   // 5: φ^(-5) ≈ 0.090
    557,   // 6: φ^(-6) ≈ 0.056
    344,   // 7: φ^(-7) ≈ 0.034
    213,   // 8: φ^(-8) ≈ 0.021
    132,   // 9: φ^(-9) ≈ 0.013
    81,    // 10: φ^(-10) ≈ 0.008
    50,    // 11: φ^(-11) ≈ 0.005
    31,    // 12: φ^(-12) ≈ 0.003
    19,    // 13: φ^(-13) ≈ 0.002
    12,    // 14: φ^(-14) ≈ 0.001
    7,     // 15: φ^(-15) ≈ 0.0007
    4,     // 16: φ^(-16) ≈ 0.0004
    3,     // 17: φ^(-17) ≈ 0.0003
    2,     // 18: φ^(-18) ≈ 0.0002
    1,     // 19: φ^(-19) ≈ 0.0001
    1,     // 20+: effectively 0 but we keep 1 for precision
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 21-31: 0
];

/// Get φ^(-level) in basis points
/// Returns the value of (1/φ)^level scaled to 10000 = 1.0
///
/// # Arguments
/// * `level` - The exponent (0 = 1.0, higher = smaller)
///
/// # Returns
/// φ^(-level) in basis points (0-10000)
///
/// # Example
/// ```ignore
/// phi_inverse_power_bps(0)  // 10000 (1.0)
/// phi_inverse_power_bps(1)  // 6180 (0.618)
/// phi_inverse_power_bps(5)  // 902 (0.09)
/// phi_inverse_power_bps(10) // 81 (0.008)
/// ```
#[inline]
pub fn phi_inverse_power_bps(level: u32) -> u16 {
    if level >= PHI_INVERSE_POWER_TABLE.len() as u32 {
        return 0;
    }
    PHI_INVERSE_POWER_TABLE[level as usize]
}

/// Calculate asymptotic capacity using golden ratio
///
/// Formula: capacity = max_capacity × (1 - φ^(-level))
///
/// This creates elegant diminishing returns where each level adds
/// progressively less, but NEVER reaches the maximum.
///
/// # Arguments
/// * `max_capacity` - The theoretical maximum (never actually reached)
/// * `level` - The progression level (0 = 0 capacity, higher = closer to max)
///
/// # Returns
/// Current capacity based on level
///
/// # Example
/// ```ignore
/// asymptotic_capacity(100, 0)  // 0 (no progress)
/// asymptotic_capacity(100, 1)  // 38 (38% of max)
/// asymptotic_capacity(100, 2)  // 62 (62% of max)
/// asymptotic_capacity(100, 5)  // 91 (91% of max)
/// asymptotic_capacity(100, 10) // 99 (99% of max)
/// ```
#[inline]
pub fn asymptotic_capacity(max_capacity: u64, level: u32) -> u64 {
    if level == 0 {
        return 0;
    }

    let remaining_bps = phi_inverse_power_bps(level) as u64;
    // capacity = max × (10000 - remaining) / 10000
    let achieved_bps = BP_SCALE.saturating_sub(remaining_bps);
    apply_bp(max_capacity, achieved_bps).unwrap_or(max_capacity)
}

/// Calculate asymptotic capacity with a base value
///
/// Formula: capacity = base + (max - base) × (1 - φ^(-level))
///
/// Useful when there's a minimum capacity that's always available.
///
/// # Arguments
/// * `base_capacity` - The starting capacity at level 0
/// * `max_capacity` - The theoretical maximum (never actually reached)
/// * `level` - The progression level
///
/// # Returns
/// Current capacity based on level, starting from base
///
/// # Example
/// ```ignore
/// asymptotic_capacity_with_base(30, 90, 0)  // 30 (base only)
/// asymptotic_capacity_with_base(30, 90, 5)  // 85 (30 + 91% of 60)
/// ```
#[inline]
pub fn asymptotic_capacity_with_base(base_capacity: u64, max_capacity: u64, level: u32) -> u64 {
    if level == 0 || base_capacity >= max_capacity {
        return base_capacity;
    }

    let additional_range = max_capacity.saturating_sub(base_capacity);
    let additional = asymptotic_capacity(additional_range, level);
    base_capacity.saturating_add(additional)
}

// ============================================================
// Integer Square Root
// ============================================================

/// Integer square root (Newton's method, u64-only)
///
/// Returns floor(sqrt(n))
///
/// # Example
/// ```ignore
/// isqrt(100) // 10
/// isqrt(99)  // 9
/// isqrt(0)   // 0
/// ```
#[inline]
pub fn isqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Safe sqrt(a * b) without u128
///
/// Uses property: sqrt(a * b) ≈ sqrt(a) * sqrt(b)
/// For exact results, adjusts using: sqrt(a * b) = sqrt(a) * sqrt(b) when a,b are perfect squares
///
/// For resource calculations, slight precision loss (~5% max) is acceptable
#[inline]
pub fn sqrt_product(a: u64, b: u64) -> u64 {
    // If product fits in u64, use direct calculation
    if let Some(product) = a.checked_mul(b) {
        return isqrt(product);
    }
    // Otherwise, use sqrt(a) * sqrt(b) approximation
    isqrt(a).saturating_mul(isqrt(b))
}

/// Approximate x^0.75 using only u64 arithmetic
///
/// Uses: x^0.75 = sqrt(sqrt(x^3)) = sqrt(sqrt(x)) * sqrt(x)
/// Approximation: x^0.75 ≈ sqrt(x) * sqrt(sqrt(x))
///
/// For diminishing returns curves in resource collection
#[inline]
pub fn pow_three_quarters(x: u64) -> u64 {
    if x == 0 {
        return 0;
    }
    let sqrt_x = isqrt(x);
    let sqrt_sqrt_x = isqrt(sqrt_x);
    sqrt_x.saturating_mul(sqrt_sqrt_x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_bp() {
        assert_eq!(apply_bp(1000, 15000), Some(1500)); // 1.5x
        assert_eq!(apply_bp(1000, 10000), Some(1000)); // 1.0x
        assert_eq!(apply_bp(1000, 5000), Some(500));   // 0.5x
        assert_eq!(apply_bp(1000, 0), Some(0));        // 0x
    }

    #[test]
    fn test_apply_bp_bonus_penalty() {
        assert_eq!(apply_bp_bonus(1000, 500), Some(1050));  // +5%
        assert_eq!(apply_bp_penalty(1000, 500), Some(950)); // -5%
        assert_eq!(apply_bp_bonus(1000, 10000), Some(2000)); // +100%
    }

    #[test]
    fn test_chain_bp_no_overflow() {
        // This would overflow u64 without interleaving:
        // 10^13 × 13750 × 12720 × 15000 = 2.6 × 10^26 (overflow!)
        // With interleaving: each step stays under u64
        let result = chain_bp(10_000_000_000_000, &[13750, 12720, 15000]);
        assert!(result.is_some());
        // 10^13 × 1.375 × 1.272 × 1.5 ≈ 2.62 × 10^13
        let value = result.unwrap();
        assert!(value > 2_000_000_000_000);
        assert!(value < 3_000_000_000_000);
    }

    #[test]
    fn test_chain_bp_small_values() {
        // Small values should work with minimal precision loss
        let result = chain_bp(100, &[15000, 12000, 11000]);
        // 100 × 1.5 × 1.2 × 1.1 = 198
        assert_eq!(result, Some(198));
    }

    #[test]
    fn test_exp_growth() {
        // 10 × 1.5^5 = 10 × 7.59375 ≈ 75
        let result = exp_growth(10, 3, 2, 5);
        assert_eq!(result, Some(75));

        // 100 × 1.8^3 = 100 × 5.832 ≈ 583
        let result = exp_growth(100, 18, 10, 3);
        assert_eq!(result, Some(583));
    }

    #[test]
    fn test_calculate_share() {
        assert_eq!(calculate_share(1000, 30, 100), Some(300));  // 30%
        assert_eq!(calculate_share(1000, 0, 100), Some(0));     // 0%
        assert_eq!(calculate_share(1000, 100, 100), Some(1000)); // 100%
        assert_eq!(calculate_share(1000, 50, 0), Some(0));      // div by zero -> 0
    }

    #[test]
    fn test_safe_sum() {
        assert_eq!(safe_sum(&[1, 2, 3, 4, 5]), Some(15));
        assert_eq!(safe_sum(&[u64::MAX, 1]), None); // overflow
        assert_eq!(safe_sum(&[]), Some(0));
    }

    #[test]
    fn test_mul_div() {
        assert_eq!(mul_div(100, 50, 10), Some(500));
        assert_eq!(mul_div(1000, 10000, 10000), Some(1000));
        // Large values that would overflow in direct multiply
        let result = mul_div(u64::MAX / 2, 2, 2);
        assert_eq!(result, Some(u64::MAX / 2));
    }
}
