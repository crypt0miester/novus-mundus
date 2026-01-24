use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Require account owner matches expected
#[inline(always)]
pub fn require_owner(account: &AccountInfo, expected: &Pubkey) -> Result<(), ProgramError> {
    if account.owner() != expected {
        return Err(ProgramError::IllegalOwner);
    }
    Ok(())
}

/// Require account is signer
#[inline(always)]
pub fn require_signer(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

/// Require account is writable
#[inline(always)]
pub fn require_writable(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

/// Require account has minimum data length
#[inline(always)]
pub fn require_data_len(account: &AccountInfo, min_len: usize) -> Result<(), ProgramError> {
    if account.data_len() < min_len {
        return Err(ProgramError::AccountDataTooSmall);
    }
    Ok(())
}

/// Require account is empty (for initialization)
#[inline(always)]
pub fn require_empty(account: &AccountInfo) -> Result<(), ProgramError> {
    if account.data_len() > 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    Ok(())
}

/// Require account is initialized (has data)
#[inline(always)]
pub fn require_initialized(account: &AccountInfo) -> Result<(), ProgramError> {
    if account.data_len() == 0 {
        return Err(ProgramError::UninitializedAccount);
    }
    Ok(())
}

/// Derive PDA
pub fn derive_pda(seeds: &[&[u8]], program_id: &Pubkey) -> (Pubkey, u8) {
    pinocchio::pubkey::find_program_address(seeds, program_id)
}

/// Require PDA matches expected derivation
pub fn require_pda(
    account: &AccountInfo,
    seeds: &[&[u8]],
    program_id: &Pubkey,
) -> Result<u8, ProgramError> {
    let (expected, bump) = derive_pda(seeds, program_id);
    if account.key() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(bump)
}

/// Require account key matches expected
#[inline(always)]
pub fn require_key_match(account: &AccountInfo, expected: &Pubkey) -> Result<(), ProgramError> {
    if account.key() != expected {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}
