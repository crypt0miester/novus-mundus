use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::{
    error::GameError,
    state::{AccountKey, BuildingTemplate, GameEngine},
    utils::{read_u16, read_u32, read_u64, read_u8},
    validation::{require_owner, require_signer, require_writable},
};

/// Update a building template (DAO only)
///
/// DAO can retune build cost, time, growth factors, and active state.
///
/// # Accounts
/// - [signer] dao_authority: DAO authority
/// - [writable] building_template: BuildingTemplate PDA
/// - [] game_engine: GameEngine (verify DAO)
///
/// # Instruction Data
/// - [0] field_to_update: u8
///   - 0: base_time_seconds (u32)
///   - 1: base_novi_cost (u64)
///   - 2: cost_growth_bps (u16)
///   - 3: time_growth_bps (u16)
///   - 4: is_active (bool)
///   - 5: max_level (u8)
///   - 6: tier (u8)
/// - [1..] new_value (size depends on field)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [dao_authority, building_template, game_engine]);

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(building_template)?;
    require_owner(building_template, program_id)?;

    // 3. Verify DAO authority
    let game_engine_state = GameEngine::load_checked_by_key(game_engine, program_id)?;

    if dao_authority.address() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data
    let field_to_update = read_u8(instruction_data, 0, "update_building_template.field")?;

    // 5. Load template + verify it is a genuine BuildingTemplate at its own PDA
    let mut template_data = building_template.try_borrow_mut()?;
    AccountKey::validate(&template_data, AccountKey::BuildingTemplate)?;
    let template = unsafe { BuildingTemplate::load_mut(&mut template_data) };
    let expected = BuildingTemplate::create_pda(template.building_type, template.bump)?;
    if building_template.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Update the specified field
    match field_to_update {
        0 => {
            if instruction_data.len() != 5 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.base_time_seconds = read_u32(
                instruction_data,
                1,
                "update_building_template.base_time_seconds",
            )?;
        }
        1 => {
            if instruction_data.len() != 9 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.base_novi_cost = read_u64(
                instruction_data,
                1,
                "update_building_template.base_novi_cost",
            )?;
        }
        2 => {
            if instruction_data.len() != 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.cost_growth_bps = read_u16(
                instruction_data,
                1,
                "update_building_template.cost_growth_bps",
            )?;
        }
        3 => {
            if instruction_data.len() != 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.time_growth_bps = read_u16(
                instruction_data,
                1,
                "update_building_template.time_growth_bps",
            )?;
        }
        4 => {
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.is_active =
                read_u8(instruction_data, 1, "update_building_template.is_active")? != 0;
        }
        5 => {
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.max_level =
                read_u8(instruction_data, 1, "update_building_template.max_level")?;
        }
        6 => {
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.tier = read_u8(instruction_data, 1, "update_building_template.tier")?;
        }
        _ => return Err(GameError::InvalidParameter.into()),
    }

    Ok(())
}
