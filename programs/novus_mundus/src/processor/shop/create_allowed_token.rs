use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::ALLOWED_TOKEN_SEED,
    error::GameError,
    state::{GameEngine, AllowedTokenAccount},
    validation::{require_signer, require_writable, require_key_match},
    helpers::{consume_optional_feed_slot, OracleType, ZERO_PUBKEY},
    utils::{read_bytes32, read_u16},
};

/// Create an AllowedToken account (DAO only)
///
/// Whitelists a token for payment in the shop system.
/// Stores both Pyth and Switchboard oracle feeds for redundancy.
///
/// # Accounts (base — 5)
/// - [signer, writable] authority: DAO authority (game_engine.authority), pays for account
/// - [] game_engine: GameEngine account
/// - [writable] allowed_token: AllowedTokenAccount PDA to create
/// - [] token_mint: The SPL token mint being allowed
/// - [] system_program: System program
///
/// # Accounts (conditional, appended in this order)
/// - [] pyth_feed_account: Required iff `pyth_feed` in instruction data is non-zero.
///   Owner-checked + parsed as a Pyth `PythPriceAccount`.
/// - [] switchboard_feed_account: Required iff `switchboard_feed` in instruction
///   data is non-zero. Owner-checked + Anchor-discriminator-validated.
///
/// Without these trailing accounts, a junk pubkey would only fail later
/// at purchase time. Caller passes 0–2 trailing accounts depending on
/// which feed pubkeys are being configured.
///
/// # Instruction Data
/// - pyth_feed: Address (32 bytes) - Pyth TOKEN/USD price feed
/// - switchboard_feed: Address (32 bytes) - Switchboard TOKEN/USD quote account
/// - max_staleness_slots: u16 - Max age in slots before rejection
/// - confidence_threshold_bps: u16 - Max confidence interval (Pyth only)
/// - discount_bps: u16 - Discount for using this token
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (5 required + 0–2 optional feed-validation slots)

    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let authority = &accounts[0];
    let game_engine_account = &accounts[1];
    let allowed_token_account = &accounts[2];
    let token_mint = &accounts[3];
    let system_program = &accounts[4];

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(allowed_token_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify token_mint is a valid SPL mint (82 bytes)

    if token_mint.data_len() != 82 {
        return Err(GameError::InvalidMint.into());
    }

    // 5. Derive and Verify AllowedToken PDA

    let (expected_pda, bump) = AllowedTokenAccount::derive_pda(
        game_engine_account.address(),
        token_mint.address(),
    );

    if allowed_token_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Parse Instruction Data

    let pyth_feed = Address::from(read_bytes32(instruction_data, 0, "pyth_feed")?);
    let switchboard_feed = Address::from(read_bytes32(instruction_data, 32, "switchboard_feed")?);
    let max_staleness_slots = read_u16(instruction_data, 64, "max_staleness_slots")?;
    let confidence_threshold_bps = read_u16(instruction_data, 66, "confidence_threshold_bps")?;
    let discount_bps = read_u16(instruction_data, 68, "discount_bps")?;

    // Validate discount isn't over 50%
    if discount_bps > 5000 {
        return Err(GameError::InvalidParameter.into());
    }

    // At least one oracle feed must be configured; otherwise this token can
    // never be priced. Reject the no-op config eagerly.
    if pyth_feed.as_array() == &ZERO_PUBKEY && switchboard_feed.as_array() == &ZERO_PUBKEY {
        return Err(GameError::OracleUnavailable.into());
    }

    // Walk the variable-length tail of feed accounts (pyth then switchboard,
    // a zero pubkey consumes no slot).
    let mut feed_slot = 5usize;
    feed_slot = consume_optional_feed_slot(accounts, feed_slot, pyth_feed.as_array(), OracleType::Pyth)?;
    let _ = consume_optional_feed_slot(accounts, feed_slot, switchboard_feed.as_array(), OracleType::Switchboard)?;

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
    }.invoke_signed(&[signer])?;

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
    allowed_token._reserved = [0; 15];
    allowed_token.bump = bump;

    Ok(())
}
