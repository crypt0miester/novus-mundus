//! Resign Court - Court member voluntarily resigns their position
//!
//! Instruction 274
//!
//! A court member can resign their position at any time,
//! clearing their buffs and closing the CourtPositionAccount.

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
        player::{NULL_PUBKEY, EXT_COURT, COURT_OFFSET, CourtSection},
    },
    helpers::close_account,
    validation::{require_owner, require_initialized},
};

/// Resign Court instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [writable] Castle account
/// 3. [writable] Court position account (to close)
/// 4. [writable] Rent recipient (player wallet)

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let player_wallet = &accounts[0];
    let player_account = &accounts[1];
    let castle_account = &accounts[2];
    let court_position_account = &accounts[3];
    let rent_recipient = &accounts[4];

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (only discriminator needed, city_id/castle_id from account)
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Load player
    require_owner(player_account, program_id)?;
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != player_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Load court position to get position_type
    require_owner(court_position_account, program_id)?;

    require_initialized(court_position_account).map_err(|_| GameError::NotCourtMember)?;

    let court_data = court_position_account.try_borrow_data()?;
    let court = unsafe { CourtPositionAccount::load(&court_data) };

    // Verify player is the holder
    if court.holder != *player_account.key() {
        return Err(GameError::NotCourtMember.into());
    }

    // Verify court is for this castle
    if court.castle != *castle_account.key() {
        return Err(GameError::InvalidAccount.into());
    }

    let position_type = court.position_type;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy player name and extensions before modifying data
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player.name);
    let player_extensions = player.extensions;
    let player_data_len = player_data.len();

    // Store castle name for event
    let castle_name = castle.name;

    // Clear player's court section (if extension exists)
    if player_extensions & EXT_COURT != 0 && player_data_len >= COURT_OFFSET + CourtSection::LEN {
        let court_ptr = player_data[COURT_OFFSET..].as_mut_ptr() as *mut CourtSection;
        let court_section = unsafe { &mut *court_ptr };
        court_section.clear();
    }

    // Update castle court count
    castle.court_count = castle.court_count.saturating_sub(1);

    // Drop borrows before closing
    drop(court_data);
    drop(player_data);

    // Close court position account
    close_account(court_position_account, rent_recipient)?;

    // Emit event (resigned = true)
    emit!(CourtDismissed {
        castle: *castle_account.key(),
        castle_name,
        dismissed: *player_account.key(),
        dismissed_name: player_name,
        position_type,
        dismissed_by: NULL_PUBKEY, // Self-resignation
        resigned: true,
        timestamp: now,
    });

    Ok(())
}
