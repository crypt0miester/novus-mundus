    //! Force Remove King - DAO forcibly removes a king
//!
//! Instruction 287
//!
//! DAO-only instruction to forcibly remove a king from their castle.
//! Used for moderation or emergency situations. Initiates transition
//! to make castle vacant.

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::KingForceRemoved,
    state::{
        CastleAccount, KingRegistryAccount, PlayerAccount, GameEngine,
        player::NULL_PUBKEY,
    },
    constants::CASTLE_STATUS_TRANSITIONING,
    validation::require_owner,
    utils::read_u16,
};

/// Force Remove King instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] DAO authority
/// 1. [] Game engine account
/// 2. [writable] Castle account
/// 3. [] King player account
/// 4. [writable] King registry account

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [
        dao_authority,
        game_engine_account,
        castle_account,
        king_account,
        king_registry,
    ]);

    // Verify signer
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load and verify game engine (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Verify DAO authority
    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::Unauthorized.into());
    }

    // Parse instruction data
    let city_id = read_u16(instruction_data, 0, "city_id")?;
    let castle_id = read_u16(instruction_data, 2, "castle_id")?;

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle has a king (is not vacant)
    if castle.king == NULL_PUBKEY {
        return Err(GameError::CastleNotVacant.into());
    }

    // Verify king account matches
    if castle.king != *king_account.address() {
        return Err(GameError::NotKing.into());
    }

    // Load king player for event
    require_owner(king_account, program_id)?;
    let king_data = king_account.try_borrow()?;
    let king = unsafe { PlayerAccount::load(&king_data) };

    // Verify and update king registry
    require_owner(king_registry, program_id)?;
    let (expected_registry_pda, _) = KingRegistryAccount::derive_pda(king_account.address());
    if king_registry.address() != &expected_registry_pda {
        return Err(GameError::InvalidPDA.into());
    }

    if king_registry.data_len() > 0 {
        let mut registry_data = king_registry.try_borrow_mut()?;
        let registry = unsafe { KingRegistryAccount::load_mut(&mut registry_data) };

        // Remove castle from king's registry
        registry.remove_castle(city_id, castle_id);
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy names for event
    let mut king_name = [0u8; 48];
    king_name.copy_from_slice(&king.name);

    // Store king pubkey for event before clearing
    let removed_king = castle.king;

    // Set castle to transitioning state (will become vacant after cleanup)
    castle.status = CASTLE_STATUS_TRANSITIONING;
    castle.king = NULL_PUBKEY;
    castle.team = NULL_PUBKEY;
    castle.transition_new_king = NULL_PUBKEY; // No new king - will be vacant

    // Court positions are handled via separate CourtPositionAccount PDAs
    // They will be closed during transition cleanup

    // Emit event
    emit!(KingForceRemoved {
        castle: *castle_account.address(),
        castle_name: castle.name,
        removed_king,
        removed_king_name: king_name,
        timestamp: now,
    });


    Ok(())
}
