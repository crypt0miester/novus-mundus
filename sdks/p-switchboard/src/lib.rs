//! p-switchboard: pinocchio / no_std port of the Switchboard On-Demand SDK.
//!
//! Faithful 1:1 port of the pull-feed reader in the audited
//! `switchboard-on-demand` v0.11.3 crate (`PullFeedAccountData`), adapted for
//! no_std / pinocchio.
//!
//! The struct layout, discriminator and the [`SwitchboardFeed::get_value`]
//! algorithm match upstream exactly:
//! - `get_value` recomputes the price from the raw `submissions` ring buffer,
//!   filtering by slot staleness and requiring `min_samples` fresh
//!   submissions — this is the safe path the Switchboard docs recommend.
//! - The lower-bound median (`sort` then `values[len / 2]`) is preserved.
//!
//! Values are `i128` scaled by `10^18` (`PRECISION = 18`).
//!
//! # Example
//! ```ignore
//! use p_switchboard::SwitchboardFeed;
//!
//! let data = feed_account.try_borrow()?;
//! let feed = SwitchboardFeed::load(&data)?;
//! let min_samples = feed.min_sample_size().max(1) as u32;
//! let median = feed.get_value(current_slot, 100, min_samples, true)?;
//! ```

#![cfg_attr(not(test), no_std)]

#[cfg(all(not(feature = "no-panic-handler"), not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

use pinocchio::error::ProgramError;

// CONSTANTS

/// Anchor discriminator for `PullFeedAccountData` (switchboard-on-demand).
pub const ON_DEMAND_DISCRIMINATOR: [u8; 8] = [196, 27, 108, 196, 10, 215, 219, 40];

/// Switchboard On-Demand values are fixed-point scaled by `10^18`.
pub const PRECISION: u32 = 18;

/// Number of slots in the `submissions` ring buffer.
const NUM_SUBMISSIONS: usize = 32;
/// Size of one `OracleSubmission`: oracle[32] + slot(8) + landed_at(8) + value(16).
const SUBMISSION_SIZE: usize = 64;

/// `size_of::<PullFeedAccountData>()` for v0.11.3 (verified field-by-field).
const PULL_FEED_STRUCT_SIZE: usize = 3200;
/// Minimum total account length: 8-byte discriminator + struct.
pub const MIN_PULL_FEED_LEN: usize = 8 + PULL_FEED_STRUCT_SIZE;

// Byte offsets into the account data (including the 8-byte discriminator).
// Derived from the `#[repr(C)]` `PullFeedAccountData` layout in v0.11.3.

/// `submissions: [OracleSubmission; 32]` begins right after the discriminator.
const OFF_SUBMISSIONS: usize = 8;
/// `min_responses: u32`.
const OFF_MIN_RESPONSES: usize = 2176;
/// `min_sample_size: u8`.
const OFF_MIN_SAMPLE_SIZE: usize = 2215;
/// `last_update_timestamp: i64`.
const OFF_LAST_UPDATE_TS: usize = 2216;
/// `result: CurrentResult` begins here.
const OFF_RESULT: usize = 2264;
/// `result.value: i128`.
const OFF_RESULT_VALUE: usize = OFF_RESULT;
/// `result.std_dev: i128`.
const OFF_RESULT_STD_DEV: usize = OFF_RESULT + 16;
/// `result.num_samples: u8` (after 6 i128 stat fields = 96 bytes).
const OFF_RESULT_NUM_SAMPLES: usize = OFF_RESULT + 96;
/// `result.slot: u64` (the slot at which the result was signed).
const OFF_RESULT_SLOT: usize = OFF_RESULT + 104;
/// `max_staleness: u32`.
const OFF_MAX_STALENESS: usize = OFF_RESULT + 128;

// Within one OracleSubmission:
/// `OracleSubmission.slot: u64`.
const SUB_OFF_SLOT: usize = 32;
/// `OracleSubmission.value: i128`.
const SUB_OFF_VALUE: usize = 48;

// ERRORS

