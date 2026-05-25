use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::BUILDING_TEMPLATE_SEED,
    error::GameError,
    state::{BuildingTemplate, BuildingType, GameEngine},
    utils::{read_u16, read_u32, read_u64, read_u8},
    validation::{require_key_match, require_signer, require_writable},
};

/// Initialize a building template (DAO only)
///
/// Creates a BuildingTemplate account that defines a building type's build
/// cost and time. Only the DAO authority can call this instruction.
///
/// # Accounts
/// - [signer] dao_authority: DAO authority
/// - [writable] building_template: BuildingTemplate PDA to create
/// - [] game_engine: GameEngine (verify DAO)
/// - [] system_program
///
/// # Instruction Data (19 bytes)
/// - [0] building_type: u8 (0-18)
/// - [1] tier: u8 (1-3)
/// - [2] max_level: u8
/// - [3..7] base_time_seconds: u32
/// - [7..15] base_novi_cost: u64
/// - [15..17] cost_growth_bps: u16
/// - [17..19] time_growth_bps: u16
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [dao_authority, building_template, game_engine, system_program]);

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(building_template)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO authority
    let game_engine_data = game_engine.try_borrow()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data) };

    if dao_authority.address() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data
    if instruction_data.len() != 19 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let building_type = read_u8(instruction_data, 0, "init_building_template.building_type")?;
    let tier = read_u8(instruction_data, 1, "init_building_template.tier")?;
    let max_level = read_u8(instruction_data, 2, "init_building_template.max_level")?;
    let base_time_seconds = read_u32(
        instruction_data,
        3,
        "init_building_template.base_time_seconds",
    )?;
    let base_novi_cost = read_u64(instruction_data, 7, "init_building_template.base_novi_cost")?;
    let cost_growth_bps = read_u16(
        instruction_data,
        15,
        "init_building_template.cost_growth_bps",
    )?;
    let time_growth_bps = read_u16(
        instruction_data,
        17,
        "init_building_template.time_growth_bps",
    )?;

    // 5. Validate building type
    if building_type as usize >= BuildingType::COUNT {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Derive and verify PDA
    let (expected_template, bump) = BuildingTemplate::derive_pda(building_type);

    if building_template.address() != &expected_template {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Create BuildingTemplate account
    let lamports = crate::utils::rent_exempt_const(BuildingTemplate::LEN);

    let bump_seed = [bump];
    let building_type_seed = [building_type];
    let seeds = crate::seeds!(BUILDING_TEMPLATE_SEED, &building_type_seed, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: building_template,
        lamports,
        space: BuildingTemplate::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 8. Initialize template data
    let mut template_data = building_template.try_borrow_mut()?;
    let template = unsafe { BuildingTemplate::load_mut(&mut template_data) };

    template.account_key = crate::state::AccountKey::BuildingTemplate as u8;
    template.building_type = building_type;
    template.tier = tier;
    template.max_level = max_level;
    template.base_time_seconds = base_time_seconds;
    template.base_novi_cost = base_novi_cost;
    template.cost_growth_bps = cost_growth_bps;
    template.time_growth_bps = time_growth_bps;
    template.is_active = true;
    template.bump = bump;
    template._padding = [0; 10];

    Ok(())
}
