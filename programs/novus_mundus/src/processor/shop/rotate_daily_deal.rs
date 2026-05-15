use pinocchio::{
    ProgramResult,
    AccountView,
    Address,
    sysvars::Sysvar,
};
use crate::{
    error::GameError,
    state::{GameEngine, DailyDealAccount},
    validation::{require_signer, require_writable},
    utils::{read_u8, read_u16, read_u32},
};

/// Rotate daily deal to next day (DAO or crank)
///
/// Moves next→current, sets new next deal, resets daily stats.
/// Can be called by DAO or any authorized crank.
///
/// # Accounts
/// - [signer] authority: DAO authority or crank
/// - [] game_engine: GameEngine account
/// - [writable] daily_deal: DailyDealAccount to rotate
///
/// # Instruction Data
/// - slot_index: u8 (for PDA verification)
/// - new_next_item_id: u32
/// - new_next_discount_bps: u16
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        authority,
        game_engine_account,
        daily_deal_account,
    ]);

    // 2. Validate Accounts

    require_signer(authority)?;
    require_writable(daily_deal_account)?;

    // 3. Parse Instruction Data

    // slot(1) + next_item(4) + next_discount(2) = 7
    let slot_index = read_u8(instruction_data, 0, "slot_index")?;
    let new_next_item_id = read_u32(instruction_data, 1, "new_next_item_id")?;
    let new_next_discount_bps = read_u16(instruction_data, 5, "new_next_discount_bps")?;

    // 4. Validate Data

    if slot_index > 2 {
        return Err(GameError::InvalidParameter.into());
    }

    // Discount range: 15-40%
    if new_next_discount_bps < 1500 || new_next_discount_bps > 4000 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify Authority (DAO or crank)

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Must be DAO authority (could extend to allow cranks in future)
    if authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Verify PDA

    let (expected_pda, _) = DailyDealAccount::derive_pda(game_engine_account.address(), slot_index);
    if daily_deal_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Rotate Deal

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    let mut daily_deal_data_ref = daily_deal_account.try_borrow_mut()?;
    let daily_deal = unsafe { DailyDealAccount::load_mut(&mut daily_deal_data_ref) };

    // Check if 24 hours have passed (optional - DAO can force rotate)
    // let day_seconds = 86400;
    // if now - daily_deal.started_at < day_seconds {
    //     return Err(GameError::InvalidTimestamp.into());
    // }

    // Move next → current
    daily_deal.item_id = daily_deal.next_item_id;
    daily_deal.discount_bps = daily_deal.next_discount_bps;
    daily_deal.started_at = now;

    // Set new next
    daily_deal.next_item_id = new_next_item_id;
    daily_deal.next_discount_bps = new_next_discount_bps;

    // Reset daily stats
    daily_deal.purchases_today = 0;
    daily_deal.revenue_today_lamports = 0;

    Ok(())
}
