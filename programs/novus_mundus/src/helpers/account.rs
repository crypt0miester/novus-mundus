use pinocchio::{
    account_info::AccountInfo,
    pubkey::Pubkey,
    ProgramResult,
};

/// System program ID (all zeros)
const SYSTEM_PROGRAM_ID: Pubkey = [0u8; 32];

/// Close an account and refund rent to recipient
///
/// This is a generic function that can close any program-owned account.
/// It properly:
/// 1. Transfers all lamports to recipient
/// 2. Zeros out account data
/// 3. Resizes account to 0
/// 4. Assigns account back to system program
///
/// # Arguments
/// * `account` - The account to close (must be writable)
/// * `recipient` - The account to receive the rent refund (must be writable)
///
/// # Safety
/// Uses unsafe operations for lamport transfers (standard Solana pattern)
pub fn close_account(
    account: &AccountInfo,
    recipient: &AccountInfo,
) -> ProgramResult {
    // Transfer all lamports to recipient
    let lamports = account.lamports();
    unsafe {
        *account.borrow_mut_lamports_unchecked() = 0;
        *recipient.borrow_mut_lamports_unchecked() += lamports;
    }

    // Zero out account data
    {
        let mut data = account.try_borrow_mut_data()?;
        data.fill(0);
    } // drop RefMut before resize

    // Resize to 0 (mark as closed)
    account.resize(0)?;

    // Assign back to system program
    unsafe {
        account.assign(&SYSTEM_PROGRAM_ID);
    }

    Ok(())
}
