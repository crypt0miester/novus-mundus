use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::WEEKLY_SALE_SEED,
    error::GameError,
    state::{GameEngine, WeeklySaleAccount, WeeklySaleTheme},
    validation::{require_signer, require_writable, require_key_match},
};

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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        payer,
        game_engine_account,
        dao_authority,
        weekly_sale_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(weekly_sale_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // week(8) + theme(1) + bonus_type(1) + bonus_value(2) + cats(8) + starts(8) + duration(1) = 29
    if instruction_data.len() < 29 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let week_number = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let theme = instruction_data[8];
    let bonus_type = instruction_data[9];
    let bonus_value_bps = u16::from_le_bytes(instruction_data[10..12].try_into().unwrap());

    let category_discounts: [u16; 4] = [
        u16::from_le_bytes(instruction_data[12..14].try_into().unwrap()),
        u16::from_le_bytes(instruction_data[14..16].try_into().unwrap()),
        u16::from_le_bytes(instruction_data[16..18].try_into().unwrap()),
        u16::from_le_bytes(instruction_data[18..20].try_into().unwrap()),
    ];

    let starts_at = i64::from_le_bytes(instruction_data[20..28].try_into().unwrap());
    let duration_days = instruction_data[28];

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

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Weekly Sale PDA

    let (expected_pda, bump) = WeeklySaleAccount::derive_pda(game_engine_account.key(), week_number);

    if weekly_sale_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Weekly Sale Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(WeeklySaleAccount::LEN);

    let week_bytes = week_number.to_le_bytes();
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        WEEKLY_SALE_SEED,
        game_engine_account.key().as_ref(),
        &week_bytes,
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: weekly_sale_account,
        lamports,
        space: WeeklySaleAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Weekly Sale Data

    let ends_at = starts_at + (duration_days as i64 * 86400);

    let mut weekly_sale_data_ref = weekly_sale_account.try_borrow_mut_data()?;
    let weekly_sale = unsafe { WeeklySaleAccount::load_mut(&mut weekly_sale_data_ref) };

    // Payer receives rent on close
    weekly_sale.account_key = crate::state::AccountKey::WeeklySale as u8;
    weekly_sale.payer = *payer.key();

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
