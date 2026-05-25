//! Inventory helper functions
//!
//! Provides get_or_create and auto-expand functionality for player inventory.
//! Used by shop purchases, loot claims, and any other instruction that adds items.

/// Check if item type goes to PlayerInventoryAccount instead of direct PlayerAccount fields.
///
/// Inventory item types:
/// - `3`: Armor pieces (tracked individually in inventory for stat variations)
/// - `300..=399`: Cosmetics
/// - `1000..`: Event items
///
/// All other item types (weapons, consumables, materials, currencies) are stored as
/// counters/totals directly on the PlayerAccount.
///
/// # Note
/// This is the canonical source of truth shared by all shop purchase flows
/// (`purchase_item`, `purchase_bundle`, `purchase_flash_sale`) to ensure
/// consistent routing of fulfillment between direct-player fields and the
/// separate PlayerInventoryAccount.
pub fn is_inventory_item_type(item_type: u16) -> bool {
    matches!(item_type, 3 | 300..=399 | 1000..)
}

use crate::{
    constants::INVENTORY_SEED,
    error::GameError,
    state::{InventoryItem, PlayerInventory, PlayerInventoryHeader},
};
use pinocchio::{error::ProgramError, sysvars::Sysvar, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Get or create inventory account, auto-expanding if needed.
///
/// This function handles:
/// 1. Creating the inventory account if it doesn't exist
/// 2. Expanding the inventory if full (before adding an item)
///
/// # Arguments
/// * `program_id` - The program ID
/// * `payer` - Account paying for creation/expansion (must be signer, writable)
/// * `owner` - The player who owns this inventory
/// * `inventory_account` - The inventory PDA (writable)
/// * `system_program` - System program
///
/// # Returns
/// Ok(()) if inventory is ready to use (created/expanded as needed)
pub fn get_or_create_inventory(
    program_id: &Address,
    payer: &AccountView,
    owner: &Address,
    inventory_account: &AccountView,
    system_program: &AccountView,
) -> ProgramResult {
    // Verify PDA
    let (expected_pda, bump) = PlayerInventoryHeader::derive_pda(owner);
    if inventory_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify system program
    if system_program.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let current_len = inventory_account.data_len();

    if current_len == 0 {
        // Create new inventory
        create_inventory(program_id, payer, owner, inventory_account, bump)?;
    }

    Ok(())
}

/// Add item to inventory, auto-expanding if needed.
///
/// This is the main function to use when adding items from purchases, loot, etc.
///
/// # Arguments
/// * `program_id` - The program ID
/// * `payer` - Account paying for expansion if needed (must be signer, writable)
/// * `owner` - The player who owns this inventory
/// * `inventory_account` - The inventory PDA (writable)
/// * `system_program` - System program
/// * `item_type` - Type of item to add
/// * `quantity` - Number of items
/// * `rarity` - Item rarity
/// * `item_id` - Specific item ID
/// * `now` - Current timestamp
pub fn add_to_inventory(
    program_id: &Address,
    payer: &AccountView,
    owner: &Address,
    inventory_account: &AccountView,
    system_program: &AccountView,
    item_type: u16,
    quantity: u16,
    rarity: u8,
    item_id: u32,
    now: u32,
) -> ProgramResult {
    // Ensure inventory exists
    get_or_create_inventory(program_id, payer, owner, inventory_account, system_program)?;

    // Try to add item
    {
        let mut data = inventory_account.try_borrow_mut()?;
        let mut inventory = unsafe { PlayerInventory::load(&mut data) };

        if inventory.add_item(item_type, quantity, rarity, item_id, now) {
            return Ok(());
        }
    }

    // Need expansion - expand and retry
    expand_inventory(payer, inventory_account)?;

    // Retry adding item
    let mut data = inventory_account.try_borrow_mut()?;
    let mut inventory = unsafe { PlayerInventory::load(&mut data) };

    if inventory.add_item(item_type, quantity, rarity, item_id, now) {
        Ok(())
    } else {
        // This shouldn't happen after expansion
        Err(GameError::InventoryFull.into())
    }
}

/// Create a new inventory account
fn create_inventory(
    program_id: &Address,
    payer: &AccountView,
    owner: &Address,
    inventory_account: &AccountView,
    bump: u8,
) -> ProgramResult {
    let initial_slots = PlayerInventoryHeader::INITIAL_SLOTS;
    let account_size = PlayerInventoryHeader::account_size(initial_slots);

    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let lamports = rent.try_minimum_balance(account_size)?;

    let bump_seed = [bump];
    let seeds = crate::seeds!(INVENTORY_SEED, owner.as_ref(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: inventory_account,
        lamports,
        space: account_size as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // Initialize header
    let mut data = inventory_account.try_borrow_mut()?;
    let header = unsafe { PlayerInventoryHeader::load_mut(&mut data) };
    header.owner = *owner;
    header.bump = bump;
    header._padding = [0; 3];
    header.slot_count = initial_slots;
    header.used_slots = 0;

    // Initialize empty slots
    let items_start = PlayerInventoryHeader::LEN;
    for i in 0..initial_slots as usize {
        let item_offset = items_start + (i * InventoryItem::LEN);
        let item = unsafe { &mut *(data.as_mut_ptr().add(item_offset) as *mut InventoryItem) };
        *item = InventoryItem::empty();
    }

    Ok(())
}

/// Expand inventory by EXPANSION_SLOTS
fn expand_inventory(payer: &AccountView, inventory_account: &AccountView) -> ProgramResult {
    let current_slot_count = {
        let data = inventory_account.try_borrow()?;
        let header = unsafe { PlayerInventoryHeader::load(&data) };
        header.slot_count
    };

    let new_slot_count = current_slot_count.saturating_add(PlayerInventoryHeader::EXPANSION_SLOTS);
    let new_size = PlayerInventoryHeader::account_size(new_slot_count);

    // Calculate additional rent needed
    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let old_size = PlayerInventoryHeader::account_size(current_slot_count);
    let old_lamports = rent.try_minimum_balance(old_size)?;
    let new_lamports = rent.try_minimum_balance(new_size)?;
    let additional_lamports = new_lamports.saturating_sub(old_lamports);

    // Transfer additional rent
    if additional_lamports > 0 {
        pinocchio_system::instructions::Transfer {
            from: payer,
            to: inventory_account,
            lamports: additional_lamports,
        }
        .invoke()?;
    }

    // Resize account
    inventory_account.resize(new_size)?;

    // Update header and zero new slots
    let mut data = inventory_account.try_borrow_mut()?;
    let header = unsafe { PlayerInventoryHeader::load_mut(&mut data) };
    header.slot_count = new_slot_count;

    // Zero out new slots
    let old_items_end =
        PlayerInventoryHeader::LEN + (current_slot_count as usize * InventoryItem::LEN);
    let new_items_end = PlayerInventoryHeader::LEN + (new_slot_count as usize * InventoryItem::LEN);

    for byte in data[old_items_end..new_items_end].iter_mut() {
        *byte = 0;
    }

    Ok(())
}
