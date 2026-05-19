//! p-switchboard: pinocchio / no_std port of Switchboard On-Demand
//! **OracleQuote** verification.
//!
//! Vendored and ported from the audited `switchboard-on-demand` crate
//! v0.12.1 (crates.io, MIT). Only the on-chain *verify + write* path of the
//! `oracle_quote` module is kept — the anchor / client / borsh / decimal
//! machinery is dropped. The verification *logic* is a faithful 1:1 copy of
//! upstream; the changes are mechanical: `anyhow` → [`SbError`], `std` →
//! `core`, pinocchio 0.9 `AccountInfo` → pinocchio 0.10 `AccountView`.
//!
//! Re-vendor from the same upstream module on a Switchboard format rev.
//!
//! Upstream sources ported here:
//! - `src/on_demand/oracle_quote/{feed_info,quote,quote_verifier}.rs`
//! - `src/sysvar/{ed25519_sysvar,ix_sysvar}.rs`
//! - `src/on_demand/accounts/queue.rs` (`QueueAccountData` layout)
//!
//! # Example
//! ```ignore
//! use p_switchboard::QuoteVerifier;
//!
//! let quote = QuoteVerifier::new()
//!     .queue(queue_account)
//!     .slothash_sysvar(slothashes_sysvar)
//!     .ix_sysvar(instructions_sysvar)
//!     .clock_slot(current_slot)
//!     .max_age(30)
//!     .verify_account(quote_account)?;
//!
//! for feed in quote.feeds() {
//!     // feed.feed_id() : &[u8; 32], feed.feed_value() : i128 (scaled 1e18)
//! }
//! ```

#![cfg_attr(not(test), no_std)]

// Required for no_std when building as a standalone program (not for tests,
// and not when the host program supplies its own panic handler).
#[cfg(all(not(feature = "no-panic-handler"), not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

use pinocchio::error::ProgramError;

pub mod ed25519;
pub mod feed_info;
pub mod ix_sysvar;
pub mod queue;
pub mod quote;
pub mod verifier;

pub use ed25519::Ed25519Sysvar;
pub use feed_info::{PackedFeedInfo, PackedQuoteHeader};
pub use ix_sysvar::Instructions;
pub use queue::QueueAccountData;
pub use quote::{OracleQuote, QUOTE_DISCRIMINATOR, QUOTE_DISCRIMINATOR_U64_LE};
pub use verifier::QuoteVerifier;

// ── Program / sysvar addresses ───────────────────────────────────────────────

/// Solana ed25519 signature-verification precompile program.
pub const ED25519_PROGRAM_ID: [u8; 32] =
    five8_const::decode_32_const("Ed25519SigVerify111111111111111111111111111");

/// Instructions sysvar (`Sysvar1nstructions1111111111111111111111111`).
pub const INSTRUCTIONS_SYSVAR_ID: [u8; 32] =
    five8_const::decode_32_const("Sysvar1nstructions1111111111111111111111111");

/// SlotHashes sysvar (`SysvarS1otHashes111111111111111111111111111`).
pub const SLOT_HASHES_SYSVAR_ID: [u8; 32] =
    five8_const::decode_32_const("SysvarS1otHashes111111111111111111111111111");

/// Switchboard On-Demand quote program (`orac1e…`), owner of canonical
/// oracle-quote accounts.
pub const QUOTE_PROGRAM_ID: [u8; 32] =
    five8_const::decode_32_const("orac1eFjzWL5R3RbbdMV68K9H6TaCVVcL6LjvQQWAbz");

// ── Errors ───────────────────────────────────────────────────────────────────

/// Errors surfaced by quote verification.
///
/// On-chain these surface as `ProgramError::Custom(6200 + variant)`. They
/// replace the upstream `anyhow` error strings (dropped for `no_std`).
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SbError {
    /// Account data is shorter than the minimum required.
    AccountTooSmall = 0,
    /// Oracle-quote account discriminator did not match `SBOracle`.
    InvalidDiscriminator = 1,
    /// Queue account is not exactly `8 + size_of::<QueueAccountData>()` bytes.
    QueueWrongSize = 2,
    /// A required builder account (queue / sysvar / clock slot) was not set.
    MissingAccount = 3,
    /// Quote `recent_slot` is older than `max_age`, or ahead of the clock.
    QuoteTooOld = 4,
    /// The ed25519 instruction carried zero signatures.
    NoSignatures = 5,
    /// The quote's signed slot hash was not found in the SlotHashes sysvar.
    SlotHashNotFound = 6,
    /// The ed25519 instruction data was malformed (length / offset checks).
    MalformedInstruction = 7,
    /// The requested feed id was not present in the verified quote.
    FeedNotFound = 8,
}

