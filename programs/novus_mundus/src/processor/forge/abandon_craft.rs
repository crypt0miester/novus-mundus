use pinocchio::{AccountView, Address, ProgramResult};

use crate::{
    emit,
    error::GameError,
    events::CraftAbandoned,
    state::{estate::CraftedEquipmentAccount, PlayerAccount},
    validation::{require_owner, require_pda, require_signer, require_writable},
};

use pinocchio::sysvars::{clock::Clock, Sysvar};

/// Abandon an in-progress staged craft
///
/// Allows player to give up on a craft before completion or failure.
/// Materials (NOVI) already consumed are lost - this is intentional
/// to prevent abuse and maintain skill-based crafting integrity.
///
/// Use cases:
/// - Player realizes they can't maintain the required rhythm
/// - Player needs to start a different craft urgently
/// - Player wants to free up the crafting slot
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [] player_account: PlayerAccount PDA (for ownership verification)
/// - [writable] crafted_equipment: CraftedEquipmentAccount PDA
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [owner, player_account, crafted_equipment]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_owner(player_account, program_id)?;
    require_writable(crafted_equipment)?;
    require_owner(crafted_equipment, program_id)?;
    // Validate CraftedEquipmentAccount PDA derivation
    require_pda(
        crafted_equipment,
        &[b"crafted_equipment", owner.address().as_ref()],
        program_id,
    )?;

    // 3. Load Player Account (for ownership check)
    let player_data_ref = player_account.try_borrow()?;
    let player = unsafe { PlayerAccount::load(&player_data_ref) };

    // Verify ownership
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Capture player name before dropping borrow
    let player_name = player.name;

    drop(player_data_ref);

    // 4. Load Crafted Equipment Account
    let mut crafted_data_ref = crafted_equipment.try_borrow_mut()?;
    let crafted = unsafe { CraftedEquipmentAccount::load_mut(&mut crafted_data_ref) };

    // Verify ownership
    if crafted.owner != *owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Check there is an active craft to abandon
    if !crafted.is_crafting() {
        return Err(GameError::NoCraftingInProgress.into());
    }

    // 6. Get current time and craft info before clearing
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let item_type = crafted.active_craft_equipment;
    let stage_reached = crafted.current_stage;

    // 7. Record as failure (materials lost)
    crafted.failed_crafts = crafted.failed_crafts.saturating_add(1);
    crafted.total_crafts = crafted.total_crafts.saturating_add(1);

    // 8. Emit event before clearing craft state
    emit!(CraftAbandoned {
        player: *player_account.address(),
        player_name,
        item_type,
        stage_reached,
        timestamp: now,
    });

    // 9. Clear craft state
    crafted.clear_craft();

    Ok(())
}
