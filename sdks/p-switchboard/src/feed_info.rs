//! Packed feed-info structures carried inside an oracle quote.
//!
//! Ported from `switchboard-on-demand` 0.12.1
//! `src/on_demand/oracle_quote/feed_info.rs`. Only the zero-copy structs and
//! their accessors are kept; the borsh / anchor / `rust_decimal` paths
//! (`value()`, `hex_id()`) are dropped — on-chain we work with the raw
//! fixed-point `i128` (`feed_value()`) directly.

/// Packed quote header: the 32-byte slot hash signed by every oracle in the
/// quote. Used to validate freshness against the SlotHashes sysvar.
///
/// Size: 32 bytes.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(packed)]
pub struct PackedQuoteHeader {
    /// The 32-byte slot hash signed by all oracles in the quote.
    pub signed_slothash: [u8; 32],
}

/// Packed per-feed information: id, value, and minimum-sample requirement.
///
/// Size: 49 bytes (32 + 16 + 1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(packed)]
pub struct PackedFeedInfo {
    /// 32-byte unique identifier for this feed.
    pub feed_id: [u8; 32],
    /// Feed value as a fixed-point integer (scaled by 1e18).
    pub feed_value: i128,
    /// Minimum number of oracle samples required for this feed.
    pub min_oracle_samples: u8,
}

impl PackedFeedInfo {
    /// Serialized size of this packed structure, in bytes.
    pub const PACKED_SIZE: usize = 49;

    /// Returns a reference to the 32-byte feed id.
    ///
    /// `feed_id` is `[u8; 32]` (alignment 1), so referencing it within this
    /// `#[repr(packed)]` struct is well-defined.
    #[inline(always)]
    pub fn feed_id(&self) -> &[u8; 32] {
        &self.feed_id
    }

    /// Returns the raw feed value as a fixed-point integer (scaled by 1e18).
    #[inline(always)]
    pub fn feed_value(&self) -> i128 {
        self.feed_value
    }

    /// Returns the minimum number of oracle samples required for this feed.
    #[inline(always)]
    pub fn min_oracle_samples(&self) -> u8 {
        self.min_oracle_samples
    }
}