/// Errors surfaced by this crate.
///
/// On-chain these surface as `ProgramError::Custom(6200 + variant)`.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwitchboardError {
    /// Account data is too short for a `PullFeedAccountData`.
    InvalidAccountData = 0,
    /// The 8-byte Anchor discriminator does not match.
    InvalidDiscriminator = 1,
    /// Fewer than `min_samples` fresh submissions were available.
    NotEnoughSamples = 2,
    /// The aggregated result is older than the staleness threshold.
    StaleResult = 3,
    /// The resolved value is non-positive while `only_positive` was set.
    IllegalFeedValue = 4,
    /// The standard deviation is wider than the caller's threshold.
    ConfidenceTooWide = 5,
}

impl From<SwitchboardError> for ProgramError {
    fn from(e: SwitchboardError) -> Self {
        ProgramError::Custom(6200 + e as u32)
    }
}

// PRICE OUTPUT

/// Resolved Switchboard price (`i128` values scaled by `10^18`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SwitchboardPrice {
    /// Median value across the fresh oracle submissions (`get_value` result).
    pub value: i128,
    /// Standard deviation of the on-chain aggregated `CurrentResult`.
    pub std_dev: i128,
    /// Slot at which the on-chain `CurrentResult` was signed.
    pub result_slot: u64,
}

impl SwitchboardPrice {
    /// Convert the price to a `u64` scaled to `target_decimals`.
    ///
    /// Returns `None` on a non-positive value or on overflow.
    pub fn get_price_in_decimals(&self, target_decimals: u32) -> Option<u64> {
        if self.value <= 0 {
            return None;
        }
        let value = self.value as u128;
        if target_decimals >= PRECISION {
            let multiplier = 10u128.checked_pow(target_decimals - PRECISION)?;
            u64::try_from(value.checked_mul(multiplier)?).ok()
        } else {
            let divisor = 10u128.checked_pow(PRECISION - target_decimals)?;
            u64::try_from(value / divisor).ok()
        }
    }

    /// Check the standard deviation is within `max_std_dev_bps` basis points
    /// of the value. `max_std_dev_bps == 0` disables the check.
    pub fn is_confidence_acceptable(&self, max_std_dev_bps: u16) -> bool {
        if max_std_dev_bps == 0 {
            return true;
        }
        if self.value <= 0 {
            return false;
        }
        let price_abs = self.value.unsigned_abs();
        let std_dev_abs = self.std_dev.unsigned_abs();
        let bps = std_dev_abs.saturating_mul(10000) / price_abs;
        bps <= max_std_dev_bps as u128
    }
}

// FEED READER

/// A validated view over a `PullFeedAccountData` account.
///
/// The caller MUST separately verify the account is owned by the Switchboard
/// On-Demand program — the discriminator alone does not prove provenance.
#[derive(Clone, Copy, Debug)]
pub struct SwitchboardFeed<'a> {
    data: &'a [u8],
}

impl<'a> SwitchboardFeed<'a> {
    /// Validate and wrap raw account data.
    ///
    /// Mirrors `PullFeedAccountData::parse`: checks the discriminator and that
    /// the buffer is large enough for the full struct.
    pub fn load(data: &'a [u8]) -> Result<Self, SwitchboardError> {
        if data.len() < 8 {
            return Err(SwitchboardError::InvalidDiscriminator);
        }
        if data[..8] != ON_DEMAND_DISCRIMINATOR {
            return Err(SwitchboardError::InvalidDiscriminator);
        }
        if data.len() < MIN_PULL_FEED_LEN {
            return Err(SwitchboardError::InvalidAccountData);
        }
        Ok(Self { data })
    }

    /// `min_sample_size`: the feed's configured minimum samples for a valid result.
    pub fn min_sample_size(&self) -> u8 {
        self.data[OFF_MIN_SAMPLE_SIZE]
    }

    /// `min_responses`: the feed's configured minimum oracle responses.
    pub fn min_responses(&self) -> u32 {
        read_u32(self.data, OFF_MIN_RESPONSES)
    }

    /// `max_staleness`: the feed's own configured staleness bound, in slots.
    pub fn max_staleness(&self) -> u32 {
        read_u32(self.data, OFF_MAX_STALENESS)
    }

