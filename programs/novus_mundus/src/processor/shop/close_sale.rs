use pinocchio::{
    ProgramResult,
    AccountView,
    error::ProgramError,
    Address,
    sysvars::Sysvar,
};
use crate::{
    error::GameError,
    helpers::close_account,
    state::{
        GameEngine, FlashSaleAccount, WeeklySaleAccount, SeasonalSaleAccount,
        DAOPromotionAccount, PlayerPurchaseAccount, ShopItemAccount,
    },
    validation::{require_signer, require_writable},
    utils::{read_u8, read_u64},
};

/// Sale account type for closing
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum SaleType {
    FlashSale = 0,
    WeeklySale = 1,
    SeasonalSale = 2,
    DAOPromotion = 3,
    PlayerPurchase = 4,
}

impl SaleType {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::FlashSale),
            1 => Some(Self::WeeklySale),
            2 => Some(Self::SeasonalSale),
            3 => Some(Self::DAOPromotion),
            4 => Some(Self::PlayerPurchase),
            _ => None,
        }
    }
}

/// Close a sale account and return rent to payer
///
/// Generic close instruction for all CLOSABLE shop accounts.
/// Returns rent-exempt lamports to the original payer.
///
/// # Accounts
/// - [signer] authority: DAO authority or original payer
/// - [] game_engine: GameEngine account
/// - [writable] sale_account: The account to close
/// - [writable] rent_recipient: Receives rent lamports (must match payer field for non-DAO)
/// - [] shop_item (optional): For PlayerPurchase, the ShopItemAccount
///
/// # Instruction Data
/// - sale_type: u8 (SaleType enum)
/// - sale_id: u64 (or item_id for PlayerPurchase)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, [
        authority,
        game_engine_account,
        sale_account,
        rent_recipient,
    ]);

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(sale_account)?;
    require_writable(rent_recipient)?;

    // 3. Parse Instruction Data

    let sale_type = SaleType::from_u8(read_u8(instruction_data, 0, "close_sale.sale_type")?)
        .ok_or(GameError::InvalidParameter)?;
    let sale_id = read_u64(instruction_data, 1, "close_sale.sale_id")?;

    // 4. Load Game Engine for Authority Check

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    let is_dao = authority.address() == &game_engine.authority;

    // 5. Validate and Close Based on Sale Type

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    match sale_type {
        SaleType::FlashSale => {
            close_flash_sale(
                program_id,
                game_engine_account.address(),
                sale_account,
                rent_recipient,
                sale_id,
                is_dao,
                now,
            )?;
        }
        SaleType::WeeklySale => {
            close_weekly_sale(
                program_id,
                game_engine_account.address(),
                sale_account,
                rent_recipient,
                sale_id,
                is_dao,
                now,
            )?;
        }
        SaleType::SeasonalSale => {
            // For seasonal, sale_id is actually event pubkey bytes
            // Simplified: just use the account directly
            close_seasonal_sale(
                program_id,
                sale_account,
                rent_recipient,
                is_dao,
            )?;
        }
        SaleType::DAOPromotion => {
            close_dao_promotion(
                program_id,
                game_engine_account.address(),
                sale_account,
                rent_recipient,
                sale_id,
                is_dao,
            )?;
        }
        SaleType::PlayerPurchase => {
            // PlayerPurchase needs the shop_item account to verify can_close
            if accounts.len() < 5 {
                return Err(ProgramError::NotEnoughAccountKeys);
            }
            let shop_item_account = &accounts[4];

            close_player_purchase(
                program_id,
                authority.address(),
                sale_account,
                rent_recipient,
                shop_item_account,
                sale_id as u32, // item_id
                is_dao,
            )?;
        }
    }

    Ok(())
}

// CLOSE IMPLEMENTATIONS

fn close_flash_sale(
    _program_id: &Address,
    game_engine: &Address,
    sale_account: &AccountView,
    rent_recipient: &AccountView,
    sale_id: u64,
    is_dao: bool,
    now: i64,
) -> ProgramResult {
    // Verify PDA
    let (expected, _) = FlashSaleAccount::derive_pda(game_engine, sale_id);
    if sale_account.address() != &expected {
        return Err(GameError::InvalidPDA.into());
    }

    // Load and verify can close
    let sale_data = sale_account.try_borrow()?;
    let flash_sale = unsafe { FlashSaleAccount::load(&sale_data) };

    // DAO can always close, otherwise check can_close
    if !is_dao {
        // Check recipient is payer
        if rent_recipient.address() != &flash_sale.payer {
            return Err(GameError::Unauthorized.into());
        }

        // Check sale ended or sold out
        if !flash_sale.can_close() && now <= flash_sale.ends_at {
            return Err(GameError::SaleNotActive.into()); // Reusing error - sale still active
        }
    }

    drop(sale_data);

    // Transfer lamports and close
    close_account(sale_account, rent_recipient)
}

