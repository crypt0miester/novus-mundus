use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
};
use crate::{
    error::GameError,
    state::{GameEngine, ShopItemAccount},
    validation::{require_signer, require_writable},
    utils::{read_u8, read_u32, read_u64, read_i64},
};

/// Update field flags - which fields to update
#[repr(u8)]
pub enum UpdateField {
    PriceSol = 1,
    IsActive = 4,
    IsFeatured = 8,
    AvailableFrom = 16,
    AvailableUntil = 32,
    Stock = 64,
}

/// Update a shop item (DAO only)
///
/// Allows modifying prices, availability, and stock of existing items.
///
/// # Accounts
/// - [signer] dao_authority: DAO's authority
/// - [] game_engine: GameEngine account
/// - [writable] shop_item: ShopItemAccount to update
///
/// # Instruction Data
/// - item_id: u32 (for PDA verification)
/// - update_flags: u8 (bitmask of UpdateField)
/// - price_sol_lamports: u64 (if flag set)
/// - is_active: u8 (if flag set)
/// - is_featured: u8 (if flag set)
/// - available_from: i64 (if flag set)
/// - available_until: i64 (if flag set)
/// - max_global_stock: u64 (if flag set)
/// - current_global_stock: u64 (if flag set)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        dao_authority,
        game_engine_account,
        shop_item_account,
    ]);

    // 2. Validate Accounts

    require_signer(dao_authority)?;
    require_writable(shop_item_account)?;

    // 3. Parse Instruction Data Header

    // item_id(4) + update_flags(1) = 5 bytes minimum
    let item_id = read_u32(instruction_data, 0, "item_id")?;
    let update_flags = read_u8(instruction_data, 4, "update_flags")?;

    // 4. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Verify PDA

    let (expected_pda, _) = ShopItemAccount::derive_pda(game_engine_account.address(), item_id);
    if shop_item_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Load and Update Shop Item

    let mut shop_item_data_ref = shop_item_account.try_borrow_mut()?;
    let shop_item = unsafe { ShopItemAccount::load_mut(&mut shop_item_data_ref) };

    // Track data offset for variable-length updates
    let mut offset = 5usize;

    // Update price_sol if flag set
    if update_flags & (UpdateField::PriceSol as u8) != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.price_sol_lamports = read_u64(instruction_data, offset, "price_sol_lamports")?;
        offset += 8;
    }

    // Update is_active if flag set
    if update_flags & (UpdateField::IsActive as u8) != 0 {
        if instruction_data.len() < offset + 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.is_active = read_u8(instruction_data, offset, "is_active")? != 0;
        offset += 1;
    }

    // Update is_featured if flag set
    if update_flags & (UpdateField::IsFeatured as u8) != 0 {
        if instruction_data.len() < offset + 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.is_featured = read_u8(instruction_data, offset, "is_featured")? != 0;
        offset += 1;
    }

    // Update available_from if flag set
    if update_flags & (UpdateField::AvailableFrom as u8) != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.available_from = read_i64(instruction_data, offset, "available_from")?;
        offset += 8;
    }

    // Update available_until if flag set
    if update_flags & (UpdateField::AvailableUntil as u8) != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.available_until = read_i64(instruction_data, offset, "available_until")?;
        offset += 8;
    }

    // Update stock if flag set (both max and current)
    if update_flags & (UpdateField::Stock as u8) != 0 {
        if instruction_data.len() < offset + 16 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.max_global_stock = read_u64(instruction_data, offset, "max_global_stock")?;
        shop_item.current_global_stock = read_u64(instruction_data, offset + 8, "current_global_stock")?;
        // offset += 16;
    }

    Ok(())
}
