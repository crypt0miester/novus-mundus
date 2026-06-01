use crate::{
    constants::BUNDLE_SEED,
    error::GameError,
    state::{BundleAccount, BundleItem, BundleTier, GameEngine, ShopCategory, MAX_BUNDLE_ITEMS},
    utils::{read_i64, read_u16, read_u32, read_u64, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Hard ceiling on a bundle's advertised savings, mirroring the shop config's
/// `max_total_discount_bps` (75%). `savings_bps` is display-only (the price is
/// set explicitly), so this just stops a nonsensical ">75% off" claim — or a
/// >100% value — from being written to the account.
const MAX_BUNDLE_SAVINGS_BPS: u16 = 7500;

/// Create a bundle (DAO only)
///
/// Creates a pre-built bundle of items with bundled pricing.
///
/// # Accounts
/// - [signer, writable] payer: Pays for account creation
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] bundle: BundleAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - bundle_id: u32
/// - tier: u8
/// - category: u8
/// - item_count: u8
/// - requires_subscription: u8
/// - savings_bps: u16
/// - price_sol_lamports: u64
/// - available_from: i64
/// - available_until: i64
/// - is_active: bool
/// - items: [(item_id: u32, quantity: u32)] * item_count
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
        bundle_account,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(bundle_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // Header: bundle_id(4) + tier(1) + category(1) + item_count(1) + req_sub(1) +
    //         savings(2) + sol(8) + from(8) + until(8) + active(1) = 35 bytes
    let bundle_id = read_u32(instruction_data, 0, "bundle_id")?;
    let tier = read_u8(instruction_data, 4, "tier")?;
    let category = read_u8(instruction_data, 5, "category")?;
    let item_count = read_u8(instruction_data, 6, "item_count")? as usize;
    let requires_subscription = read_u8(instruction_data, 7, "requires_subscription")?;
    let savings_bps = read_u16(instruction_data, 8, "savings_bps")?;
    let price_sol_lamports = read_u64(instruction_data, 10, "price_sol_lamports")?;
    let available_from = read_i64(instruction_data, 18, "available_from")?;
    let available_until = read_i64(instruction_data, 26, "available_until")?;
    let is_active = read_u8(instruction_data, 34, "is_active")? != 0;

    // Parse items (8 bytes each: item_id(4) + quantity(4))
    let items_offset = 35;
    let items_size = item_count * 8;

    if instruction_data.len() < items_offset + items_size {
        return Err(ProgramError::InvalidInstructionData);
    }

    // 4. Validate Data

    // Validate tier
    BundleTier::from_u8(tier).ok_or(GameError::InvalidParameter)?;

    // Validate category
    ShopCategory::from_u8(category).ok_or(GameError::InvalidParameter)?;

    // Validate item count (2-10)
    if item_count < 2 || item_count > MAX_BUNDLE_ITEMS {
        return Err(GameError::InvalidParameter.into());
    }

    // Validate subscription tier (0-4)
    if requires_subscription > 4 {
        return Err(GameError::InvalidParameter.into());
    }

    // Cap advertised savings so a bad seed can't store a nonsensical discount
    if savings_bps > MAX_BUNDLE_SAVINGS_BPS {
        return Err(GameError::InvalidParameter.into());
    }

    // Must have SOL price (bundles are SOL only)
    if price_sol_lamports == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Bundle PDA

    let (expected_bundle, bump) =
        BundleAccount::derive_pda(game_engine_account.address(), bundle_id);

    if bundle_account.address() != &expected_bundle {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Bundle Account

    let lamports = crate::utils::rent_exempt_const(BundleAccount::LEN);

    let bundle_id_bytes = bundle_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        BUNDLE_SEED,
        game_engine_account.address(),
        &bundle_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: bundle_account,
        lamports,
        space: BundleAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize Bundle Data

    let mut bundle_data_ref = bundle_account.try_borrow_mut()?;
    let bundle = unsafe { BundleAccount::load_mut(&mut bundle_data_ref) };

    bundle.account_key = crate::state::AccountKey::ShopBundle as u8;
    bundle.tier = tier;
    bundle.category = category;
    bundle.item_count = item_count as u8;
    bundle.requires_subscription = requires_subscription;
    bundle.savings_bps = savings_bps;
    bundle.is_active = is_active;
    bundle._padding = 0;

    // Parse and store items
    for i in 0..MAX_BUNDLE_ITEMS {
        if i < item_count {
            let item_offset = items_offset + (i * 8);
            let item_id = read_u32(instruction_data, item_offset, "item_id")?;
            let quantity = read_u32(instruction_data, item_offset + 4, "quantity")?;

            // Validate quantity > 0
            if quantity == 0 {
                return Err(GameError::InvalidParameter.into());
            }

            bundle.items[i] = BundleItem { item_id, quantity };
        } else {
            bundle.items[i] = BundleItem::default();
        }
    }

    bundle.price_sol_lamports = price_sol_lamports;

    bundle.available_from = available_from;
    bundle.available_until = available_until;

    bundle.total_purchases = 0;
    bundle.total_revenue_lamports = 0;

    bundle._reserved = [0; 8];
    bundle._padding2 = [0; 7];
    bundle.bump = bump;

    Ok(())
}
