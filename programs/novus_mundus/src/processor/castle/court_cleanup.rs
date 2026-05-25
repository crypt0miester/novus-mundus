//! Court Cleanup - Clean up court positions during transition
//!
//! Instruction 283
//!
//! Permissionless instruction to clean up court positions
//! during castle ownership transition. Closes the court position
//! accounts and returns rent to original holders.

use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::CASTLE_STATUS_TRANSITIONING,
    emit,
    error::GameError,
    events::CastleTransitionProgress,
    helpers::close_account,
    state::{
        player::{CourtSection, COURT_OFFSET, EXT_COURT, NULL_PUBKEY},
        CastleAccount, CourtPositionAccount, PlayerAccount,
    },
    utils::read_u8,
    validation::{require_initialized, require_owner},
};

/// Phase constant for event
const PHASE_COURT: u8 = 1;

/// Crank Court Cleanup instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - position: u8 (bytes 6) - court position index (0-4)

/// Accounts:
/// 0. [signer] Crank (anyone can call)
/// 1. [writable] Castle account
/// 2. [writable] Court position account (to close)
/// 3. [writable] Former holder player account (to clear court reference)
/// 4. [writable] Rent recipient (former holder wallet)

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(
        accounts,
        [
            _crank,
            castle_account,
            court_account,
            holder_account,
            rent_recipient,
        ]
    );

    // Parse instruction data (city_id/castle_id from account)
    let position = read_u8(instruction_data, 0, "position")?;

    // Validate position (0-4 for 5 court position types)
    if position > 4 {
        return Err(GameError::InvalidParameter.into());
    }

    // Load castle
    let castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle is in transitioning state
    if castle.status != CASTLE_STATUS_TRANSITIONING {
        return Err(GameError::CastleTransitioning.into());
    }

    // Load court position account
    require_owner(court_account, program_id)?;

    let (expected_court_pda, _) =
        CourtPositionAccount::derive_pda(castle_account.address(), position);
    if court_account.address() != &expected_court_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(court_account).map_err(|_| GameError::CourtPositionVacant)?;

    let court_data = court_account.try_borrow()?;
    let court = unsafe { CourtPositionAccount::load(&court_data) };

    // Verify holder matches
    if court.holder == NULL_PUBKEY {
        return Err(GameError::CourtPositionVacant.into());
    }

    if court.holder != *holder_account.address() {
        return Err(GameError::InvalidAccount.into());
    }

    // Load holder player to clear court reference
    require_owner(holder_account, program_id)?;
    let mut holder_data = holder_account.try_borrow_mut()?;
    let holder = unsafe { PlayerAccount::load_mut(&mut holder_data) };

    // Rent recipient must be the court holder's wallet (the player
    // who originally paid the rent for the court position account).
    if rent_recipient.address() != &holder.owner {
        return Err(GameError::InvalidAccount.into());
    }

    // Clear court position reference in player account if they have court extension
    let holder_extensions = holder.extensions;
    let holder_data_len = holder_data.len();
    if holder_extensions & EXT_COURT != 0 && holder_data_len >= COURT_OFFSET + CourtSection::LEN {
        let court_ptr = holder_data[COURT_OFFSET..].as_mut_ptr() as *mut CourtSection;
        let court_section = unsafe { &mut *court_ptr };
        court_section.clear();
    }

    // Decrement castle court count
    castle.court_count = castle.court_count.saturating_sub(1);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Mark court as cleaned when all positions are done
    if castle.court_count == 0 {
        castle.transition_court_cleaned = true;
    }

    // Calculate progress for event
    let cleaned_count = if castle.transition_court_cleaned {
        castle.max_court
    } else {
        castle.max_court.saturating_sub(castle.court_count)
    };
    let total_count = castle.max_court;

    // Drop borrows before closing
    drop(court_data);
    drop(holder_data);

    // Close court position account
    close_account(court_account, rent_recipient)?;

    // Emit event
    emit!(CastleTransitionProgress {
        castle: *castle_account.address(),
        phase: PHASE_COURT,
        cleaned_count,
        total_count,
        timestamp: now,
    });

    Ok(())
}
