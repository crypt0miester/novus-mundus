//! Build per-asset hero portrait URI: `<base>/<base58 pubkey>?v=<level>`.
//!
//! The runtime route at `apps/web/src/app/heroes/[pubkey]/route.ts` serves a
//! procedural PNG portrait (see docs/design/HERO_PORTRAITS.md). The URI is
//! baked into the asset at mint time and re-written on every level-up so
//! external indexers / marketplaces see the URI as a fresh string and
//! re-fetch — without the `?v=<level>` cache-buster they'd serve the stale
//! cached PNG forever.
//!
//! LOCALHOST FOR LOCALNET TESTING — bump `URI_PREFIX` to
//! `b"https://novusmundus.gg/heroes/"` before any non-local deploy.

pub const URI_PREFIX: &[u8] = b"http://localhost:3000/heroes/";
pub const URI_LEVEL_SEP: &[u8] = b"?v=";

/// Maximum total URI length:
///   29 (prefix) + 44 (base58 of 32 bytes max) + 3 ("?v=") + 10 (u32 decimal) = 96
pub const MAX_URI_LEN: usize = URI_PREFIX.len() + 44 + URI_LEVEL_SEP.len() + 10;

/// Build the per-asset URI into `out`. Returns the number of bytes written.
/// `pk` is the asset's 32-byte address; `level` is the hero's current level.
pub fn build_hero_uri(pk: &[u8; 32], level: u32, out: &mut [u8; MAX_URI_LEN]) -> usize {
    let mut pos = 0;

    out[pos..pos + URI_PREFIX.len()].copy_from_slice(URI_PREFIX);
    pos += URI_PREFIX.len();

    let mut pk_str = [0u8; 44];
    let mut pk_len = 0u8;
    five8::encode_32(pk, Some(&mut pk_len), &mut pk_str);
    let pk_len = pk_len as usize;
    out[pos..pos + pk_len].copy_from_slice(&pk_str[..pk_len]);
    pos += pk_len;

    out[pos..pos + URI_LEVEL_SEP.len()].copy_from_slice(URI_LEVEL_SEP);
    pos += URI_LEVEL_SEP.len();

    pos + write_u32_decimal(level, &mut out[pos..])
}

/// Write decimal digits of `value` to `out`. Returns bytes written.
/// u32::MAX = 10 digits, so `out` should be at least 10 bytes for safety.
fn write_u32_decimal(value: u32, out: &mut [u8]) -> usize {
    if value == 0 {
        out[0] = b'0';
        return 1;
    }
    let mut digits = [0u8; 10];
    let mut n = value;
    let mut count = 0;
    while n > 0 {
        digits[count] = b'0' + (n % 10) as u8;
        n /= 10;
        count += 1;
    }
    for i in 0..count {
        out[i] = digits[count - 1 - i];
    }
    count
}
