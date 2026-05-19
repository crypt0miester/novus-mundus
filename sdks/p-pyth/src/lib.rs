//! p-pyth: pinocchio / no_std port of the Pyth Solana receiver SDK.
//!
//! This is a faithful 1:1 port of the price-reading logic in the audited
//! `pyth-solana-receiver-sdk` v1.2.0 (`price_update.rs`), adapted for no_std /
//! pinocchio. It reads the modern Pyth **pull** oracle account format
//! (`PriceUpdateV2`, an Anchor `#[account]` = Borsh-serialized struct) — NOT
//! the deprecated legacy push-oracle price account, which Pyth sunset on
//! 2024-06-30.
//!
//! Behaviour kept identical to the upstream SDK:
//! - `VerificationLevel` enum + `gte` ordering.
//! - `get_price_unchecked` verifies `price_message.feed_id == feed_id`.
//! - `get_price_no_older_than` requires `VerificationLevel::Full` and a
//!   `publish_time` no older than `maximum_age` seconds.
//!
//! The only addition over the upstream SDK is [`Price::is_confidence_acceptable`],
//! a local convenience for callers that gate on the confidence interval.
//!
//! # Example
//! ```ignore
//! use p_pyth::PriceUpdateV2;
//!
//! let data = price_account.try_borrow()?;
//! let update = PriceUpdateV2::parse(&data)?;
//! let price = update.get_price_no_older_than(current_timestamp, 60, &feed_id)?;
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

// CONSTANTS

/// Anchor account discriminator for `PriceUpdateV2`.
///
/// First 8 bytes of `sha256("account:PriceUpdateV2")`.
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// Borsh enum tag for `VerificationLevel::Partial` (variant index 0).
const VL_TAG_PARTIAL: u8 = 0;
/// Borsh enum tag for `VerificationLevel::Full` (variant index 1).
const VL_TAG_FULL: u8 = 1;

/// Serialized size of an embedded `PriceFeedMessage` (Borsh, no padding).
///
/// feed_id(32) + price(8) + conf(8) + exponent(4) + publish_time(8)
/// + prev_publish_time(8) + ema_price(8) + ema_conf(8) = 84.
const PRICE_FEED_MESSAGE_LEN: usize = 84;

/// A 32-byte Pyth price-feed identifier (`pythnet_sdk::messages::FeedId`).
pub type FeedId = [u8; 32];

// ERROR CODES

/// Errors surfaced by this crate.
///
/// The numbers mirror the upstream `GetPriceError` semantics; on-chain they
/// surface as `ProgramError::Custom(6100 + variant)`.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PythError {
    /// Account data is too short for a `PriceUpdateV2`.
    InvalidAccountData = 0,
    /// The 8-byte Anchor discriminator does not match `PriceUpdateV2`.
    InvalidDiscriminator = 1,
    /// The `verification_level` enum tag byte is neither `Partial` nor `Full`.
    InvalidVerificationLevel = 2,
    /// The update's `feed_id` does not match the requested feed.
    MismatchedFeedId = 3,
    /// The update's verification level is lower than required.
    InsufficientVerificationLevel = 4,
    /// `publish_time` is older than the requested `maximum_age`.
    PriceTooOld = 5,
    /// The confidence interval is wider than the caller's threshold.
    ConfidenceTooWide = 6,
}

impl From<PythError> for ProgramError {
    fn from(e: PythError) -> Self {
        ProgramError::Custom(6100 + e as u32)
    }
}

// DATA STRUCTURES

/// Mirrors `pyth_solana_receiver_sdk::price_update::VerificationLevel`.
///
/// `Full` means roughly two-thirds of the current Wormhole guardians have been
/// verified; `Partial` carries the number of signatures actually verified.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    /// Partially verified: `num_signatures` Wormhole guardian signatures.
    Partial {
        /// Number of guardian signatures verified.
        num_signatures: u8,
    },
    /// Fully verified.
    Full,
}

impl VerificationLevel {
    /// Compare two `VerificationLevel`s.
    ///
    /// `Full` is always greater than `Partial`; a `Partial` with more
    /// signatures is greater than one with fewer. Faithful port of the
    /// upstream `VerificationLevel::gte`.
    pub fn gte(&self, other: VerificationLevel) -> bool {
        match self {
            VerificationLevel::Full => true,
            VerificationLevel::Partial { num_signatures } => match other {
                VerificationLevel::Full => false,
                VerificationLevel::Partial {
                    num_signatures: other_num_signatures,
                } => *num_signatures >= other_num_signatures,
            },
        }
    }
}

