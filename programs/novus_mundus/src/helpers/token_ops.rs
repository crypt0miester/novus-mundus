/// SPL Token operations using Pinocchio
///
/// This module provides actual token burn/mint/transfer operations
/// using the pinocchio-token crate for compute-optimized CPIs.

use pinocchio::{
    AccountView,
    cpi::Signer,
    error::ProgramError,
    Address,
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
    token_account: &AccountView,
    expected_owner: &Address,
) -> Result<(), ProgramError> {
    // Check token account is owned by SPL Token program
    if unsafe { token_account.owner() } != &pinocchio_token::ID {
        return Err(GameError::InvalidTokenAccount.into());
    }

    // Check token account data is large enough
    let token_data = token_account.try_borrow()?;
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
    token_account: &'a AccountView,
    mint: &'a AccountView,
    authority: &'a AccountView,
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
    mint: &'a AccountView,
    destination: &'a AccountView,
    mint_authority: &'a AccountView,
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
    from: &'a AccountView,
    to: &'a AccountView,
    authority: &'a AccountView,
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
// let seeds = crate::seeds!(GAME_ENGINE_SEED, &bump_seed);
// let signer = Signer::from(&seeds);
// burn_tokens(account, mint, authority, amount, &[signer])?;
// ```

// ORACLE & TOKEN PAYMENT HELPERS

use p_pyth::{OraclePrice, load_pyth_price_with_confidence};
use p_switchboard::{SwitchboardPrice, load_switchboard_price, load_switchboard_price_with_confidence};
use crate::constants::{PYTH_PROGRAM_ID, SWITCHBOARD_PROGRAM_ID};
use crate::state::{AllowedTokenAccount, ShopConfigAccount};
use crate::validation::require_key_match;
use crate::logic::safe_math::apply_bp_penalty;
use crate::utils::{unlikely, Pk};

/// Oracle type, identified by the program that owns the feed account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OracleType {
    Pyth,
    Switchboard,
}

/// Detect oracle type from the feed account's owner program.
///
/// The address-pin against shop_config/allowed_token already ties the
/// feed to a DAO-approved pubkey, but the owner check is what makes the
/// data-format assumption safe: only the real Pyth program can produce
/// bytes that load as a Pyth price account, and the same for Switchboard.
/// Without it, a feed swap (account closure + replay-with-same-pubkey)
/// could feed arbitrary bytes to whichever parser we picked by magic.
pub fn detect_oracle_type(oracle_account: &AccountView) -> Result<OracleType, ProgramError> {
    let owner = unsafe { oracle_account.owner() };
    if owner.as_array() == &PYTH_PROGRAM_ID {
        Ok(OracleType::Pyth)
    } else if owner.as_array() == &SWITCHBOARD_PROGRAM_ID {
        Ok(OracleType::Switchboard)
    } else {
        pinocchio_log::log!(
            "detect_oracle_type: unrecognized feed owner {} (feed {})",
            Pk(owner.as_array()),
            Pk(oracle_account.address().as_array()),
        );
        Err(GameError::OracleUnavailable.into())
    }
}

/// Validate that a feed account submitted at DAO config time matches the
/// pubkey the DAO wants to store *and* is in fact the oracle type they
/// claim it is.
///
/// Checks (in order):
/// 1. `feed_account.address() == expected_pubkey`
/// 2. `feed_account.owner() == PYTH_PROGRAM_ID` (or `SWITCHBOARD_PROGRAM_ID`)
/// 3. Account data parses as the matching feed layout — Pyth: passes
///    `PythPriceAccount::load`; Switchboard: passes
///    `p_switchboard::validate_discriminator`
///
/// Without this, a junk pubkey set at config time is silently accepted
/// and only blows up later at purchase time. Run this from
/// `create_allowed_token`, `update_allowed_token`, and shop
/// `update_config` whenever the DAO is *writing* a feed pubkey.
pub fn validate_oracle_feed_at_config(
    feed_account: &AccountView,
    expected_pubkey: &[u8; 32],
    expected_type: OracleType,
) -> Result<(), ProgramError> {
    if unlikely(feed_account.address().as_array() != expected_pubkey) {
        pinocchio_log::log!(
            "validate_oracle_feed: feed account {} doesn't match instruction-data pubkey {}",
            Pk(feed_account.address().as_array()),
            Pk(expected_pubkey),
        );
        return Err(GameError::OracleUnavailable.into());
    }

    let owner = unsafe { feed_account.owner() };
    let expected_owner: &[u8; 32] = match expected_type {
        OracleType::Pyth => &PYTH_PROGRAM_ID,
        OracleType::Switchboard => &SWITCHBOARD_PROGRAM_ID,
    };
    if unlikely(owner.as_array() != expected_owner) {
        pinocchio_log::log!(
            "validate_oracle_feed: expected owner {}, got {}",
            Pk(expected_owner),
            Pk(owner.as_array()),
        );
        return Err(GameError::OracleUnavailable.into());
    }

    let data = feed_account.try_borrow()?;
    match expected_type {
        OracleType::Pyth => {
            unsafe { p_pyth::PythPriceAccount::load(&data) }
                .map_err(|_| GameError::OracleUnavailable)?;
        }
        OracleType::Switchboard => {
            p_switchboard::validate_discriminator(&data)
                .map_err(|_| GameError::OracleUnavailable)?;
        }
    }
    Ok(())
}

