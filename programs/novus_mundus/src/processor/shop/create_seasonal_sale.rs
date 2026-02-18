use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::SEASONAL_SALE_SEED,
    error::GameError,
    state::{GameEngine, SeasonalSaleAccount, SeasonalSaleStatus, MAX_FEATURED_ITEMS},
    validation::{require_signer, require_writable, require_key_match},
};

/// Create a seasonal sale tied to an event (DAO only)
///
/// Seasonal sales run during events with featured items and exclusive rewards.
/// Account is CLOSABLE - rent returns to payer after event ends.
///
/// # Accounts
/// - [signer, writable] payer: Pays for creation (receives rent on close)
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [] event: The event this sale is tied to (for PDA derivation)
/// - [writable] seasonal_sale: SeasonalSaleAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - name: [u8; 32]
/// - global_discount_bps: u16
/// - starts_at: i64
/// - ends_at: i64
/// - spend_threshold: u64 (for exclusive reward)
/// - exclusive_cosmetic_id: u32
/// - featured_count: u8
/// - featured_items: [(item_id: u32, discount_bps: u16)] * featured_count
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
        event_account,
        seasonal_sale_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(seasonal_sale_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data Header

    // name(32) + global_discount(2) + starts(8) + ends(8) + threshold(8) + cosmetic(4) + count(1) = 63
    if instruction_data.len() < 63 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut name = [0u8; 32];
    name.copy_from_slice(&instruction_data[0..32]);

    let global_discount_bps = u16::from_le_bytes(instruction_data[32..34].try_into().unwrap());
    let starts_at = i64::from_le_bytes(instruction_data[34..42].try_into().unwrap());
    let ends_at = i64::from_le_bytes(instruction_data[42..50].try_into().unwrap());
    let spend_threshold = u64::from_le_bytes(instruction_data[50..58].try_into().unwrap());
    let exclusive_cosmetic_id = u32::from_le_bytes(instruction_data[58..62].try_into().unwrap());
    let featured_count = instruction_data[62] as usize;

    // 4. Validate Data

    if featured_count > MAX_FEATURED_ITEMS {
        return Err(GameError::InvalidParameter.into());
    }

    if ends_at <= starts_at {
        return Err(GameError::InvalidTimestamp.into());
    }

    if global_discount_bps > 5000 {
        return Err(GameError::InvalidParameter.into());
    }

    // Parse featured items (6 bytes each: item_id(4) + discount(2))
    let featured_data_size = featured_count * 6;
    if instruction_data.len() < 63 + featured_data_size {
        return Err(ProgramError::InvalidInstructionData);
    }

    // 5. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Seasonal Sale PDA

    let (expected_pda, bump) = SeasonalSaleAccount::derive_pda(
        game_engine_account.key(),
        event_account.key(),
    );

    if seasonal_sale_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Seasonal Sale Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(SeasonalSaleAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        SEASONAL_SALE_SEED,
        game_engine_account.key().as_ref(),
        event_account.key().as_ref(),
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: seasonal_sale_account,
        lamports,
        space: SeasonalSaleAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Seasonal Sale Data

    let mut sale_data_ref = seasonal_sale_account.try_borrow_mut_data()?;
    let sale = unsafe { SeasonalSaleAccount::load_mut(&mut sale_data_ref) };

    sale.account_key = crate::state::AccountKey::SeasonalSale as u8;
    sale.payer = *payer.key();
    sale.name = name;

    // Parse featured items
    let mut featured_item_ids = [0u32; MAX_FEATURED_ITEMS];
    let mut featured_discounts_bps = [0u16; MAX_FEATURED_ITEMS];

    for i in 0..featured_count {
        let offset = 63 + i * 6;
        featured_item_ids[i] = u32::from_le_bytes(
            instruction_data[offset..offset + 4].try_into().unwrap()
        );
        featured_discounts_bps[i] = u16::from_le_bytes(
            instruction_data[offset + 4..offset + 6].try_into().unwrap()
        );
    }

    sale.featured_item_ids = featured_item_ids;
    sale.featured_discounts_bps = featured_discounts_bps;

    sale.featured_count = featured_count as u8;
    sale.status = SeasonalSaleStatus::Scheduled as u8;
    sale.global_discount_bps = global_discount_bps;
    sale._padding1 = [0; 4];

    sale.starts_at = starts_at;
    sale.ends_at = ends_at;

    sale.spend_threshold = spend_threshold;
    sale.exclusive_cosmetic_id = exclusive_cosmetic_id;
    sale.exclusive_claims = 0;

    sale.total_purchases = 0;
    sale.total_revenue_lamports = 0;

    sale._reserved = [0; 8];
    sale._padding2 = [0; 7];
    sale.bump = bump;

    Ok(())
}