/// Mirrors `pythnet_sdk::messages::PriceFeedMessage`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PriceFeedMessage {
    /// 32-byte feed identifier.
    pub feed_id: FeedId,
    /// Price. Real value is `price * 10^exponent`.
    pub price: i64,
    /// Confidence interval, same scale as `price`.
    pub conf: u64,
    /// Price exponent (typically negative).
    pub exponent: i32,
    /// Unix timestamp (seconds) of this price update.
    pub publish_time: i64,
    /// Unix timestamp of the previous price update.
    pub prev_publish_time: i64,
    /// Exponentially-weighted moving-average price.
    pub ema_price: i64,
    /// EMA confidence interval.
    pub ema_conf: u64,
}

/// Mirrors `pyth_solana_receiver_sdk::price_update::Price`.
///
/// The real price is `(price ± conf) * 10^exponent`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Price {
    /// Price value.
    pub price: i64,
    /// Confidence interval, same scale as `price`.
    pub conf: u64,
    /// Price exponent.
    pub exponent: i32,
    /// Unix timestamp (seconds) when the price was published.
    pub publish_time: i64,
}

impl Price {
    /// Calculate the price as a `u64` scaled to a target exponent.
    ///
    /// Returns `None` on a negative price or on overflow.
    pub fn get_price_in_target_expo(&self, target_expo: i32) -> Option<u64> {
        if self.price < 0 {
            return None;
        }
        let price = self.price as u64;
        let expo_diff = self.exponent - target_expo;
        if expo_diff >= 0 {
            let multiplier = 10u64.checked_pow(expo_diff as u32)?;
            price.checked_mul(multiplier)
        } else {
            let divisor = 10u64.checked_pow((-expo_diff) as u32)?;
            Some(price / divisor)
        }
    }

    /// Local extra (not in the upstream SDK): check the confidence interval
    /// is within `max_conf_bps` basis points of the price.
    ///
    /// `max_conf_bps == 0` disables the check (always `true`).
    pub fn is_confidence_acceptable(&self, max_conf_bps: u16) -> bool {
        if max_conf_bps == 0 {
            return true;
        }
        if self.price == 0 {
            return false;
        }
        let price_abs = self.price.unsigned_abs();
        let conf_bps = self.conf.saturating_mul(10000) / price_abs;
        conf_bps <= max_conf_bps as u64
    }
}

/// Mirrors `pyth_solana_receiver_sdk::price_update::PriceUpdateV2`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceUpdateV2 {
    /// Authority that posted/owns this update account.
    pub write_authority: [u8; 32],
    /// How thoroughly the underlying Wormhole VAA was verified.
    pub verification_level: VerificationLevel,
    /// The verified price message.
    pub price_message: PriceFeedMessage,
    /// Slot at which this update was posted.
    pub posted_slot: u64,
}

impl PriceUpdateV2 {
    /// Parse a `PriceUpdateV2` from raw account data.
    ///
    /// `data` must be the full account data, starting with the 8-byte Anchor
    /// discriminator. `PriceUpdateV2` is Borsh-serialized, so this decodes
    /// field-by-field; the `verification_level` enum is variable-length
    /// (`Full` = 1 byte, `Partial` = 2 bytes), which shifts everything after it.
    ///
    /// The caller MUST separately verify the account is owned by a Pyth
    /// program — the discriminator alone does not prove provenance.
    pub fn parse(data: &[u8]) -> Result<Self, PythError> {
        // discriminator(8) + write_authority(32) + verification_level tag(1)
        if data.len() < 41 {
            return Err(PythError::InvalidAccountData);
        }
        if data[..8] != PRICE_UPDATE_V2_DISCRIMINATOR {
            return Err(PythError::InvalidDiscriminator);
        }

        let mut write_authority = [0u8; 32];
        write_authority.copy_from_slice(&data[8..40]);

        // verification_level: Borsh enum = 1-byte variant tag + payload.
        let (verification_level, vl_len) = match data[40] {
            VL_TAG_PARTIAL => {
                if data.len() < 42 {
                    return Err(PythError::InvalidAccountData);
                }
                (
                    VerificationLevel::Partial {
                        num_signatures: data[41],
                    },
                    2usize,
                )
            }
            VL_TAG_FULL => (VerificationLevel::Full, 1usize),
            _ => return Err(PythError::InvalidVerificationLevel),
        };

        let pm_off = 40 + vl_len;
        // price_message(84) + posted_slot(8)
        if data.len() < pm_off + PRICE_FEED_MESSAGE_LEN + 8 {
            return Err(PythError::InvalidAccountData);
        }

        let mut feed_id = [0u8; 32];
        feed_id.copy_from_slice(&data[pm_off..pm_off + 32]);
        let price_message = PriceFeedMessage {
            feed_id,
            price: read_i64(data, pm_off + 32),
            conf: read_u64(data, pm_off + 40),
            exponent: read_i32(data, pm_off + 48),
            publish_time: read_i64(data, pm_off + 52),
            prev_publish_time: read_i64(data, pm_off + 60),
            ema_price: read_i64(data, pm_off + 68),
            ema_conf: read_u64(data, pm_off + 76),
        };
        let posted_slot = read_u64(data, pm_off + PRICE_FEED_MESSAGE_LEN);

        Ok(Self {
            write_authority,
            verification_level,
            price_message,
            posted_slot,
        })
    }

