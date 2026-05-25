use crate::{
    constants::ORACLE_QUOTE_SEED,
    error::GameError,
    state::{GameEngine, OracleQuotePda, ORACLE_QUOTE_ACCOUNT_LEN},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Create the program-owned Switchboard oracle-quote PDA (DAO only).
///
/// One quote account per Switchboard On-Demand queue, derived
/// `["oracle_quote", switchboard_queue]`. After creation, `crank_oracle_quote`
/// (ix 302) keeps it fresh; purchase instructions read it via
/// `QuoteVerifier::verify_account`.
///
/// # Accounts (5)
/// 0. [signer, writable] authority - DAO authority (game_engine.authority); pays rent
/// 1. [] game_engine - GameEngine account
/// 2. [writable] oracle_quote - the OracleQuote PDA to create
/// 3. [] switchboard_queue - Switchboard On-Demand queue (PDA seed)
/// 4. [] system_program
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    crate::extract_accounts!(
        accounts,
        [
            authority,
            game_engine_account,
            oracle_quote_account,
            switchboard_queue,
            system_program,
        ]
    );

    require_signer(authority)?;
    require_writable(authority)?;
    require_writable(oracle_quote_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // DAO authority gate.
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    if authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // Derive and verify the oracle-quote PDA.
    let (expected_pda, bump) = OracleQuotePda::derive_pda(switchboard_queue.address());
    if oracle_quote_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Create the account, program-owned, sized for one ed25519 oracle quote.
    // `CreateAccount` fails if the account already holds lamports/data, so a
    // re-init is rejected by the runtime.
    let lamports = crate::utils::rent_exempt_const(ORACLE_QUOTE_ACCOUNT_LEN);
    let bump_seed = [bump];
    let seeds = crate::seeds!(ORACLE_QUOTE_SEED, switchboard_queue.address(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: authority,
        to: oracle_quote_account,
        lamports,
        space: ORACLE_QUOTE_ACCOUNT_LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    Ok(())
}
