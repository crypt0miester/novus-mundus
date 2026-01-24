//! Update Castle Status - Permissionless time-based status transitions
//!
//! Instruction 289
//!
//! Anyone can call this instruction to trigger status transitions based on
//! absolute time conditions:
//! - CONTEST → PROTECTED: when contest period ends (2 hours)
//! - PROTECTED → VULNERABLE: when protection period expires
//!
//! TRANSITIONING status requires finalize_transition (needs cleanup verification).

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
    events::CastleStatusChanged,
    state::CastleAccount,
    constants::{
        CASTLE_STATUS_CONTEST, CASTLE_STATUS_PROTECTED, CASTLE_STATUS_VULNERABLE,
    },
};

/// Update Castle Status instruction data
/// - city_id: u16 (bytes 0-1)
/// - castle_id: u16 (bytes 2-3)

/// Accounts:
/// 0. [signer] Caller (anyone can call - permissionless)
/// 1. [writable] Castle account

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let _caller = &accounts[0];
    let castle_account = &accounts[1];

    // Parse instruction data
    if instruction_data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let castle_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Load castle
    let mut castle = CastleAccount::load_checked_mut(castle_account, city_id, castle_id, program_id)?;

    let old_status = castle.status;
    let mut new_status = old_status;

    match castle.status {
        CASTLE_STATUS_CONTEST => {
            // CONTEST → PROTECTED when contest period ends
            if now >= castle.contest_end_at {
                new_status = CASTLE_STATUS_PROTECTED;
                castle.status = CASTLE_STATUS_PROTECTED;
                // contest_end_at stays the same - protection is measured from there
            }
        }
        CASTLE_STATUS_PROTECTED => {
            // PROTECTED → VULNERABLE when protection expires
            // Uses effective_protection_duration which includes watchtower bonus
            if now >= castle.contest_end_at + castle.effective_protection_duration() {
                new_status = CASTLE_STATUS_VULNERABLE;
                castle.status = CASTLE_STATUS_VULNERABLE;
            }
        }
        _ => {
            // VACANT: No transition needed
            // VULNERABLE: Stays vulnerable until attacked
            // TRANSITIONING: Requires finalize_transition (cleanup verification)
            return Err(GameError::InvalidCastleStatus.into());
        }
    }

    // Only emit if status actually changed
    if new_status != old_status {
        emit!(CastleStatusChanged {
            castle: *castle_account.key(),
            castle_name: castle.name,
            old_status,
            new_status,
            timestamp: now,
        });
    } else {
        // No transition was possible
        return Err(GameError::InvalidCastleStatus.into());
    }

    Ok(())
}
