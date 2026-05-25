use crate::{
    constants::SHOP_CONFIG_SEED,
    error::GameError,
    state::{GameEngine, ShopConfigAccount},
    utils::read_u16,
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        payer,
        game_engine_account,
        dao_authority,
        shop_config_account,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(shop_config_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Derive and Verify Shop Config PDA

    let (expected_config, bump) = ShopConfigAccount::derive_pda(game_engine_account.address());

    if shop_config_account.address() != &expected_config {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Parse Instruction Data (optional overrides)

    // Defaults
    let mut max_base_discount_bps: u16 = 6000; // 60%
    let mut max_bundle_discount_bps: u16 = 3500; // 35%
    let mut max_fib_discount_bps: u16 = 2000; // 20%
    let mut max_total_discount_bps: u16 = 7500; // 75%

    if instruction_data.len() >= 8 {
        let parsed_base = read_u16(instruction_data, 0, "max_base_discount_bps")?;
        let parsed_bundle = read_u16(instruction_data, 2, "max_bundle_discount_bps")?;
        let parsed_fib = read_u16(instruction_data, 4, "max_fib_discount_bps")?;
        let parsed_total = read_u16(instruction_data, 6, "max_total_discount_bps")?;

        if parsed_base > 0 {
            max_base_discount_bps = parsed_base;
        }
        if parsed_bundle > 0 {
            max_bundle_discount_bps = parsed_bundle;
        }
        if parsed_fib > 0 {
            max_fib_discount_bps = parsed_fib;
        }
        if parsed_total > 0 {
            max_total_discount_bps = parsed_total;
        }
    }

    // 6. Create Shop Config Account

    let lamports = crate::utils::rent_exempt_const(ShopConfigAccount::LEN);

    let bump_seed = [bump];
    let seeds = crate::seeds!(SHOP_CONFIG_SEED, game_engine_account.address(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: shop_config_account,
        lamports,
        space: ShopConfigAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 7. Initialize Shop Config Data

    let mut config_data_ref = shop_config_account.try_borrow_mut()?;
    let config = unsafe { ShopConfigAccount::load_mut(&mut config_data_ref) };

    config.account_key = crate::state::AccountKey::ShopConfig as u8;

    // Discount caps
    config.max_base_discount_bps = max_base_discount_bps;
    config.max_bundle_discount_bps = max_bundle_discount_bps;
    config.max_fib_discount_bps = max_fib_discount_bps;
    config.max_total_discount_bps = max_total_discount_bps;

    // Sale limits
    config.max_flash_sales_per_day = 2;
    config.max_daily_deals = 3;
    config.flash_sale_min_duration_secs = 3600; // 1 hour
    config.flash_sale_max_duration_secs = 21600; // 6 hours

    // Milestone thresholds (in lamports, ~SOL equivalent)
    // These are approximate USD values at ~$100/SOL
    config.bronze_threshold = 100_000_000; // ~0.1 SOL (~$10)
    config.silver_threshold = 500_000_000; // ~0.5 SOL (~$50)
    config.gold_threshold = 2_000_000_000; // ~2 SOL (~$200)
    config.platinum_threshold = 5_000_000_000; // ~5 SOL (~$500)
    config.diamond_threshold = 10_000_000_000; // ~10 SOL (~$1000)

    // Milestone discounts (basis points)
    config.bronze_discount_bps = 200; // 2%
    config.silver_discount_bps = 400; // 4%
    config.gold_discount_bps = 600; // 6%
    config.platinum_discount_bps = 800; // 8%
    config.diamond_discount_bps = 1000; // 10%

    // Loyalty streak discounts
    config.streak_day_2_bps = 200; // 2%
    config.streak_day_3_bps = 300; // 3%
    config.streak_day_5_bps = 500; // 5%
    config.streak_day_7_bps = 800; // 8%

    // Global stats
    config.total_sol_collected = 0;
    config.total_novi_burned = 0;

    // State
    config.next_flash_sale_id = 0;

    // SOL Oracle Configuration
    // These should be set via update_config before enabling token payments
    config.sol_pyth_feed = Address::default(); // Set via update_config
    config.sol_switchboard_feed = Address::default(); // Set via update_config
    config.switchboard_queue = Address::default(); // Set via update_config
    config.sol_max_staleness_slots = 30; // ~12 seconds at 400ms slots
    config.sol_confidence_threshold_bps = 100; // 1% max confidence interval

    // Reserved/padding
    config._padding1 = [0; 2];
    config._reserved = [0; 8];
    config._padding2 = [0; 3];

    config.bump = bump;

    Ok(())
}
