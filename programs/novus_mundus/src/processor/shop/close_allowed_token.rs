use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
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
    program_id: &Address,
    accounts: &[AccountView],
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

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify AllowedToken Account

    require_owner(allowed_token_account, program_id)?;

    // Verify PDA matches
    let (expected_pda, _) = AllowedTokenAccount::derive_pda(
        game_engine_account.address(),
        token_mint.address(),
    );

    if allowed_token_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Close Account and Return Rent to Authority

    close_account(allowed_token_account, authority)
}
