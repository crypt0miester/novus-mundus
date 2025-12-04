use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::SHOP_CONFIG_SEED,
    error::GameError,
    state::{GameEngine, ShopConfigAccount},
    validation::{require_signer, require_writable, require_key_match},
};

/// Initialize shop configuration (DAO only)
///
/// Creates the global shop config account with default values.
/// Can only be called once per game engine.
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] shop_config: ShopConfigAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data (optional overrides, zeros use defaults)
/// - max_base_discount_bps: u16
/// - max_bundle_discount_bps: u16
/// - max_fib_discount_bps: u16
/// - max_total_discount_bps: u16
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
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(shop_config_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Derive and Verify Shop Config PDA

    let (expected_config, bump) = ShopConfigAccount::derive_pda(game_engine_account.key());

    if shop_config_account.key() != &expected_config {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Parse Instruction Data (optional overrides)

    // Defaults
    let mut max_base_discount_bps: u16 = 6000;      // 60%
    let mut max_bundle_discount_bps: u16 = 3500;    // 35%
    let mut max_fib_discount_bps: u16 = 2000;       // 20%
    let mut max_total_discount_bps: u16 = 7500;     // 75%

    if instruction_data.len() >= 8 {
        let parsed_base = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
        let parsed_bundle = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
        let parsed_fib = u16::from_le_bytes([instruction_data[4], instruction_data[5]]);
        let parsed_total = u16::from_le_bytes([instruction_data[6], instruction_data[7]]);

        if parsed_base > 0 { max_base_discount_bps = parsed_base; }
        if parsed_bundle > 0 { max_bundle_discount_bps = parsed_bundle; }
        if parsed_fib > 0 { max_fib_discount_bps = parsed_fib; }
        if parsed_total > 0 { max_total_discount_bps = parsed_total; }
    }

    // 6. Create Shop Config Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(ShopConfigAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        SHOP_CONFIG_SEED,
        game_engine_account.key().as_ref(),
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: shop_config_account,
        lamports,
        space: ShopConfigAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 7. Initialize Shop Config Data

    let mut config_data_ref = shop_config_account.try_borrow_mut_data()?;
    let config = unsafe { ShopConfigAccount::load_mut(&mut config_data_ref) };

    // Discount caps
    config.max_base_discount_bps = max_base_discount_bps;
    config.max_bundle_discount_bps = max_bundle_discount_bps;
    config.max_fib_discount_bps = max_fib_discount_bps;
    config.max_total_discount_bps = max_total_discount_bps;

    // Sale limits
    config.max_flash_sales_per_day = 2;
    config.max_daily_deals = 3;
    config.flash_sale_min_duration_secs = 3600;     // 1 hour
    config.flash_sale_max_duration_secs = 21600;    // 6 hours

    // Milestone thresholds (in lamports, ~SOL equivalent)
    // These are approximate USD values at ~$100/SOL
    config.bronze_threshold = 100_000_000;          // ~0.1 SOL (~$10)
    config.silver_threshold = 500_000_000;          // ~0.5 SOL (~$50)
    config.gold_threshold = 2_000_000_000;          // ~2 SOL (~$200)
    config.platinum_threshold = 5_000_000_000;      // ~5 SOL (~$500)
    config.diamond_threshold = 10_000_000_000;      // ~10 SOL (~$1000)

    // Milestone discounts (basis points)
    config.bronze_discount_bps = 200;               // 2%
    config.silver_discount_bps = 400;               // 4%
    config.gold_discount_bps = 600;                 // 6%
    config.platinum_discount_bps = 800;             // 8%
    config.diamond_discount_bps = 1000;             // 10%

    // Loyalty streak discounts
    config.streak_day_2_bps = 200;                  // 2%
    config.streak_day_3_bps = 300;                  // 3%
    config.streak_day_5_bps = 500;                  // 5%
    config.streak_day_7_bps = 800;                  // 8%

    // Global stats
    config.total_sol_collected = 0;
    config.total_novi_burned = 0;

    // State
    config.next_flash_sale_id = 0;

    // Reserved/padding
    config._padding1 = [0; 2];
    config._reserved = [0; 16];
    config._padding2 = [0; 6];

    config.bump = bump;

    Ok(())
}
