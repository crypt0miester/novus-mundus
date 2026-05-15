use pinocchio::{
    AccountView,
    Address,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, NULL_PUBKEY, require_extension, EXT_HEROES},
    utils::read_u8,
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::HeroAssignedDefensive,
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
    _program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [owner, player_account]);

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;

    // 3. Parse instruction data
    let slot_index = read_u8(instruction_data, 0, "assign_defensive.slot_index")?;

    // 4. SAFETY: Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Load player account
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // 6. SAFETY: Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 6a. Require EXT_HEROES to be unlocked
    require_extension(player, EXT_HEROES)?;

    // 7. SAFETY: Verify slot is occupied
    if player.active_hero_at(slot_index as usize) == NULL_PUBKEY {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Update defensive hero slot
    player.set_defensive_hero_slot(slot_index);

    // 9. Emit HeroAssignedDefensive event
    let hero_mint = player.active_hero_at(slot_index as usize);
    let clock = Clock::get()?;
    emit!(HeroAssignedDefensive {
        hero_mint,
        hero_name: [0u8; 32], // No template loaded in assign - name unavailable
        player: *player_account.address(),
        player_name: player.name,
        assigned: true,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
