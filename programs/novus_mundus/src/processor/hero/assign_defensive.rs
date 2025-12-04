use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, NULL_PUBKEY, require_extension, EXT_HEROES},
    validation::{
        require_signer,
        require_writable,
    },
};

/// Assign which locked hero is used for defense (135)
///
/// Sets the defensive_hero_slot to indicate which of the 3 locked heroes
/// should be used when the player is attacked.
///
/// # Safety Requirements
/// 1. Verify slot_index < 3 (bounds check)
/// 2. Verify slot is occupied (not NULL_PUBKEY)
/// 3. Verify player owns the account
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;

    // 3. Parse instruction data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let slot_index = instruction_data[0];

    // 4. SAFETY: Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Load player account
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // 6. SAFETY: Verify ownership
    if !player.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 6a. Require EXT_HEROES to be unlocked
    require_extension(player, EXT_HEROES)?;

    // 7. SAFETY: Verify slot is occupied
    if player.active_heroes[slot_index as usize] == NULL_PUBKEY {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Update defensive hero slot
    player.defensive_hero_slot = slot_index;

    Ok(())
}
