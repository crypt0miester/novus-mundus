use crate::{
    error::GameError,
    state::{BundleAccount, GameEngine},
    utils::{read_i64, read_u16, read_u32, read_u64, read_u8},
    validation::{require_signer, require_writable},
};
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

/// Update field flags
pub const UPDATE_PRICE_SOL: u8 = 1;
pub const UPDATE_IS_ACTIVE: u8 = 2;
pub const UPDATE_AVAILABILITY: u8 = 4;
pub const UPDATE_SAVINGS_BPS: u8 = 8;

/// Update a bundle (DAO only)
///
/// Allows modifying prices, availability, and active status of bundles.
///
/// # Accounts
/// - [signer] dao_authority: DAO's authority
/// - [] game_engine: GameEngine account
/// - [writable] bundle: BundleAccount to update
///
/// # Instruction Data
/// - bundle_id: u32 (for PDA verification)
/// - update_flags: u8 (bitmask)
/// - price_sol_lamports: u64 (if flag set)
/// - is_active: u8 (if flag set)
/// - available_from: i64 (if availability flag)
/// - available_until: i64 (if availability flag)
/// - savings_bps: u16 (if flag set)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        dao_authority,
        game_engine_account,
        bundle_account,
    ]);

    // 2. Validate Accounts

    require_signer(dao_authority)?;
    require_writable(bundle_account)?;

    // 3. Parse Instruction Data Header

    let bundle_id = read_u32(instruction_data, 0, "bundle_id")?;
    let update_flags = read_u8(instruction_data, 4, "update_flags")?;

    // 4. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Verify PDA

    let (expected_pda, _) = BundleAccount::derive_pda(game_engine_account.address(), bundle_id);
    if bundle_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Load and Update Bundle

    let mut bundle_data_ref = bundle_account.try_borrow_mut()?;
    let bundle = unsafe { BundleAccount::load_mut(&mut bundle_data_ref) };

    let mut offset = 5usize;

    if update_flags & UPDATE_PRICE_SOL != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.price_sol_lamports = read_u64(instruction_data, offset, "price_sol_lamports")?;
        offset += 8;
    }

    if update_flags & UPDATE_IS_ACTIVE != 0 {
        if instruction_data.len() < offset + 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.is_active = read_u8(instruction_data, offset, "is_active")? != 0;
        offset += 1;
    }

    if update_flags & UPDATE_AVAILABILITY != 0 {
        if instruction_data.len() < offset + 16 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.available_from = read_i64(instruction_data, offset, "available_from")?;
        bundle.available_until = read_i64(instruction_data, offset + 8, "available_until")?;
        offset += 16;
    }

    if update_flags & UPDATE_SAVINGS_BPS != 0 {
        if instruction_data.len() < offset + 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.savings_bps = read_u16(instruction_data, offset, "savings_bps")?;
        // offset += 2;
    }

    Ok(())
}