/// Zero pubkey used to indicate "no feed configured".
pub const ZERO_PUBKEY: [u8; 32] = [0u8; 32];
pub const ZERO_ADDRESS: Address = Address::new_from_array(ZERO_PUBKEY);

/// Pin a user-supplied oracle feed account to the DAO-configured pubkey.
///
/// Rejects either:
/// - `configured == ZERO_ADDRESS` (no feed has been configured for this
///   oracle type at all), or
/// - `feed.address() != configured` (user passed a different feed than
///   the DAO approved).
///
/// Both rejections produce `OracleUnavailable`. Pulls the four
/// per-feed pin checks out of `process_token_payment_flow` and
/// `purchase_novi::try_oracle_price`.
#[inline(always)]
pub fn pin_oracle_feed(feed: &AccountView, configured: &Address) -> Result<(), ProgramError> {
    if unlikely(*configured == ZERO_ADDRESS || feed.address() != configured) {
        return Err(GameError::OracleUnavailable.into());
    }
    Ok(())
}

/// DAO-time helper: consume the optional trailing feed slot for
/// `feed_pubkey` (Pyth or Switchboard), if `feed_pubkey` is non-zero.
///
/// Used by `create_allowed_token` / `update_allowed_token` / shop
/// `update_config` to walk a variable-length tail of feed accounts
/// (pyth-then-switchboard ordering, zero pubkeys consume no slot).
///
/// Returns the next slot cursor.
#[inline]
pub fn consume_optional_feed_slot(
    accounts: &[AccountView],
    slot: usize,
    feed_pubkey: &[u8; 32],
    feed_type: OracleType,
) -> Result<usize, ProgramError> {
    if feed_pubkey == &ZERO_PUBKEY {
        return Ok(slot);
    }
    let acct = accounts.get(slot).ok_or(ProgramError::NotEnoughAccountKeys)?;
    validate_oracle_feed_at_config(acct, feed_pubkey, feed_type)?;
    Ok(slot + 1)
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

/// Compute `numerator * 10^net_expo / denominator` in u128, overflow-checked.
///
/// Oracle price math (SOL→token, token→lamports) always reduces to a ratio of
/// two raw integer prices times a net power of ten. Callers fold every
/// power-of-ten adjustment — both price exponents, token decimals, SOL
/// decimals — into a single signed `net_expo` and pass it here so the scale is
/// applied exactly once. We never normalize an individual price to a fixed
/// working exponent: at expo -18 a $150 SOL price (15e9 @ expo -8 → 1.5e20)
/// overflows u64. Staying in u128 with one combined exponent keeps products
/// far below u128::MAX (raw oracle prices are ~1e10).
pub fn scale_ratio(
    numerator: u128,
    denominator: u128,
    net_expo: i32,
) -> Result<u128, ProgramError> {
    let (num, den) = if net_expo >= 0 {
        let scale = 10u128
            .checked_pow(net_expo as u32)
            .ok_or(GameError::OracleOverflow)?;
        (numerator.checked_mul(scale).ok_or(GameError::OracleOverflow)?, denominator)
    } else {
        let scale = 10u128
            .checked_pow((-net_expo) as u32)
            .ok_or(GameError::OracleOverflow)?;
        (numerator, denominator.checked_mul(scale).ok_or(GameError::OracleOverflow)?)
    };

    if den == 0 {
        return Err(GameError::OracleUnavailable.into());
    }
    Ok(num.checked_div(den).ok_or(GameError::OracleOverflow)?)
}

/// Calculate token amount for payment given oracle prices.
///
/// `token_amount = lamports * (sol_usd / token_usd) * 10^token_decimals / 10^9`
/// — all powers of ten folded into one `net_expo` for [`scale_ratio`].
pub fn calculate_token_amount(
    sol_price_lamports: u64,
    sol_price: &OraclePrice,
    token_price: &OraclePrice,
    token_decimals: u8,
) -> Result<u64, ProgramError> {
    if sol_price.price <= 0 || token_price.price <= 0 {
        return Err(GameError::OracleUnavailable.into());
    }

    let net_expo = sol_price.expo - token_price.expo + token_decimals as i32 - 9;
    let numerator = (sol_price_lamports as u128)
        .checked_mul(sol_price.price as u128)
        .ok_or(GameError::OracleOverflow)?;

    let token_amount = scale_ratio(numerator, token_price.price as u128, net_expo)?;

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
    from: &'a AccountView,
    to: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
) -> ProgramResult {
    transfer_tokens(from, to, authority, amount, &[])
}

// UNIFIED TOKEN PAYMENT PROCESSOR

/// Token payment accounts structure (7 accounts, identical for Pyth and Switchboard):
/// - [0] allowed_token: AllowedTokenAccount PDA
/// - [1] token_mint: SPL Token mint
/// - [2] buyer_token_ata: Buyer's token account (writable)
/// - [3] treasury_token_ata: Treasury's token account (writable)
/// - [4] token_program: SPL Token program
/// - [5] sol_oracle_feed: SOL/USD price feed (Pyth or Switchboard pull feed)
/// - [6] token_oracle_feed: TOKEN/USD price feed (Pyth or Switchboard pull feed)
///
/// Both feeds must be owned by the same oracle program; mixing is rejected.
pub const TOKEN_PAYMENT_ACCOUNTS: usize = 7;

/// Process a complete token payment flow.
///
/// Unified entry point for token payments across all purchase processors:
/// detects oracle program (Pyth or Switchboard pull feed) from feed owner,
/// fetches both prices, computes the token amount, and CPI-transfers.
///
/// `token_accounts` must be `TOKEN_PAYMENT_ACCOUNTS` (7) entries — see the
/// constant's docstring for the slot order.
pub fn process_token_payment_flow(
    token_accounts: &[AccountView],
    game_engine_key: &Address,
    program_id: &Address,
    shop_config: &ShopConfigAccount,
    buyer: &AccountView,
    final_price_lamports: u64,
    current_slot: u64,
) -> ProgramResult {
    if unlikely(token_accounts.len() < TOKEN_PAYMENT_ACCOUNTS) {
        pinocchio_log::log!(
            "process_token_payment_flow: need {} accounts, got {}",
            TOKEN_PAYMENT_ACCOUNTS as u64,
            token_accounts.len() as u64,
        );
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let allowed_token_account = &token_accounts[0];
    let token_mint = &token_accounts[1];
    let buyer_token_ata = &token_accounts[2];
    let treasury_token_ata = &token_accounts[3];
    let token_program = &token_accounts[4];
    let sol_oracle_feed = &token_accounts[5];
    let token_oracle_feed = &token_accounts[6];

    require_key_match(token_program, &pinocchio_token::ID)?;

    if !buyer_token_ata.is_writable() || !treasury_token_ata.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }

    let allowed_token = AllowedTokenAccount::load_checked(
        allowed_token_account,
        game_engine_key,
        token_mint.address(),
        program_id,
    ).map_err(|_| GameError::TokenNotAllowed)?;

    // Pick oracle type by feed-account owner. Both feeds must come from
    // the same program — mixing Pyth + Switchboard is rejected.
    let oracle_type = detect_oracle_type(sol_oracle_feed)?;
    if unlikely(detect_oracle_type(token_oracle_feed)? != oracle_type) {
        pinocchio_log::log!("process_token_payment_flow: mixed Pyth+Switchboard feeds rejected");
        return Err(GameError::OracleUnavailable.into());
    }

    // Pin to the DAO-configured pubkey for this oracle type. The owner
    // check above guarantees the bytes-format is what we'll parse; this
    // address-pin guarantees the *price* is the one the DAO approved.
    let (sol_configured, token_configured) = match oracle_type {
        OracleType::Pyth => (&shop_config.sol_pyth_feed, &allowed_token.pyth_feed),
        OracleType::Switchboard => (&shop_config.sol_switchboard_feed, &allowed_token.switchboard_feed),
    };
    pin_oracle_feed(sol_oracle_feed, sol_configured)?;
    pin_oracle_feed(token_oracle_feed, token_configured)?;

    let token_amount = match oracle_type {
        OracleType::Pyth => calculate_token_amount_pyth(
            sol_oracle_feed,
            token_oracle_feed,
            token_mint,
            &allowed_token,
            shop_config,
            final_price_lamports,
            current_slot,
        )?,
        OracleType::Switchboard => calculate_token_amount_switchboard(
            sol_oracle_feed,
            token_oracle_feed,
            token_mint,
            &allowed_token,
            shop_config,
            final_price_lamports,
            current_slot,
        )?,
    };

    // Apply token discount (Layer 0 - first discount applied)
    let discounted_token_amount = if allowed_token.discount_bps > 0 {
        apply_bp_penalty(token_amount, allowed_token.discount_bps)
            .ok_or(GameError::MathOverflow)?
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

fn calculate_token_amount_pyth(
    sol_oracle_feed: &AccountView,
    token_oracle_feed: &AccountView,
    token_mint: &AccountView,
    allowed_token: &AllowedTokenAccount,
    shop_config: &ShopConfigAccount,
    final_price_lamports: u64,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    let sol_oracle_data = sol_oracle_feed.try_borrow()?;
    let sol_price = get_pyth_price(
        &sol_oracle_data,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
        shop_config.sol_confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    let token_oracle_data = token_oracle_feed.try_borrow()?;
    let token_price = get_pyth_price(
        &token_oracle_data,
        current_slot,
        allowed_token.max_staleness_slots as u64,
        allowed_token.confidence_threshold_bps,
    ).map_err(|_| GameError::OraclePriceStale)?;

    let mint_data = token_mint.try_borrow()?;
    let token_decimals = read_token_decimals(&mint_data)?;

    calculate_token_amount(final_price_lamports, &sol_price, &token_price, token_decimals)
}

/// Calculate token amount from Switchboard pull-feed prices (i128 @ 10^18).
fn calculate_token_amount_switchboard(
    sol_oracle_feed: &AccountView,
    token_oracle_feed: &AccountView,
    token_mint: &AccountView,
    allowed_token: &AllowedTokenAccount,
    shop_config: &ShopConfigAccount,
    final_price_lamports: u64,
    current_slot: u64,
) -> Result<u64, ProgramError> {
    let sol_price = read_switchboard_price(
        sol_oracle_feed,
        current_slot,
        shop_config.sol_max_staleness_slots as u64,
        shop_config.sol_confidence_threshold_bps,
    )?;

    let token_price = read_switchboard_price(
        token_oracle_feed,
        current_slot,
        allowed_token.max_staleness_slots as u64,
        allowed_token.confidence_threshold_bps,
    )?;

    let mint_data = token_mint.try_borrow()?;
    let token_decimals = read_token_decimals(&mint_data)?;

    calculate_token_amount_from_sb_prices(
        final_price_lamports,
        sol_price.value,
        token_price.value,
        token_decimals,
    )
}

/// Read & validate a Switchboard pull-feed price (single feed account).
///
/// Caller is responsible for verifying the feed's address against the
/// DAO-configured pubkey *and* that the feed is owned by the Switchboard
/// on-demand program before calling this.
pub fn read_switchboard_price(
    feed_account: &AccountView,
    current_slot: u64,
    max_staleness_slots: u64,
    max_std_dev_bps: u16,
) -> Result<SwitchboardPrice, ProgramError> {
    let data = feed_account.try_borrow()?;
    let price = if max_std_dev_bps > 0 {
        load_switchboard_price_with_confidence(
            &data,
            current_slot,
            max_staleness_slots,
            max_std_dev_bps,
        )
    } else {
        load_switchboard_price(&data, current_slot, max_staleness_slots)
    };
    price.map_err(|_| GameError::OraclePriceStale.into())
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
