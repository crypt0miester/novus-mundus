//! Finalize Transition - Complete castle ownership transition
//!
//! Instruction 285
//!
//! Permissionless instruction to finalize castle ownership transition after:
//! 1. The 2-hour contest window has passed (now >= contest_end_at)
//! 2. All garrison and court cleanup is complete
//!
//! Sets the new king and grants protection period.

use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{CASTLE_STATUS_PROTECTED, CASTLE_STATUS_TRANSITIONING, CASTLE_STATUS_VACANT},
    emit,
    error::GameError,
    events::CastleClaimed,
    state::{player::NULL_PUBKEY, CastleAccount, KingRegistryAccount, PlayerAccount},
    utils::read_u16,
    validation::require_owner,
};

/// Finalize Transition instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Caller (anyone can call - permissionless)
/// 1. [writable] Castle account
/// 2. [writable] New king player account
/// 3. [writable] New king registry account
/// 4. [writable] Old king registry account (optional, to update)

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(
        accounts,
        [_caller, castle_account, new_king_account, new_king_registry,]
    );

    // Parse instruction data
    let city_id = read_u16(instruction_data, 0, "city_id")?;
    let castle_id = read_u16(instruction_data, 2, "castle_id")?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Load castle
    let castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle is in transitioning state
    if castle.status != CASTLE_STATUS_TRANSITIONING {
        return Err(GameError::CastleTransitioning.into());
    }

    // Verify 2-hour contest window has passed
    if now < castle.contest_end_at {
        return Err(GameError::ContestNotEnded.into());
    }

    // Verify all garrison cleanup is complete
    if castle.garrison_count > 0 {
        return Err(GameError::TransitionNotComplete.into());
    }

    // Verify all court cleanup is complete
    if castle.court_count > 0 {
        return Err(GameError::TransitionNotComplete.into());
    }

    // Two flows:
    //   (a) transition_new_king != NULL_PUBKEY -> claim by new king
    //   (b) transition_new_king == NULL_PUBKEY -> castle becomes VACANT
    //       (used by force_remove_king and similar DAO actions). Requires
    //       garrison_count == 0 && court_count == 0 (already checked above).
    if castle.transition_new_king == NULL_PUBKEY {
        // VACANT flow - no new king assigned; reset transition state and
        // mark castle vacant for re-claim via claim_vacant_castle.
        let old_king = castle.king;
        castle.king = NULL_PUBKEY;
        castle.team = NULL_PUBKEY;
        castle.transition_new_king = NULL_PUBKEY;
        castle.status = CASTLE_STATUS_VACANT;
        castle.claimed_at = 0;
        castle.contest_end_at = 0;

        // Reset transition counters
        castle.transition_garrison_cleaned = 0;
        castle.transition_court_cleaned = false;
        castle.transition_rewards_cleaned = 0;

        // Best-effort: clear castle from old king's registry if provided
        if accounts.len() > 4 && old_king != NULL_PUBKEY {
            let old_king_registry = &accounts[4];
            let (expected_old_pda, _) = KingRegistryAccount::derive_pda(&old_king);
            if old_king_registry.address() == &expected_old_pda
                && unsafe { old_king_registry.owner() } == program_id
                && old_king_registry.data_len() > 0
            {
                let mut old_registry_data = old_king_registry.try_borrow_mut()?;
                let old_registry = unsafe { KingRegistryAccount::load_mut(&mut old_registry_data) };
                old_registry.remove_castle(city_id, castle_id);
            }
        }

        // No CastleClaimed event for vacant transition (claim_vacant_castle
        // will emit when someone takes the throne).
        return Ok(());
    }

    // Verify new king account matches pending king
    if *new_king_account.address() != castle.transition_new_king {
        return Err(GameError::Unauthorized.into());
    }

    // Load new king player
    require_owner(new_king_account, program_id)?;
    let mut new_king_data = new_king_account.try_borrow_mut()?;
    let new_king = unsafe { PlayerAccount::load_mut(&mut new_king_data) };

    // Store old king for registry update
    let old_king = castle.king;

    // Update new king registry using load_checked_mut
    let new_registry = KingRegistryAccount::load_checked_mut(
        new_king_registry,
        new_king_account.address(),
        program_id,
    )?;

    // Verify new king can claim another castle
    if !new_registry.can_claim_castle() {
        return Err(GameError::MaxCastlesReached.into());
    }

    // Add castle to new king's registry
    new_registry.add_castle(city_id, castle_id, castle.tier, now);

    // Update old king registry if provided - remove castle from their list
    if accounts.len() > 4 && old_king != NULL_PUBKEY {
        let old_king_registry = &accounts[4];

        // Verify old king registry PDA matches the previous king
        let (expected_old_pda, _) = KingRegistryAccount::derive_pda(&old_king);
        if old_king_registry.address() == &expected_old_pda {
            if unsafe { old_king_registry.owner() } == program_id
                && old_king_registry.data_len() > 0
            {
                let mut old_registry_data = old_king_registry.try_borrow_mut()?;
                let old_registry = unsafe { KingRegistryAccount::load_mut(&mut old_registry_data) };
                old_registry.remove_castle(city_id, castle_id);
            }
        }
    }

    // Update castle state - directly to PROTECTED with protection period starting now
    castle.king = castle.transition_new_king;
    castle.team = new_king.team_address();
    castle.transition_new_king = NULL_PUBKEY;
    castle.status = CASTLE_STATUS_PROTECTED;
    castle.claimed_at = now;
    // Protection period: now to now + protection_duration
    // is_protected() checks: now < contest_end_at + protection_duration
    castle.contest_end_at = now;

    // Increment times claimed stat
    castle.times_claimed = castle.times_claimed.saturating_add(1);

    // Reset transition counters
    castle.transition_garrison_cleaned = 0;
    castle.transition_court_cleaned = false;
    castle.transition_rewards_cleaned = 0;

    // Copy name for event
    let mut king_name = [0u8; 48];
    king_name.copy_from_slice(&new_king.name);

    // Emit event
    emit!(CastleClaimed {
        castle: *castle_account.address(),
        castle_name: castle.name,
        king: *new_king_account.address(),
        king_name,
        team: new_king.team_address(),
        tier: castle.tier,
        timestamp: now,
    });

    Ok(())
}
