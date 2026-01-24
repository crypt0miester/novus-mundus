use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    constants::DUNGEON_MAX_MULTI_ATTACKS,
};

use super::attack::process_attacks;

/// Attack the current room enemy multiple times (1-5 attacks)
///
/// Executes up to 5 attacks in a single transaction.
/// Stops early if enemy dies. Auto-advances on kill.
///
/// # Accounts
/// Same as attack_room
///
/// # Instruction Data
/// - attack_count: u8 (1-5)
/// - next_room_type: u8 (provided by backend for auto-advance)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Parse attack count
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let attack_count = data[0];

    // Validate attack count
    if attack_count == 0 || attack_count > DUNGEON_MAX_MULTI_ATTACKS {
        return Err(GameError::InvalidParameter.into());
    }

    // Shift data to pass next_room_type
    let remaining_data = if data.len() > 1 { &data[1..] } else { &[] };

    // Delegate to shared attack processing
    process_attacks(program_id, accounts, remaining_data, attack_count)
}
