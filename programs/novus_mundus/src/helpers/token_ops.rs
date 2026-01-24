/// SPL Token operations using Pinocchio
///
/// This module provides actual token burn/mint/transfer operations
/// using the pinocchio-token crate for compute-optimized CPIs.

use pinocchio::{
    account_info::AccountInfo,
    instruction::Signer,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_token::instructions::*;

use crate::error::GameError;

/// Validate that a token account is owned by the expected owner
///
/// Checks:
/// 1. Token account is owned by SPL Token program
/// 2. Token account's owner field matches expected_owner
///
/// # Arguments
/// * `token_account` - The token account to validate
/// * `expected_owner` - The pubkey that should own the token account
///
/// # Returns
/// Ok(()) if valid, Err(InvalidTokenAccount) otherwise
///
/// # Token Account Layout (SPL Token)
/// - Bytes 0-31: mint
/// - Bytes 32-63: owner
/// - Bytes 64-71: amount
/// - ...
pub fn validate_token_account_owner(
    token_account: &AccountInfo,
    expected_owner: &Pubkey,
) -> Result<(), ProgramError> {
    // Check token account is owned by SPL Token program
    if token_account.owner() != &pinocchio_token::ID {
        return Err(GameError::InvalidTokenAccount.into());
    }

    // Check token account data is large enough
    let token_data = token_account.try_borrow_data()?;
    if token_data.len() < 64 {
        return Err(GameError::InvalidTokenAccount.into());
    }

    // Check token account owner field matches expected
    let token_owner = &token_data[32..64];
    if token_owner != expected_owner.as_ref() {
        return Err(GameError::InvalidTokenAccount.into());
    }

    Ok(())
}

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

// ============================================================================
// ORACLE & TOKEN PAYMENT HELPERS
// ============================================================================

use p_pyth::{PYTH_MAGIC, OraclePrice, load_pyth_price_with_confidence};
use switchboard_on_demand::QuoteVerifier;
use crate::state::{AllowedTokenAccount, ShopConfigAccount};
use crate::validation::require_key_match;
use crate::logic::safe_math::apply_bp_penalty;

/// Oracle type detection based on account data
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OracleType {
    Pyth,
    Switchboard,
}

/// Detect oracle type from account data
///
/// Pyth accounts start with magic number 0xa1b2c3d4.
/// If not Pyth, assumes Switchboard.
pub fn detect_oracle_type(oracle_data: &[u8]) -> OracleType {
    if oracle_data.len() >= 4 {
        let magic = u32::from_le_bytes([
            oracle_data[0],
            oracle_data[1],
            oracle_data[2],
            oracle_data[3],
        ]);
        if magic == PYTH_MAGIC {
            return OracleType::Pyth;
        }
    }
    OracleType::Switchboard
}

/// Get price from Pyth oracle
///
/// # Arguments
/// * `pyth_data` - Raw account data from Pyth price feed
/// * `current_slot` - Current blockchain slot
/// * `max_staleness_slots` - Maximum age in slots
/// * `max_confidence_bps` - Maximum confidence interval in basis points
///
/// # Returns
/// OraclePrice on success, ProgramError on failure
pub fn get_pyth_price(
    pyth_data: &[u8],
    current_slot: u64,
    max_staleness_slots: u64,
    max_confidence_bps: u16,
) -> Result<OraclePrice, ProgramError> {
    load_pyth_price_with_confidence(
        pyth_data,
        current_slot,
        max_staleness_slots,
        max_confidence_bps,
    ).map_err(|e| e.into())
}

/// Read token decimals from SPL mint account
///
/// SPL Mint layout has decimals at offset 44.
pub fn read_token_decimals(mint_data: &[u8]) -> Result<u8, ProgramError> {
    if mint_data.len() < 45 {
        return Err(GameError::InvalidMint.into());
    }
    Ok(mint_data[44])
}

/// Calculate token amount for payment given oracle prices
///
/// Formula: token_amount = (sol_price_lamports * sol_usd) / token_usd
/// Adjusted for token decimals.
///
/// # Arguments
/// * `sol_price_lamports` - Item price in lamports
/// * `sol_price` - SOL/USD oracle price
/// * `token_price` - TOKEN/USD oracle price
/// * `token_decimals` - Token decimals (from mint)
///
/// # Returns
/// Token amount to charge (in token's smallest units)
pub fn calculate_token_amount(
    sol_price_lamports: u64,
    sol_price: &OraclePrice,
    token_price: &OraclePrice,
    token_decimals: u8,
) -> Result<u64, ProgramError> {
    // Convert both prices to same exponent for calculation
    // We use -18 as the working exponent for precision
    const WORK_EXPO: i32 = -18;

    let sol_usd = sol_price.get_price_in_target_expo(WORK_EXPO)
        .ok_or(GameError::OracleOverflow)?;
    let token_usd = token_price.get_price_in_target_expo(WORK_EXPO)
        .ok_or(GameError::OracleOverflow)?;

    if token_usd == 0 {
        return Err(GameError::OracleUnavailable.into());
    }

    // Calculate: (lamports * sol_usd / token_usd) * (10^token_decimals / 10^9)
    // Rearranged for precision: (lamports * sol_usd * 10^token_decimals) / (token_usd * 10^9)

    // First: lamports * sol_usd (could overflow for large amounts, use u128)
    let lamports_x_sol = (sol_price_lamports as u128)
        .checked_mul(sol_usd as u128)
        .ok_or(GameError::OracleOverflow)?;

    // Then: multiply by 10^token_decimals
    let token_scale = 10u128.pow(token_decimals as u32);
    let numerator = lamports_x_sol
        .checked_mul(token_scale)
        .ok_or(GameError::OracleOverflow)?;

    // Denominator: token_usd * 10^9 (SOL has 9 decimals)
    let sol_scale = 10u128.pow(9);
    let denominator = (token_usd as u128)
        .checked_mul(sol_scale)
        .ok_or(GameError::OracleOverflow)?;

    // Final division
    let token_amount = numerator
        .checked_div(denominator)
        .ok_or(GameError::OracleOverflow)?;

    // Convert back to u64 (check for overflow)
    if token_amount > u64::MAX as u128 {
        return Err(GameError::OracleOverflow.into());
    }

    Ok(token_amount as u64)
}

/// Process token payment transfer from buyer to treasury
///
/// # Arguments
/// * `from` - Buyer's token account
/// * `to` - Treasury's token account
/// * `authority` - Transfer authority (buyer must sign)
/// * `amount` - Token amount to transfer
///
/// # Returns
/// Ok(()) on successful transfer
pub fn process_token_payment<'a>(
    from: &'a AccountInfo,
    to: &'a AccountInfo,
    authority: &'a AccountInfo,
    amount: u64,
) -> ProgramResult {
    transfer_tokens(from, to, authority, amount, &[])
}

