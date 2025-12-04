use pinocchio::{
    ProgramResult,
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use crate::{
    constants::BUNDLE_SEED,
    error::GameError,
    state::{GameEngine, BundleAccount, BundleItem, BundleTier, ShopCategory, MAX_BUNDLE_ITEMS},
    validation::{require_signer, require_writable, require_key_match},
};

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
/// - price_novi: u64
/// - available_from: i64
/// - available_until: i64
/// - is_active: bool
/// - items: [(item_id: u32, quantity: u32)] * item_count
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        payer,
        game_engine_account,
        dao_authority,
        bundle_account,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(bundle_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // Header: bundle_id(4) + tier(1) + category(1) + item_count(1) + req_sub(1) +
    //         savings(2) + sol(8) + novi(8) + from(8) + until(8) + active(1) = 43 bytes
    if instruction_data.len() < 43 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let bundle_id = u32::from_le_bytes(instruction_data[0..4].try_into().unwrap());
    let tier = instruction_data[4];
    let category = instruction_data[5];
    let item_count = instruction_data[6] as usize;
    let requires_subscription = instruction_data[7];
    let savings_bps = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());
    let price_sol_lamports = u64::from_le_bytes(instruction_data[10..18].try_into().unwrap());
    let price_novi = u64::from_le_bytes(instruction_data[18..26].try_into().unwrap());
    let available_from = i64::from_le_bytes(instruction_data[26..34].try_into().unwrap());
    let available_until = i64::from_le_bytes(instruction_data[34..42].try_into().unwrap());
    let is_active = instruction_data[42] != 0;

    // Parse items (8 bytes each: item_id(4) + quantity(4))
    let items_offset = 43;
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

    // Must have at least one price
    if price_sol_lamports == 0 && price_novi == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    if dao_authority.key() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify Bundle PDA

    let (expected_bundle, bump) = BundleAccount::derive_pda(game_engine_account.key(), bundle_id);

    if bundle_account.key() != &expected_bundle {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create Bundle Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(BundleAccount::LEN);

    let bundle_id_bytes = bundle_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(
        BUNDLE_SEED,
        game_engine_account.key().as_ref(),
        &bundle_id_bytes,
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: bundle_account,
        lamports,
        space: BundleAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize Bundle Data

    let mut bundle_data_ref = bundle_account.try_borrow_mut_data()?;
    let bundle = unsafe { BundleAccount::load_mut(&mut bundle_data_ref) };

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
            let item_id = u32::from_le_bytes(
                instruction_data[item_offset..item_offset + 4].try_into().unwrap()
            );
            let quantity = u32::from_le_bytes(
                instruction_data[item_offset + 4..item_offset + 8].try_into().unwrap()
            );

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
    bundle.price_novi = price_novi;

    bundle.available_from = available_from;
    bundle.available_until = available_until;

    bundle.total_purchases = 0;
    bundle.total_revenue_lamports = 0;

    bundle._reserved = [0; 8];
    bundle._padding2 = [0; 7];
    bundle.bump = bump;

    Ok(())
}
