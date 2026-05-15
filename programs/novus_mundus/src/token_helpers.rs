/// Token account creation helpers using Pinocchio
///
/// This module provides utilities for creating associated token accounts
/// using the pinocchio-associated-token-account crate.

use pinocchio::{
    AccountView,
    ProgramResult,
};
use pinocchio_associated_token_account::instructions::Create;

/// Create an associated token account
///
/// Uses the non-idempotent `Create` instruction, which:
/// - Creates the ATA, deriving and verifying the canonical ATA address
/// - Returns an error if an account already exists at that address
///   (e.g. a front-run creation) — callers must treat this as fatal
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
/// Ok(()) once the ATA has been created
pub fn create_associated_token_account<'a>(
    funding_account: &'a AccountView,
    account: &'a AccountView,
    wallet: &'a AccountView,
    mint: &'a AccountView,
    system_program: &'a AccountView,
    token_program: &'a AccountView,
) -> ProgramResult {
    let create_ix = Create {
        funding_account,
        account,
        wallet,
        mint,
        system_program,
        token_program,
    };

    create_ix.invoke()
}
