use crate::{
    constants::ALLOWED_TOKEN_SEED,
    error::GameError,
    helpers::read_token_decimals,
    helpers::ZERO_PUBKEY,
    state::{AllowedTokenAccount, GameEngine},
    token_helpers::create_associated_token_account,
    utils::{read_bytes32, read_u16, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Create an AllowedToken account (DAO only)
///
/// Whitelists a token for payment in the shop system.
/// Stores both Pyth and Switchboard oracle feeds for redundancy.
///
/// # Accounts (base — 9)
/// - [signer, writable] authority: DAO authority (game_engine.authority), pays for accounts
/// - [] game_engine: GameEngine account
/// - [writable] allowed_token: AllowedTokenAccount PDA to create
/// - [] token_mint: The SPL token mint being allowed
/// - [] system_program: System program
/// - [] treasury_wallet: Treasury wallet (must equal game_engine.treasury_wallet)
/// - [writable] treasury_token_account: Treasury's ATA for token_mint (created if missing)
/// - [] token_program: SPL Token program
/// - [] associated_token_program: Associated Token program
///
/// Both Pyth and Switchboard feeds are configured as bare 32-byte feed-ids
/// (no account), so neither consumes a trailing account slot — feed-ids are
/// verified at purchase time.
///
/// # Instruction Data
/// - pyth_feed: 32 bytes - Pyth TOKEN/USD feed id (Pyth feed identifier, 0 = unset)
/// - switchboard_feed: 32 bytes - Switchboard TOKEN/USD OracleQuote feed id (0 = unset)
/// - max_staleness_slots: u16 - Max price age (Pyth: seconds; Switchboard: slots)
/// - confidence_threshold_bps: u16 - Max confidence interval / std deviation
/// - discount_bps: u16 - Discount for using this token
/// - pegged_to_usd: u8 - 0 = oracle path (requires at least one feed);
///   1 = $1-pegged stablecoin (USDC/USDT/PYUSD — no feeds needed; mint
///   decimals must be in [2, 12]).
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (9 required + 0–2 optional feed-validation slots)

    crate::extract_accounts!(
        accounts,
        [
            authority,
            game_engine_account,
            allowed_token_account,
            token_mint,
            system_program,
            treasury_wallet,
            treasury_token_account,
            token_program,
            _associated_token_program,
        ]
    );

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(allowed_token_account)?;
    require_writable(treasury_token_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;
    require_key_match(token_program, &pinocchio_token::ID)?;

    // 3. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // Treasury wallet must match GameEngine config — it is the authority of the
    // treasury ATA provisioned below, which process_token_payment_flow pins.
    crate::require_keys_eq!(
        treasury_wallet.address().as_array(),
        game_engine.treasury_wallet.as_array(),
        "create_allowed_token.treasury_wallet",
        GameError::InvalidAccount,
    );

    // 4. Verify token_mint is a valid SPL mint (82 bytes)

    if token_mint.data_len() != 82 {
        return Err(GameError::InvalidMint.into());
    }

    // 5. Derive and Verify AllowedToken PDA

    let (expected_pda, bump) =
        AllowedTokenAccount::derive_pda(game_engine_account.address(), token_mint.address());

    if allowed_token_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Parse Instruction Data

    let pyth_feed = Address::from(read_bytes32(instruction_data, 0, "pyth_feed")?);
    let switchboard_feed = Address::from(read_bytes32(instruction_data, 32, "switchboard_feed")?);
    let max_staleness_slots = read_u16(instruction_data, 64, "max_staleness_slots")?;
    let confidence_threshold_bps = read_u16(instruction_data, 66, "confidence_threshold_bps")?;
    let discount_bps = read_u16(instruction_data, 68, "discount_bps")?;
    let pegged_to_usd = read_u8(instruction_data, 70, "pegged_to_usd")?;

    /*
     * pegged_to_usd is a flag — only 0 or 1 are valid. Match the
     * UpdateAllowedToken validator so create-time and update-time agree;
     * without this the SDK reader (which treats the byte as `=== 1`) and
     * the chain branch (`!= 0`) disagree on values 2..=255, producing a
     * silent SDK↔chain divergence.
     */
    if pegged_to_usd > 1 {
        return Err(GameError::InvalidParameter.into());
    }

    /* Validate discount isn't over 50% */
    if discount_bps > 5000 {
        return Err(GameError::InvalidParameter.into());
    }

    if pegged_to_usd != 0 {
        // Pegged stablecoin path: no oracle is read at purchase time, so feeds
        // are not required (but may be set as belt-and-suspenders for a future
        // un-peg). Instead, validate the mint's decimals — `cost_usd_cents ×
        // 10^(decimals - 2)` requires decimals >= 2 and overflow-safe scaling.
        let mint_data = token_mint.try_borrow()?;
        let decimals = read_token_decimals(&mint_data)?;
        if decimals < 2 || decimals > 12 {
            return Err(GameError::InvalidParameter.into());
        }
    } else {
        // Oracle path: at least one feed must be set; otherwise the token can
        // never be priced. Reject the no-op config eagerly.
        if pyth_feed.as_array() == &ZERO_PUBKEY && switchboard_feed.as_array() == &ZERO_PUBKEY {
            return Err(GameError::OracleUnavailable.into());
        }
    }

    // Both Pyth and Switchboard feeds are bare feed-ids verified at purchase
    // time; there is no feed account to validate here.

    // 6b. Provision the treasury's ATA for this token (create if missing).
    // process_token_payment_flow pins treasury_token_ata to
    // game_engine.treasury_wallet, so this ATA must exist before any purchase
    // settled in this token can succeed.
    if treasury_token_account.data_len() == 0 {
        create_associated_token_account(
            authority,              // Payer (DAO authority; signer + writable)
            treasury_token_account, // ATA to create
            treasury_wallet,        // Wallet that owns the ATA
            token_mint,             // SPL token mint
            system_program,
            token_program,
        )?;
    }

    // 7. Create AllowedToken Account

    let lamports = crate::utils::rent_exempt_const(AllowedTokenAccount::LEN);

    let bump_seed = [bump];
    let seeds = crate::seeds!(
        ALLOWED_TOKEN_SEED,
        game_engine_account.address(),
        token_mint.address(),
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: authority,
        to: allowed_token_account,
        lamports,
        space: AllowedTokenAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize AllowedToken Data

    let mut data_ref = allowed_token_account.try_borrow_mut()?;
    let allowed_token = unsafe { AllowedTokenAccount::load_mut(&mut data_ref) };

    allowed_token.account_key = crate::state::AccountKey::AllowedToken as u8;
    allowed_token.mint = *token_mint.address();
    allowed_token.pyth_feed = pyth_feed;
    allowed_token.switchboard_feed = switchboard_feed;
    allowed_token.max_staleness_slots = max_staleness_slots;
    allowed_token.confidence_threshold_bps = confidence_threshold_bps;
    allowed_token.discount_bps = discount_bps;
    allowed_token._padding = [0; 2];
    allowed_token.pegged_to_usd = pegged_to_usd;
    allowed_token._reserved = [0; 14];
    allowed_token.bump = bump;

    Ok(())
}
