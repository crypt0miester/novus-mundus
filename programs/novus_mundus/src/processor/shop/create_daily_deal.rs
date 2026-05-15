use pinocchio::{
    ProgramResult,
    AccountView,
    Address,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::DAILY_DEAL_SEED,
    error::GameError,
    state::{GameEngine, DailyDealAccount},
    validation::{require_signer, require_writable, require_key_match},
    utils::{read_u8, read_u16, read_u32},
};

/// Create a daily deal slot (DAO only)
///
/// Creates a persistent DailyDealAccount for a slot (0, 1, or 2).
/// These accounts are reused daily - rotate_daily_deal updates them.
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] daily_deal: DailyDealAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - slot_index: u8 (0, 1, or 2)
/// - initial_item_id: u32
/// - initial_discount_bps: u16
/// - next_item_id: u32
/// - next_discount_bps: u16
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        payer,
        game_engine_account,
        dao_authority,
        daily_deal_account,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(daily_deal_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // slot(1) + item_id(4) + discount(2) + next_item(4) + next_discount(2) = 13
    let slot_index = read_u8(instruction_data, 0, "slot_index")?;
    let initial_item_id = read_u32(instruction_data, 1, "initial_item_id")?;
    let initial_discount_bps = read_u16(instruction_data, 5, "initial_discount_bps")?;
    let next_item_id = read_u32(instruction_data, 7, "next_item_id")?;
    let next_discount_bps = read_u16(instruction_data, 11, "next_discount_bps")?;

    // 4. Validate Data

    // Only 3 slots (0, 1, 2)
    if slot_index > 2 {
        return Err(GameError::InvalidParameter.into());
    }

    // Discount range: 15-40% (1500-4000 bps)
    if initial_discount_bps < 1500 || initial_discount_bps > 4000 {
        return Err(GameError::InvalidParameter.into());
    }
    if next_discount_bps < 1500 || next_discount_bps > 4000 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Daily Deal PDA

    let (expected_pda, bump) = DailyDealAccount::derive_pda(game_engine_account.address(), slot_index);

    if daily_deal_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Daily Deal Account

    let lamports = crate::utils::rent_exempt_const(DailyDealAccount::LEN);

    let slot_seed = [slot_index];
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        DAILY_DEAL_SEED,
        game_engine_account.address(),
        &slot_seed,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: daily_deal_account,
        lamports,
        space: DailyDealAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Daily Deal Data

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    let mut daily_deal_data_ref = daily_deal_account.try_borrow_mut()?;
    let daily_deal = unsafe { DailyDealAccount::load_mut(&mut daily_deal_data_ref) };

    daily_deal.account_key = crate::state::AccountKey::DailyDeal as u8;
    daily_deal.item_id = initial_item_id;
    daily_deal.discount_bps = initial_discount_bps;
    daily_deal._padding1 = [0; 2];
    daily_deal.started_at = now;

    daily_deal.next_item_id = next_item_id;
    daily_deal.next_discount_bps = next_discount_bps;
    daily_deal._padding2 = [0; 2];

    daily_deal.purchases_today = 0;
    daily_deal.revenue_today_lamports = 0;

    daily_deal._reserved = [0; 8];
    daily_deal.bump = bump;

    Ok(())
}
