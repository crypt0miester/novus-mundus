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

use p_pyth::{Price, PriceUpdateV2, PythError};
use p_switchboard::{OracleQuote, QuoteVerifier, SbError};
use crate::constants::{PYTH_PROGRAM_ID, PYTH_RECEIVER_PROGRAM_ID};
use crate::state::{AllowedTokenAccount, OracleQuotePda, ShopConfigAccount};
use crate::validation::require_key_match;
use crate::logic::safe_math::apply_bp_penalty;
use crate::token_helpers::create_associated_token_account;
use crate::utils::{unlikely, Pk};

/// Oracle program, identified by the account passed at the SOL-feed slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OracleType {
    /// Pyth pull oracle — a `PriceUpdateV2` account per asset.
    Pyth,
    /// Switchboard On-Demand — the program-owned `OracleQuote` PDA (Model B).
    Switchboard,
}

/// Detect the oracle program from the SOL-feed-slot account's owner.
///
/// Pyth pull-oracle accounts (`PriceUpdateV2`) are owned by the Pyth price-feed
/// program (sponsored feeds) or the Pyth Solana Receiver (caller-posted
/// updates). The Switchboard path instead passes this program's own
/// **oracle-quote PDA** (Model B — see `state/oracle_quote.rs`), owned by
/// `crate::ID`.
///
/// The owner check is what makes the data-format assumption safe: only the
/// real Pyth program can produce bytes that parse as a Pyth feed, and only
/// this program's `crank_oracle_quote` writes the oracle-quote PDA.
pub fn detect_oracle_type(feed_or_quote: &AccountView) -> Result<OracleType, ProgramError> {
    let owner = unsafe { feed_or_quote.owner() };
    let owner = owner.as_array();
    if owner == &PYTH_PROGRAM_ID || owner == &PYTH_RECEIVER_PROGRAM_ID {
        Ok(OracleType::Pyth)
    } else if owner == crate::ID.as_array() {
        Ok(OracleType::Switchboard)
    } else {
        pinocchio_log::log!(
            "detect_oracle_type: unrecognized feed/quote owner {} (account {})",
            Pk(owner),
            Pk(feed_or_quote.address().as_array()),
        );
        Err(GameError::OracleUnavailable.into())
    }
}

/// Zero pubkey used to indicate "no feed configured".
pub const ZERO_PUBKEY: [u8; 32] = [0u8; 32];
pub const ZERO_ADDRESS: Address = Address::new_from_array(ZERO_PUBKEY);

/// Require that a Pyth feed id is configured (non-zero).
///
/// Pyth pull-oracle accounts can be ephemeral, so the feed is pinned by its
/// 32-byte `feed_id` — verified inside [`PriceUpdateV2::get_price_no_older_than`]
/// — rather than by account address. The DAO stores that `feed_id` in the
/// `*_pyth_feed` config field.
#[inline(always)]
pub fn require_pyth_feed_configured(feed_id: &[u8; 32]) -> Result<(), ProgramError> {
    if unlikely(feed_id == &ZERO_PUBKEY) {
        return Err(GameError::OracleUnavailable.into());
    }
    Ok(())
}

/// Require that a Switchboard feed id is configured (non-zero).
///
/// Switchboard On-Demand `OracleQuote`s carry feeds keyed by a 32-byte
/// `feed_id` (the feed hash). The DAO stores that id in the `*_switchboard_feed`
/// config field; verification matches it against the feeds in the quote.
#[inline(always)]
pub fn require_switchboard_feed_configured(feed_id: &[u8; 32]) -> Result<(), ProgramError> {
    if unlikely(feed_id == &ZERO_PUBKEY) {
        return Err(GameError::OracleUnavailable.into());
    }
    Ok(())
}

/// Map a `p_pyth::PythError` onto a game error.
fn map_pyth_err(e: PythError) -> GameError {
    match e {
        PythError::PriceTooOld => GameError::OraclePriceStale,
        PythError::ConfidenceTooWide => GameError::OracleConfidenceTooWide,
        // MismatchedFeedId, InsufficientVerificationLevel, parse failures.
        _ => GameError::OracleUnavailable,
    }
}

