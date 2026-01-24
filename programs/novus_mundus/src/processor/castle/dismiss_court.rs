//! Dismiss Court - King dismisses a court member
//!
//! Instruction 273
//!
//! King can dismiss court members, clearing their buffs
//! and closing the CourtPositionAccount PDA.

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
    events::CourtDismissed,
    state::{
        CastleAccount, CourtPositionAccount, PlayerAccount,
        player::{EXT_COURT, COURT_OFFSET, CourtSection},
    },
    helpers::close_account,
    validation::{require_owner, require_initialized},
};

/// Dismiss Court instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - position_type: u8 (byte 6)

/// Accounts:
/// 0. [signer] King wallet
/// 1. [] King player account
/// 2. [writable] Castle account
/// 3. [writable] Dismissed player account
/// 4. [writable] Court position account (to close)
/// 5. [writable] Rent recipient (king wallet)

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 6 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let king_wallet = &accounts[0];
    let king_account = &accounts[1];
    let castle_account = &accounts[2];
    let dismissed_account = &accounts[3];
    let court_position_account = &accounts[4];
    let rent_recipient = &accounts[5];

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data
    if instruction_data.len() < 7 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
    let castle_id = u16::from_le_bytes([instruction_data[4], instruction_data[5]]);
    let position_type = instruction_data[6];

    // Load king player
    require_owner(king_account, program_id)?;
    let king_data = king_account.try_borrow_data()?;
    let king = unsafe { PlayerAccount::load(&king_data) };

    if &king.owner != king_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut(castle_account, city_id, castle_id, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.key() {
        return Err(GameError::NotKing.into());
    }

    // Load court position
    require_owner(court_position_account, program_id)?;

    let (expected_court_pda, _court_bump) = CourtPositionAccount::derive_pda(castle_account.key(), position_type);
    if court_position_account.key() != &expected_court_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify position exists
    require_initialized(court_position_account).map_err(|_| GameError::CourtPositionVacant)?;

    let court_data = court_position_account.try_borrow_data()?;
    let court = unsafe { CourtPositionAccount::load(&court_data) };

    // Verify dismissed account matches holder
    if court.holder != *dismissed_account.key() {
        return Err(GameError::InvalidAccount.into());
    }

    // Load dismissed player
    require_owner(dismissed_account, program_id)?;
    let mut dismissed_data = dismissed_account.try_borrow_mut_data()?;
    let dismissed = unsafe { PlayerAccount::load_mut(&mut dismissed_data) };

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy dismissed name and extensions before modifying data
    let mut dismissed_name = [0u8; 48];
    dismissed_name.copy_from_slice(&dismissed.name);
    let dismissed_extensions = dismissed.extensions;
    let dismissed_data_len = dismissed_data.len();

    // Store castle name for event
    let castle_name = castle.name;

    // Clear dismissed player's court section (if extension exists)
    if dismissed_extensions & EXT_COURT != 0 && dismissed_data_len >= COURT_OFFSET + CourtSection::LEN {
        let court_ptr = dismissed_data[COURT_OFFSET..].as_mut_ptr() as *mut CourtSection;
        let court_section = unsafe { &mut *court_ptr };
        court_section.clear();
    }

    // Update castle court count
    castle.court_count = castle.court_count.saturating_sub(1);

    // Drop borrows before closing
    drop(court_data);
    drop(dismissed_data);

    // Close court position account
    close_account(court_position_account, rent_recipient)?;

    // Emit event
    emit!(CourtDismissed {
        castle: *castle_account.key(),
        castle_name,
        dismissed: *dismissed_account.key(),
        dismissed_name,
        position_type,
        dismissed_by: *king_account.key(),
        resigned: false,
        timestamp: now,
    });

    Ok(())
}
