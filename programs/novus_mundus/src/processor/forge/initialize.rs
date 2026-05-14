use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, rent::Rent},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{
        PlayerAccount,
        estate::CraftedEquipmentAccount,
    },
    helpers::estate::{load_estate_for_player, require_forge},
    validation::{require_signer, require_writable, require_owner},
};

/// Initialize CraftedEquipmentAccount for a player
///
/// Creates the account that tracks crafted equipment quality distribution.
/// Must be called once before the player can start crafting.
///
/// # Building Requirements
/// Requires Forge building at minimum level 1.
///
/// # Accounts
/// - [signer] owner: Player's wallet (payer)
/// - [] player_account: PlayerAccount PDA
/// - [] estate_account: EstateAccount PDA (for Forge requirement)
/// - [writable] crafted_equipment: CraftedEquipmentAccount PDA (to be created)
/// - [] system_program: System program
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [owner, player_account, estate_account, crafted_equipment, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_owner(player_account, program_id)?;
    require_writable(crafted_equipment)?;

    // 3. Load Player Account
    let player_data_ref = player_account.try_borrow()?;
    let player = unsafe { PlayerAccount::load(&player_data_ref) };

    // Verify ownership
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Validate Forge Building Requirement
    let estate = load_estate_for_player(estate_account, player, program_id)?;
    require_forge(estate, 1)?; // Minimum Forge level 1

    drop(player_data_ref);

    // 5. Derive and validate CraftedEquipment PDA
    let (expected_pda, bump) = CraftedEquipmentAccount::derive_pda(owner.address());
    if crafted_equipment.address() != &expected_pda {
        return Err(GameError::InvalidAccount.into());
    }

    // 6. Check account doesn't already exist
    if !crafted_equipment.is_data_empty() {
        return Err(GameError::AccountAlreadyExists.into());
    }

    // 7. Calculate rent
    let rent = Rent::get()?;
    let space = CraftedEquipmentAccount::LEN;
    let lamports = rent.try_minimum_balance(space)?;

    // 8. Create the account
    let bump_seed = [bump];
    let signer_seeds = crate::seeds!(
        b"crafted_equipment",
        owner.address(),
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&signer_seeds);

    CreateAccount {
        from: owner,
        to: crafted_equipment,
        lamports,
        space: space as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 9. Initialize account data
    let mut crafted_data_ref = crafted_equipment.try_borrow_mut()?;
    let crafted = unsafe { CraftedEquipmentAccount::load_mut(&mut crafted_data_ref) };
    *crafted = CraftedEquipmentAccount::init(*owner.address(), bump);

    Ok(())
}