    /// Faithful port of `PriceUpdateV2::get_price_unchecked`.
    ///
    /// Verifies the update is for `feed_id`, then returns the price WITHOUT a
    /// staleness or verification-level check. Prefer [`Self::get_price_no_older_than`].
    pub fn get_price_unchecked(&self, feed_id: &FeedId) -> Result<Price, PythError> {
        if self.price_message.feed_id != *feed_id {
            return Err(PythError::MismatchedFeedId);
        }
        Ok(Price {
            price: self.price_message.price,
            conf: self.price_message.conf,
            exponent: self.price_message.exponent,
            publish_time: self.price_message.publish_time,
        })
    }

    /// Faithful port of
    /// `PriceUpdateV2::get_price_no_older_than_with_custom_verification_level`.
    ///
    /// Checks, in order: verification level `>= verification_level`, `feed_id`
    /// match, and `publish_time` no older than `maximum_age` **seconds**
    /// relative to `current_timestamp` (a Unix timestamp).
    pub fn get_price_no_older_than_with_custom_verification_level(
        &self,
        current_timestamp: i64,
        maximum_age: u64,
        feed_id: &FeedId,
        verification_level: VerificationLevel,
    ) -> Result<Price, PythError> {
        if !self.verification_level.gte(verification_level) {
            return Err(PythError::InsufficientVerificationLevel);
        }
        let price = self.get_price_unchecked(feed_id)?;
        if price
            .publish_time
            .saturating_add(maximum_age as i64)
            < current_timestamp
        {
            return Err(PythError::PriceTooOld);
        }
        Ok(price)
    }

    /// Faithful port of `PriceUpdateV2::get_price_no_older_than`.
    ///
    /// Equivalent to the custom-verification variant with
    /// `VerificationLevel::Full` — the safe default.
    pub fn get_price_no_older_than(
        &self,
        current_timestamp: i64,
        maximum_age: u64,
        feed_id: &FeedId,
    ) -> Result<Price, PythError> {
        self.get_price_no_older_than_with_custom_verification_level(
            current_timestamp,
            maximum_age,
            feed_id,
            VerificationLevel::Full,
        )
    }
}

// LITTLE-ENDIAN READERS (alignment-safe; Borsh is little-endian)

#[inline(always)]
fn read_i32(data: &[u8], off: usize) -> i32 {
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&data[off..off + 4]);
    i32::from_le_bytes(buf)
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

// TESTS

#[cfg(test)]
mod tests {
    use super::*;

