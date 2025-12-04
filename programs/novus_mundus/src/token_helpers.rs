/// Token account creation helpers using Pinocchio
///
/// This module provides utilities for creating associated token accounts
/// using the pinocchio-associated-token-account crate.

use pinocchio::{
    account_info::AccountInfo,
    ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;

/// Get or create an associated token account
///
/// Uses CreateIdempotent which:
/// - Creates the ATA if it doesn't exist
/// - Returns success if it already exists with correct owner
/// - Returns error if it exists with wrong owner
///
/// # Arguments
/// * `funding_account` - Payer for account creation (must be signer)
/// * `account` - ATA address to create
/// * `wallet` - Wallet that owns the ATA
/// * `mint` - Token mint
/// * `system_program` - System program
/// * `token_program` - SPL Token program
///
/// # Returns
/// Ok(()) on success (account created or already exists)
pub fn get_or_create_associated_token_account<'a>(
    funding_account: &'a AccountInfo,
    account: &'a AccountInfo,
    wallet: &'a AccountInfo,
    mint: &'a AccountInfo,
    system_program: &'a AccountInfo,
    token_program: &'a AccountInfo,
) -> ProgramResult {
    let create_ix = CreateIdempotent {
        funding_account,
        account,
        wallet,
        mint,
        system_program,
        token_program,
    };

    create_ix.invoke()
}
