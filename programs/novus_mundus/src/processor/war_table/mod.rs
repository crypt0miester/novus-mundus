//! War Table message posting (instruction 323).
//!
//! The war table is an on-chain, log-only chat layer. A post writes nothing to
//! account state: the processor validates membership/scope, validates the wire
//! envelope, then emits the raw envelope bytes via `sol_log_data`. Off-chain
//! readers identify war-table messages by the `wt1` magic at bytes [0..3].
//!
//! Encryption is handled entirely off-chain (the chain never sees the key). The
//! chain only enforces the envelope shape, the per-scope `key_version` rule, and
//! the encrypted-flag invariant so the plaintext-vs-encrypted distinction is
//! unambiguous and tamper-evident.

pub mod access;
pub mod post;
