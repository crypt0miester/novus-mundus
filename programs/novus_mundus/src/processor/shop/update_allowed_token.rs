use pinocchio::{
    ProgramResult,
    AccountView,
    Address,
};
use crate::{
    error::GameError,
    state::{GameEngine, AllowedTokenAccount},
    validation::{require_signer, require_writable, require_owner},
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
    /// Flip the stablecoin peg: 0 = oracle path, 1 = $1-pegged (USDC/USDT/PYUSD).
    /// When flipping to 1, the chain validates mint decimals are in [2, 12].
    PeggedToUsd = 5,
}

impl AllowedTokenUpdateField {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::PythFeed),
            1 => Some(Self::SwitchboardFeed),
            2 => Some(Self::MaxStalenessSlots),
            3 => Some(Self::ConfidenceThresholdBps),
            4 => Some(Self::DiscountBps),
            5 => Some(Self::PeggedToUsd),
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
/// `PythFeed` / `SwitchboardFeed` are bare 32-byte feed-ids — no feed account
/// is passed; both are verified at purchase time.
///
/// # Instruction Data
/// - field: u8 (AllowedTokenUpdateField enum)
/// - value: varies by field type
///   - PythFeed / SwitchboardFeed: 32 bytes (feed id)
///   - MaxStalenessSlots/ConfidenceThresholdBps/DiscountBps: u16 (2 bytes)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (4 required + 0–1 optional feed-validation slot)

    crate::extract_accounts!(accounts, [
        authority,
        game_engine_account,
        allowed_token_account,
        token_mint,
    ]);

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
            // A Pyth feed is a bare 32-byte feed-id (no account to validate);
            // it is verified against the PriceUpdateV2 account at purchase time.
            let new_pyth_feed = read_bytes32(instruction_data, 1, "pyth_feed")?;
            allowed_token.pyth_feed = Address::from(new_pyth_feed);
        }
        AllowedTokenUpdateField::SwitchboardFeed => {
            // A Switchboard feed is a bare 32-byte OracleQuote feed-id (no
            // account to validate); it is matched against the verified quote
            // at purchase time.
            let new_sb_feed = read_bytes32(instruction_data, 1, "switchboard_feed")?;
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
        AllowedTokenUpdateField::PeggedToUsd => {
            let new_flag = read_u8(instruction_data, 1, "pegged_to_usd")?;
            if new_flag > 1 {
                return Err(GameError::InvalidParameter.into());
            }
            if new_flag == 1 {
                // Validate mint decimals are scalable: `cost_usd_cents × 10^(d-2)`
                // requires d >= 2; cap at 12 to keep the multiply safe in u64.
                let mint_data = token_mint.try_borrow()?;
                let decimals = crate::helpers::read_token_decimals(&mint_data)?;
                if decimals < 2 || decimals > 12 {
                    return Err(GameError::InvalidParameter.into());
                }
            }
            allowed_token.pegged_to_usd = new_flag;
        }
    }

    Ok(())
}