// ============================================================================
// UNIFIED TOKEN PAYMENT PROCESSOR
// ============================================================================

/// Token payment accounts structure
///
/// For Pyth oracle (7 accounts):
/// - [0] allowed_token: AllowedTokenAccount PDA
/// - [1] token_mint: SPL Token mint
/// - [2] buyer_token_ata: Buyer's token account (writable)
/// - [3] treasury_token_ata: Treasury's token account (writable)
/// - [4] token_program: SPL Token program
/// - [5] sol_oracle_feed: SOL/USD Pyth price feed
/// - [6] token_oracle_feed: TOKEN/USD Pyth price feed
///
/// For Switchboard oracle (10 accounts):
/// - [0] allowed_token: AllowedTokenAccount PDA
/// - [1] token_mint: SPL Token mint
/// - [2] buyer_token_ata: Buyer's token account (writable)
/// - [3] treasury_token_ata: Treasury's token account (writable)
/// - [4] token_program: SPL Token program
/// - [5] sol_oracle_feed: SOL/USD Switchboard quote
/// - [6] token_oracle_feed: TOKEN/USD Switchboard quote
/// - [7] switchboard_queue: Switchboard queue account
/// - [8] slothashes_sysvar: SlotHashes sysvar
/// - [9] instructions_sysvar: Instructions sysvar
pub const TOKEN_ACCOUNTS_PYTH: usize = 7;
pub const TOKEN_ACCOUNTS_SWITCHBOARD: usize = 10;

