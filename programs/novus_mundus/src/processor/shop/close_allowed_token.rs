use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    error::GameError,
    helpers::close_account,
    state::{GameEngine, AllowedTokenAccount},
    validation::{require_signer, require_writable, require_owner},
};

/// Close an AllowedToken account (DAO only)
///
/// Removes token support and returns rent to the DAO authority.
///
/// # Accounts
/// - [signer, writable] authority: DAO authority (game_engine.authority), receives rent
/// - [] game_engine: GameEngine account
/// - [writable] allowed_token: AllowedTokenAccount to close
/// - [] token_mint: The SPL token mint (for PDA verification)
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        authority,
        game_engine_account,
        allowed_token_account,
        token_mint,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(allowed_token_account)?;

    // 3. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify AllowedToken Account

    require_owner(allowed_token_account, program_id)?;

    // Verify PDA matches
    let (expected_pda, _) = AllowedTokenAccount::derive_pda(
        game_engine_account.key(),
        token_mint.key(),
    );

    if allowed_token_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Close Account and Return Rent to Authority

    close_account(allowed_token_account, authority)
}
