use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::ALLOWED_TOKEN_SEED,
    error::GameError,
    state::{GameEngine, AllowedTokenAccount},
    validation::{require_signer, require_writable, require_key_match},
};

/// Create an AllowedToken account (DAO only)
///
/// Whitelists a token for payment in the shop system.
/// Stores both Pyth and Switchboard oracle feeds for redundancy.
///
/// # Accounts
/// - [signer, writable] authority: DAO authority (game_engine.authority), pays for account
/// - [] game_engine: GameEngine account
/// - [writable] allowed_token: AllowedTokenAccount PDA to create
/// - [] token_mint: The SPL token mint being allowed
/// - [] system_program: System program
///
/// # Instruction Data
/// - pyth_feed: Pubkey (32 bytes) - Pyth TOKEN/USD price feed
/// - switchboard_feed: Pubkey (32 bytes) - Switchboard TOKEN/USD quote account
/// - max_staleness_slots: u16 - Max age in slots before rejection
/// - confidence_threshold_bps: u16 - Max confidence interval (Pyth only)
/// - discount_bps: u16 - Discount for using this token
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        authority,
        game_engine_account,
        allowed_token_account,
        token_mint,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(allowed_token_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify token_mint is a valid SPL mint (82 bytes)

    if token_mint.data_len() != 82 {
        return Err(GameError::InvalidMint.into());
    }

    // 5. Derive and Verify AllowedToken PDA

    let (expected_pda, bump) = AllowedTokenAccount::derive_pda(
        game_engine_account.key(),
        token_mint.key(),
    );

    if allowed_token_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Parse Instruction Data

    if instruction_data.len() < 70 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let pyth_feed = Pubkey::from(<[u8; 32]>::try_from(&instruction_data[0..32]).unwrap());
    let switchboard_feed = Pubkey::from(<[u8; 32]>::try_from(&instruction_data[32..64]).unwrap());
    let max_staleness_slots = u16::from_le_bytes([instruction_data[64], instruction_data[65]]);
    let confidence_threshold_bps = u16::from_le_bytes([instruction_data[66], instruction_data[67]]);
    let discount_bps = u16::from_le_bytes([instruction_data[68], instruction_data[69]]);

    // Validate discount isn't over 100%
    if discount_bps > 10000 {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Create AllowedToken Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(AllowedTokenAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        ALLOWED_TOKEN_SEED,
        game_engine_account.key().as_ref(),
        token_mint.key().as_ref(),
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: authority,
        to: allowed_token_account,
        lamports,
        space: AllowedTokenAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize AllowedToken Data

    let mut data_ref = allowed_token_account.try_borrow_mut_data()?;
    let allowed_token = unsafe { AllowedTokenAccount::load_mut(&mut data_ref) };

    allowed_token.mint = *token_mint.key();
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
