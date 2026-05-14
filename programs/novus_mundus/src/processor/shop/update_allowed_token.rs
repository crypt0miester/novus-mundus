use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
};
use crate::{
    error::GameError,
    state::{GameEngine, AllowedTokenAccount},
    validation::{require_signer, require_writable, require_owner},
    helpers::{consume_optional_feed_slot, OracleType},
    utils::{read_bytes32, read_u16, read_u8},
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
/// # Accounts (base — 4)
/// - [signer] authority: DAO authority (game_engine.authority)
/// - [] game_engine: GameEngine account
/// - [writable] allowed_token: Existing AllowedTokenAccount
/// - [] token_mint: The SPL token mint (for PDA verification)
///
/// # Accounts (conditional)
/// - [] oracle_feed_account: Required iff `field == PythFeed | SwitchboardFeed`
///   AND the new pubkey in instruction data is non-zero. Owner-checked +
///   layout-validated against the target oracle type.
///
/// # Instruction Data
/// - field: u8 (AllowedTokenUpdateField enum)
/// - value: varies by field type
///   - PythFeed/SwitchboardFeed: Address (32 bytes)
///   - MaxStalenessSlots/ConfidenceThresholdBps/DiscountBps: u16 (2 bytes)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (4 required + 0–1 optional feed-validation slot)

    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let authority = &accounts[0];
    let game_engine_account = &accounts[1];
    let allowed_token_account = &accounts[2];
    let token_mint = &accounts[3];

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(allowed_token_account)?;

    // 3. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Verify AllowedToken Account

    require_owner(allowed_token_account, program_id)?;

    // Verify PDA matches
    let (expected_pda, _) = AllowedTokenAccount::derive_pda(
        game_engine_account.address(),
        token_mint.address(),
    );

    if allowed_token_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 5. Parse Instruction Data

    let field = AllowedTokenUpdateField::from_u8(
        read_u8(instruction_data, 0, "update_allowed_token.field")?
    ).ok_or(GameError::InvalidParameter)?;

    // 6. Load and Update

    let mut data_ref = allowed_token_account.try_borrow_mut()?;
    let allowed_token = unsafe { AllowedTokenAccount::load_mut(&mut data_ref) };

    match field {
        AllowedTokenUpdateField::PythFeed => {
            let new_pyth_feed = read_bytes32(instruction_data, 1, "pyth_feed")?;
            // Non-zero → require feed account in slot 4 and validate it.
            // Zero clears the feed and consumes no slot.
            consume_optional_feed_slot(accounts, 4, &new_pyth_feed, OracleType::Pyth)?;
            allowed_token.pyth_feed = Address::from(new_pyth_feed);
        }
        AllowedTokenUpdateField::SwitchboardFeed => {
            let new_sb_feed = read_bytes32(instruction_data, 1, "switchboard_feed")?;
            consume_optional_feed_slot(accounts, 4, &new_sb_feed, OracleType::Switchboard)?;
            allowed_token.switchboard_feed = Address::from(new_sb_feed);
        }
        AllowedTokenUpdateField::MaxStalenessSlots => {
            allowed_token.max_staleness_slots =
                read_u16(instruction_data, 1, "max_staleness_slots")?;
        }
        AllowedTokenUpdateField::ConfidenceThresholdBps => {
            allowed_token.confidence_threshold_bps =
                read_u16(instruction_data, 1, "confidence_threshold_bps")?;
        }
        AllowedTokenUpdateField::DiscountBps => {
            let discount = read_u16(instruction_data, 1, "discount_bps")?;
            if discount > 5000 {
                return Err(GameError::InvalidParameter.into());
            }
            allowed_token.discount_bps = discount;
        }
    }

    Ok(())
}
