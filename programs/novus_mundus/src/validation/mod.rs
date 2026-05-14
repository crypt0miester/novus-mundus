//! Account validation primitives.
//!
//! Each `require_*` helper logs `<check>: <account_address>` on failure so
//! tx logs surface the failing account without rewriting every call site.
//! Cold-path branch hints (`utils::unlikely`) lay the failure arm cold so
//! the success path is fall-through (~1–3 CU per call site).

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
};

use crate::utils::{unlikely, Pk};

/// Require account owner matches expected.
#[inline(always)]
pub fn require_owner(account: &AccountView, expected: &Address) -> Result<(), ProgramError> {
    let owner = unsafe { account.owner() };
    if unlikely(owner != expected) {
        pinocchio_log::log!(
            "require_owner: expected {}, got {} (account {})",
            Pk(expected.as_array()),
            Pk(owner.as_array()),
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::IllegalOwner);
    }
    Ok(())
}

/// Require account is signer.
#[inline(always)]
pub fn require_signer(account: &AccountView) -> Result<(), ProgramError> {
    if unlikely(!account.is_signer()) {
        pinocchio_log::log!(
            "require_signer: not a signer ({})",
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

/// Require account is writable.
#[inline(always)]
pub fn require_writable(account: &AccountView) -> Result<(), ProgramError> {
    if unlikely(!account.is_writable()) {
        pinocchio_log::log!(
            "require_writable: not writable ({})",
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

/// Require account has at least `min_len` bytes of data.
#[inline(always)]
pub fn require_data_len(account: &AccountView, min_len: usize) -> Result<(), ProgramError> {
    if unlikely(account.data_len() < min_len) {
        pinocchio_log::log!(
            "require_data_len: need {}, have {} ({})",
            min_len as u64,
            account.data_len() as u64,
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::AccountDataTooSmall);
    }
    Ok(())
}

/// Require account is empty (zero-len data, e.g. fresh from CreateAccount).
#[inline(always)]
pub fn require_empty(account: &AccountView) -> Result<(), ProgramError> {
    if unlikely(account.data_len() > 0) {
        pinocchio_log::log!(
            "require_empty: already initialized ({})",
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    Ok(())
}

/// Require account has data (i.e. has been initialized).
#[inline(always)]
pub fn require_initialized(account: &AccountView) -> Result<(), ProgramError> {
    if unlikely(account.data_len() == 0) {
        pinocchio_log::log!(
            "require_initialized: uninitialized ({})",
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::UninitializedAccount);
    }
    Ok(())
}

/// Derive a program address.
#[inline]
pub fn derive_pda(seeds: &[&[u8]], program_id: &Address) -> (Address, u8) {
    pinocchio::Address::find_program_address(seeds, program_id)
}

/// Require an account's address matches the PDA derived from `seeds`.
/// Returns the canonical bump.
pub fn require_pda(
    account: &AccountView,
    seeds: &[&[u8]],
    program_id: &Address,
) -> Result<u8, ProgramError> {
    let (expected, bump) = derive_pda(seeds, program_id);
    if unlikely(account.address() != &expected) {
        pinocchio_log::log!(
            "require_pda: expected {}, got {}",
            Pk(expected.as_array()),
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(bump)
}

/// Require account.address() == expected.
#[inline(always)]
pub fn require_key_match(account: &AccountView, expected: &Address) -> Result<(), ProgramError> {
    if unlikely(account.address() != expected) {
        pinocchio_log::log!(
            "require_key_match: expected {}, got {}",
            Pk(expected.as_array()),
            Pk(account.address().as_array()),
        );
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}
