use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::SHOP_ITEM_SEED,
    error::GameError,
    state::{GameEngine, ShopItemAccount, ShopCategory},
    validation::{require_signer, require_writable, require_key_match},
};

/// Create a shop item (DAO only)
///
/// Creates a new item that can be purchased in the shop.
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] shop_item: ShopItemAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - item_id: u32
/// - item_type: u16
/// - category: u8
/// - rarity: u8
/// - quantity_per_purchase: u16
/// - base_stats_bps: u16
/// - price_sol_lamports: u64
/// - price_novi: u64
/// - price_gems: u64
/// - available_from: i64 (0 = now)
/// - available_until: i64 (0 = forever)
/// - max_global_stock: u64 (0 = unlimited)
/// - max_per_player: u32 (0 = unlimited)
/// - max_per_day: u16 (0 = unlimited)
/// - is_active: bool
/// - is_featured: bool
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        payer,
        game_engine_account,
        dao_authority,
        shop_item_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(shop_item_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // Minimum required: item_id(4) + item_type(2) + category(1) + rarity(1) +
    //                   qty(2) + stats(2) + sol(8) + novi(8) + gems(8) = 36 bytes
    if instruction_data.len() < 36 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let item_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let item_type = u16::from_le_bytes(instruction_data[4..6].try_into().unwrap());
    let category = instruction_data[6];
    let rarity = instruction_data[7];
    let quantity_per_purchase = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let base_stats_bps = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());
    let price_sol_lamports = u64::from_le_bytes(instruction_data[12..20].try_into().unwrap());
    let price_novi = u64::from_le_bytes(instruction_data[20..28].try_into().unwrap());
    let price_gems = u64::from_le_bytes(instruction_data[28..36].try_into().unwrap());

    // Optional fields with defaults
    let available_from = if instruction_data.len() >= 44 {
        i64::from_le_bytes(instruction_data[36..44].try_into().unwrap())
    } else { 0 };

    let available_until = if instruction_data.len() >= 52 {
        i64::from_le_bytes(instruction_data[44..52].try_into().unwrap())
    } else { 0 };

    let max_global_stock = if instruction_data.len() >= 60 {
        u64::from_le_bytes(instruction_data[52..60].try_into().unwrap())
    } else { 0 };

    let max_per_player = if instruction_data.len() >= 64 {
        u32::from_le_bytes(instruction_data[60..64].try_into().unwrap())
    } else { 0 };

    let max_per_day = if instruction_data.len() >= 66 {
        u16::from_le_bytes(instruction_data[64..66].try_into().unwrap())
    } else { 0 };

    let is_active = if instruction_data.len() >= 67 {
        instruction_data[66] != 0
    } else { true };

    let is_featured = if instruction_data.len() >= 68 {
        instruction_data[67] != 0
    } else { false };

    // 4. Validate Data

    // Validate category
    ShopCategory::from_u8(category).ok_or(GameError::InvalidParameter)?;

    // Validate rarity (0-4)
    if rarity > 4 {
        return Err(GameError::InvalidParameter.into());
    }

    // Must have at least one price
    if price_sol_lamports == 0 && price_novi == 0 && price_gems == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // Quantity must be > 0
    if quantity_per_purchase == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Shop Item PDA

    let (expected_item, bump) = ShopItemAccount::derive_pda(game_engine_account.key(), item_id);

    if shop_item_account.key() != &expected_item {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Shop Item Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(ShopItemAccount::LEN);

    let item_id_bytes = item_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        SHOP_ITEM_SEED,
        game_engine_account.key().as_ref(),
        &item_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: shop_item_account,
        lamports,
        space: ShopItemAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Shop Item Data

    let mut item_data_ref = shop_item_account.try_borrow_mut_data()?;
    let item = unsafe { ShopItemAccount::load_mut(&mut item_data_ref) };

    item.item_type = item_type;
    item.category = category;
    item.rarity = rarity;
    item.quantity_per_purchase = quantity_per_purchase;
    item.base_stats_bps = base_stats_bps;

    item.price_sol_lamports = price_sol_lamports;
    item.price_novi = price_novi;
    item.price_gems = price_gems;

    item.available_from = available_from;
    item.available_until = available_until;

    item.max_global_stock = max_global_stock;
    item.current_global_stock = max_global_stock; // Start at max

    item.max_per_player = max_per_player;
    item.max_per_day = max_per_day;
    item._padding = [0; 2];

    item.is_active = is_active;
    item.is_featured = is_featured;

    item._reserved = [0; 8];
    item._padding2 = [0; 5];
    item.bump = bump;

    Ok(())
}
