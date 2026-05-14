//! Branch-prediction hints — the `no_std` analogue of
//! `core::intrinsics::unlikely`. On the SBF backend `cold_path()` is laid
//! down as cold so LLVM lays the success branch as fall-through.
//! ~1–3 CU saved per call site, multiplied across every `require_*`.

#![allow(dead_code)]

/// Marker call telling the optimizer this region is unlikely.
#[cold]
#[inline(always)]
pub const fn cold_path() {}

/// Returns `b` after telling LLVM the `true` arm is the cold path.
#[inline(always)]
pub const fn unlikely(b: bool) -> bool {
    if b {
        cold_path();
        true
    } else {
        false
    }
}
