use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
    sysvars::Sysvar,
};
use crate::{
    error::GameError,
    state::{
        SeasonalSaleAccount, SeasonalSaleStatus,
        DAOPromotionAccount, DAOPromotionStatus,
    },
    validation::{require_signer, require_writable, require_owner},
    utils::{read_u8, read_u64, read_bytes32},
};

/// Sale type for activation
const SALE_TYPE_SEASONAL: u8 = 0;
const SALE_TYPE_DAO_PROMO: u8 = 1;

/// Activate or end a sale based on current time
///
/// Transitions sales between statuses:
/// - Seasonal: Scheduled → Active → Ended
/// - DAO Promo: Approved → Active → Ended/BudgetExhausted
///
/// Can be called by anyone (permissionless crank).
///
/// # Accounts
/// - [signer] crank: Anyone can call
/// - [] game_engine: GameEngine account
/// - [writable] sale: SeasonalSaleAccount or DAOPromotionAccount
///
/// # Instruction Data
/// - sale_type: u8 (0 = Seasonal, 1 = DAO Promo)
/// - sale_id: varies by type
///   - Seasonal: event pubkey (32 bytes)
///   - DAO Promo: proposal_id (8 bytes)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        crank,
        game_engine_account,
        sale_account,
    ]);

    // 2. Validate Accounts

    require_signer(crank)?;
    require_writable(sale_account)?;

    // 3. Parse Instruction Data

    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let sale_type = read_u8(instruction_data, 0, "sale_type")?;

    // 4. Get Current Time

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Process Based on Sale Type

    match sale_type {
        SALE_TYPE_SEASONAL => {
            activate_seasonal_sale(
                game_engine_account.address(),
                sale_account,
                instruction_data,
                now,
                program_id,
            )
        }
        SALE_TYPE_DAO_PROMO => {
            activate_dao_promotion(
                game_engine_account.address(),
                sale_account,
                instruction_data,
                now,
                program_id,
            )
        }
        _ => Err(GameError::InvalidParameter.into()),
    }
}

fn activate_seasonal_sale(
    game_engine_key: &Address,
    sale_account: &AccountView,
    instruction_data: &[u8],
    now: i64,
    program_id: &Address,
) -> ProgramResult {
    // Need event pubkey (32 bytes)
    let event_key = Address::from(read_bytes32(instruction_data, 1, "event_key")?);

    // Verify PDA
    let (expected_pda, _) = SeasonalSaleAccount::derive_pda(game_engine_key, &event_key);
    if sale_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // SeasonalSaleAccount doesn't have load_checked - verify program ownership manually
    require_owner(sale_account, program_id)?;
    // Load and update status
    let mut sale_data_ref = sale_account.try_borrow_mut()?;
    let sale = unsafe { SeasonalSaleAccount::load_mut(&mut sale_data_ref) };

    let current_status = SeasonalSaleStatus::from_u8(sale.status);

    match current_status {
        Some(SeasonalSaleStatus::Scheduled) => {
            if now >= sale.starts_at {
                sale.status = SeasonalSaleStatus::Active as u8;
            }
        }
        Some(SeasonalSaleStatus::Active) => {
            if now > sale.ends_at {
                sale.status = SeasonalSaleStatus::Ended as u8;
            }
        }
        _ => {
            // Already ended or invalid status
        }
    }

    Ok(())
}

fn activate_dao_promotion(
    game_engine_key: &Address,
    sale_account: &AccountView,
    instruction_data: &[u8],
    now: i64,
    program_id: &Address,
) -> ProgramResult {
    // Need proposal_id (8 bytes)
    let proposal_id = read_u64(instruction_data, 1, "proposal_id")?;

    // Verify PDA
    let (expected_pda, _) = DAOPromotionAccount::derive_pda(game_engine_key, proposal_id);
    if sale_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // DAOPromotionAccount doesn't have load_checked - verify program ownership manually
    require_owner(sale_account, program_id)?;
    // Load and update status
    let mut promo_data_ref = sale_account.try_borrow_mut()?;
    let promo = unsafe { DAOPromotionAccount::load_mut(&mut promo_data_ref) };

    let current_status = DAOPromotionStatus::from_u8(promo.status);

    match current_status {
        Some(DAOPromotionStatus::Approved) => {
            if now >= promo.starts_at {
                promo.status = DAOPromotionStatus::Active as u8;
            }
        }
        Some(DAOPromotionStatus::Active) => {
            if now > promo.ends_at {
                promo.status = DAOPromotionStatus::Ended as u8;
            } else if promo.used_discount_budget >= promo.max_discount_budget_lamports {
                promo.status = DAOPromotionStatus::BudgetExhausted as u8;
            }
        }
        _ => {
            // Already ended or invalid status
        }
    }

    Ok(())
}

impl SeasonalSaleStatus {
    fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Scheduled),
            1 => Some(Self::Active),
            2 => Some(Self::Ended),
            _ => None,
        }
    }
}

impl DAOPromotionStatus {
    fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Approved),
            1 => Some(Self::Active),
            2 => Some(Self::Ended),
            3 => Some(Self::BudgetExhausted),
            _ => None,
        }
    }
}