    fn build_account(vl: VerificationLevel, msg: PriceFeedMessage, posted_slot: u64) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
        data.extend_from_slice(&[7u8; 32]); // write_authority
        match vl {
            VerificationLevel::Partial { num_signatures } => {
                data.push(VL_TAG_PARTIAL);
                data.push(num_signatures);
            }
            VerificationLevel::Full => data.push(VL_TAG_FULL),
        }
        data.extend_from_slice(&msg.feed_id);
        data.extend_from_slice(&msg.price.to_le_bytes());
        data.extend_from_slice(&msg.conf.to_le_bytes());
        data.extend_from_slice(&msg.exponent.to_le_bytes());
        data.extend_from_slice(&msg.publish_time.to_le_bytes());
        data.extend_from_slice(&msg.prev_publish_time.to_le_bytes());
        data.extend_from_slice(&msg.ema_price.to_le_bytes());
        data.extend_from_slice(&msg.ema_conf.to_le_bytes());
        data.extend_from_slice(&posted_slot.to_le_bytes());
        data
    }

    fn sample_msg(feed_id: FeedId, publish_time: i64) -> PriceFeedMessage {
        PriceFeedMessage {
            feed_id,
            price: 15_000_000_000, // $150 at expo -8
            conf: 7_500_000,       // 0.05%
            exponent: -8,
            publish_time,
            prev_publish_time: publish_time - 1,
            ema_price: 15_000_000_000,
            ema_conf: 7_500_000,
        }
    }

    #[test]
    fn verification_level_ordering() {
        assert!(VerificationLevel::Full.gte(VerificationLevel::Full));
        assert!(VerificationLevel::Full.gte(VerificationLevel::Partial { num_signatures: 5 }));
        assert!(!VerificationLevel::Partial { num_signatures: 5 }.gte(VerificationLevel::Full));
        assert!(VerificationLevel::Partial { num_signatures: 5 }
            .gte(VerificationLevel::Partial { num_signatures: 5 }));
        assert!(!VerificationLevel::Partial { num_signatures: 4 }
            .gte(VerificationLevel::Partial { num_signatures: 5 }));
    }

    #[test]
    fn parse_full_account() {
        let feed_id = [9u8; 32];
        let data = build_account(VerificationLevel::Full, sample_msg(feed_id, 1_700_000_000), 42);
        let update = PriceUpdateV2::parse(&data).unwrap();
        assert_eq!(update.verification_level, VerificationLevel::Full);
        assert_eq!(update.price_message.feed_id, feed_id);
        assert_eq!(update.price_message.price, 15_000_000_000);
        assert_eq!(update.posted_slot, 42);
        // Full account is 133 bytes.
        assert_eq!(data.len(), 133);
    }

    #[test]
    fn parse_partial_account() {
        let feed_id = [1u8; 32];
        let data = build_account(
            VerificationLevel::Partial { num_signatures: 13 },
            sample_msg(feed_id, 1_700_000_000),
            1,
        );
        let update = PriceUpdateV2::parse(&data).unwrap();
        assert_eq!(
            update.verification_level,
            VerificationLevel::Partial { num_signatures: 13 }
        );
        // Partial account is 134 bytes.
        assert_eq!(data.len(), 134);
    }

    #[test]
    fn bad_discriminator_rejected() {
        let mut data =
            build_account(VerificationLevel::Full, sample_msg([0u8; 32], 1), 0);
        data[0] ^= 0xff;
        assert_eq!(
            PriceUpdateV2::parse(&data),
            Err(PythError::InvalidDiscriminator)
        );
    }

    #[test]
    fn get_price_checks_feed_id() {
        let feed_id = [3u8; 32];
        let data = build_account(VerificationLevel::Full, sample_msg(feed_id, 1_700_000_000), 0);
        let update = PriceUpdateV2::parse(&data).unwrap();
        assert!(update.get_price_unchecked(&feed_id).is_ok());
        assert_eq!(
            update.get_price_unchecked(&[4u8; 32]),
            Err(PythError::MismatchedFeedId)
        );
    }

    #[test]
    fn get_price_checks_staleness() {
        let feed_id = [3u8; 32];
        let publish_time = 1_700_000_000;
        let data = build_account(VerificationLevel::Full, sample_msg(feed_id, publish_time), 0);
        let update = PriceUpdateV2::parse(&data).unwrap();
        // 30s after publish, max age 60s -> ok.
        assert!(update
            .get_price_no_older_than(publish_time + 30, 60, &feed_id)
            .is_ok());
        // 90s after publish, max age 60s -> too old.
        assert_eq!(
            update.get_price_no_older_than(publish_time + 90, 60, &feed_id),
            Err(PythError::PriceTooOld)
        );
    }

    #[test]
    fn get_price_requires_full_verification() {
        let feed_id = [3u8; 32];
        let data = build_account(
            VerificationLevel::Partial { num_signatures: 12 },
            sample_msg(feed_id, 1_700_000_000),
            0,
        );
        let update = PriceUpdateV2::parse(&data).unwrap();
        assert_eq!(
            update.get_price_no_older_than(1_700_000_010, 60, &feed_id),
            Err(PythError::InsufficientVerificationLevel)
        );
    }

    #[test]
    fn confidence_check() {
        let price = Price {
            price: 10_000,
            conf: 100, // 1%
            exponent: 0,
            publish_time: 0,
        };
        assert!(price.is_confidence_acceptable(100));
        assert!(price.is_confidence_acceptable(200));
        assert!(!price.is_confidence_acceptable(50));
        assert!(price.is_confidence_acceptable(0)); // disabled
    }
}
