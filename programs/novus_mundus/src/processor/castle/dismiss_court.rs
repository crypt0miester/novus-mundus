//! Dismiss Court - King dismisses a court member
//!
//! Instruction 273
//!
//! King can dismiss court members, clearing their buffs
//! and closing the CourtPositionAccount PDA.

use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::CourtDismissed,
    helpers::close_account,
    state::{
        player::{CourtSection, COURT_OFFSET, EXT_COURT},
        CastleAccount, CourtPositionAccount, PlayerAccount,
    },
    utils::read_u8,
    validation::{require_initialized, require_owner},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(
        accounts,
        [
            king_wallet,
            king_account,
            castle_account,
            dismissed_account,
            court_position_account,
            rent_recipient,
        ]
    );

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (city_id/castle_id from account)
    let position_type = read_u8(instruction_data, 0, "position_type")?;

    // Load king player
    require_owner(king_account, program_id)?;
    let king_data = king_account.try_borrow()?;
    let king = unsafe { PlayerAccount::load(&king_data) };

    if &king.owner != king_wallet.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.address() {
        return Err(GameError::NotKing.into());
    }

    // Load court position
    require_owner(court_position_account, program_id)?;

    let (expected_court_pda, _court_bump) =
        CourtPositionAccount::derive_pda(castle_account.address(), position_type);
    if court_position_account.address() != &expected_court_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify position exists
    require_initialized(court_position_account).map_err(|_| GameError::CourtPositionVacant)?;

    let court_data = court_position_account.try_borrow()?;
    let court = unsafe { CourtPositionAccount::load(&court_data) };

    // Verify dismissed account matches holder
    if court.holder != *dismissed_account.address() {
        return Err(GameError::InvalidAccount.into());
    }

    // Load dismissed player
    require_owner(dismissed_account, program_id)?;
    let mut dismissed_data = dismissed_account.try_borrow_mut()?;
    let dismissed = unsafe { PlayerAccount::load_mut(&mut dismissed_data) };

    // Refund the court position account rent to the dismissed
    // player's wallet (they originally paid the rent when appointed), not
    // to a caller-supplied recipient (defaulting to the king's wallet).
    if rent_recipient.address() != &dismissed.owner {
        return Err(GameError::InvalidAccount.into());
    }

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
    if dismissed_extensions & EXT_COURT != 0
        && dismissed_data_len >= COURT_OFFSET + CourtSection::LEN
    {
        let court_ptr = dismissed_data[COURT_OFFSET..].as_mut_ptr() as *mut CourtSection;
        let court_section = unsafe { &mut *court_ptr };
        court_section.clear();
    }

    // Update castle court count
    castle.court_count = castle.court_count.saturating_sub(1);
    castle.membership_epoch = castle.membership_epoch.saturating_add(1); // rotate war-table key on access loss

    // Drop borrows before closing
    drop(court_data);
    drop(dismissed_data);

    // Close court position account
    close_account(court_position_account, rent_recipient)?;

    // Emit event
    emit!(CourtDismissed {
        castle: *castle_account.address(),
        castle_name,
        dismissed: *dismissed_account.address(),
        dismissed_name,
        position_type,
        dismissed_by: *king_account.address(),
        resigned: false,
        timestamp: now,
    });

    Ok(())
}
