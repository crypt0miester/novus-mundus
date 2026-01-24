use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    error::GameError,
    state::{GameEngine, ShopConfigAccount},
    validation::{require_signer, require_writable},
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
/// # Accounts
/// - [signer] dao_authority: DAO's authority
/// - [] game_engine: GameEngine account
/// - [writable] shop_config: ShopConfigAccount to update
///
/// # Instruction Data
/// - update_flags: u8 (bitmask)
/// - [conditional fields based on flags]
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        dao_authority,
        game_engine_account,
        shop_config_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(dao_authority)?;
    require_writable(shop_config_account)?;

    // 3. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify PDA

    let (expected_pda, _) = ShopConfigAccount::derive_pda(game_engine_account.key());
    if shop_config_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Parse and Apply Updates

    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let update_flags = instruction_data[0];
    let mut offset = 1usize;

    let mut config_data_ref = shop_config_account.try_borrow_mut_data()?;
    let config = unsafe { ShopConfigAccount::load_mut(&mut config_data_ref) };

    // Update discount caps (8 bytes: 4 x u16)
    if update_flags & UPDATE_DISCOUNT_CAPS != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        config.max_base_discount_bps = u16::from_le_bytes(
            instruction_data[offset..offset + 2].try_into().unwrap()
        );
        config.max_bundle_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 2..offset + 4].try_into().unwrap()
        );
        config.max_fib_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 4..offset + 6].try_into().unwrap()
        );
        config.max_total_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 6..offset + 8].try_into().unwrap()
        );
        offset += 8;
    }

    // Update sale limits (6 bytes)
    if update_flags & UPDATE_SALE_LIMITS != 0 {
        if instruction_data.len() < offset + 6 {
            return Err(ProgramError::InvalidInstructionData);
        }
        config.max_flash_sales_per_day = instruction_data[offset];
        config.max_daily_deals = instruction_data[offset + 1];
        config.flash_sale_min_duration_secs = u16::from_le_bytes(
            instruction_data[offset + 2..offset + 4].try_into().unwrap()
        );
        config.flash_sale_max_duration_secs = u16::from_le_bytes(
            instruction_data[offset + 4..offset + 6].try_into().unwrap()
        );
        offset += 6;
    }

    // Update milestone thresholds (40 bytes: 5 x u64)
    if update_flags & UPDATE_MILESTONES != 0 {
        if instruction_data.len() < offset + 40 {
            return Err(ProgramError::InvalidInstructionData);
        }
        config.bronze_threshold = u64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        config.silver_threshold = u64::from_le_bytes(
            instruction_data[offset + 8..offset + 16].try_into().unwrap()
        );
        config.gold_threshold = u64::from_le_bytes(
            instruction_data[offset + 16..offset + 24].try_into().unwrap()
        );
        config.platinum_threshold = u64::from_le_bytes(
            instruction_data[offset + 24..offset + 32].try_into().unwrap()
        );
        config.diamond_threshold = u64::from_le_bytes(
            instruction_data[offset + 32..offset + 40].try_into().unwrap()
        );
        offset += 40;
    }

    // Update milestone discount rates (10 bytes: 5 x u16)
    if update_flags & UPDATE_MILESTONE_DISCOUNTS != 0 {
        if instruction_data.len() < offset + 10 {
            return Err(ProgramError::InvalidInstructionData);
        }
        config.bronze_discount_bps = u16::from_le_bytes(
            instruction_data[offset..offset + 2].try_into().unwrap()
        );
        config.silver_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 2..offset + 4].try_into().unwrap()
        );
        config.gold_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 4..offset + 6].try_into().unwrap()
        );
        config.platinum_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 6..offset + 8].try_into().unwrap()
        );
        config.diamond_discount_bps = u16::from_le_bytes(
            instruction_data[offset + 8..offset + 10].try_into().unwrap()
        );
        offset += 10;
    }

    // Update streak discounts (8 bytes: 4 x u16)
    if update_flags & UPDATE_STREAK_DISCOUNTS != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        config.streak_day_2_bps = u16::from_le_bytes(
            instruction_data[offset..offset + 2].try_into().unwrap()
        );
        config.streak_day_3_bps = u16::from_le_bytes(
            instruction_data[offset + 2..offset + 4].try_into().unwrap()
        );
        config.streak_day_5_bps = u16::from_le_bytes(
            instruction_data[offset + 4..offset + 6].try_into().unwrap()
        );
        config.streak_day_7_bps = u16::from_le_bytes(
            instruction_data[offset + 6..offset + 8].try_into().unwrap()
        );
        offset += 8;
    }

    // Update SOL oracle configuration (68 bytes: 2 x Pubkey + 2 x u16)
    if update_flags & UPDATE_SOL_ORACLE != 0 {
        if instruction_data.len() < offset + 68 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let pyth_bytes: [u8; 32] = instruction_data[offset..offset + 32].try_into().unwrap();
        config.sol_pyth_feed = Pubkey::from(pyth_bytes);

        let sb_bytes: [u8; 32] = instruction_data[offset + 32..offset + 64].try_into().unwrap();
        config.sol_switchboard_feed = Pubkey::from(sb_bytes);

        config.sol_max_staleness_slots = u16::from_le_bytes(
            instruction_data[offset + 64..offset + 66].try_into().unwrap()
        );
        config.sol_confidence_threshold_bps = u16::from_le_bytes(
            instruction_data[offset + 66..offset + 68].try_into().unwrap()
        );
        // offset += 68;
    }

    Ok(())
}
