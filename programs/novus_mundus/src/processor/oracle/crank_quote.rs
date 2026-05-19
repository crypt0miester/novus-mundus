use pinocchio::{
    ProgramResult,
    AccountView,
    Address,
    sysvars::Sysvar,
};
use p_switchboard::OracleQuote;
use crate::{
    error::GameError,
    state::{GameEngine, OracleQuotePda, ShopConfigAccount},
    validation::{require_signer, require_writable, require_owner},
    utils::unlikely,
};

/// Crank the Switchboard oracle-quote PDA with a fresh verified quote.
///
/// Cosigner model: the crank transaction is `[ed25519 verify ix,
/// crank_oracle_quote]`. The ed25519 instruction carries the oracle-signed
/// quote bundle; this instruction extracts and persists it into the
/// program-owned quote PDA (`OracleQuote::write_from_ix`, which validates the
/// quote's slot is fresh and never regresses).
///
/// The on-chain *verification* of that quote (oracle-key authorization,
/// slot-hash freshness) happens later, at read time, inside
/// `QuoteVerifier::verify_account` — see `helpers::verify_switchboard_quote`.
///
/// # Accounts (6)
/// 0. [signer] cranker - must equal game_engine.game_authority
/// 1. [] game_engine - GameEngine account
/// 2. [] shop_config - ShopConfigAccount (source of switchboard_queue)
/// 3. [writable] oracle_quote - the OracleQuote PDA to write
/// 4. [] switchboard_queue - Switchboard On-Demand queue
/// 5. [] instructions_sysvar - Instructions sysvar (carries the ed25519 quote ix)
///
/// # Instruction Data
/// - ed25519_ix_index: u8 (optional; index of the ed25519 verify instruction,
///   default 0)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    crate::extract_accounts!(accounts, [
        cranker,
        game_engine_account,
        shop_config_account,
        oracle_quote_account,
        switchboard_queue,
        instructions_sysvar,
    ]);

    require_signer(cranker)?;
    require_writable(oracle_quote_account)?;
    require_owner(oracle_quote_account, program_id)?;
    require_owner(shop_config_account, program_id)?;

    // Crank authorization: the game server authority co-signs.
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    if cranker.address() != &game_engine.game_authority {
        return Err(GameError::Unauthorized.into());
    }

    // Verify shop_config PDA, then pin the queue to its configured value.
    let (expected_shop_pda, _) = ShopConfigAccount::derive_pda(game_engine_account.address());
    if shop_config_account.address() != &expected_shop_pda {
        return Err(GameError::InvalidPDA.into());
    }
    let shop_config_data = shop_config_account.try_borrow()?;
    let shop_config = unsafe { ShopConfigAccount::load(&shop_config_data) };
    if unlikely(switchboard_queue.address() != &shop_config.switchboard_queue) {
        return Err(GameError::OracleUnavailable.into());
    }

    // Pin the quote account to the canonical ["oracle_quote", queue] PDA.
    let (expected_quote, _) = OracleQuotePda::derive_pda(switchboard_queue.address());
    if oracle_quote_account.address() != &expected_quote {
        return Err(GameError::InvalidPDA.into());
    }

    // Index of the ed25519 verify instruction in this transaction (default 0).
    let ed25519_ix_index = instruction_data.first().map(|&b| b as usize).unwrap_or(0);

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let queue_bytes = switchboard_queue.address().as_array();

    // Extract the oracle-signed quote from the ed25519 instruction and persist
    // it. `write_from_ix` enforces slot freshness (new slot < clock slot) and
    // anti-replay (new slot >= the slot already stored).
    let mut quote_data = oracle_quote_account.try_borrow_mut()?;
    OracleQuote::write_from_ix(
        instructions_sysvar,
        &mut quote_data[..],
        queue_bytes,
        clock.slot,
        ed25519_ix_index,
    );

    Ok(())
}
