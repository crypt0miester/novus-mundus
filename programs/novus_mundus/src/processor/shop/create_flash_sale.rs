use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::FLASH_SALE_SEED,
    error::GameError,
    state::{GameEngine, ShopConfigAccount, FlashSaleAccount, FlashSaleStatus},
    validation::{require_signer, require_writable, require_key_match},
};

/// Create a flash sale (DAO only)
///
/// Creates a time-limited flash sale with limited stock.
/// Announces 30 minutes before start (status = Announced).
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation (receives rent on close)
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] shop_config: ShopConfigAccount (to get/increment sale_id)
/// - [writable] flash_sale: FlashSaleAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - item_id: u32
/// - is_bundle: u8 (bool)
/// - discount_bps: u16
/// - starts_at: i64
/// - duration_secs: u32
/// - max_stock: u64
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
        shop_config_account,
        flash_sale_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(shop_config_account)?;
    require_writable(flash_sale_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // item_id(4) + is_bundle(1) + discount_bps(2) + starts_at(8) + duration(4) + stock(8) = 27
    if instruction_data.len() < 27 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let item_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let is_bundle = instruction_data[4] != 0;
    let discount_bps = u16::from_le_bytes(instruction_data[5..7].try_into().unwrap());
    let starts_at = i64::from_le_bytes(instruction_data[7..15].try_into().unwrap());
    let duration_secs = u32::from_le_bytes(instruction_data[15..19].try_into().unwrap());
    let max_stock = u64::from_le_bytes(instruction_data[19..27].try_into().unwrap());

    // 4. Validate Data

    // Max discount 50% for flash sales
    if discount_bps > 5000 {
        return Err(GameError::InvalidParameter.into());
    }

    // Stock must be > 0
    if max_stock == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Load Shop Config and Validate Duration

    let mut shop_config_data_ref = shop_config_account.try_borrow_mut_data()?;
    let shop_config = unsafe { ShopConfigAccount::load_mut(&mut shop_config_data_ref) };

    // Validate duration within bounds
    if duration_secs < shop_config.flash_sale_min_duration_secs as u32 {
        return Err(GameError::InvalidParameter.into());
    }
    if duration_secs > shop_config.flash_sale_max_duration_secs as u32 {
        return Err(GameError::InvalidParameter.into());
    }

    // Get and increment sale ID
    let sale_id = shop_config.next_flash_sale_id;
    shop_config.next_flash_sale_id = shop_config.next_flash_sale_id.saturating_add(1);

    // 7. Calculate Timing

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    // Starts must be in the future
    if starts_at <= now {
        return Err(GameError::InvalidTimestamp.into());
    }

    // Announcement time (30 minutes before start)
    let announced_at = starts_at - 1800; // 30 * 60 = 1800 seconds

    // End time
    let ends_at = starts_at + duration_secs as i64;

    // 8. Derive and Verify Flash Sale PDA

    let (expected_pda, bump) = FlashSaleAccount::derive_pda(game_engine_account.key(), sale_id);

    if flash_sale_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 9. Create Flash Sale Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(FlashSaleAccount::LEN);

    let sale_id_bytes = sale_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        FLASH_SALE_SEED,
        game_engine_account.key().as_ref(),
        &sale_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: flash_sale_account,
        lamports,
        space: FlashSaleAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 10. Initialize Flash Sale Data

    let mut flash_sale_data_ref = flash_sale_account.try_borrow_mut_data()?;
    let flash_sale = unsafe { FlashSaleAccount::load_mut(&mut flash_sale_data_ref) };

    flash_sale.account_key = crate::state::AccountKey::FlashSale as u8;

    // Payer receives rent on close
    flash_sale.payer = *payer.key();

    flash_sale.item_id = item_id;
    flash_sale.is_bundle = is_bundle;
    flash_sale.status = FlashSaleStatus::Announced as u8;
    flash_sale.discount_bps = discount_bps;

    flash_sale.announced_at = announced_at;
    flash_sale.starts_at = starts_at;
    flash_sale.ends_at = ends_at;

    flash_sale.max_stock = max_stock;
    flash_sale.remaining_stock = max_stock;

    flash_sale.total_claims = 0;
    flash_sale.total_revenue_lamports = 0;

    flash_sale._reserved = [0; 8];
    flash_sale._padding = [0; 7];
    flash_sale.bump = bump;

    Ok(())
}
