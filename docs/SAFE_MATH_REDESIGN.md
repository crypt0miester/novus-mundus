# Safe Math Redesign: Eliminating u128 and Unchecked Arithmetic

## Table of Contents
1. [Problem Statement](#problem-statement)
2. [u128-Ready Padding](#u128-ready-padding-for-future-proofing)
3. [Audit Results](#audit-results)
4. [Safe Math Module](#redesign-safe-math-module)
5. [Migration Guide](#migration-guide)
6. [Implementation Checklist](#implementation-checklist)

---

## Problem Statement

1. **Solana SBF/eBPF u128 issues**: u128 operations are expensive (compute units) and have potential runtime issues
2. **Unchecked arithmetic**: Several raw multiplications could overflow
3. **Inconsistent patterns**: Mix of `checked_*`, `saturating_*`, and raw operations

## Goals

1. **Eliminate all u128** - use interleaved multiply/divide pattern
2. **100% checked arithmetic** - no raw `*`, `+`, `-` on user-controlled values
3. **Standardized helpers** - consistent patterns across codebase
4. **No precision loss** - maintain calculation accuracy
5. **u128-ready padding** - reserve space for future upgrades

---

## u128-Ready Padding for Future-Proofing

### Reality Check: Will Any Field Actually Overflow u64?

**u64 max = 18,446,744,073,709,551,615 (1.84 × 10^19)**

| Field | Absolute Maximum | u64 Headroom | Overflow Risk |
|-------|------------------|--------------|---------------|
| TeamAccount.team_networth | 50 × 10^13 = 5×10^14 | 36,000× | **None** |
| TeamAccount.treasury | Bounded by supply = 10^13 | 1,800,000× | **None** |
| EventAccount.prize_amount | Single pool = 10^13 | 1,800,000× | **None** |
| ShopConfig.total_sol_collected | All SOL = 5×10^17 | 36× | **None** |
| RallyAccount.total_power | Per-rally, not cumulative | ~10^6× | **None** |
| MintingConfig.total_minted | Hard capped by supply | 1,800,000× | **None** |

**Conclusion: No stored value will overflow u64.** The overflow risk is only in **intermediate calculations** (multiplications before division), not final storage.

### Why Pad Only TeamAccount?

TeamAccount is the **only true cross-entity aggregate** where future expansion could matter:

| Factor | Other Fields | TeamAccount |
|--------|--------------|-------------|
| Bounded by supply cap? | Yes | No (sum of members) |
| Per-entity limit? | Yes | No (scales with team size) |
| Future expansion risk? | Low | Medium (bigger teams, alliances) |

If you later:
- Increase max team size from 50 to 500
- Add team alliances (sum of team networthes)
- Add team-level cumulative stats

Then TeamAccount aggregates could grow significantly. **Padding costs nothing and enables this flexibility.**

### Recommended: Pad TeamAccount Only

```rust
// state/team.rs - ONLY account needing u128-ready padding

pub struct TeamAccount {
    pub id: u64,
    pub leader: Pubkey,
    pub name: [u8; 32],
    pub name_len: u8,
    pub disbanded: bool,
    pub _padding1: [u8; 6],

    pub members: [Pubkey; 50],
    pub member_count: u8,
    pub _padding2: [u8; 7],

    pub created_at: i64,
    pub treasury: u64,

    // Reserved at end - can expand treasury to u128 or add new aggregate fields
    pub _reserved: [u8; 64],
}
```

### Fields That DON'T Need Padding

| Account | Field | Why No Padding Needed |
|---------|-------|----------------------|
| EventAccount | prize_amount | Bounded by supply cap |
| EventAccount | prize_remaining | Same as above |
| ShopConfig | total_sol_collected | Bounded by SOL supply (can't exceed) |
| ShopConfig | total_novi_burned | Bounded by tokens that exist |
| RallyAccount | total_power | Per-rally, not cumulative across all rallies |
| MintingConfig | total_minted | Hard capped by max_supply_cap |
| MintingConfig | minted_for_* | Bounded by allocation caps |
| PlayerAccount | All fields | Per-player limits, not aggregates |

### Account Size Impact

| Account | Current Size | With Padding | Delta |
|---------|--------------|--------------|-------|
| TeamAccount | 1704 | 1752 | +48 bytes |

**Cost:** ~0.0003 SOL additional rent. Negligible.

---

## Audit Results

### Category 1: u128 Required (Chained Multipliers)

| File | Line | Pattern | Overflow At |
|------|------|---------|-------------|
| `logic/consume.rs` | 50-54 | `a × b × c × d / 10^12` | >70k NOVI |
| `logic/rewards.rs` | 273-276 | `osc × level × time / 10^8` | Level 50+ |
| `logic/combat.rs` | 202-205 | `units × weapon × coeff / 10^8` | >10M units |
| `logic/calculations.rs` | 32-109 | `Σ(units × value)` | Extreme values |
| `processor/combat/attack_player.rs` | 353-390 | `amount × bps / 10000` | >1.8 quadrillion |

### Category 2: Unchecked Raw Multiplications (DANGEROUS)

| File | Line | Code | Risk |
|------|------|------|------|
| `state/research.rs` | 162 | `(minutes as u64) * gem_per_minute` | Low (minutes bounded) |
| `logic/calculations.rs` | 181 | `BASE_XP * level.pow(2)` | Low (level ≤ 100) |
| `processor/shop/purchase_item.rs` | 488-506 | `price * (10000 - disc) / 10000` | Medium |
| `processor/shop/purchase_bundle.rs` | 436-454 | Same discount pattern | Medium |
| `processor/shop/purchase_flash_sale.rs` | 408-426 | Same discount pattern | Medium |
| `player_and_user_state.rs` | 18, 24 | `interval * 300`, `interval * rate` | Low |

### Category 3: Using u128 but Could Be u64

| File | Line | Pattern | Fix |
|------|------|---------|-----|
| `logic/fibonacci.rs` | 10-36 | `5 × n²` for Fibonacci check | Keep u128 (math requires it) |
| `state/hero.rs` | 244-250 | `cost × 3 / 2` per level | Interleave works |
| `state/research.rs` | 117-118 | `cost × 18 / 10` per level | Interleave works |

---

## Redesign: Safe Math Module

### New File: `logic/safe_math.rs`

```rust
//! Safe arithmetic operations that never overflow or use u128
//!
//! All functions return Option<T> for overflow handling.
//! Use `.ok_or(GameError::MathOverflow)?` at call sites.

use crate::error::GameError;

/// Basis points constant (10000 = 100% = 1.0x)
pub const BP_SCALE: u64 = 10_000;

/// Apply a basis-point multiplier: `value × multiplier_bp / 10000`
///
/// Safe for: value up to 1.84 × 10^15 with multiplier up to 10^4
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
/// Example: apply_bp_bonus(1000, 500) = 1000 × 10500 / 10000 = 1050
#[inline]
pub fn apply_bp_bonus(value: u64, bonus_bp: u16) -> Option<u64> {
    let multiplier = BP_SCALE.checked_add(bonus_bp as u64)?;
    apply_bp(value, multiplier)
}

/// Apply a basis-point penalty: `value × (10000 - penalty_bp) / 10000`
///
/// Example: apply_bp_penalty(1000, 500) = 1000 × 9500 / 10000 = 950
#[inline]
pub fn apply_bp_penalty(value: u64, penalty_bp: u16) -> Option<u64> {
    let multiplier = BP_SCALE.checked_sub(penalty_bp as u64)?;
    apply_bp(value, multiplier)
}

/// Chain multiple basis-point multipliers safely
///
/// Interleaves multiplication and division to stay within u64.
///
/// Example: chain_bp(1000, &[15000, 12000, 11000])
///   = ((1000 × 15000 / 10000) × 12000 / 10000) × 11000 / 10000
///   = 1980
#[inline]
pub fn chain_bp(mut value: u64, multipliers_bp: &[u64]) -> Option<u64> {
    for &mult in multipliers_bp {
        value = apply_bp(value, mult)?;
    }
    Some(value)
}

/// Calculate share of a total based on contribution
///
/// `share = total × contribution / total_contribution`
///
/// Safe: divides before multiply gets too large
#[inline]
pub fn calculate_share(total: u64, contribution: u64, total_contribution: u64) -> Option<u64> {
    if total_contribution == 0 {
        return Some(0);
    }

    // Calculate contribution percentage first (in BP)
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
/// Example: exp_growth(10, 3, 2, 5) = 10 × (1.5)^5 ≈ 75
#[inline]
pub fn exp_growth(base: u64, numerator: u64, denominator: u64, iterations: u32) -> Option<u64> {
    let mut result = base;
    for _ in 0..iterations {
        result = result.checked_mul(numerator)?.checked_div(denominator)?;
    }
    Some(result)
}

/// Sum an iterator with overflow checking
pub fn safe_sum<I: Iterator<Item = u64>>(iter: I) -> Option<u64> {
    iter.try_fold(0u64, |acc, x| acc.checked_add(x))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_bp() {
        assert_eq!(apply_bp(1000, 15000), Some(1500)); // 1.5x
        assert_eq!(apply_bp(1000, 10000), Some(1000)); // 1.0x
        assert_eq!(apply_bp(1000, 5000), Some(500));   // 0.5x
    }

    #[test]
    fn test_chain_bp_no_overflow() {
        // This would overflow u64 without interleaving:
        // 10^13 × 137500 × 12720 × 15000 = 2.6 × 10^26 (overflow!)
        // With interleaving: each step stays under u64
        let result = chain_bp(10_000_000_000_000, &[13750, 12720, 15000]);
        assert!(result.is_some());
        // 10^13 × 1.375 × 1.272 × 1.5 ≈ 2.62 × 10^13
        assert!(result.unwrap() > 2_000_000_000_000);
    }

    #[test]
    fn test_exp_growth() {
        // 10 × 1.5^10 ≈ 576
        let result = exp_growth(10, 3, 2, 10);
        assert_eq!(result, Some(576));
    }

    #[test]
    fn test_calculate_share() {
        assert_eq!(calculate_share(1000, 30, 100), Some(300)); // 30%
        assert_eq!(calculate_share(1000, 0, 100), Some(0));    // 0%
        assert_eq!(calculate_share(1000, 100, 100), Some(1000)); // 100%
    }
}
```

---

## Migration Guide

### Pattern 1: Single Multiplier

**Before:**
```rust
((base as u128).saturating_mul(multiplier as u128) / 10000) as u64
```

**After:**
```rust
use crate::logic::safe_math::apply_bp;
apply_bp(base, multiplier).ok_or(GameError::MathOverflow)?
```

### Pattern 2: Chained Multipliers (consume_novi)

**Before:**
```rust
let base_value = ((novi_amount as u128)
    .saturating_mul(base_mult_bp as u128)
    .saturating_mul(secondary_mult_bp as u128)
    .saturating_mul(luck_bp as u128)
    / 1_000_000_000_000u128) as u64;
```

**After:**
```rust
use crate::logic::safe_math::chain_bp;
let base_value = chain_bp(novi_amount, &[base_mult_bp, secondary_mult_bp, luck_bp])
    .ok_or(GameError::MathOverflow)?;
```

### Pattern 3: Loot Share Distribution

**Before:**
```rust
cash: ((self.total_cash as u128).saturating_mul(share_bp as u128) / 10000) as u64,
```

**After:**
```rust
use crate::logic::safe_math::apply_bp;
cash: apply_bp(self.total_cash, share_bp as u64).unwrap_or(0),
```

### Pattern 4: Exponential Growth (hero/research costs)

**Before:**
```rust
let mut cost = base as u128;
for _ in 0..level {
    cost = cost.saturating_mul(3).checked_div(2).unwrap_or(u128::MAX);
    if cost > u64::MAX as u128 { return u64::MAX; }
}
cost as u64
```

**After:**
```rust
use crate::logic::safe_math::exp_growth;
exp_growth(base, 3, 2, level as u32).unwrap_or(u64::MAX)
```

### Pattern 5: Networth Calculation

**Before:**
```rust
let total = defensive_1_value
    .checked_add(defensive_2_value)?
    .checked_add(defensive_3_value)?
    // ... 14 more
```

**After:**
```rust
use crate::logic::safe_math::{safe_mul, safe_sum};

let values = [
    safe_mul(player.defensive_unit_1, config.defensive_unit_1_value)?,
    safe_mul(player.defensive_unit_2, config.defensive_unit_2_value)?,
    // ...
];
safe_sum(values.into_iter()).ok_or(GameError::MathOverflow)?
```

---

## Files Requiring Changes

### High Priority (u128 elimination)

1. `logic/consume.rs` - Lines 50-62
2. `logic/rewards.rs` - Lines 269-276, 430-432, 471-482
3. `logic/combat.rs` - Lines 30-32, 141-143, 202-205, 300-302
4. `logic/calculations.rs` - Lines 32-109
5. `logic/progression.rs` - Lines 181-196
6. `processor/rally/execute.rs` - Lines 356-382
7. `processor/combat/attack_encounter.rs` - Lines 259-287
8. `processor/combat/attack_player.rs` - Lines 353-390
9. `state/hero.rs` - Lines 244-256
10. `state/research.rs` - Lines 114-127, 134-147

### Medium Priority (unchecked arithmetic)

1. `processor/shop/purchase_item.rs` - Lines 488-506
2. `processor/shop/purchase_bundle.rs` - Lines 436-454
3. `processor/shop/purchase_flash_sale.rs` - Lines 408-426
4. `state/research.rs` - Line 162
5. `player_and_user_state.rs` - Lines 18, 24

### Low Priority (constants, already safe)

1. `constants.rs` - Compile-time constants, safe
2. `logic/calculations.rs:181` - `pow(2)` with level ≤ 100, safe but should use checked

---

## Precision Analysis

### Interleaved vs Single Division

| Operation | Single Division | Interleaved | Difference |
|-----------|-----------------|-------------|------------|
| 1000 × 1.5 × 1.2 × 1.1 | 1980 | 1980 | 0% |
| 100 × 1.5 × 1.2 × 1.1 | 198 | 198 | 0% |
| 10 × 1.5 × 1.2 × 1.1 | 19.8 → 19 | 19 | 0% |
| 1 × 1.5 × 1.2 × 1.1 | 1.98 → 1 | 1 | 0% |

For values ≥10, precision loss is negligible. For values <10, both methods truncate similarly.

### Edge Case: Very Small Values

```
1 NOVI × 137500 × 12720 × 15000 / 10^12
= 26.235 (truncated to 26)

Interleaved:
1 × 137500 / 10000 = 13
13 × 12720 / 10000 = 16
16 × 15000 / 10000 = 24

Difference: 26 vs 24 = 7.7% loss
```

**Mitigation:** For critical calculations with small inputs, add minimum thresholds or use higher precision paths.

---

## Implementation Checklist

### Phase 1: u128-Ready Padding (Do First - Account Layout Changes)

- [ ] `state/team.rs` - Add `_reserved: [u8; 64]` at end of struct
- [ ] Update TeamAccount `LEN` constant
- [ ] Test account serialization/deserialization

**Note:** Other accounts (Event, Shop, Rally, MintingConfig) don't need padding - all bounded by supply caps or per-entity limits.

### Phase 2: Safe Math Module

- [ ] Create `logic/safe_math.rs` module
- [ ] Add to `logic/mod.rs` exports
- [ ] Write comprehensive unit tests

### Phase 3: u128 Elimination (Logic Files)

- [ ] Migrate `logic/consume.rs`
- [ ] Migrate `logic/rewards.rs`
- [ ] Migrate `logic/combat.rs`
- [ ] Migrate `logic/calculations.rs`
- [ ] Migrate `logic/progression.rs`

### Phase 4: u128 Elimination (Processor Files)

- [ ] Migrate `processor/rally/execute.rs`
- [ ] Migrate `processor/combat/attack_encounter.rs`
- [ ] Migrate `processor/combat/attack_player.rs`

### Phase 5: u128 Elimination (State Files)

- [ ] Migrate `state/hero.rs`
- [ ] Migrate `state/research.rs`

### Phase 6: Unchecked Arithmetic Fixes

- [ ] Fix `processor/shop/purchase_item.rs` discount calculations
- [ ] Fix `processor/shop/purchase_bundle.rs` discount calculations
- [ ] Fix `processor/shop/purchase_flash_sale.rs` discount calculations
- [ ] Fix `state/research.rs:162` gem cost calculation

### Phase 7: Verification

- [ ] `cargo check` - no u128 in program code
- [ ] `grep -r "as u128" src/` - should return nothing
- [ ] Integration tests pass
- [ ] Benchmark compute unit usage

---

## Compute Unit Benefit

| Operation | u128 CU Cost | u64 CU Cost | Savings |
|-----------|--------------|-------------|---------|
| Multiply | ~50-100 CU | ~2 CU | 96-98% |
| Divide | ~100-200 CU | ~5 CU | 95-97% |
| Per tx with 10 ops | ~1500 CU | ~70 CU | ~95% |

Eliminating u128 could save **1000+ compute units per transaction**.
