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
    state::{GameEngine, HeroTemplate, BuffConfig},
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
/// Layout (71 bytes total):
/// - [0..2]   template_id: u16
/// - [2..34]  name: [u8; 32]
/// - [34]     hero_type: u8
/// - [35]     category: u8
/// - [36..44] mint_cost_sol: u64
/// - [44..48] supply_cap: u32
/// - [48]     enabled: bool
/// - [49]     event_exclusive: bool
/// - [50]     required_player_level: u8
/// - [51..71] buffs: [BuffConfig; 4] - 4 buffs × 5 bytes = 20 bytes
///
/// Note: No buff_ranges needed - hero progression is deterministic using √φ scaling
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [dao_authority, hero_template, game_engine, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(hero_template)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO authority
    let game_engine_data = game_engine.try_borrow_data()?;
    let game_engine_state = unsafe { GameEngine::load(&game_engine_data) };

    if dao_authority.key() != &game_engine_state.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Parse instruction data (Deterministic System - no buff_ranges needed)
    if instruction_data.len() != 71 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let template_id = u16::from_le_bytes([
        instruction_data[0],
        instruction_data[1],
    ]);

    let mut name = [0u8; 32];
    name.copy_from_slice(&instruction_data[2..34]);

    let hero_type = instruction_data[34];
    let category = instruction_data[35];

    let mint_cost_sol = u64::from_le_bytes([
        instruction_data[36],
        instruction_data[37],
        instruction_data[38],
        instruction_data[39],
        instruction_data[40],
        instruction_data[41],
        instruction_data[42],
        instruction_data[43],
    ]);

    let supply_cap = u32::from_le_bytes([
        instruction_data[44],
        instruction_data[45],
        instruction_data[46],
        instruction_data[47],
    ]);

    let enabled = instruction_data[48] != 0;
    let event_exclusive = instruction_data[49] != 0;
    let required_player_level = instruction_data[50];

    // Parse buffs (4 × 5 bytes = 20 bytes) - Deterministic System
    // Each buff has: stat (u8), base_bps (u16), _reserved (2 bytes)
    let mut buffs = [BuffConfig::NONE; 4];
    for i in 0..4 {
        let offset = 51 + (i * 5);
        buffs[i] = BuffConfig {
            stat: instruction_data[offset],
            base_bps: u16::from_le_bytes([
                instruction_data[offset + 1],
                instruction_data[offset + 2],
            ]),
            _reserved: [instruction_data[offset + 3], instruction_data[offset + 4]],
        };
    }
    // Note: No buff_ranges parsing - hero buffs scale deterministically using √φ

    // 5. Derive and verify PDA
    let (expected_template, bump) = HeroTemplate::derive_pda(template_id);

    if hero_template.key() != &expected_template {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Create HeroTemplate account
    let lamports = Rent::get()?.minimum_balance(HeroTemplate::LEN);

    let template_id_bytes = template_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(crate::constants::HERO_TEMPLATE_SEED, &template_id_bytes, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: hero_template,
        lamports,
        space: HeroTemplate::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 7. Initialize template data
    let mut template_data = hero_template.try_borrow_mut_data()?;
    let template = unsafe { HeroTemplate::load_mut(&mut template_data) };

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
    template.buffs = buffs;
    // Note: No buff_ranges - deterministic √φ scaling
    template.bump = bump;
    template._padding = [0; 6];

    Ok(())
}