    /// Unix timestamp of the last feed update.
    pub fn last_update_timestamp(&self) -> i64 {
        read_i64(self.data, OFF_LAST_UPDATE_TS)
    }

    /// `CurrentResult.value` — the on-chain aggregated median (`10^18` scale).
    pub fn current_result_value(&self) -> i128 {
        read_i128(self.data, OFF_RESULT_VALUE)
    }

    /// `CurrentResult.std_dev` — std deviation of the aggregated result.
    pub fn current_result_std_dev(&self) -> i128 {
        read_i128(self.data, OFF_RESULT_STD_DEV)
    }

    /// `CurrentResult.slot` — slot at which the aggregated result was signed.
    pub fn current_result_slot(&self) -> u64 {
        read_u64(self.data, OFF_RESULT_SLOT)
    }

    /// `CurrentResult.num_samples` — submissions that fed the aggregated result.
    pub fn current_result_num_samples(&self) -> u8 {
        self.data[OFF_RESULT_NUM_SAMPLES]
    }

    /// Faithful port of `PullFeedAccountData::get_value`.
    ///
    /// Returns the lower-bound median of the oracle submissions made in the
    /// last `max_staleness` slots. The `submissions` ring buffer is walked
    /// with `take_while(!is_empty)` (an empty slot has `slot == 0`), fresh
    /// submissions (`slot >= clock_slot - max_staleness`) are collected, and:
    /// - fewer than `min_samples` fresh submissions => `NotEnoughSamples`;
    /// - the median is `sorted[len / 2]` (lower-bound median);
    /// - `only_positive && median <= 0` => `IllegalFeedValue`.
    ///
    /// The returned value is `i128` scaled by `10^18`.
    pub fn get_value(
        &self,
        clock_slot: u64,
        max_staleness: u64,
        min_samples: u32,
        only_positive: bool,
    ) -> Result<i128, SwitchboardError> {
        let min_valid_slot = clock_slot.saturating_sub(max_staleness);

        let mut values = [0i128; NUM_SUBMISSIONS];
        let mut count: usize = 0;
        for i in 0..NUM_SUBMISSIONS {
            let base = OFF_SUBMISSIONS + i * SUBMISSION_SIZE;
            let slot = read_u64(self.data, base + SUB_OFF_SLOT);
            // take_while(!is_empty): an uninitialized submission has slot == 0.
            if slot == 0 {
                break;
            }
            // filter(slot >= clock_slot - max_staleness)
            if slot >= min_valid_slot {
                values[count] = read_i128(self.data, base + SUB_OFF_VALUE);
                count += 1;
            }
        }

        if count == 0 || (count as u32) < min_samples {
            return Err(SwitchboardError::NotEnoughSamples);
        }

        // lower_bound_median: sort ascending, take element at len / 2.
        insertion_sort(&mut values[..count]);
        let median = values[count / 2];

        if only_positive && median <= 0 {
            return Err(SwitchboardError::IllegalFeedValue);
        }
        Ok(median)
    }
}

/// Validate the 8-byte Anchor discriminator (config-time helper).
pub fn validate_discriminator(data: &[u8]) -> Result<(), SwitchboardError> {
    if data.len() < 8 {
        return Err(SwitchboardError::InvalidDiscriminator);
    }
    if data[..8] != ON_DEMAND_DISCRIMINATOR {
        return Err(SwitchboardError::InvalidDiscriminator);
    }
    Ok(())
}

/// Resolve a Switchboard price via the faithful `get_value` path.
///
/// Walks the submissions ring buffer (fresh-slot filtered, `min_samples`
/// enforced, `only_positive` enforced) for the price, and reads the
/// `CurrentResult` for the accompanying `std_dev` / signing slot.
pub fn load_switchboard_price(
    data: &[u8],
    clock_slot: u64,
    max_staleness: u64,
    min_samples: u32,
    only_positive: bool,
) -> Result<SwitchboardPrice, SwitchboardError> {
    let feed = SwitchboardFeed::load(data)?;
    let value = feed.get_value(clock_slot, max_staleness, min_samples, only_positive)?;
    Ok(SwitchboardPrice {
        value,
        std_dev: feed.current_result_std_dev(),
        result_slot: feed.current_result_slot(),
    })
}

