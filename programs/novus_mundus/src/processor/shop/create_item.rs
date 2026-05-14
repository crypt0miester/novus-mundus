use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
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
/// - available_from: i64 (0 = now)
/// - available_until: i64 (0 = forever)
/// - max_global_stock: u64 (0 = unlimited)
/// - max_per_player: u32 (0 = unlimited)
/// - max_per_day: u16 (0 = unlimited)
/// - is_active: bool
/// - is_featured: bool
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
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
    //                   qty(2) + stats(2) + sol(8) = 20 bytes
    if instruction_data.len() < 20 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let item_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let item_type = u16::from_le_bytes(instruction_data[4..6].try_into().unwrap());
    let category = instruction_data[6];
    let rarity = instruction_data[7];
    let quantity_per_purchase = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let base_stats_bps = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());
    let price_sol_lamports = u64::from_le_bytes(instruction_data[12..20].try_into().unwrap());

    // Optional fields with defaults
    let available_from = if instruction_data.len() >= 28 {
        i64::from_le_bytes(instruction_data[20..28].try_into().unwrap())
    } else { 0 };

    let available_until = if instruction_data.len() >= 36 {
        i64::from_le_bytes(instruction_data[28..36].try_into().unwrap())
    } else { 0 };

    let max_global_stock = if instruction_data.len() >= 44 {
        u64::from_le_bytes(instruction_data[36..44].try_into().unwrap())
    } else { 0 };

    let max_per_player = if instruction_data.len() >= 48 {
        u32::from_le_bytes(instruction_data[44..48].try_into().unwrap())
    } else { 0 };

    let max_per_day = if instruction_data.len() >= 50 {
        u16::from_le_bytes(instruction_data[48..50].try_into().unwrap())
    } else { 0 };

    let is_active = if instruction_data.len() >= 51 {
        instruction_data[50] != 0
    } else { true };

    let is_featured = if instruction_data.len() >= 52 {
        instruction_data[51] != 0
    } else { false };

    // 4. Validate Data

    // Validate category
    ShopCategory::from_u8(category).ok_or(GameError::InvalidParameter)?;

    // Validate rarity (0-4)
    if rarity > 4 {
        return Err(GameError::InvalidParameter.into());
    }

    // Must have a SOL price
    if price_sol_lamports == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // Quantity must be > 0
    if quantity_per_purchase == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Shop Item PDA

    let (expected_item, bump) = ShopItemAccount::derive_pda(game_engine_account.address(), item_id);

    if shop_item_account.address() != &expected_item {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Shop Item Account

    let lamports = crate::utils::rent_exempt_const(ShopItemAccount::LEN);

    let item_id_bytes = item_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        SHOP_ITEM_SEED,
        game_engine_account.address(),
        &item_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: shop_item_account,
        lamports,
        space: ShopItemAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Shop Item Data

    let mut item_data_ref = shop_item_account.try_borrow_mut()?;
    let item = unsafe { ShopItemAccount::load_mut(&mut item_data_ref) };

    item.account_key = crate::state::AccountKey::ShopItem as u8;
    item.item_type = item_type;
    item.category = category;
    item.rarity = rarity;
    item.quantity_per_purchase = quantity_per_purchase;
    item.base_stats_bps = base_stats_bps;

    item.price_sol_lamports = price_sol_lamports;
    item._reserved_price = [0; 8];

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
