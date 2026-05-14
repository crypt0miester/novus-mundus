//! Rent-exemption math.
//!
//! Mirrors pinocchio's `Rent::minimum_balance_unchecked` for the
//! `CURRENT_EXEMPTION_THRESHOLD == 2.0` branch, evaluated at compile time.
//! Use `rent_exempt_const` for statically-known account sizes; fall back to
//! `Rent::try_minimum_balance` for dynamic.
//!
//! REVISIT on SIMD-0194 activation: the new threshold drops the `2*` factor
//! (exemption_threshold = 1.0). After activation, `rent_exempt_const`
//! over-funds by 2× (harmless but wasteful) until updated.

#![allow(dead_code)]

pub const ACCOUNT_STORAGE_OVERHEAD: u64 = 128;
pub const DEFAULT_LAMPORTS_PER_BYTE: u64 = 6960;

/// Compile-time minimum lamports for rent exemption at the current threshold (2.0).
#[inline(always)]
pub const fn rent_exempt_const(space: usize) -> u64 {
    2 * (ACCOUNT_STORAGE_OVERHEAD + space as u64) * DEFAULT_LAMPORTS_PER_BYTE
}
