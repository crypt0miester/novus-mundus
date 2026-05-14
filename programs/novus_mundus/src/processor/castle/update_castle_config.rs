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
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let dao_authority = &accounts[0];
    let game_engine_account = &accounts[1];
    let castle_account = &accounts[2];

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
            // Update reward rates
            // Format: king_novi(8), king_cash(8), court_novi(8), court_cash(8), member_novi(8), member_cash(8)
            if instruction_data.len() < 49 {
                return Err(ProgramError::InvalidInstructionData);
            }

            castle.king_novi_per_day = u64::from_le_bytes([
                instruction_data[1], instruction_data[2], instruction_data[3], instruction_data[4],
                instruction_data[5], instruction_data[6], instruction_data[7], instruction_data[8],
            ]);
            castle.king_cash_per_day = u64::from_le_bytes([
                instruction_data[9], instruction_data[10], instruction_data[11], instruction_data[12],
                instruction_data[13], instruction_data[14], instruction_data[15], instruction_data[16],
            ]);
            castle.court_novi_per_day = u64::from_le_bytes([
                instruction_data[17], instruction_data[18], instruction_data[19], instruction_data[20],
                instruction_data[21], instruction_data[22], instruction_data[23], instruction_data[24],
            ]);
            castle.court_cash_per_day = u64::from_le_bytes([
                instruction_data[25], instruction_data[26], instruction_data[27], instruction_data[28],
                instruction_data[29], instruction_data[30], instruction_data[31], instruction_data[32],
            ]);
            castle.member_novi_per_day = u64::from_le_bytes([
                instruction_data[33], instruction_data[34], instruction_data[35], instruction_data[36],
                instruction_data[37], instruction_data[38], instruction_data[39], instruction_data[40],
            ]);
            castle.member_cash_per_day = u64::from_le_bytes([
                instruction_data[41], instruction_data[42], instruction_data[43], instruction_data[44],
                instruction_data[45], instruction_data[46], instruction_data[47], instruction_data[48],
            ]);
        }
        CONFIG_TIER_MULTIPLIER => {
            // Update tier multiplier (BPS)
            if instruction_data.len() < 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            castle.tier_multiplier_bps = u16::from_le_bytes([instruction_data[1], instruction_data[2]]);
        }
        CONFIG_TREASURY_LEVEL => {
            // Update treasury level
            if instruction_data.len() < 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            castle.treasury_level = instruction_data[1];
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
            if new_name.iter().filter(|&&b| b != 0).count() == 0 {
                return Err(GameError::InvalidParameter.into());
            }

            castle.name.copy_from_slice(new_name);
        }
        _ => {
            return Err(ProgramError::InvalidInstructionData);
        }
    }

    // Note: CastleAccount doesn't track last_updated_at

    Ok(())
}
