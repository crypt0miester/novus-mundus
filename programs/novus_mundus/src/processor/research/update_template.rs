use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{GameEngine, ResearchTemplate},
    validation::{
        require_signer,
        require_writable,
    },
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
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [dao_authority, research_template, game_engine] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(research_template)?;

    // 3. Verify DAO authority
    let game_engine_data = game_engine.try_borrow_data()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data) };

    if dao_authority.key() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let field_to_update = instruction_data[0];

    // 5. Load template
    let mut template_data = research_template.try_borrow_mut_data()?;
    let template = unsafe { ResearchTemplate::load_mut(&mut template_data) };

    // 6. Update the specified field
    match field_to_update {
        0 => {
            // Update base_time_seconds (u32)
            if instruction_data.len() != 5 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.base_time_seconds = u32::from_le_bytes([
                instruction_data[1],
                instruction_data[2],
                instruction_data[3],
                instruction_data[4],
            ]);
        },
        1 => {
            // Update base_novi_cost (u64)
            if instruction_data.len() != 9 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.base_novi_cost = u64::from_le_bytes([
                instruction_data[1],
                instruction_data[2],
                instruction_data[3],
                instruction_data[4],
                instruction_data[5],
                instruction_data[6],
                instruction_data[7],
                instruction_data[8],
            ]);
        },
        2 => {
            // Update buff_per_level_bps (u16)
            if instruction_data.len() != 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.buff_per_level_bps = u16::from_le_bytes([
                instruction_data[1],
                instruction_data[2],
            ]);
        },
        3 => {
            // Update gem_cost_per_minute (u16)
            if instruction_data.len() != 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.gem_cost_per_minute = u16::from_le_bytes([
                instruction_data[1],
                instruction_data[2],
            ]);
        },
        4 => {
            // Update is_active (bool)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.is_active = instruction_data[1] != 0;
        },
        5 => {
            // Update max_level (u8)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.max_level = instruction_data[1];
        },
        6 => {
            // Update prerequisite_research (u8)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.prerequisite_research = instruction_data[1];
        },
        7 => {
            // Update prerequisite_level (u8)
            if instruction_data.len() != 2 {
                return Err(ProgramError::InvalidInstructionData);
            }
            template.prerequisite_level = instruction_data[1];
        },
        _ => return Err(GameError::InvalidParameter.into()),
    }

    Ok(())
}