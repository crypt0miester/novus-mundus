//! Abort Expedition Processor
//!
//! Allows a player to abort an active expedition early.
//! Operatives are returned, but the locked NOVI cost is NOT refunded (burnt).
//!
//! If a hero was sent with the expedition, the hero NFT is returned to owner.
//!
//! Use case: Player urgently needs operatives for combat/rally.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::EXPEDITION_SEED,
    error::GameError,
    state::{PlayerAccount, ExpeditionAccount, NULL_PUBKEY},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::ExpeditionAborted,
};

/// Abort an active expedition
///
/// Closes the ExpeditionAccount early, returning operatives to the player.
/// The locked NOVI cost is NOT refunded - it is considered burnt.
///
/// If a hero was sent with the expedition, the hero NFT is returned to owner.
///
/// # Accounts
/// 0. `[signer]` owner - Player's wallet (receives rent refund)
/// 1. `[writable]` player_account - PlayerAccount PDA
/// 2. `[writable]` expedition_account - ExpeditionAccount PDA (to be closed)
///
/// ## Optional Hero Accounts (if hero was on expedition):
/// 3. `[writable]` hero_mint - Hero NFT (MPL Core asset)
/// 4. `[]` hero_collection - Hero collection (MPL Core)
/// 5. `[]` system_program - System program (for transfer)
/// 6. `[]` p_core_program - MPL Core program
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (minimum 3, up to 7 with hero)
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let owner = &accounts[0];
    let player_account = &accounts[1];
    let expedition_account = &accounts[2];

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(expedition_account)?;
    require_owner(player_account, program_id)?;
    require_owner(expedition_account, program_id)?;

    // 3. Validate ExpeditionAccount PDA
    let (expected_expedition_pda, _) = pinocchio::pubkey::find_program_address(
        &[EXPEDITION_SEED, owner.key().as_ref()],
        program_id,
    );

    if expedition_account.key() != &expected_expedition_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 4. Check expedition exists
    require_initialized(expedition_account).map_err(|_| GameError::NoExpeditionInProgress)?;

    // 5. Load Expedition Data (before closing)
    let (op_unit_1, op_unit_2, op_unit_3, hero_mint_key, expedition_type) = {
        let expedition_data = expedition_account.try_borrow_data()?;
        let expedition = unsafe { ExpeditionAccount::load(&expedition_data) };

        // Verify expedition belongs to this player
        if &expedition.player != owner.key() {
            return Err(GameError::Unauthorized.into());
        }

        (
            expedition.operative_unit_1,
            expedition.operative_unit_2,
            expedition.operative_unit_3,
            expedition.hero_mint,
            expedition.expedition_type,
        )
    };

    // Check if expedition had a hero
    let has_hero = hero_mint_key != NULL_PUBKEY;

    // 6. Load Player Data
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 7. Verify ownership
    if !player_data.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 8. RETURN LOCKED OPERATIVES to player (no rewards, NOVI is burnt)
    player_data.operative_unit_1 = player_data.operative_unit_1
        .checked_add(op_unit_1)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_2 = player_data.operative_unit_2
        .checked_add(op_unit_2)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_3 = player_data.operative_unit_3
        .checked_add(op_unit_3)
        .ok_or(GameError::MathOverflow)?;

    // 9. Return hero NFT to owner (if hero was on expedition)
    // Drop player_data borrow before transfer
    drop(player_data_ref);

    if has_hero && accounts.len() >= 7 {
        let hero_mint = &accounts[3];
        let hero_collection = &accounts[4];
        let system_program = &accounts[5];
        let _p_core_program = &accounts[6];

        // Verify hero mint matches what was stored
        if hero_mint.key() != &hero_mint_key {
            return Err(GameError::InvalidParameter.into());
        }

        // Derive expedition PDA signer
        let (_, expedition_bump) = pinocchio::pubkey::find_program_address(
            &[EXPEDITION_SEED, owner.key().as_ref()],
            program_id,
        );
        let bump_seed = [expedition_bump];
        let expedition_seeds = pinocchio::seeds!(
            EXPEDITION_SEED,
            owner.key().as_ref(),
            &bump_seed
        );
        let expedition_signer = pinocchio::instruction::Signer::from(&expedition_seeds);

        // Transfer hero NFT from expedition back to owner
        p_core::instructions::TransferV1 {
            asset: hero_mint,
            collection: hero_collection,
            current_owner: expedition_account,
            new_owner: owner,
            payer: owner,
            authority: expedition_account,
            system_program,
        }.invoke_signed(&[expedition_signer])?;
    }

    // 10. Close expedition account (refund rent to owner)
    // Note: Locked NOVI is NOT refunded - it is burnt as penalty for aborting
    close_account(expedition_account, owner)?;

    // 11. Emit event
    let now = Clock::get()?.unix_timestamp;

    // Re-borrow player_data to access name field
    let player_data_ref = player_account.try_borrow_data()?;
    let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

    emit!(ExpeditionAborted {
        player: *player_account.key(),
        player_name: player_data.name,
        expedition_type,
        partial_yield: 0, // No partial yield on abort
        timestamp: now,
    });

    Ok(())
}
