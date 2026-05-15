use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
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
    utils::{read_u8, read_u16, read_u32, read_u64},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [dao_authority, research_template, game_engine, system_program]);

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(research_template)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO authority
    let game_engine_data = game_engine.try_borrow()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data) };

    if dao_authority.address() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data
    if instruction_data.len() != 22 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let research_type = read_u8(instruction_data, 0, "initialize_template.research_type")?;
    let category = read_u8(instruction_data, 1, "initialize_template.category")?;
    let max_level = read_u8(instruction_data, 2, "initialize_template.max_level")?;

    let base_time_seconds = read_u32(instruction_data, 3, "initialize_template.base_time_seconds")?;

    let base_novi_cost = read_u64(instruction_data, 7, "initialize_template.base_novi_cost")?;

    let buff_type = read_u8(instruction_data, 15, "initialize_template.buff_type")?;

    let buff_per_level_bps = read_u16(instruction_data, 16, "initialize_template.buff_per_level_bps")?;

    let prerequisite_research = read_u8(instruction_data, 18, "initialize_template.prerequisite_research")?;
    let prerequisite_level = read_u8(instruction_data, 19, "initialize_template.prerequisite_level")?;

    let gem_cost_per_minute = read_u16(instruction_data, 20, "initialize_template.gem_cost_per_minute")?;

    // 5. Validate research type
    if research_type >= 30 {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Derive and verify PDA
    let (expected_template, bump) = ResearchTemplate::derive_pda(research_type);

    if research_template.address() != &expected_template {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Create ResearchTemplate account
    let lamports = crate::utils::rent_exempt_const(ResearchTemplate::LEN);

    let bump_seed = [bump];
    let research_type_seed = [research_type];
    let seeds = crate::seeds!(RESEARCH_TEMPLATE_SEED, &research_type_seed, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: research_template,
        lamports,
        space: ResearchTemplate::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize template data
    let mut template_data = research_template.try_borrow_mut()?;
    let template = unsafe { ResearchTemplate::load_mut(&mut template_data) };

    template.account_key = crate::state::AccountKey::ResearchTemplate as u8;
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