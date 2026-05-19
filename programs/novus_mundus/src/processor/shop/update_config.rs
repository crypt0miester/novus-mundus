use pinocchio::{
    ProgramResult,
    AccountView,
    Address,
};
use crate::{
    error::GameError,
    state::{GameEngine, ShopConfigAccount},
    validation::{require_signer, require_writable},
    utils::{read_bytes32, read_u16, read_u64, read_u8},
};

/// Update field flags
pub const UPDATE_DISCOUNT_CAPS: u8 = 1;
pub const UPDATE_SALE_LIMITS: u8 = 2;
pub const UPDATE_MILESTONES: u8 = 4;
pub const UPDATE_MILESTONE_DISCOUNTS: u8 = 8;
pub const UPDATE_STREAK_DISCOUNTS: u8 = 16;
pub const UPDATE_SOL_ORACLE: u8 = 32;

/// Update shop config (DAO only)
///
/// Allows modifying global shop settings.
///
/// # Accounts (base — 3)
/// - [signer] dao_authority: DAO's authority
/// - [] game_engine: GameEngine account
/// - [writable] shop_config: ShopConfigAccount to update
///
/// `UPDATE_SOL_ORACLE` carries no extra accounts — both the Pyth and
/// Switchboard SOL feeds, and the Switchboard queue, are bare 32-byte pubkeys
/// in the instruction data.
///
/// # Instruction Data
/// - update_flags: u8 (bitmask)
/// - [conditional fields based on flags]
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (3 required + 0–2 optional feed-validation slots)

    crate::extract_accounts!(accounts, [
        dao_authority,
        game_engine_account,
        shop_config_account,
    ]);

    // 2. Validate Accounts

    require_signer(dao_authority)?;
    require_writable(shop_config_account)?;

    // 3. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify PDA

    let (expected_pda, _) = ShopConfigAccount::derive_pda(game_engine_account.address());
    if shop_config_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Parse and Apply Updates

    let update_flags = read_u8(instruction_data, 0, "update_flags")?;
    let mut offset = 1usize;

    let mut config_data_ref = shop_config_account.try_borrow_mut()?;
    let config = unsafe { ShopConfigAccount::load_mut(&mut config_data_ref) };

    // Update discount caps (8 bytes: 4 x u16)
    if update_flags & UPDATE_DISCOUNT_CAPS != 0 {
        config.max_base_discount_bps = read_u16(instruction_data, offset, "max_base_discount_bps")?;
        config.max_bundle_discount_bps = read_u16(instruction_data, offset + 2, "max_bundle_discount_bps")?;
        config.max_fib_discount_bps = read_u16(instruction_data, offset + 4, "max_fib_discount_bps")?;
        config.max_total_discount_bps = read_u16(instruction_data, offset + 6, "max_total_discount_bps")?;
        offset += 8;
    }

    // Update sale limits (6 bytes)
    if update_flags & UPDATE_SALE_LIMITS != 0 {
        config.max_flash_sales_per_day = read_u8(instruction_data, offset, "max_flash_sales_per_day")?;
        config.max_daily_deals = read_u8(instruction_data, offset + 1, "max_daily_deals")?;
        config.flash_sale_min_duration_secs = read_u16(instruction_data, offset + 2, "flash_sale_min_duration_secs")?;
        config.flash_sale_max_duration_secs = read_u16(instruction_data, offset + 4, "flash_sale_max_duration_secs")?;
        offset += 6;
    }

    // Update milestone thresholds (40 bytes: 5 x u64)
    if update_flags & UPDATE_MILESTONES != 0 {
        config.bronze_threshold = read_u64(instruction_data, offset, "bronze_threshold")?;
        config.silver_threshold = read_u64(instruction_data, offset + 8, "silver_threshold")?;
        config.gold_threshold = read_u64(instruction_data, offset + 16, "gold_threshold")?;
        config.platinum_threshold = read_u64(instruction_data, offset + 24, "platinum_threshold")?;
        config.diamond_threshold = read_u64(instruction_data, offset + 32, "diamond_threshold")?;
        offset += 40;
    }

    // Update milestone discount rates (10 bytes: 5 x u16)
    if update_flags & UPDATE_MILESTONE_DISCOUNTS != 0 {
        config.bronze_discount_bps = read_u16(instruction_data, offset, "bronze_discount_bps")?;
        config.silver_discount_bps = read_u16(instruction_data, offset + 2, "silver_discount_bps")?;
        config.gold_discount_bps = read_u16(instruction_data, offset + 4, "gold_discount_bps")?;
        config.platinum_discount_bps = read_u16(instruction_data, offset + 6, "platinum_discount_bps")?;
        config.diamond_discount_bps = read_u16(instruction_data, offset + 8, "diamond_discount_bps")?;
        offset += 10;
    }

    // Update streak discounts (8 bytes: 4 x u16)
    if update_flags & UPDATE_STREAK_DISCOUNTS != 0 {
        config.streak_day_2_bps = read_u16(instruction_data, offset, "streak_day_2_bps")?;
        config.streak_day_3_bps = read_u16(instruction_data, offset + 2, "streak_day_3_bps")?;
        config.streak_day_5_bps = read_u16(instruction_data, offset + 4, "streak_day_5_bps")?;
        config.streak_day_7_bps = read_u16(instruction_data, offset + 6, "streak_day_7_bps")?;
        offset += 8;
    }

    // Update SOL oracle configuration (100 bytes: 3 x Address + 2 x u16)
    if update_flags & UPDATE_SOL_ORACLE != 0 {
        let pyth_bytes = read_bytes32(instruction_data, offset, "sol_pyth_feed")?;
        let sb_bytes = read_bytes32(instruction_data, offset + 32, "sol_switchboard_feed")?;
        let queue_bytes = read_bytes32(instruction_data, offset + 64, "switchboard_queue")?;

        // `sol_pyth_feed` / `sol_switchboard_feed` are bare 32-byte feed-ids and
        // `switchboard_queue` is the Switchboard On-Demand queue pubkey — all
        // verified at purchase time, so no feed account is passed here.
        config.sol_pyth_feed = Address::from(pyth_bytes);
        config.sol_switchboard_feed = Address::from(sb_bytes);
        config.switchboard_queue = Address::from(queue_bytes);
        config.sol_max_staleness_slots = read_u16(instruction_data, offset + 96, "sol_max_staleness_slots")?;
        config.sol_confidence_threshold_bps = read_u16(instruction_data, offset + 98, "sol_confidence_threshold_bps")?;
    }

    Ok(())
}
