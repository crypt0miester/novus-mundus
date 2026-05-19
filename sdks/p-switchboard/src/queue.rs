//! Switchboard `QueueAccountData` layout.
//!
//! Ported verbatim (field-for-field) from `switchboard-on-demand` 0.12.1
//! `src/on_demand/accounts/queue.rs`. Only the `#[repr(C)]` struct layout is
//! kept — all client / anchor methods are dropped. Quote verification reads
//! exactly one field, `ed25519_oracle_signing_keys`, after a raw pointer cast
//! over the queue account data (skipping its 8-byte discriminator).
//!
//! The layout MUST stay byte-identical to upstream; the `const` assert below
//! pins `size_of` so an accidental field change fails the build.

/// Reward-vault entry embedded in [`QueueAccountData`].
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct VaultInfo {
    /// Public key of the vault account.
    pub vault_key: [u8; 32],
    /// Last epoch when rewards were distributed.
    pub last_reward_epoch: u64,
}

/// Switchboard oracle queue account — holds the authorized oracle signing keys.
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct QueueAccountData {
    /// Authority permitted to add/remove allowed enclave measurements.
    pub authority: [u8; 32],
    /// Allowed enclave measurements.
    pub mr_enclaves: [[u8; 32]; 32],
    /// Quote-oracle addresses with a valid verification status.
    pub oracle_keys: [[u8; 32]; 78],
    reserved1: [u8; 40],
    /// SECP256K1 signing keys for oracles.
    pub secp_oracle_signing_keys: [[u8; 20]; 30],
    /// ED25519 signing keys for oracles — checked against quote signatures.
    pub ed25519_oracle_signing_keys: [[u8; 32]; 30],
    /// Maximum allowable time until an EnclaveAccount needs re-verification.
    pub max_quote_verification_age: i64,
    /// Unix timestamp when the last quote oracle heartbeated on-chain.
    pub last_heartbeat: i64,
    /// Timeout period for oracle nodes, in seconds.
    pub node_timeout: i64,
    /// Minimum lamports a quote oracle must lock up to heartbeat / verify.
    pub oracle_min_stake: u64,
    /// Time after which authority override is allowed.
    pub allow_authority_override_after: i64,
    /// Number of allowed enclave measurements.
    pub mr_enclaves_len: u32,
    /// Number of valid quote oracles for the queue.
    pub oracle_keys_len: u32,
    /// Reward paid to quote oracles for attesting on-chain.
    pub reward: u32,
    /// Incrementer tracking the current quote oracle.
    pub curr_idx: u32,
    /// Incrementer used to garbage-collect stale quote oracles.
    pub gc_idx: u32,
    /// Whether authority permission is required for heartbeat.
    pub require_authority_heartbeat_permission: u8,
    /// Whether authority permission is required for verification.
    pub require_authority_verify_permission: u8,
    /// Whether usage permissions are required.
    pub require_usage_permissions: u8,
    /// PDA bump seed for the queue signer.
    pub signer_bump: u8,
    /// Token mint for queue operations.
    pub mint: [u8; 32],
    /// Address lookup table slot.
    pub lut_slot: u64,
    /// Whether subsidies are allowed for oracle operations.
    pub allow_subsidies: u8,
    _ebuf6: [u8; 15],
    /// Network coordination node public key.
    pub ncn: [u8; 32],
    _resrved: u64,
    /// Vault information for rewards.
    pub vaults: [VaultInfo; 4],
    /// Last epoch when queue rewards were distributed.
    pub last_reward_epoch: u64,
    _ebuf4: [u8; 32],
    _ebuf2: [u8; 256],
    _ebuf1: [u8; 504],
}

/// Anchor discriminator for `QueueAccountData`.
pub const QUEUE_ACCOUNT_DISCRIMINATOR: [u8; 8] = [217, 194, 55, 127, 184, 83, 138, 1];

/// Full on-chain queue account size (`discriminator + struct`).
pub const QUEUE_ACCOUNT_LEN: usize = 8 + core::mem::size_of::<QueueAccountData>();

// Pins the layout: upstream's verifier checks the queue account is exactly
// 6280 bytes (8-byte discriminator + 6272-byte struct).
const _: () = assert!(core::mem::size_of::<QueueAccountData>() == 6272);
const _: () = assert!(QUEUE_ACCOUNT_LEN == 6280);
