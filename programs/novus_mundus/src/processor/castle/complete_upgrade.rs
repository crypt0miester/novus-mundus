//! Complete Upgrade - Finalize a castle upgrade when timer expires
//!
//! Instruction 290
//!
//! Permissionless instruction to complete an upgrade once the timer has expired.
//! Applies the upgrade bonus to the castle.

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
    events::CastleUpgradeCompleted,
    state::CastleAccount,
    constants::{
        CASTLE_UPGRADE_FORTIFICATION, CASTLE_UPGRADE_TREASURY,
        CASTLE_UPGRADE_CHAMBERS, CASTLE_UPGRADE_WATCHTOWER, CASTLE_UPGRADE_ARMORY,
    },
};

/// Complete Upgrade instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Crank (anyone can call)
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

    let _crank = &accounts[0];
    let castle_account = &accounts[1];

    // Parse instruction data
    if instruction_data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
    let castle_id = u16::from_le_bytes([instruction_data[4], instruction_data[5]]);

    // Load castle
    let mut castle = CastleAccount::load_checked_mut(castle_account, city_id, castle_id, program_id)?;

    // Verify upgrade is in progress
    if castle.upgrade_type == 0 {
        return Err(GameError::CastleNoUpgradeInProgress.into());
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Verify upgrade timer has expired
    if now < castle.upgrade_end_at {
        return Err(GameError::CastleUpgradeNotReady.into());
    }

    let upgrade_type = castle.upgrade_type;
    let target_level = castle.upgrade_target_level;

    // Apply the upgrade
    match upgrade_type {
        CASTLE_UPGRADE_FORTIFICATION => {
            castle.fortification_level = target_level;
        }
        CASTLE_UPGRADE_TREASURY => {
            castle.treasury_level = target_level;
        }
        CASTLE_UPGRADE_CHAMBERS => {
            castle.chambers_level = target_level;
            // Update max court based on new chambers level
            castle.max_court = target_level;
        }
        CASTLE_UPGRADE_WATCHTOWER => {
            castle.watchtower_level = target_level;
        }
        CASTLE_UPGRADE_ARMORY => {
            castle.armory_level = target_level;
        }
        _ => return Err(GameError::InvalidUpgradeType.into()),
    }

    // Clear upgrade in progress
    castle.upgrade_type = 0;
    castle.upgrade_target_level = 0;
    castle.upgrade_end_at = 0;

    // Emit event
    emit!(CastleUpgradeCompleted {
        castle: *castle_account.key(),
        castle_name: castle.name,
        upgrade_type,
        new_level: target_level,
        timestamp: now,
    });

    Ok(())
}
