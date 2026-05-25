use pinocchio::{AccountView, Address, ProgramResult};

use crate::{constants::DUNGEON_MAX_MULTI_ATTACKS, error::GameError, utils::read_u8};

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
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // Parse attack count
    let attack_count = read_u8(data, 0, "attack_multi.attack_count")?;

    // Validate attack count
    if attack_count == 0 || attack_count > DUNGEON_MAX_MULTI_ATTACKS {
        return Err(GameError::InvalidParameter.into());
    }

    // Shift data to pass next_room_type
    let remaining_data = if data.len() > 1 { &data[1..] } else { &[] };

    // Delegate to shared attack processing
    process_attacks(program_id, accounts, remaining_data, attack_count)
}