fn close_weekly_sale(
    _program_id: &Address,
    game_engine: &Address,
    sale_account: &AccountView,
    rent_recipient: &AccountView,
    week_number: u64,
    is_dao: bool,
    now: i64,
) -> ProgramResult {
    let (expected, _) = WeeklySaleAccount::derive_pda(game_engine, week_number);
    if sale_account.address() != &expected {
        return Err(GameError::InvalidPDA.into());
    }

    let sale_data = sale_account.try_borrow()?;
    let weekly_sale = unsafe { WeeklySaleAccount::load(&sale_data) };

    if !is_dao {
        if rent_recipient.address() != &weekly_sale.payer {
            return Err(GameError::Unauthorized.into());
        }

        if !weekly_sale.can_close(now) {
            return Err(GameError::SaleNotActive.into());
        }
    }

    drop(sale_data);
    close_account(sale_account, rent_recipient)
}

fn close_seasonal_sale(
    _program_id: &Address,
    sale_account: &AccountView,
    rent_recipient: &AccountView,
    is_dao: bool,
) -> ProgramResult {
    // Seasonal sale PDA uses event pubkey, harder to verify here
    // Just load and check payer/status

    let sale_data = sale_account.try_borrow()?;
    let seasonal_sale = unsafe { SeasonalSaleAccount::load(&sale_data) };

    if !is_dao {
        if rent_recipient.address() != &seasonal_sale.payer {
            return Err(GameError::Unauthorized.into());
        }

        if !seasonal_sale.can_close() {
            return Err(GameError::SaleNotActive.into());
        }
    }

    drop(sale_data);
    close_account(sale_account, rent_recipient)
}

fn close_dao_promotion(
    _program_id: &Address,
    game_engine: &Address,
    sale_account: &AccountView,
    rent_recipient: &AccountView,
    proposal_id: u64,
    is_dao: bool,
) -> ProgramResult {
    let (expected, _) = DAOPromotionAccount::derive_pda(game_engine, proposal_id);
    if sale_account.address() != &expected {
        return Err(GameError::InvalidPDA.into());
    }

    let sale_data = sale_account.try_borrow()?;
    let dao_promo = unsafe { DAOPromotionAccount::load(&sale_data) };

    if !is_dao {
        if rent_recipient.address() != &dao_promo.payer {
            return Err(GameError::Unauthorized.into());
        }

        if !dao_promo.can_close() {
            return Err(GameError::SaleNotActive.into());
        }
    }

    drop(sale_data);
    close_account(sale_account, rent_recipient)
}

fn close_player_purchase(
    _program_id: &Address,
    authority: &Address,
    purchase_account: &AccountView,
    rent_recipient: &AccountView,
    shop_item_account: &AccountView,
    item_id: u32,
    is_dao: bool,
) -> ProgramResult {
    // PlayerPurchase PDA uses player pubkey
    // Authority should be the player OR DAO
    let (expected, _) = PlayerPurchaseAccount::derive_pda(authority, item_id);

    // Either the purchase account matches (authority is player)
    // Or DAO is closing it
    if purchase_account.address() != &expected && !is_dao {
        return Err(GameError::InvalidPDA.into());
    }

    // Load shop item to check can_close
    let item_data = shop_item_account.try_borrow()?;
    let shop_item = unsafe { ShopItemAccount::load(&item_data) };

    let purchase_data = purchase_account.try_borrow()?;
    let player_purchase = unsafe { PlayerPurchaseAccount::load(&purchase_data) };

    if !is_dao && !player_purchase.can_close(&shop_item) {
        return Err(GameError::Unauthorized.into());
    }

    drop(item_data);
    drop(purchase_data);

    // PlayerPurchase doesn't have a payer field - rent goes to authority
    close_account(purchase_account, rent_recipient)
}