/// Process a complete token payment flow
///
/// This is the unified entry point for token payments across all purchase processors.
/// It handles oracle detection, price fetching, amount calculation, and token transfer.
///
/// # Arguments
/// * `token_accounts` - Slice of token payment accounts (7 for Pyth, 10 for Switchboard)
/// * `game_engine_key` - GameEngine pubkey (for AllowedToken PDA derivation)
/// * `program_id` - Program ID
/// * `shop_config` - ShopConfigAccount reference (for SOL oracle settings)
/// * `buyer` - Buyer account (signer for token transfer)
/// * `final_price_lamports` - Final price in lamports (after all discounts)
/// * `current_slot` - Current blockchain slot (for staleness checks)
///
/// # Returns
/// Ok(()) on successful payment, or appropriate error
pub fn process_token_payment_flow(
    token_accounts: &[AccountInfo],
    game_engine_key: &Pubkey,
    program_id: &Pubkey,
    shop_config: &ShopConfigAccount,
    buyer: &AccountInfo,
    final_price_lamports: u64,
    current_slot: u64,
) -> ProgramResult {
    // Minimum accounts check (Pyth minimum)
    if token_accounts.len() < TOKEN_ACCOUNTS_PYTH {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Parse common accounts
    let allowed_token_account = &token_accounts[0];
    let token_mint = &token_accounts[1];
    let buyer_token_ata = &token_accounts[2];
    let treasury_token_ata = &token_accounts[3];
    let token_program = &token_accounts[4];
    let sol_oracle_feed = &token_accounts[5];
    let token_oracle_feed = &token_accounts[6];

    // Validate token program
    require_key_match(token_program, &pinocchio_token::ID)?;

    // Validate writable accounts
    if !buyer_token_ata.is_writable() || !treasury_token_ata.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Load and validate AllowedTokenAccount
    let allowed_token = AllowedTokenAccount::load_checked(
        allowed_token_account,
        game_engine_key,
        token_mint.key(),
        program_id,
    ).map_err(|_| GameError::TokenNotAllowed)?;

    // Detect oracle type from SOL oracle feed
    let sol_oracle_data = sol_oracle_feed.try_borrow_data()?;
    let oracle_type = detect_oracle_type(&sol_oracle_data);

    // Calculate token amount based on oracle type
    let token_amount = match oracle_type {
        OracleType::Pyth => {
            calculate_token_amount_pyth(
                &sol_oracle_data,
                token_oracle_feed,
                token_mint,
                &allowed_token,
                shop_config,
                final_price_lamports,
                current_slot,
            )?
        }
        OracleType::Switchboard => {
            // Verify we have enough accounts for Switchboard
            if token_accounts.len() < TOKEN_ACCOUNTS_SWITCHBOARD {
                return Err(ProgramError::NotEnoughAccountKeys);
            }

            let switchboard_queue = &token_accounts[7];
            let slothashes_sysvar = &token_accounts[8];
            let instructions_sysvar = &token_accounts[9];

            calculate_token_amount_switchboard(
                sol_oracle_feed,
                token_oracle_feed,
                switchboard_queue,
                slothashes_sysvar,
                instructions_sysvar,
                token_mint,
                &allowed_token,
                shop_config,
                final_price_lamports,
                current_slot,
            )?
        }
    };

    // Apply token discount (Layer 0 - first discount applied)
    let discounted_token_amount = if allowed_token.discount_bps > 0 {
        apply_bp_penalty(token_amount, allowed_token.discount_bps).unwrap_or(token_amount)
    } else {
        token_amount
    };

    // Transfer tokens from buyer to treasury
    process_token_payment(
        buyer_token_ata,
        treasury_token_ata,
        buyer,
        discounted_token_amount,
    )
}

/// Calculate token amount using Pyth oracles
fn calculate_token_amount_pyth(
    sol_oracle_data: &[u8],
    token_oracle_feed: &AccountInfo,
    token_mint: &AccountInfo,
    allowed_token: &AllowedTokenAccount,
    shop_config: &ShopConfigAccount,
    final_price_lamports: u64,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    // Load SOL/USD price from Pyth
    let sol_price = get_pyth_price(
        sol_oracle_data,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
        shop_config.sol_confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    // Load TOKEN/USD price from Pyth
    let token_oracle_data = token_oracle_feed.try_borrow_data()?;
    let token_price = get_pyth_price(
        &token_oracle_data,
        current_slot,
        allowed_token.max_staleness_slots as u64,
        allowed_token.confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    // Read token decimals
    let mint_data = token_mint.try_borrow_data()?;
    let token_decimals = read_token_decimals(&mint_data)?;

    // Calculate token amount
    calculate_token_amount(final_price_lamports, &sol_price, &token_price, token_decimals)
}

/// Calculate token amount using Switchboard oracles
///
/// Switchboard values are scaled to 18 decimals (standard DeFi precision).
fn calculate_token_amount_switchboard(
    sol_oracle_feed: &AccountInfo,
    token_oracle_feed: &AccountInfo,
    switchboard_queue: &AccountInfo,
    slothashes_sysvar: &AccountInfo,
    instructions_sysvar: &AccountInfo,
    token_mint: &AccountInfo,
    allowed_token: &AllowedTokenAccount,
    shop_config: &ShopConfigAccount,
    final_price_lamports: u64,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    // Get SOL/USD price from Switchboard
    let sol_price_i128 = get_switchboard_price(
        sol_oracle_feed,
        switchboard_queue,
        slothashes_sysvar,
        instructions_sysvar,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
    )?;

    // Get TOKEN/USD price from Switchboard
    let token_price_i128 = get_switchboard_price(
        token_oracle_feed,
        switchboard_queue,
        slothashes_sysvar,
        instructions_sysvar,
        current_slot,
        allowed_token.max_staleness_slots as u64,
    )?;

    // Read token decimals
    let mint_data = token_mint.try_borrow_data()?;
    let token_decimals = read_token_decimals(&mint_data)?;

    // Calculate token amount using Switchboard values (18 decimal precision)
    calculate_token_amount_from_sb_prices(
        final_price_lamports,
        sol_price_i128,
        token_price_i128,
        token_decimals,
    )
}

/// Get price from Switchboard oracle using QuoteVerifier
///
/// # Arguments
/// * `quote_account` - Switchboard quote account
/// * `queue_account` - Switchboard queue account
/// * `slothashes_sysvar` - SlotHashes sysvar
/// * `instructions_sysvar` - Instructions sysvar
/// * `current_slot` - Current blockchain slot
/// * `max_staleness_slots` - Maximum age in slots
///
/// # Returns
/// i128 price value (scaled to 18 decimals)
fn get_switchboard_price(
    quote_account: &AccountInfo,
    queue_account: &AccountInfo,
    slothashes_sysvar: &AccountInfo,
    instructions_sysvar: &AccountInfo,
    current_slot: u64,
    max_staleness_slots: u64,
) -> Result<i128, ProgramError> {
    let quote_data = QuoteVerifier::new()
        .slothash_sysvar(slothashes_sysvar)
        .ix_sysvar(instructions_sysvar)
        .clock_slot(current_slot)
        .queue(queue_account)
        .max_age(max_staleness_slots)
        .verify_account(quote_account)
        .map_err(|_| GameError::OraclePriceStale)?;

    // Get first feed's value
    let feed = quote_data.feeds().first()
        .ok_or(GameError::OracleUnavailable)?;

    // Switchboard's Decimal needs to be converted to i128
    // Decimal uses 18-decimal precision, so mantissa() gives us the scaled value
    Ok(feed.value().mantissa())
}

/// Calculate token amount from Switchboard i128 prices
///
/// Switchboard prices are scaled to 18 decimals.
///
/// Formula: token_amount = (lamports * sol_usd) / token_usd
/// Adjusted for token decimals and Switchboard's 18-decimal precision.
fn calculate_token_amount_from_sb_prices(
    sol_price_lamports: u64,
    sol_usd_i128: i128,
    token_usd_i128: i128,
    token_decimals: u8,
) -> Result<u64, ProgramError> {
    // Validate prices are positive
    if sol_usd_i128 <= 0 || token_usd_i128 <= 0 {
        return Err(GameError::OracleUnavailable.into());
    }

    let sol_usd = sol_usd_i128 as u128;
    let token_usd = token_usd_i128 as u128;

    // Switchboard uses 18 decimal precision
    // SOL has 9 decimals (lamports)
    // Formula: (lamports * sol_usd * 10^token_decimals) / (token_usd * 10^9)
    //
    // Since both sol_usd and token_usd are in 18 decimals, they cancel out.

    let token_scale = 10u128.pow(token_decimals as u32);
    let sol_scale = 10u128.pow(9); // SOL has 9 decimals

    // Calculate: (lamports * sol_usd * token_scale) / (token_usd * sol_scale)
    let numerator = (sol_price_lamports as u128)
        .checked_mul(sol_usd)
        .ok_or(GameError::OracleOverflow)?
        .checked_mul(token_scale)
        .ok_or(GameError::OracleOverflow)?;

    let denominator = token_usd
        .checked_mul(sol_scale)
        .ok_or(GameError::OracleOverflow)?;

    let token_amount = numerator
        .checked_div(denominator)
        .ok_or(GameError::OracleOverflow)?;

    // Convert back to u64
    if token_amount > u64::MAX as u128 {
        return Err(GameError::OracleOverflow.into());
    }

    Ok(token_amount as u64)
}
