//! Crate-wide no_std utilities.
//!
//! Existing files in this directory (`leaderboard/`, `misc.rs`, `reward.rs`)
//! are pre-existing orphan code — they reference `std` / `Vec` and were
//! never reachable from `lib.rs`. They are not wired up here; they can be
//! revived after a no_std cleanup pass.

pub mod hint;
pub mod io;
pub mod log_format;
pub mod rent;

#[allow(unused_imports)]
pub use hint::{cold_path, unlikely};
#[allow(unused_imports)]
pub use io::{read_bytes32, read_i64, read_len_prefixed, read_u16, read_u32, read_u64, read_u8};
pub use log_format::Pk;
#[allow(unused_imports)]
pub use rent::{rent_exempt_const, ACCOUNT_STORAGE_OVERHEAD, DEFAULT_LAMPORTS_PER_BYTE};
