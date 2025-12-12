/// SPL Token operations using Pinocchio
///
/// This module provides actual token burn/mint/transfer operations
/// using the pinocchio-token crate for compute-optimized CPIs.

use pinocchio::{
    account_info::AccountInfo,
    instruction::Signer,
    ProgramResult,
};
use pinocchio_token::instructions::*;

use crate::error::GameError;

/// Burn tokens from a token account
///
/// This permanently reduces the total supply of the token.
///
/// # Arguments
/// * `token_account` - Token account to burn from
/// * `mint` - Token mint address
/// * `authority` - Authority that can burn (must sign or be PDA)
/// * `amount` - Amount of tokens to burn (in token decimals)
/// * `signers` - Optional PDA signers if authority is a PDA
///
/// # Returns
/// Ok(()) on successful burn
pub fn burn_tokens<'a>(
    token_account: &'a AccountInfo,
    mint: &'a AccountInfo,
    authority: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // Build burn instruction
    let burn_ix = Burn {
        account: token_account,
        mint,
        authority,
        amount,
    };

    // Execute with signers
    burn_ix.invoke_signed(signers)
}

/// Mint tokens to a token account
///
/// Increases the total supply of the token.
/// Only the mint authority can call this.
///
/// # Arguments
/// * `mint` - Token mint address
/// * `destination` - Token account to mint to
/// * `mint_authority` - The mint authority (must be a PDA for this program)
/// * `amount` - Amount of tokens to mint (in token decimals)
/// * `signers` - PDA signers for mint authority
///
/// # Returns
/// Ok(()) on successful mint
pub fn mint_tokens<'a>(
    mint: &'a AccountInfo,
    destination: &'a AccountInfo,
    mint_authority: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // Build mint instruction
    let mint_ix = MintTo {
        mint,
        account: destination,
        mint_authority,
        amount,
    };

    // Execute with PDA signer
    mint_ix.invoke_signed(signers)
}

/// Transfer tokens between token accounts
///
/// # Arguments
/// * `from` - Source token account
/// * `to` - Destination token account
/// * `authority` - Authority that can transfer (must sign or be PDA)
/// * `amount` - Amount of tokens to transfer (in token decimals)
/// * `signers` - Optional PDA signers if authority is a PDA
///
/// # Returns
/// Ok(()) on successful transfer
pub fn transfer_tokens<'a>(
    from: &'a AccountInfo,
    to: &'a AccountInfo,
    authority: &'a AccountInfo,
    amount: u64,
    signers: &[Signer],
) -> ProgramResult {
    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // Build transfer instruction
    let transfer_ix = Transfer {
        from,
        to,
        authority,
        amount,
    };

    // Execute with signers
    transfer_ix.invoke_signed(signers)
}

// NOTE: GameEngine PDA signer creation removed as helper function
//
// Signer cannot be returned from a function because it references temporary seeds.
// Instead, create the signer inline where you use it:
//
// Example:
// ```
// let bump_seed = [game_engine_data.bump];
// let seeds = pinocchio::seeds!(GAME_ENGINE_SEED, &bump_seed);
// let signer = Signer::from(&seeds);
// burn_tokens(account, mint, authority, amount, &[signer])?;
// ```
