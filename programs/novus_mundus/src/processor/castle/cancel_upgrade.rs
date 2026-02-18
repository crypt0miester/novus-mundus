//! Cancel Upgrade - King cancels an in-progress upgrade
//!
//! Instruction 276
//!
//! King can cancel an in-progress upgrade and receive 50% refund.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::CastleUpgradeCancelled,
    state::{CastleAccount, PlayerAccount, GameEngine},
    constants::GAME_ENGINE_SEED,
    helpers::mint_tokens,
    validation::require_owner,
};

/// Refund percentage (basis points)
const CANCEL_REFUND_BPS: u64 = 5000; // 50%

/// NOVI cost per upgrade level (must match initiate_upgrade)
const UPGRADE_COST_BASE: u64 = 10_000;
const UPGRADE_COST_MULTIPLIER: u64 = 15;

/// Cancel Upgrade instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] King wallet
/// 1. [writable] King player account
/// 2. [writable] Castle account
/// 3. [] Game engine account
/// 4. [writable] NOVI mint
/// 5. [] Token program
/// 6. [writable] Locked token account (owned by PlayerAccount PDA)

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 7 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let king_wallet = &accounts[0];
    let king_account = &accounts[1];
    let castle_account = &accounts[2];
    let game_engine_account = &accounts[3];
    let novi_mint = &accounts[4];
    let _token_program = &accounts[5];
    let locked_token_account = &accounts[6];

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (only discriminator needed, city_id/castle_id from account)

    // Load king player
    require_owner(king_account, program_id)?;
    let mut king_data = king_account.try_borrow_mut_data()?;
    let king = unsafe { PlayerAccount::load_mut(&mut king_data) };

    if &king.owner != king_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.key() {
        return Err(GameError::NotKing.into());
    }

    // Verify upgrade is in progress
    if castle.upgrade_type == 0 {
        return Err(GameError::CastleNoUpgradeInProgress.into());
    }

    let upgrade_type = castle.upgrade_type;
    let target_level = castle.upgrade_target_level;

    // Calculate original cost
    let mut original_cost = UPGRADE_COST_BASE;
    for _ in 0..target_level {
        original_cost = original_cost.saturating_mul(UPGRADE_COST_MULTIPLIER) / 10;
    }

    // Calculate refund (50%)
    let refund = original_cost.saturating_mul(CANCEL_REFUND_BPS) / 10000;

    // Load game engine for mint authority (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Create GameEngine PDA signer for minting
    let ge_bump_seed = [game_engine.bump];
    let kingdom_id_bytes = game_engine.kingdom_id.to_le_bytes();
    let ge_seeds = pinocchio::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &ge_bump_seed);
    let ge_signer = pinocchio::instruction::Signer::from(&ge_seeds);

    // Mint refund to locked token account
    if refund > 0 {
        mint_tokens(
            novi_mint,
            locked_token_account,
            game_engine_account,
            refund,
            &[ge_signer],
        )?;
    }

    // Update cached balance
    king.locked_novi = king.locked_novi.saturating_add(refund);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Clear upgrade in progress
    castle.upgrade_type = 0;
    castle.upgrade_target_level = 0;
    castle.upgrade_end_at = 0;

    // Emit event
    emit!(CastleUpgradeCancelled {
        castle: *castle_account.key(),
        castle_name: castle.name,
        upgrade_type,
        novi_refunded: refund,
        timestamp: now,
    });

    Ok(())
}
