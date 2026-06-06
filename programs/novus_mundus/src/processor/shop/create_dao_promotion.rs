use crate::{
    constants::DAO_PROMOTION_SEED,
    error::GameError,
    state::{DAOPromotionAccount, DAOPromotionStatus, GameEngine},
    utils::{read_bytes32, read_i64, read_u16, read_u64},
    validation::{require_key_match, require_signer, require_writable},
};
use pinocchio::{sysvars::Sysvar, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

/// Create a DAO promotion (DAO only, after governance vote)
///
/// Community-voted promotions with category discounts and budget limits.
/// Account is CLOSABLE - rent returns to payer after promotion ends.
///
/// # Accounts
/// - [signer, writable] payer: Pays for creation (receives rent on close)
/// - [] game_engine: GameEngine account
/// - [signer] dao_authority: DAO's authority
/// - [writable] dao_promotion: DAOPromotionAccount PDA to create
/// - [] system_program: System program
///
/// # Instruction Data
/// - proposal_id: u64 (from governance, for PDA)
/// - title: [u8; 32]
/// - equipment_discount_bps: u16
/// - consumable_discount_bps: u16
/// - material_discount_bps: u16
/// - cosmetic_discount_bps: u16
/// - global_discount_bps: u16
/// - max_discount_bps: u16
/// - starts_at: i64
/// - ends_at: i64
/// - max_discount_budget_lamports: u64
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
        dao_promotion_account,
        system_program,
    ]);

    // 2. Validate Accounts

    require_signer(payer)?;
    require_writable(payer)?;
    require_signer(dao_authority)?;
    require_writable(dao_promotion_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    // proposal_id(8) + title(32) + discounts(12) + starts(8) + ends(8) + budget(8) = 76
    let proposal_id = read_u64(instruction_data, 0, "proposal_id")?;

    let title = read_bytes32(instruction_data, 8, "title")?;

    let equipment_discount_bps = read_u16(instruction_data, 40, "equipment_discount_bps")?;
    let consumable_discount_bps = read_u16(instruction_data, 42, "consumable_discount_bps")?;
    let material_discount_bps = read_u16(instruction_data, 44, "material_discount_bps")?;
    let cosmetic_discount_bps = read_u16(instruction_data, 46, "cosmetic_discount_bps")?;
    let global_discount_bps = read_u16(instruction_data, 48, "global_discount_bps")?;
    let max_discount_bps = read_u16(instruction_data, 50, "max_discount_bps")?;

    let starts_at = read_i64(instruction_data, 52, "starts_at")?;
    let ends_at = read_i64(instruction_data, 60, "ends_at")?;
    let max_discount_budget_lamports =
        read_u64(instruction_data, 68, "max_discount_budget_lamports")?;

    // 4. Validate Data

    if ends_at <= starts_at {
        return Err(GameError::InvalidTimestamp.into());
    }

    // Cap individual discounts at 50%
    if equipment_discount_bps > 5000
        || consumable_discount_bps > 5000
        || material_discount_bps > 5000
        || cosmetic_discount_bps > 5000
        || global_discount_bps > 5000
    {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify DAO Authority

    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    if dao_authority.address() != &game_engine.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 6. Derive and Verify DAO Promotion PDA

    let (expected_pda, bump) =
        DAOPromotionAccount::derive_pda(game_engine_account.address(), proposal_id);

    if dao_promotion_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 7. Create DAO Promotion Account

    let lamports = crate::utils::rent_exempt_const(DAOPromotionAccount::LEN);

    let proposal_bytes = proposal_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(
        DAO_PROMOTION_SEED,
        game_engine_account.address(),
        &proposal_bytes,
        &bump_seed
    );
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: dao_promotion_account,
        lamports,
        space: DAOPromotionAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize DAO Promotion Data

    let clock = pinocchio::sysvars::clock::Clock::get()?;
    let now = clock.unix_timestamp;

    let mut promo_data_ref = dao_promotion_account.try_borrow_mut()?;
    let promo = unsafe { DAOPromotionAccount::load_mut(&mut promo_data_ref) };

    promo.account_key = crate::state::AccountKey::DaoPromotion as u8;
    promo.payer = *payer.address();
    promo.title = title;

    promo.equipment_discount_bps = equipment_discount_bps;
    promo.consumable_discount_bps = consumable_discount_bps;
    promo.material_discount_bps = material_discount_bps;
    promo.cosmetic_discount_bps = cosmetic_discount_bps;
    promo.global_discount_bps = global_discount_bps;
    promo.max_discount_bps = max_discount_bps;
    promo.status = DAOPromotionStatus::Approved as u8;
    promo._padding1 = [0; 3];

    promo.approved_at = now;
    promo.starts_at = starts_at;
    promo.ends_at = ends_at;

    promo.max_discount_budget_lamports = max_discount_budget_lamports;
    promo.used_discount_budget = 0;

    promo.total_purchases = 0;
    promo.total_revenue_lamports = 0;
    promo.unique_purchasers = 0;

    // Persist the proposal_id (the PDA-derivation seed)
    // so off-chain cranks can rebuild `activate_sale` 
    // for this promo without having to reverse the PDA. 
    promo.proposal_id = proposal_id.to_le_bytes();
    promo._padding2 = [0; 7];
    promo.bump = bump;

    Ok(())
}
