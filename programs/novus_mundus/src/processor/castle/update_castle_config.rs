//! Update Castle Config - DAO updates castle configuration
//!
//! Instruction 286
//!
//! DAO-only instruction to update castle configuration parameters
//! such as reward rates, upgrade costs, and other settings.

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{CastleAccount, GameEngine},
    utils::{read_u8, read_u16, read_u64},
};

/// Update Castle Config instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - config_type: u8 (bytes 6) - what to update
/// - values: variable (bytes 7+) - new values

/// Config types:
const CONFIG_REWARD_RATES: u8 = 0;
const CONFIG_TIER_MULTIPLIER: u8 = 1;
const CONFIG_TREASURY_LEVEL: u8 = 2;
const CONFIG_NAME: u8 = 3;

/// Accounts:
/// 0. [signer] DAO authority
/// 1. [] Game engine account
/// 2. [writable] Castle account

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [
        dao_authority,
        game_engine_account,
        castle_account,
    ]);

    // Verify signer
    if !dao_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load and verify game engine (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Verify DAO authority
    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::Unauthorized.into());
    }

    // Parse instruction data (city_id/castle_id from account)
    if instruction_data.len() < 1 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let config_type = instruction_data[0];

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    match config_type {
        CONFIG_REWARD_RATES => {
            // 6 consecutive u64 reward rates starting at byte 1. Each read_u64
            // bounds-checks its own slice, so a short buffer fails cleanly.
            castle.king_novi_per_day   = read_u64(instruction_data, 1,  "king_novi")?;
            castle.king_cash_per_day   = read_u64(instruction_data, 9,  "king_cash")?;
            castle.court_novi_per_day  = read_u64(instruction_data, 17, "court_novi")?;
            castle.court_cash_per_day  = read_u64(instruction_data, 25, "court_cash")?;
            castle.member_novi_per_day = read_u64(instruction_data, 33, "member_novi")?;
            castle.member_cash_per_day = read_u64(instruction_data, 41, "member_cash")?;
        }
        CONFIG_TIER_MULTIPLIER => {
            castle.tier_multiplier_bps = read_u16(instruction_data, 1, "tier_multiplier")?;
        }
        CONFIG_TREASURY_LEVEL => {
            castle.treasury_level = read_u8(instruction_data, 1, "treasury_level")?;
        }
        CONFIG_NAME => {
            // Update castle name (CastleAccount::name is [u8; 32])
            const NAME_LEN: usize = 32;
            if instruction_data.len() < 1 + NAME_LEN {
                return Err(ProgramError::InvalidInstructionData);
            }
            let new_name = &instruction_data[1..1 + NAME_LEN];

            // Validate UTF-8 and non-empty (after stripping null padding)
            core::str::from_utf8(new_name).map_err(|_| GameError::InvalidParameter)?;
            // Length is everything up to the first null byte (or full slice if none).
            let new_name_len = new_name.iter().position(|&b| b == 0).unwrap_or(NAME_LEN);
            if new_name_len == 0 {
                return Err(GameError::InvalidParameter.into());
            }

            castle.name.copy_from_slice(new_name);
            castle.name_len = new_name_len as u8;
        }
        _ => {
            return Err(ProgramError::InvalidInstructionData);
        }
    }

    // Note: CastleAccount doesn't track last_updated_at

    Ok(())
}
