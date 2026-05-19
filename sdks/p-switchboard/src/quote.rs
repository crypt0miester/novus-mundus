//! Verified oracle quote and the crank write-path.
//!
//! Ported from `switchboard-on-demand` 0.12.1
//! `src/on_demand/oracle_quote/quote.rs`. The `OracleQuote` accessors and the
//! slot-validated write-path are kept; the `Vec`-returning helpers
//! (`feed_ids`, `find_canonical_address`, …), the anchor wrappers and the
//! `_unchecked` write variants are dropped. The write-path keeps upstream's
//! `assert!`/`panic!` preconditions (fail-closed under `panic = abort`); the
//! only mechanical change is `sol_memcpy_` → slice copy.

use core::ptr::read_unaligned;

use pinocchio::AccountView;

use crate::feed_info::{PackedFeedInfo, PackedQuoteHeader};
use crate::ix_sysvar::Instructions;
use crate::SbError;

/// Discriminator prefixing a stored Switchboard oracle-quote account.
pub const QUOTE_DISCRIMINATOR: [u8; 8] = *b"SBOracle";
/// [`QUOTE_DISCRIMINATOR`] as a little-endian `u64` for fast comparison.
pub const QUOTE_DISCRIMINATOR_U64_LE: u64 = u64::from_le_bytes(QUOTE_DISCRIMINATOR);

/// A verified oracle quote: aggregated feed data from one or more oracles,
/// cryptographically verified via ed25519 signatures and the slot-hash sysvar.
///
/// All fields are zero-copy references into the verified instruction data.
#[derive(Clone, Copy)]
pub struct OracleQuote<'a> {
    /// Reference to the quote header containing the signed slot hash.
    quote_header_refs: &'a PackedQuoteHeader,
    /// Number of oracle signatures that verified this quote.
    pub oracle_count: u8,
    /// Zero-copy reference to the packed feed data.
    pub packed_feed_infos: &'a [PackedFeedInfo],
    /// Number of valid feeds in the quote.
    feed_count: u8,
    /// Oracle indices corresponding to the queue's oracle array.
    pub oracle_idxs: &'a [u8],
    /// Recent slot from the ed25519 instruction, used for freshness checks.
    pub recent_slot: u64,
    /// Version from the ed25519 instruction data.
    pub version: u8,
    /// Reference to the raw ed25519 instruction data.
    pub raw_buffer: &'a [u8],
}

impl<'a> OracleQuote<'a> {
    /// Constructs a verified quote. Called only after verification; all
    /// parameters are pre-validated.
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        quote_header_ref: &'a PackedQuoteHeader,
        oracle_count: u8,
        packed_feed_infos: &'a [PackedFeedInfo],
        feed_count: u8,
        oracle_idxs: &'a [u8],
        recent_slot: u64,
        version: u8,
        raw_buffer: &'a [u8],
    ) -> Self {
        Self {
            quote_header_refs: quote_header_ref,
            oracle_count,
            packed_feed_infos,
            feed_count,
            oracle_idxs,
            recent_slot,
            version,
            raw_buffer,
        }
    }

    /// Returns the recent slot the quote was created at.
    #[inline(always)]
    pub fn slot(&self) -> u64 {
        self.recent_slot
    }

    /// Returns the quote format version.
    #[inline(always)]
    pub fn version(&self) -> u8 {
        self.version
    }

    /// Returns the raw verified ed25519 instruction data.
    #[inline(always)]
    pub fn raw_data(&self) -> &[u8] {
        self.raw_buffer
    }

    /// Returns the slice of valid feeds in this quote.
    #[inline(always)]
    pub fn feeds(&self) -> &[PackedFeedInfo] {
        &self.packed_feed_infos[..self.feed_count as usize]
    }

    /// Returns the number of valid feeds in this quote.
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.feed_count as usize
    }

    /// Returns true if this quote contains no feeds.
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.feed_count == 0
    }

    /// Returns the quote header (the verified signed slot hash).
    #[inline(always)]
    pub fn header(&self) -> &'a PackedQuoteHeader {
        self.quote_header_refs
    }

    /// Finds the feed with the given 32-byte feed id.
    #[inline(always)]
    pub fn feed(&self, feed_id: &[u8; 32]) -> Result<&PackedFeedInfo, SbError> {
        self.feeds()
            .iter()
            .find(|info| info.feed_id() == feed_id)
            .ok_or(SbError::FeedNotFound)
    }

    // ── Crank write-path ─────────────────────────────────────────────────────

    /// Validates slot progression before writing oracle data:
    /// - the new slot must be older than the current clock slot (freshness);
    /// - the new slot must not regress below the slot already stored (replay).
    ///
    /// # Panics
    /// Panics if `source` is too short or either slot check fails.
    #[inline(always)]
    fn validate_slot_progression(clock_slot: u64, source: &[u8], existing_data: &[u8]) {
        let source_len = source.len();
        if source_len < 13 {
            panic!("invalid source data length");
        }

        unsafe {
            // Slot sits 13 bytes from the end: slot(8) + version(1) + SBOD(4).
            let slot_offset = source_len - 13;
            let new_slot = read_unaligned(source.as_ptr().add(slot_offset) as *const u64);

            assert!(new_slot < clock_slot, "SB oracle slot is stale");

            if existing_data.len() >= 13 {
                let existing_slot_offset = existing_data.len() - 13;
                let existing_slot =
                    read_unaligned(existing_data.as_ptr().add(existing_slot_offset) as *const u64);
                assert!(new_slot >= existing_slot, "SB oracle slot regression");
            }
        }
    }

    /// Writes `source` into `dst` with a 2-byte little-endian length prefix,
    /// after validating slot progression against the current `dst` contents.
    ///
    /// # Panics
    /// Panics if slot validation fails or `dst` is too small.
    #[inline(always)]
    pub fn store_delimited(clock_slot: u64, source: &[u8], dst: &mut [u8]) {
        Self::validate_slot_progression(clock_slot, source, dst);
        let data_len = source.len();
        assert!(data_len + 2 <= dst.len(), "destination buffer too small");
        dst[0..2].copy_from_slice(&(data_len as u16).to_le_bytes());
        dst[2..2 + data_len].copy_from_slice(source);
    }

    /// Writes ed25519 instruction data into an oracle-quote account buffer,
    /// laying out `[discriminator(8)][queue(32)][len(2)][source]`.
    ///
    /// # Panics
    /// Panics if `dst` is too small or slot validation fails.
    #[inline(always)]
    pub fn write(clock_slot: u64, source: &[u8], queue: &[u8; 32], dst: &mut [u8]) {
        // discriminator(8) + queue(32) + len(2) + minimum data (13 bytes).
        assert!(dst.len() >= 55, "oracle account too small");
        dst[0..8].copy_from_slice(&QUOTE_DISCRIMINATOR);
        dst[8..40].copy_from_slice(queue);
        Self::store_delimited(clock_slot, source, &mut dst[40..]);
    }

    /// Extracts the ed25519 oracle-quote instruction at `instruction_index`
    /// from the Instructions sysvar and writes it into the oracle-quote
    /// account buffer `dst` with slot validation.
    ///
    /// # Panics
    /// Panics if instruction extraction or slot validation fails.
    #[inline(always)]
    pub fn write_from_ix(
        ix_sysvar: &AccountView,
        dst: &mut [u8],
        queue: &[u8; 32],
        curr_slot: u64,
        instruction_index: usize,
    ) {
        let data = Instructions::extract_ix_data(ix_sysvar, instruction_index);
        Self::write(curr_slot, data, queue, dst);
    }
}