impl From<SbError> for ProgramError {
    fn from(e: SbError) -> Self {
        ProgramError::Custom(6200 + e as u32)
    }
}

// ── Shared low-level helpers (ported from upstream `src/utils.rs`) ───────────

/// One entry of the SlotHashes sysvar: `(slot, hash)`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct SlotHash {
    /// Slot number.
    pub slot: u64,
    /// 32-byte bank hash for `slot`.
    pub hash: [u8; 32],
}

/// Compares two 32-byte values for equality via four unaligned `u64` reads.
#[inline(always)]
pub fn check_pubkey_eq<L: AsRef<[u8]>, R: AsRef<[u8]>>(lhs: L, rhs: R) -> bool {
    let lhs_bytes = lhs.as_ref();
    let rhs_bytes = rhs.as_ref();
    unsafe {
        let lhs_ptr = lhs_bytes.as_ptr() as *const u64;
        let rhs_ptr = rhs_bytes.as_ptr() as *const u64;
        check_p64_eq(lhs_ptr, rhs_ptr)
    }
}

/// Compares two 32-byte regions (4 × `u64`) for equality.
///
/// # Safety
/// Both pointers must reference at least 32 readable bytes.
#[inline(always)]
pub unsafe fn check_p64_eq(lhs_ptr: *const u64, rhs_ptr: *const u64) -> bool {
    use core::ptr::read_unaligned;
    read_unaligned(lhs_ptr) == read_unaligned(rhs_ptr)
        && read_unaligned(lhs_ptr.add(1)) == read_unaligned(rhs_ptr.add(1))
        && read_unaligned(lhs_ptr.add(2)) == read_unaligned(rhs_ptr.add(2))
        && read_unaligned(lhs_ptr.add(3)) == read_unaligned(rhs_ptr.add(3))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::size_of;

    // Layout pins — these must match the wire formats Switchboard oracles
    // sign / write. A mismatch silently breaks verification.
    #[test]
    fn struct_layouts() {
        assert_eq!(size_of::<feed_info::PackedQuoteHeader>(), 32);
        assert_eq!(size_of::<feed_info::PackedFeedInfo>(), 49);
        assert_eq!(feed_info::PackedFeedInfo::PACKED_SIZE, 49);
        assert_eq!(size_of::<SlotHash>(), 40);
        assert_eq!(size_of::<ed25519::Ed25519SignatureOffsets>(), 14);
        assert_eq!(
            size_of::<ed25519::Ed25519SignatureOffsets>(),
            ed25519::ED25519_SIGNATURE_OFFSETS_SERIALIZED_SIZE
        );
        // QueueAccountData layout is also pinned by a `const _` assert in queue.rs.
        assert_eq!(size_of::<queue::QueueAccountData>(), 6272);
        assert_eq!(queue::QUEUE_ACCOUNT_LEN, 6280);
    }

    #[test]
    fn quote_discriminator() {
        assert_eq!(&QUOTE_DISCRIMINATOR, b"SBOracle");
        assert_eq!(
            QUOTE_DISCRIMINATOR_U64_LE,
            u64::from_le_bytes(*b"SBOracle")
        );
    }

    #[test]
    fn pubkey_eq() {
        let a = [7u8; 32];
        let mut b = [7u8; 32];
        assert!(check_pubkey_eq(a, b));
        b[31] = 8;
        assert!(!check_pubkey_eq(a, b));
        b[31] = 7;
        b[0] = 9;
        assert!(!check_pubkey_eq(a, b));
    }

    #[test]
    fn addresses_decode() {
        // 32-byte addresses decoded at compile time from base58.
        assert_eq!(ED25519_PROGRAM_ID.len(), 32);
        assert_ne!(INSTRUCTIONS_SYSVAR_ID, [0u8; 32]);
        assert_ne!(SLOT_HASHES_SYSVAR_ID, INSTRUCTIONS_SYSVAR_ID);
    }
}
