//! Switchboard On-Demand oracle-quote PDA.
//!
//! Model B (see `docs/SWITCHBOARD_ORACLEQUOTE_PLAN.md`): an off-chain crank
//! keeps this program-owned account fresh by writing a verified Switchboard
//! `OracleQuote` into it (`crank_oracle_quote`, ix 302); purchase instructions
//! then read it via `p_switchboard::QuoteVerifier::verify_account`.
//!
//! The account is **not** a regular game account — it carries no
//! [`AccountKey`](super::AccountKey) discriminator. Its first 8 bytes are the
//! Switchboard `SBOracle` discriminator written by `OracleQuote::write`; the
//! layout is `[SBOracle(8)][queue(32)][len(2)][ed25519 quote data]`.

use pinocchio::error::ProgramError;
use pinocchio::Address;

use crate::constants::ORACLE_QUOTE_SEED;

/// On-chain size of the oracle-quote account.
///
/// `8 (SBOracle) + 32 (queue) + 1024 (length prefix + ed25519 quote data)` —
/// matches the Switchboard advanced-oracle example's `ORACLE_ACCOUNT_SIZE`.
/// A single ed25519 quote with a handful of feeds is well under 1 KiB.
pub const ORACLE_QUOTE_ACCOUNT_LEN: usize = 8 + 32 + 1024;

/// PDA helpers for the oracle-quote account, derived from the Switchboard
/// queue: `["oracle_quote", switchboard_queue]`.
pub struct OracleQuotePda;

impl OracleQuotePda {
    /// Derive the oracle-quote PDA and bump (finds bump — use at creation).
    pub fn derive_pda(queue: &Address) -> (Address, u8) {
        pinocchio::Address::find_program_address(&[ORACLE_QUOTE_SEED, queue.as_ref()], &crate::ID)
    }

    /// Recreate the oracle-quote PDA from a stored bump (fast validation).
    pub fn create_pda(queue: &Address, bump: u8) -> Result<Address, ProgramError> {
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[ORACLE_QUOTE_SEED, queue.as_ref(), &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }
}