/// Like [`load_switchboard_price`], plus a standard-deviation confidence gate.
pub fn load_switchboard_price_with_confidence(
    data: &[u8],
    clock_slot: u64,
    max_staleness: u64,
    min_samples: u32,
    only_positive: bool,
    max_std_dev_bps: u16,
) -> Result<SwitchboardPrice, SwitchboardError> {
    let price =
        load_switchboard_price(data, clock_slot, max_staleness, min_samples, only_positive)?;
    if !price.is_confidence_acceptable(max_std_dev_bps) {
        return Err(SwitchboardError::ConfidenceTooWide);
    }
    Ok(price)
}

// HELPERS

/// In-place ascending insertion sort. `n <= 32`, so this is cheap.
fn insertion_sort(values: &mut [i128]) {
    for i in 1..values.len() {
        let mut j = i;
        while j > 0 && values[j - 1] > values[j] {
            values.swap(j - 1, j);
            j -= 1;
        }
    }
}

#[inline(always)]
fn read_u32(data: &[u8], off: usize) -> u32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&data[off..off + 4]);
    u32::from_le_bytes(buf)
}

#[inline(always)]
fn read_i64(data: &[u8], off: usize) -> i64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[off..off + 8]);
    i64::from_le_bytes(buf)
}

#[inline(always)]
fn read_u64(data: &[u8], off: usize) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[off..off + 8]);
    u64::from_le_bytes(buf)
}

#[inline(always)]
fn read_i128(data: &[u8], off: usize) -> i128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&data[off..off + 16]);
    i128::from_le_bytes(buf)
}

