use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    error::GameError,
    state::{GameEngine, BundleAccount},
    validation::{require_signer, require_writable},
};

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
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        dao_authority,
        game_engine_account,
        bundle_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(dao_authority)?;
    require_writable(bundle_account)?;

    // 3. Parse Instruction Data Header

    if instruction_data.len() < 5 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let bundle_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let update_flags = instruction_data[4];

    // 4. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Verify PDA

    let (expected_pda, _) = BundleAccount::derive_pda(game_engine_account.key(), bundle_id);
    if bundle_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Load and Update Bundle

    let mut bundle_data_ref = bundle_account.try_borrow_mut_data()?;
    let bundle = unsafe { BundleAccount::load_mut(&mut bundle_data_ref) };

    let mut offset = 5usize;

    if update_flags & UPDATE_PRICE_SOL != 0 {
        if instruction_data.len() < offset + 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.price_sol_lamports = u64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        offset += 8;
    }

    if update_flags & UPDATE_IS_ACTIVE != 0 {
        if instruction_data.len() < offset + 1 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.is_active = instruction_data[offset] != 0;
        offset += 1;
    }

    if update_flags & UPDATE_AVAILABILITY != 0 {
        if instruction_data.len() < offset + 16 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.available_from = i64::from_le_bytes(
            instruction_data[offset..offset + 8].try_into().unwrap()
        );
        bundle.available_until = i64::from_le_bytes(
            instruction_data[offset + 8..offset + 16].try_into().unwrap()
        );
        offset += 16;
    }

    if update_flags & UPDATE_SAVINGS_BPS != 0 {
        if instruction_data.len() < offset + 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        bundle.savings_bps = u16::from_le_bytes(
            instruction_data[offset..offset + 2].try_into().unwrap()
        );
        // offset += 2;
    }

    Ok(())
}
