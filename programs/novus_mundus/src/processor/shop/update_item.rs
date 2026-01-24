use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    error::GameError,
    state::{GameEngine, ShopItemAccount},
    validation::{require_signer, require_writable},
};

/// Update field flags - which fields to update
#[repr(u8)]
pub enum UpdateField {
    PriceSol = 1,
    // PriceGems = 2, // Removed - use token payments instead
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
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        dao_authority,
        game_engine_account,
        shop_item_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(dao_authority)?;
    require_writable(shop_item_account)?;

    // 3. Parse Instruction Data Header

    // item_id(4) + update_flags(1) = 5 bytes minimum
    if instruction_data.len() < 5 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let item_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let update_flags = instruction_data[4];

    // 4. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Verify PDA

    let (expected_pda, _) = ShopItemAccount::derive_pda(game_engine_account.key(), item_id);
    if shop_item_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Load and Update Shop Item

    let mut shop_item_data_ref = shop_item_account.try_borrow_mut_data()?;
    let shop_item = unsafe { ShopItemAccount::load_mut(&mut shop_item_data_ref) };

    // Track data offset for variable-length updates
    let mut offset = 5usize;

    // Update price_sol if flag set
    if update_flags & (UpdateField::PriceSol as u8) != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.price_sol_lamports = u64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        offset += 8;
    }

    // Update is_active if flag set
    if update_flags & (UpdateField::IsActive as u8) != 0 {
        if instruction_data.len() < offset + 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.is_active = instruction_data[offset] != 0;
        offset += 1;
    }

    // Update is_featured if flag set
    if update_flags & (UpdateField::IsFeatured as u8) != 0 {
        if instruction_data.len() < offset + 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.is_featured = instruction_data[offset] != 0;
        offset += 1;
    }

    // Update available_from if flag set
    if update_flags & (UpdateField::AvailableFrom as u8) != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.available_from = i64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        offset += 8;
    }

    // Update available_until if flag set
    if update_flags & (UpdateField::AvailableUntil as u8) != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.available_until = i64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        offset += 8;
    }

    // Update stock if flag set (both max and current)
    if update_flags & (UpdateField::Stock as u8) != 0 {
        if instruction_data.len() < offset + 16 {
            return Err(ProgramError::InvalidInstructionData);
        }
        shop_item.max_global_stock = u64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        shop_item.current_global_stock = u64::from_le_bytes(
            instruction_data[offset + 8..offset + 16].try_into().unwrap()
        );
        // offset += 16;
    }

    Ok(())
}
