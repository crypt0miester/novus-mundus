use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::{
    error::GameError,
    state::{GameEngine, ResearchTemplate},
    utils::{read_u16, read_u32, read_u64, read_u8},
    validation::{require_signer, require_writable},
};

/// Update research template (DAO only)
///
/// DAO can update research parameters like costs, times, and buffs.
///
/// # Accounts
/// - [signer] dao_authority: DAO authority
/// - [writable] research_template: ResearchTemplate PDA
/// - [] game_engine: GameEngine (verify DAO)
///
/// # Instruction Data
/// - [0] field_to_update: u8
///   - 0: base_time_seconds
///   - 1: base_novi_cost
///   - 2: buff_per_level_bps
///   - 3: gem_cost_per_minute
///   - 4: is_active (enable/disable)
///   - 5: max_level
///   - 6: prerequisite_research
///   - 7: prerequisite_level
/// - [1..9] new_value: u64 (or appropriate size for field)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [dao_authority, research_template, game_engine]);

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(research_template)?;

    // 3. Verify DAO authority
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine_state = GameEngine::load_checked_by_key(game_engine, program_id)?;

    if dao_authority.address() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data
    let field_to_update = read_u8(instruction_data, 0, "update_template.field_to_update")?;

    // 5. Load template
    let mut template_data = research_template.try_borrow_mut()?;
    let template = unsafe { ResearchTemplate::load_mut(&mut template_data) };

    // 6. Update the specified field
    match field_to_update {
        0 => {
            // Update base_time_seconds (u32)
            if instruction_data.len() != 5 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.base_time_seconds =
                read_u32(instruction_data, 1, "update_template.base_time_seconds")?;
        }
        1 => {
            // Update base_novi_cost (u64)
            if instruction_data.len() != 9 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.base_novi_cost =
                read_u64(instruction_data, 1, "update_template.base_novi_cost")?;
        }
        2 => {
            // Update buff_per_level_bps (u16)
            if instruction_data.len() != 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.buff_per_level_bps =
                read_u16(instruction_data, 1, "update_template.buff_per_level_bps")?;
        }
        3 => {
            // Update gem_cost_per_minute (u16)
            if instruction_data.len() != 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.gem_cost_per_minute =
                read_u16(instruction_data, 1, "update_template.gem_cost_per_minute")?;
        }
        4 => {
            // Update is_active (bool)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.is_active = read_u8(instruction_data, 1, "update_template.is_active")? != 0;
        }
        5 => {
            // Update max_level (u8)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.max_level = read_u8(instruction_data, 1, "update_template.max_level")?;
        }
        6 => {
            // Update prerequisite_research (u8)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.prerequisite_research =
                read_u8(instruction_data, 1, "update_template.prerequisite_research")?;
        }
        7 => {
            // Update prerequisite_level (u8)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.prerequisite_level =
                read_u8(instruction_data, 1, "update_template.prerequisite_level")?;
        }
        _ => return Err(GameError::InvalidParameter.into()),
    }

    Ok(())
}
