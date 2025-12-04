use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, rent::Rent},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{GameEngine, ResearchTemplate},
    validation::{
        require_signer,
        require_writable,
        require_key_match,
    },
    constants::RESEARCH_TEMPLATE_SEED,
};

/// Initialize a research template (DAO only)
///
/// Creates a ResearchTemplate account that defines a research node's properties.
/// Only the DAO authority can call this instruction.
///
/// # Accounts
/// - [signer] dao_authority: DAO authority
/// - [writable] research_template: ResearchTemplate PDA to create
/// - [] game_engine: GameEngine (verify DAO)
/// - [] system_program
///
/// # Instruction Data
/// - [0] research_type: u8 (0-29)
/// - [1] category: u8 (Battle=0, Economy=1, Growth=2)
/// - [2] max_level: u8 (5-25)
/// - [3..7] base_time_seconds: u32
/// - [7..15] base_novi_cost: u64
/// - [15] buff_type: u8 (ResearchBuffType)
/// - [16..18] buff_per_level_bps: u16
/// - [18] prerequisite_research: u8 (255 = none)
/// - [19] prerequisite_level: u8
/// - [20..22] gem_cost_per_minute: u16
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [dao_authority, research_template, game_engine, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(research_template)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO authority
    let game_engine_data = game_engine.try_borrow_data()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data) };

    if dao_authority.key() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data
    if instruction_data.len() != 22 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let research_type = instruction_data[0];
    let category = instruction_data[1];
    let max_level = instruction_data[2];

    let base_time_seconds = u32::from_le_bytes([
        instruction_data[3],
        instruction_data[4],
        instruction_data[5],
        instruction_data[6],
    ]);

    let base_novi_cost = u64::from_le_bytes([
        instruction_data[7],
        instruction_data[8],
        instruction_data[9],
        instruction_data[10],
        instruction_data[11],
        instruction_data[12],
        instruction_data[13],
        instruction_data[14],
    ]);

    let buff_type = instruction_data[15];

    let buff_per_level_bps = u16::from_le_bytes([
        instruction_data[16],
        instruction_data[17],
    ]);

    let prerequisite_research = instruction_data[18];
    let prerequisite_level = instruction_data[19];

    let gem_cost_per_minute = u16::from_le_bytes([
        instruction_data[20],
        instruction_data[21],
    ]);

    // 5. Validate research type
    if research_type >= 30 {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Derive and verify PDA
    let (expected_template, bump) = ResearchTemplate::derive_pda(research_type);

    if research_template.key() != &expected_template {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Create ResearchTemplate account
    let lamports = Rent::get()?.minimum_balance(ResearchTemplate::LEN);

    let bump_seed = [bump];
    let research_type_seed = [research_type];
    let seeds = pinocchio::seeds!(RESEARCH_TEMPLATE_SEED, &research_type_seed, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: research_template,
        lamports,
        space: ResearchTemplate::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize template data
    let mut template_data = research_template.try_borrow_mut_data()?;
    let template = unsafe { ResearchTemplate::load_mut(&mut template_data) };

    template.research_type = research_type;
    template.category = category;
    template.max_level = max_level;
    template.base_time_seconds = base_time_seconds;
    template.base_novi_cost = base_novi_cost;
    template.buff_type = buff_type;
    template.buff_per_level_bps = buff_per_level_bps;
    template.prerequisite_research = prerequisite_research;
    template.prerequisite_level = prerequisite_level;
    template.gem_cost_per_minute = gem_cost_per_minute;
    template.is_active = true;
    template._padding = [0; 5];

    Ok(())
}