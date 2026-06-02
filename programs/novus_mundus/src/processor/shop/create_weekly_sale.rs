use crate::{
    constants::WEEKLY_SALE_SEED,
    error::GameError,
    state::{GameEngine, WeeklySaleAccount, WeeklySaleTheme},
    utils::{read_i64, read_u16, read_u64, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Create a weekly sale (DAO only)
///
/// Creates a themed weekly sale with category-specific discounts.
/// Account is CLOSABLE - rent returns to payer after week ends.
///
/// # Accounts
/// - [signer, writable] payer: Pays for creation (receives rent on close)
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] weekly_sale: WeeklySaleAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - week_number: u64 (epoch week number for PDA)
/// - theme: u8 (WeeklySaleTheme)
/// - bonus_type: u8
/// - bonus_value_bps: u16
/// - category_discounts: [u16; 4] (Equipment, Consumable, Material, Cosmetic)
/// - starts_at: i64
/// - duration_days: u8
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
        weekly_sale_account,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(weekly_sale_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // week(8) + theme(1) + bonus_type(1) + bonus_value(2) + cats(8) + starts(8) + duration(1) = 29
    let week_number = read_u64(instruction_data, 0, "week_number")?;
    let theme = read_u8(instruction_data, 8, "theme")?;
    let bonus_type = read_u8(instruction_data, 9, "bonus_type")?;
    let bonus_value_bps = read_u16(instruction_data, 10, "bonus_value_bps")?;

    let category_discounts: [u16; 4] = [
        read_u16(instruction_data, 12, "category_discount_0")?,
        read_u16(instruction_data, 14, "category_discount_1")?,
        read_u16(instruction_data, 16, "category_discount_2")?,
        read_u16(instruction_data, 18, "category_discount_3")?,
    ];

    let starts_at = read_i64(instruction_data, 20, "starts_at")?;
    let duration_days = read_u8(instruction_data, 28, "duration_days")?;

    // 4. Validate Data

    // Validate theme
    if !matches!(theme, 0..=4) {
        return Err(GameError::InvalidParameter.into());
    }

    // Duration 1-7 days
    if duration_days == 0 || duration_days > 7 {
        return Err(GameError::InvalidParameter.into());
    }

    // Category discounts capped at 30%
    for discount in category_discounts.iter() {
        if *discount > 3000 {
            return Err(GameError::InvalidParameter.into());
        }
    }

    // 5. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Weekly Sale PDA

    let (expected_pda, bump) =
        WeeklySaleAccount::derive_pda(game_engine_account.address(), week_number);

    if weekly_sale_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Weekly Sale Account

    let lamports = crate::utils::rent_exempt_const(WeeklySaleAccount::LEN);

    let week_bytes = week_number.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        WEEKLY_SALE_SEED,
        game_engine_account.address(),
        &week_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: weekly_sale_account,
        lamports,
        space: WeeklySaleAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize Weekly Sale Data

    let ends_at = starts_at.saturating_add((duration_days as i64).saturating_mul(86400));

    let mut weekly_sale_data_ref = weekly_sale_account.try_borrow_mut()?;
    let weekly_sale = unsafe { WeeklySaleAccount::load_mut(&mut weekly_sale_data_ref) };

    // Payer receives rent on close
    weekly_sale.account_key = crate::state::AccountKey::WeeklySale as u8;
    weekly_sale.payer = *payer.address();

    weekly_sale.theme = theme;
    weekly_sale.bonus_type = bonus_type;
    weekly_sale.bonus_value_bps = bonus_value_bps;
    weekly_sale._padding1 = [0; 4];

    weekly_sale.category_discounts = category_discounts;

    weekly_sale.starts_at = starts_at;
    weekly_sale.ends_at = ends_at;

    weekly_sale.total_purchases = 0;
    weekly_sale.total_revenue_lamports = 0;

    weekly_sale._reserved = [0; 8];
    weekly_sale._padding2 = [0; 7];
    weekly_sale.bump = bump;

    Ok(())
}

/// Get theme name for display
#[allow(dead_code)]
fn theme_name(theme: WeeklySaleTheme) -> &'static str {
    match theme {
        WeeklySaleTheme::Combat => "Combat Week",
        WeeklySaleTheme::Defense => "Defense Week",
        WeeklySaleTheme::Resource => "Resource Week",
        WeeklySaleTheme::Growth => "Growth Week",
        WeeklySaleTheme::Expedition => "Expedition Week",
    }
}
