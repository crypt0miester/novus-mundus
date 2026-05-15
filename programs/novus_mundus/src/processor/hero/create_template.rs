use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{GameEngine, HeroTemplate, BuffConfig},
    utils::{read_u8, read_u16, read_u32, read_u64},
    validation::{
        require_signer,
        require_writable,
        require_key_match,
    },
};

/// Initialize a hero template (DAO only)
///
/// Creates a HeroTemplate account that defines a hero type's properties.
/// Only the DAO authority can call this instruction.
///
/// # Accounts
/// - [signer] dao_authority: DAO authority
/// - [writable] hero_template: HeroTemplate PDA to create
/// - [] game_engine: GameEngine (verify DAO)
/// - [] system_program
///
/// # Instruction Data (Deterministic System)
/// Layout (73 bytes total):
/// - [0..2]   template_id: u16
/// - [2..34]  name: [u8; 32]
/// - [34]     hero_type: u8
/// - [35]     category: u8
/// - [36..44] mint_cost_sol: u64
/// - [44..48] supply_cap: u32
/// - [48]     enabled: bool
/// - [49]     event_exclusive: bool
/// - [50]     required_player_level: u8
/// - [51..53] meditation_city_id: u16 (0 = any city, else specific city required)
/// - [53..73] buffs: [BuffConfig; 4] - 4 buffs × 5 bytes = 20 bytes
///
/// Note: No buff_ranges needed - hero progression is deterministic using √φ scaling
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [dao_authority, hero_template, game_engine, system_program]);

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(hero_template)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO authority
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    {
        let game_engine_state = GameEngine::load_checked_by_key(game_engine, program_id)?;
        if dao_authority.address() != &game_engine_state.authority {
            return Err(GameError::DaoRequired.into());
        }
    }

    // 4. Parse instruction data (Deterministic System - no buff_ranges needed)
    if instruction_data.len() != 73 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let template_id = read_u16(instruction_data, 0, "create_template.template_id")?;

    let mut name = [0u8; 32];
    name.copy_from_slice(&instruction_data[2..34]);

    let hero_type = read_u8(instruction_data, 34, "create_template.hero_type")?;
    let category = read_u8(instruction_data, 35, "create_template.category")?;

    let mint_cost_sol = read_u64(instruction_data, 36, "create_template.mint_cost_sol")?;

    let supply_cap = read_u32(instruction_data, 44, "create_template.supply_cap")?;

    let enabled = read_u8(instruction_data, 48, "create_template.enabled")? != 0;
    let event_exclusive = read_u8(instruction_data, 49, "create_template.event_exclusive")? != 0;
    let required_player_level = read_u8(instruction_data, 50, "create_template.required_player_level")?;

    // Parse meditation_city_id (0 = any city, else specific city required for meditation)
    let meditation_city_id = read_u16(instruction_data, 51, "create_template.meditation_city_id")?;

    // Parse buffs (4 × 5 bytes = 20 bytes) - Deterministic System
    // Each buff has: stat (u8), base_bps (u16), _reserved (2 bytes)
    let mut buffs = [BuffConfig::NONE; 4];
    for i in 0..4 {
        let offset = 53 + (i * 5);
        buffs[i] = BuffConfig {
            stat: read_u8(instruction_data, offset, "create_template.buff_stat")?,
            base_bps: read_u16(instruction_data, offset + 1, "create_template.buff_base_bps")?,
            _reserved: [
                read_u8(instruction_data, offset + 3, "create_template.buff_reserved")?,
                read_u8(instruction_data, offset + 4, "create_template.buff_reserved")?,
            ],
        };
    }
    // Note: No buff_ranges parsing - hero buffs scale deterministically using √φ

    // 5. Derive and verify PDA
    let (expected_template, bump) = HeroTemplate::derive_pda(template_id);

    if hero_template.address() != &expected_template {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Create HeroTemplate account
    let lamports = crate::utils::rent_exempt_const(HeroTemplate::LEN);

    let template_id_bytes = template_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(crate::constants::HERO_TEMPLATE_SEED, &template_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: hero_template,
        lamports,
        space: HeroTemplate::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 7. Initialize template data
    let mut template_data = hero_template.try_borrow_mut()?;
    let template = unsafe { HeroTemplate::load_mut(&mut template_data) };

    template.account_key = crate::state::AccountKey::HeroTemplate as u8;
    template.template_id = template_id;
    template.name = name;
    template.hero_type = hero_type;
    template.category = category;
    template.mint_cost_sol = mint_cost_sol;
    template.supply_cap = supply_cap;
    template.minted_count = 0; // Start at 0
    template.enabled = enabled;
    template.event_exclusive = event_exclusive;
    template.required_player_level = required_player_level;
    template.meditation_city_id = meditation_city_id; // 0 = any city, else specific city required
    template.buffs = buffs;
    template.bump = bump;
    template._padding = [0; 3];

    Ok(())
}