/// Map a `p_switchboard::SbError` onto a game error.
fn map_sb_err(e: SbError) -> GameError {
    match e {
        SbError::QuoteTooOld => GameError::OraclePriceStale,
        // Bad discriminator / queue / signatures / slot hash / feed lookup.
        _ => GameError::OracleUnavailable,
    }
}

/// Parse a Pyth `PriceUpdateV2` account and return a fully-checked price.
///
/// Enforces, via the receiver-SDK port: `VerificationLevel::Full`, the
/// `feed_id` matches the DAO-configured feed, and `publish_time` is no older
/// than `max_staleness_secs` **seconds**. The confidence-interval gate is an
/// additional local check (`max_confidence_bps == 0` disables it).
///
/// # Arguments
/// * `feed_data` - Raw `PriceUpdateV2` account data
/// * `current_timestamp` - Current Unix timestamp (`Clock::unix_timestamp`)
/// * `max_staleness_secs` - Maximum price age in seconds
/// * `feed_id` - Expected 32-byte Pyth feed id
/// * `max_confidence_bps` - Maximum confidence interval in basis points
pub fn read_pyth_price(
    feed_data: &[u8],
    current_timestamp: i64,
    max_staleness_secs: u64,
    feed_id: &[u8; 32],
    max_confidence_bps: u16,
) -> Result<Price, ProgramError> {
    let update = PriceUpdateV2::parse(feed_data).map_err(map_pyth_err)?;
    let price = update
        .get_price_no_older_than(current_timestamp, max_staleness_secs, feed_id)
        .map_err(map_pyth_err)?;
    if !price.is_confidence_acceptable(max_confidence_bps) {
        return Err(GameError::OracleConfidenceTooWide.into());
    }
    Ok(price)
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

/// Calculate token amount for payment given Pyth oracle prices.
///
/// `token_amount = lamports * (sol_usd / token_usd) * 10^token_decimals / 10^9`
/// — all powers of ten folded into one `net_expo` for [`scale_ratio`].
pub fn calculate_token_amount(
    sol_price_lamports: u64,
    sol_price: &Price,
    token_price: &Price,
    token_decimals: u8,
) -> Result<u64, ProgramError> {
    if sol_price.price <= 0 || token_price.price <= 0 {
        return Err(GameError::OracleUnavailable.into());
    }

    let net_expo = sol_price.exponent - token_price.exponent + token_decimals as i32 - 9;
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
pub fn process_token_payment<'a>(
    from: &'a AccountView,
    to: &'a AccountView,
    authority: &'a AccountView,
    amount: u64,
) -> ProgramResult {
    transfer_tokens(from, to, authority, amount, &[])
}

// UNIFIED TOKEN PAYMENT PROCESSOR

/// Base token-payment accounts shared by both oracle programs:
/// - [0] allowed_token: AllowedTokenAccount PDA
/// - [1] token_mint: SPL Token mint
/// - [2] buyer_token_ata: Buyer's token account (writable)
/// - [3] treasury_token_ata: Treasury's token account (writable)
/// - [4] token_program: SPL Token program
///
/// Then, by oracle program:
/// - **Pyth** (`TOKEN_PAYMENT_ACCOUNTS` = 7): [5] sol `PriceUpdateV2`,
///   [6] token `PriceUpdateV2`.
/// - **Switchboard** (`TOKEN_PAYMENT_ACCOUNTS_SB` = 8): [5] oracle-quote PDA,
///   [6] Switchboard queue, [7] SlotHashes sysvar. A single quote carries
///   both the SOL/USD and TOKEN/USD feeds.
pub const TOKEN_PAYMENT_ACCOUNTS: usize = 7;
/// Switchboard token-payment account count (see [`TOKEN_PAYMENT_ACCOUNTS`]).
pub const TOKEN_PAYMENT_ACCOUNTS_SB: usize = 8;
/// Pegged-stablecoin token-payment account count — slots 0..=4 only; oracle
/// slots 5+ are not required when `AllowedTokenAccount.pegged_to_usd == 1`.
pub const TOKEN_PAYMENT_ACCOUNTS_PEGGED: usize = 5;

/// Process a complete token payment flow.
///
/// Unified entry point for token payments across all purchase processors.
/// Two pricing paths, selected per-token by `AllowedTokenAccount.pegged_to_usd`:
///
/// - **Pegged stablecoin** (`pegged_to_usd = 1`): USDC/USDT/PYUSD-style $1
///   peg. Skips oracle entirely; computes `token_amount = cost_usd_cents ×
///   10^(decimals - 2)`. Caller MUST pass a non-zero `cost_usd_cents` — this
///   path is meaningful only for USD-denominated products (subscriptions).
///   Account slots 5+ are not consulted, so the client may omit them.
///
/// - **Oracle path** (`pegged_to_usd = 0`): detects Pyth vs Switchboard from
///   slot 5 and verifies the SOL/USD + TOKEN/USD pair to convert
///   `final_price_lamports` into a token amount.
///
/// `treasury_wallet` is the DAO-configured treasury (`game_engine.treasury_wallet`);
/// `treasury_token_ata` is pinned to it so a buyer cannot redirect payment to
/// a token account they control. `treasury_wallet_account` + `system_program`
/// are required for the ATA-creation backstop: if the treasury ATA happens not
/// to exist (e.g. a token whitelisted before `create_allowed_token` provisioned
/// it, or an accidental close), the buyer pays the rent to create it here,
/// using the non-idempotent `Create` (mirrors `withdraw_reserved.rs`).
///
/// `current_slot` drives Switchboard quote freshness (slot-based);
/// `current_timestamp` drives Pyth staleness (`publish_time`, seconds).
pub fn process_token_payment_flow(
    token_accounts: &[AccountView],
    game_engine_key: &Address,
    treasury_wallet: &Address,
    treasury_wallet_account: &AccountView,
    program_id: &Address,
    shop_config: &ShopConfigAccount,
    buyer: &AccountView,
    final_price_lamports: u64,
    // USD-denominated price for the product, in cents. Pass `Some(n>0)` for
    // USD-priced products (subscriptions) — required by the pegged-stablecoin
    // path. Pass `None` for SOL-priced products (shop items / bundles /
    // flash sales); pegged tokens are rejected with `InvalidParameter` in
    // that case (no way to derive USD without an oracle, so the pegged
    // shortcut would be meaningless).
    cost_usd_cents: Option<u64>,
    system_program: &AccountView,
    current_slot: u64,
    current_timestamp: i64,
) -> ProgramResult {
    // Base account requirement (pegged path needs only these 5).
    if unlikely(token_accounts.len() < TOKEN_PAYMENT_ACCOUNTS_PEGGED) {
        pinocchio_log::log!(
            "process_token_payment_flow: need at least {} base accounts, got {}",
            TOKEN_PAYMENT_ACCOUNTS_PEGGED as u64,
            token_accounts.len() as u64,
        );
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let allowed_token_account = &token_accounts[0];
    let token_mint = &token_accounts[1];
    let buyer_token_ata = &token_accounts[2];
    let treasury_token_ata = &token_accounts[3];
    let token_program = &token_accounts[4];

    require_key_match(token_program, &pinocchio_token::ID)?;

    if !buyer_token_ata.is_writable() || !treasury_token_ata.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }

    // ATA backstop: `create_allowed_token` provisions the treasury ATA at
    // whitelist time, but this is defense-in-depth for tokens whitelisted
    // before that helper existed, or if the ATA was closed. The non-
    // idempotent `Create` errors if a front-run already created the same
    // address; the caller's tx fails clean and they retry.
    if treasury_token_ata.data_len() == 0 {
        create_associated_token_account(
            buyer,                       // payer (buyer covers rent in this fallback)
            treasury_token_ata,          // ATA to create
            treasury_wallet_account,     // wallet that owns the ATA
            token_mint,
            system_program,
            token_program,
        )?;
    }

    // Pin the payment destination: the treasury token account's authority
    // must be the DAO-configured treasury wallet. Without this a buyer can
    // pass a token account they control as `treasury_token_ata` and pay
    // themselves while the purchase still completes — a free purchase.
    validate_token_account_owner(treasury_token_ata, treasury_wallet)?;

    let allowed_token = AllowedTokenAccount::load_checked(
        allowed_token_account,
        game_engine_key,
        token_mint.address(),
        program_id,
    ).map_err(|_| GameError::TokenNotAllowed)?;

    // Branch on pricing model.
    let token_amount = if allowed_token.pegged_to_usd != 0 {
        // Pegged path: skip oracle, compute directly from USD.
        // `None` (SOL-priced product) or `Some(0)` (degenerate input) is
        // surfaced loudly — the pegged shortcut only makes sense when the
        // caller has an authoritative USD price to convert from.
        let cents = match cost_usd_cents {
            Some(c) if c > 0 => c,
            _ => {
                pinocchio_log::log!(
                    "process_token_payment_flow: pegged token requires a USD-denominated price (SOL-priced products must use a non-pegged token)",
                );
                return Err(GameError::InvalidParameter.into());
            }
        };
        let mint_data = token_mint.try_borrow()?;
        let decimals = read_token_decimals(&mint_data)?;
        /*
         * Defensive cap mirrored from create/update_allowed_token's
         * [2, 12] gate. The config-time validator should already prevent
         * out-of-range decimals from ever reaching here, but the helper
         * must not assume that invariant — `checked_pow(decimals - 2)`
         * accepts up to decimals = 21 before overflowing, well past any
         * realistic SPL mint.
         */
        if decimals < 2 || decimals > 12 {
            return Err(GameError::InvalidParameter.into());
        }
        /*
         * token_amount = cents × 10^(decimals - 2)
         * e.g. $50 sub at USDC (6 dec): 5_000 × 10^4 = 50_000_000 base units.
         */
        let scale = 10u64
            .checked_pow((decimals - 2) as u32)
            .ok_or(GameError::MathOverflow)?;
        cents.checked_mul(scale).ok_or(GameError::MathOverflow)?
    } else {
        // Oracle path: slot 5 selects Pyth (PriceUpdateV2) or Switchboard
        // (program-owned OracleQuote PDA).
        if unlikely(token_accounts.len() < TOKEN_PAYMENT_ACCOUNTS) {
            pinocchio_log::log!(
                "process_token_payment_flow: oracle path needs at least {} accounts, got {}",
                TOKEN_PAYMENT_ACCOUNTS as u64,
                token_accounts.len() as u64,
            );
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        match detect_oracle_type(&token_accounts[5])? {
            OracleType::Pyth => {
                if unlikely(detect_oracle_type(&token_accounts[6])? != OracleType::Pyth) {
                    pinocchio_log::log!("process_token_payment_flow: mixed Pyth+Switchboard feeds rejected");
                    return Err(GameError::OracleUnavailable.into());
                }
                calculate_token_amount_pyth(
                    &token_accounts[5],
                    &token_accounts[6],
                    token_mint,
                    &allowed_token,
                    shop_config,
                    final_price_lamports,
                    current_timestamp,
                )?
            }
            OracleType::Switchboard => {
                if unlikely(token_accounts.len() < TOKEN_PAYMENT_ACCOUNTS_SB) {
                    return Err(ProgramError::NotEnoughAccountKeys);
                }
                let quote = verify_switchboard_quote(
                    &token_accounts[5],
                    &token_accounts[6],
                    &token_accounts[7],
                    &shop_config.switchboard_queue,
                    current_slot,
                    shop_config.sol_max_staleness_slots as u64,
                )?;
                let sol_usd = sb_feed_value(&quote, shop_config.sol_switchboard_feed.as_array())?;
                let token_usd = sb_feed_value(&quote, allowed_token.switchboard_feed.as_array())?;
                let mint_data = token_mint.try_borrow()?;
                let token_decimals = read_token_decimals(&mint_data)?;
                calculate_token_amount_from_sb_prices(
                    final_price_lamports,
                    sol_usd,
                    token_usd,
                    token_decimals,
                )?
            }
        }
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
    current_timestamp: i64,
) -> Result<u64, ProgramError> {
    // Pyth feeds are pinned by `feed_id` (verified inside read_pyth_price),
    // not by account address. Require both feed ids are configured.
    let sol_feed_id = shop_config.sol_pyth_feed.as_array();
    let token_feed_id = allowed_token.pyth_feed.as_array();
    require_pyth_feed_configured(sol_feed_id)?;
    require_pyth_feed_configured(token_feed_id)?;

    let sol_oracle_data = sol_oracle_feed.try_borrow()?;
    let sol_price = read_pyth_price(
        &sol_oracle_data,
        current_timestamp,
        shop_config.sol_max_staleness_slots as u64,
        sol_feed_id,
        shop_config.sol_confidence_threshold_bps,
    )?;

    let token_oracle_data = token_oracle_feed.try_borrow()?;
    let token_price = read_pyth_price(
        &token_oracle_data,
        current_timestamp,
        allowed_token.max_staleness_slots as u64,
        token_feed_id,
        allowed_token.confidence_threshold_bps,
    )?;

    let mint_data = token_mint.try_borrow()?;
    let token_decimals = read_token_decimals(&mint_data)?;

    calculate_token_amount(final_price_lamports, &sol_price, &token_price, token_decimals)
}

/// Verify the program-owned Switchboard oracle-quote PDA and return the
/// cryptographically verified quote.
///
/// Pins the `queue` account to the DAO-configured `switchboard_queue`, pins
/// `quote_pda` to `["oracle_quote", queue]`, and confirms `quote_pda` is owned
/// by this program. `QuoteVerifier::verify_account` then performs the full
/// check: ed25519 signature authorization against the queue's oracle keys,
/// slot-hash freshness, and the `max_age_slots` bound.
pub fn verify_switchboard_quote<'a>(
    quote_pda: &'a AccountView,
    queue: &'a AccountView,
    slothashes_sysvar: &'a AccountView,
    configured_queue: &Address,
    current_slot: u64,
    max_age_slots: u64,
) -> Result<OracleQuote<'a>, ProgramError> {
    // Pin the queue to the DAO-configured Switchboard queue.
    if unlikely(configured_queue == &ZERO_ADDRESS || queue.address() != configured_queue) {
        return Err(GameError::OracleUnavailable.into());
    }
    // Pin the quote account to the canonical ["oracle_quote", queue] PDA.
    let (expected_quote, _) = OracleQuotePda::derive_pda(queue.address());
    if unlikely(quote_pda.address() != &expected_quote) {
        return Err(GameError::OracleUnavailable.into());
    }
    // The quote PDA must be owned by this program (written only by the crank).
    if unlikely(unsafe { quote_pda.owner() } != &crate::ID) {
        return Err(GameError::OracleUnavailable.into());
    }

    let mut verifier = QuoteVerifier::new();
    verifier
        .queue(queue)
        .slothash_sysvar(slothashes_sysvar)
        .clock_slot(current_slot)
        .max_age(max_age_slots);
    verifier
        .verify_account(quote_pda)
        .map_err(|e| map_sb_err(e).into())
}

/// Pull a single feed's fixed-point value (i128 @ 1e18) from a verified quote.
///
/// Requires the feed id is configured (non-zero) and present in the quote.
pub fn sb_feed_value(quote: &OracleQuote, feed_id: &[u8; 32]) -> Result<i128, ProgramError> {
    require_switchboard_feed_configured(feed_id)?;
    let info = quote.feed(feed_id).map_err(map_sb_err)?;
    Ok(info.feed_value())
}

/// Calculate token amount from Switchboard `OracleQuote` prices (i128 @ 10^18).
///
/// Switchboard prices are scaled to 18 decimals. SOL has 9 decimals (lamports).
///
/// Formula: `token_amount = (lamports * sol_usd * 10^token_decimals)
///                          / (token_usd * 10^9)`
/// — since `sol_usd` and `token_usd` share the 10^18 scale it cancels.
pub fn calculate_token_amount_from_sb_prices(
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
