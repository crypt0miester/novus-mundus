use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::{
    error::GameError,
    state::{GameEngine, AllowedTokenAccount},
    validation::{require_signer, require_writable, require_owner},
};

/// Update field types for AllowedTokenAccount
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AllowedTokenUpdateField {
    PythFeed = 0,
    SwitchboardFeed = 1,
    MaxStalenessSlots = 2,
    ConfidenceThresholdBps = 3,
    DiscountBps = 4,
}

impl AllowedTokenUpdateField {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::PythFeed),
            1 => Some(Self::SwitchboardFeed),
            2 => Some(Self::MaxStalenessSlots),
            3 => Some(Self::ConfidenceThresholdBps),
            4 => Some(Self::DiscountBps),
            _ => None,
        }
    }
}

/// Update an AllowedToken account (DAO only)
///
/// Updates a single field of an existing AllowedTokenAccount.
///
/// # Accounts
/// - [signer] authority: DAO authority (game_engine.authority)
/// - [] game_engine: GameEngine account
/// - [writable] allowed_token: Existing AllowedTokenAccount
/// - [] token_mint: The SPL token mint (for PDA verification)
///
/// # Instruction Data
/// - field: u8 (AllowedTokenUpdateField enum)
/// - value: varies by field type
///   - PythFeed/SwitchboardFeed: Pubkey (32 bytes)
///   - MaxStalenessSlots/ConfidenceThresholdBps/DiscountBps: u16 (2 bytes)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        authority,
        game_engine_account,
        allowed_token_account,
        token_mint,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(allowed_token_account)?;

    // 3. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify AllowedToken Account

    require_owner(allowed_token_account, program_id)?;

    // Verify PDA matches
    let (expected_pda, _) = AllowedTokenAccount::derive_pda(
        game_engine_account.key(),
        token_mint.key(),
    );

    if allowed_token_account.key() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Parse Instruction Data

    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let field = AllowedTokenUpdateField::from_u8(instruction_data[0])
        .ok_or(GameError::InvalidParameter)?;

    // 6. Load and Update

    let mut data_ref = allowed_token_account.try_borrow_mut_data()?;
    let allowed_token = unsafe { AllowedTokenAccount::load_mut(&mut data_ref) };

    match field {
        AllowedTokenUpdateField::PythFeed => {
            if instruction_data.len() < 33 {
                return Err(ProgramError::InvalidInstructionData);
            }
            allowed_token.pyth_feed = Pubkey::from(
                <[u8; 32]>::try_from(&instruction_data[1..33]).unwrap()
            );
        }
        AllowedTokenUpdateField::SwitchboardFeed => {
            if instruction_data.len() < 33 {
                return Err(ProgramError::InvalidInstructionData);
            }
            allowed_token.switchboard_feed = Pubkey::from(
                <[u8; 32]>::try_from(&instruction_data[1..33]).unwrap()
            );
        }
        AllowedTokenUpdateField::MaxStalenessSlots => {
            if instruction_data.len() < 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            allowed_token.max_staleness_slots = u16::from_le_bytes(
                [instruction_data[1], instruction_data[2]]
            );
        }
        AllowedTokenUpdateField::ConfidenceThresholdBps => {
            if instruction_data.len() < 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            allowed_token.confidence_threshold_bps = u16::from_le_bytes(
                [instruction_data[1], instruction_data[2]]
            );
        }
        AllowedTokenUpdateField::DiscountBps => {
            if instruction_data.len() < 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let discount = u16::from_le_bytes([instruction_data[1], instruction_data[2]]);
            if discount > 10000 {
                return Err(GameError::InvalidParameter.into());
            }
            allowed_token.discount_bps = discount;
        }
    }

    Ok(())
}
