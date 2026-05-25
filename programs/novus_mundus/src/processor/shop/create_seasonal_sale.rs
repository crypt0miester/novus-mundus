use crate::{
    constants::SEASONAL_SALE_SEED,
    error::GameError,
    state::{GameEngine, SeasonalSaleAccount, SeasonalSaleStatus, MAX_FEATURED_ITEMS},
    utils::{read_bytes32, read_i64, read_u16, read_u32, read_u64, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        payer,
        game_engine_account,
        dao_authority,
        event_account,
        seasonal_sale_account,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(seasonal_sale_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data Header

    // name(32) + global_discount(2) + starts(8) + ends(8) + threshold(8) + cosmetic(4) + count(1) = 63
    let name = read_bytes32(instruction_data, 0, "name")?;

    let global_discount_bps = read_u16(instruction_data, 32, "global_discount_bps")?;
    let starts_at = read_i64(instruction_data, 34, "starts_at")?;
    let ends_at = read_i64(instruction_data, 42, "ends_at")?;
    let spend_threshold = read_u64(instruction_data, 50, "spend_threshold")?;
    let exclusive_cosmetic_id = read_u32(instruction_data, 58, "exclusive_cosmetic_id")?;
    let featured_count = read_u8(instruction_data, 62, "featured_count")? as usize;

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

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Seasonal Sale PDA

    let (expected_pda, bump) =
        SeasonalSaleAccount::derive_pda(game_engine_account.address(), event_account.address());

    if seasonal_sale_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Seasonal Sale Account

    let lamports = crate::utils::rent_exempt_const(SeasonalSaleAccount::LEN);

    let bump_seed = [bump];
    let seeds = crate::seeds!(
        SEASONAL_SALE_SEED,
        game_engine_account.address(),
        event_account.address(),
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: seasonal_sale_account,
        lamports,
        space: SeasonalSaleAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize Seasonal Sale Data

    let mut sale_data_ref = seasonal_sale_account.try_borrow_mut()?;
    let sale = unsafe { SeasonalSaleAccount::load_mut(&mut sale_data_ref) };

    sale.account_key = crate::state::AccountKey::SeasonalSale as u8;
    sale.payer = *payer.address();
    sale.name = name;

    // Parse featured items
    let mut featured_item_ids = [0u32; MAX_FEATURED_ITEMS];
    let mut featured_discounts_bps = [0u16; MAX_FEATURED_ITEMS];

    for i in 0..featured_count {
        let offset = 63 + i * 6;
        featured_item_ids[i] = read_u32(instruction_data, offset, "featured_item_id")?;
        featured_discounts_bps[i] =
            read_u16(instruction_data, offset + 4, "featured_discount_bps")?;
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