// TESTS

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal valid account buffer with the given submissions
    /// (`(slot, value)` pairs) and a `CurrentResult`.
    fn build_account(
        submissions: &[(u64, i128)],
        result_value: i128,
        result_std_dev: i128,
        result_slot: u64,
        min_sample_size: u8,
    ) -> Vec<u8> {
        let mut data = vec![0u8; MIN_PULL_FEED_LEN];
        data[..8].copy_from_slice(&ON_DEMAND_DISCRIMINATOR);
        for (i, (slot, value)) in submissions.iter().enumerate() {
            let base = OFF_SUBMISSIONS + i * SUBMISSION_SIZE;
            data[base + SUB_OFF_SLOT..base + SUB_OFF_SLOT + 8].copy_from_slice(&slot.to_le_bytes());
            data[base + SUB_OFF_VALUE..base + SUB_OFF_VALUE + 16]
                .copy_from_slice(&value.to_le_bytes());
        }
        data[OFF_MIN_SAMPLE_SIZE] = min_sample_size;
        data[OFF_RESULT_VALUE..OFF_RESULT_VALUE + 16].copy_from_slice(&result_value.to_le_bytes());
        data[OFF_RESULT_STD_DEV..OFF_RESULT_STD_DEV + 16]
            .copy_from_slice(&result_std_dev.to_le_bytes());
        data[OFF_RESULT_SLOT..OFF_RESULT_SLOT + 8].copy_from_slice(&result_slot.to_le_bytes());
        data
    }

    #[test]
    fn struct_size_is_known() {
        // Guards the hand-derived layout offsets.
        assert_eq!(OFF_RESULT, 2264);
        assert_eq!(OFF_MAX_STALENESS, 2392);
        assert_eq!(MIN_PULL_FEED_LEN, 3208);
    }

    #[test]
    fn get_value_median_of_fresh_submissions() {
        let one = 1_000_000_000_000_000_000i128; // 1.0 at 10^18
        let subs = [
            (100, 3 * one),
            (101, 1 * one),
            (102, 2 * one),
        ];
        let data = build_account(&subs, 2 * one, 0, 102, 1);
        let feed = SwitchboardFeed::load(&data).unwrap();
        // Fresh window covers all three; median of [1,2,3] = 2.
        assert_eq!(feed.get_value(110, 50, 1, true).unwrap(), 2 * one);
    }

    #[test]
    fn get_value_filters_stale_submissions() {
        let one = 1_000_000_000_000_000_000i128;
        // slot 10 is stale relative to clock 200 / max_staleness 50.
        let subs = [(10, 99 * one), (180, 5 * one), (185, 7 * one)];
        let data = build_account(&subs, 6 * one, 0, 185, 1);
        let feed = SwitchboardFeed::load(&data).unwrap();
        // Only slots 180,185 are fresh; median of [5,7] = sorted[1] = 7.
        assert_eq!(feed.get_value(200, 50, 1, true).unwrap(), 7 * one);
    }

    #[test]
    fn get_value_enforces_min_samples() {
        let one = 1_000_000_000_000_000_000i128;
        let subs = [(180, 5 * one), (185, 7 * one)];
        let data = build_account(&subs, 6 * one, 0, 185, 1);
        let feed = SwitchboardFeed::load(&data).unwrap();
        assert_eq!(
            feed.get_value(200, 50, 5, true),
            Err(SwitchboardError::NotEnoughSamples)
        );
    }

    #[test]
    fn get_value_stops_at_first_empty_slot() {
        let one = 1_000_000_000_000_000_000i128;
        // A slot==0 entry terminates the take_while; later entries are ignored.
        let subs = [(180, 5 * one), (0, 0), (185, 999 * one)];
        let data = build_account(&subs, 5 * one, 0, 180, 1);
        let feed = SwitchboardFeed::load(&data).unwrap();
        assert_eq!(feed.get_value(200, 50, 1, true).unwrap(), 5 * one);
    }

    #[test]
    fn get_value_rejects_non_positive_when_only_positive() {
        let subs = [(180, -1), (185, -2), (186, -3)];
        let data = build_account(&subs, -2, 0, 186, 1);
        let feed = SwitchboardFeed::load(&data).unwrap();
        assert_eq!(
            feed.get_value(200, 50, 1, true),
            Err(SwitchboardError::IllegalFeedValue)
        );
    }

    #[test]
    fn bad_discriminator_rejected() {
        let mut data = build_account(&[(1, 1)], 1, 0, 1, 1);
        data[0] ^= 0xff;
        assert_eq!(
            SwitchboardFeed::load(&data).unwrap_err(),
            SwitchboardError::InvalidDiscriminator
        );
    }

    #[test]
    fn short_account_rejected() {
        let data = vec![0u8; 100];
        assert_eq!(
            SwitchboardFeed::load(&data).unwrap_err(),
            SwitchboardError::InvalidDiscriminator
        );
        let mut short = vec![0u8; 2400];
        short[..8].copy_from_slice(&ON_DEMAND_DISCRIMINATOR);
        assert_eq!(
            SwitchboardFeed::load(&short).unwrap_err(),
            SwitchboardError::InvalidAccountData
        );
    }

    #[test]
    fn confidence_gate() {
        let price = SwitchboardPrice {
            value: 10_000_000_000_000_000_000_000, // $10000
            std_dev: 100_000_000_000_000_000_000,  // $100 = 1%
            result_slot: 0,
        };
        assert!(price.is_confidence_acceptable(100));
        assert!(price.is_confidence_acceptable(200));
        assert!(!price.is_confidence_acceptable(50));
        assert!(price.is_confidence_acceptable(0)); // disabled
    }

    #[test]
    fn price_to_decimals() {
        let price = SwitchboardPrice {
            value: 2_650_500_000_000_000_000_000, // $2650.50
            std_dev: 0,
            result_slot: 0,
        };
        assert_eq!(price.get_price_in_decimals(6), Some(2_650_500_000));
    }

    #[test]
    fn load_switchboard_price_populates_result_fields() {
        let one = 1_000_000_000_000_000_000i128;
        let subs = [(180, 5 * one), (185, 7 * one), (186, 6 * one)];
        let data = build_account(&subs, 6 * one, one / 10, 186, 1);
        let price = load_switchboard_price(&data, 200, 50, 1, true).unwrap();
        assert_eq!(price.value, 6 * one); // median of [5,6,7]
        assert_eq!(price.std_dev, one / 10);
        assert_eq!(price.result_slot, 186);
    }
}
