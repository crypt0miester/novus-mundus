//! Switchboard On-Demand oracle-quote processors (Model B).
//!
//! - `init_quote` (ix 301): create the program-owned oracle-quote PDA.
//! - `crank_quote` (ix 302): write a fresh verified `OracleQuote` into it.
//!
//! Purchase instructions then read the quote via
//! `helpers::verify_switchboard_quote`. See `docs/SWITCHBOARD_ORACLEQUOTE_PLAN.md`.

pub mod crank_quote;
pub mod init_quote;
