use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{GameEngine, DungeonTemplate},
    constants::DUNGEON_TEMPLATE_SEED,
    validation::{
        require_signer,
        require_writable,
        require_key_match,
    },
};

/// Create a dungeon template (DAO only)
///
/// Creates a DungeonTemplate account that defines dungeon configuration.
/// Only the DAO authority can call this instruction.
///
/// # Accounts
/// - [signer, writable] dao_authority: DAO authority (pays for account)
/// - [writable] dungeon_template: DungeonTemplate PDA to create
/// - [] game_engine: GameEngine (verify DAO)
/// - [] system_program
///
/// # Instruction Data (152 bytes - matches DungeonTemplate struct)
/// Layout:
/// - [0..2]     dungeon_id: u16
/// - [2]        theme: u8
/// - [3]        total_floors: u8
/// - [4]        rooms_per_floor: u8
/// - [5]        checkpoint_interval: u8
/// - [6]        min_player_level: u8
/// - [7]        required_building_level: u8
/// - [8..10]    stamina_cost: u16
/// - [10..12]   boss_power_multiplier: u16
/// - [12..16]   _padding (skip bump, will be set automatically)
/// - [16..48]   name: [u8; 32]
/// - [48..88]   floor_power: [u32; 10] (40 bytes)
/// - [88..90]   combat_weight: u16
/// - [90..92]   treasure_weight: u16
/// - [92..94]   camp_weight: u16
/// - [94..96]   rest_weight: u16
/// - [96..98]   trap_weight: u16
/// - [98..100]  _padding2: u16
/// - [100..102] darkness_base_bps: u16
/// - [102..104] darkness_per_floor_bps: u16
/// - [104..108] time_limit_seconds: u32
/// - [108..116] base_xp_per_room: u64
/// - [116..124] base_novi_per_floor: u64
/// - [124..126] completion_bonus_bps: u16
/// - [126..128] reward_scaling_bps: u16
/// - [128..132] _padding3: [u8; 4]
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [dao_authority, dungeon_template, game_engine, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(dao_authority)?;
    require_writable(dungeon_template)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Verify DAO authority
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    {
        let game_engine_state = GameEngine::load_checked_by_key(game_engine, program_id)?;
        if dao_authority.address() != &game_engine_state.authority {
            return Err(GameError::DaoRequired.into());
        }
    }

    // 4. Parse instruction data
    // Minimum required data (excluding optional trailing padding)
    if instruction_data.len() < 128 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let dungeon_id = u16::from_le_bytes([
        instruction_data[0],
        instruction_data[1],
    ]);

    let theme = instruction_data[2];
    let total_floors = instruction_data[3];
    let rooms_per_floor = instruction_data[4];
    let checkpoint_interval = instruction_data[5];
    let min_player_level = instruction_data[6];
    let required_building_level = instruction_data[7];

    let stamina_cost = u16::from_le_bytes([
        instruction_data[8],
        instruction_data[9],
    ]);

    let boss_power_multiplier = u16::from_le_bytes([
        instruction_data[10],
        instruction_data[11],
    ]);

    // Skip bump and padding1 (bytes 12-15)

    // Parse name (32 bytes)
    let mut name = [0u8; 32];
    name.copy_from_slice(&instruction_data[16..48]);

    // Parse floor_power (10 × u32 = 40 bytes)
    let mut floor_power = [0u32; 10];
    for i in 0..10 {
        let offset = 48 + (i * 4);
        floor_power[i] = u32::from_le_bytes([
            instruction_data[offset],
            instruction_data[offset + 1],
            instruction_data[offset + 2],
            instruction_data[offset + 3],
        ]);
    }

    // Parse room weights
    let combat_weight = u16::from_le_bytes([
        instruction_data[88],
        instruction_data[89],
    ]);
    let treasure_weight = u16::from_le_bytes([
        instruction_data[90],
        instruction_data[91],
    ]);
    let camp_weight = u16::from_le_bytes([
        instruction_data[92],
        instruction_data[93],
    ]);
    let rest_weight = u16::from_le_bytes([
        instruction_data[94],
        instruction_data[95],
    ]);
    let trap_weight = u16::from_le_bytes([
        instruction_data[96],
        instruction_data[97],
    ]);

    // Skip padding2 (bytes 98-99)

    // Parse darkness config
    let darkness_base_bps = u16::from_le_bytes([
        instruction_data[100],
        instruction_data[101],
    ]);
    let darkness_per_floor_bps = u16::from_le_bytes([
        instruction_data[102],
        instruction_data[103],
    ]);

    // Parse time limit
    let time_limit_seconds = u32::from_le_bytes([
        instruction_data[104],
        instruction_data[105],
        instruction_data[106],
        instruction_data[107],
    ]);

    // Parse reward config
    let base_xp_per_room = u64::from_le_bytes([
        instruction_data[108],
        instruction_data[109],
        instruction_data[110],
        instruction_data[111],
        instruction_data[112],
        instruction_data[113],
        instruction_data[114],
        instruction_data[115],
    ]);

    let base_novi_per_floor = u64::from_le_bytes([
        instruction_data[116],
        instruction_data[117],
        instruction_data[118],
        instruction_data[119],
        instruction_data[120],
        instruction_data[121],
        instruction_data[122],
        instruction_data[123],
    ]);

    let completion_bonus_bps = u16::from_le_bytes([
        instruction_data[124],
        instruction_data[125],
    ]);

    let reward_scaling_bps = u16::from_le_bytes([
        instruction_data[126],
        instruction_data[127],
    ]);

    // 5. Validate configuration
    if total_floors == 0 || total_floors > 10 {
        return Err(GameError::InvalidParameter.into());
    }

    if rooms_per_floor == 0 || rooms_per_floor > 10 {
        return Err(GameError::InvalidParameter.into());
    }

    // Validate room weights sum to 10000 bps (100%)
    let total_weight = (combat_weight as u32)
        .saturating_add(treasure_weight as u32)
        .saturating_add(camp_weight as u32)
        .saturating_add(rest_weight as u32)
        .saturating_add(trap_weight as u32);

    if total_weight != 10000 {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Derive and verify PDA
    let (expected_template, bump) = DungeonTemplate::derive_pda(dungeon_id);

    if dungeon_template.address() != &expected_template {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Create DungeonTemplate account
    let lamports = crate::utils::rent_exempt_const(DungeonTemplate::LEN);

    let dungeon_id_bytes = dungeon_id.to_le_bytes();
    let bump_seed = [bump];
    let seeds = crate::seeds!(DUNGEON_TEMPLATE_SEED, &dungeon_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: dao_authority,
        to: dungeon_template,
        lamports,
        space: DungeonTemplate::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 8. Initialize template data
    let mut template_data = dungeon_template.try_borrow_mut()?;
    let template = unsafe { DungeonTemplate::load_mut(&mut template_data) };

    template.account_key = crate::state::AccountKey::DungeonTemplate as u8;
    template.dungeon_id = dungeon_id;
    template.theme = theme;
    template.total_floors = total_floors;
    template.rooms_per_floor = rooms_per_floor;
    template.checkpoint_interval = checkpoint_interval;
    template.min_player_level = min_player_level;
    template.required_building_level = required_building_level;
    template.stamina_cost = stamina_cost;
    template.boss_power_multiplier = boss_power_multiplier;
    template.bump = bump;
    template._padding1 = [0; 3];
    template.name = name;
    template.floor_power = floor_power;
    template.combat_weight = combat_weight;
    template.treasure_weight = treasure_weight;
    template.camp_weight = camp_weight;
    template.rest_weight = rest_weight;
    template.trap_weight = trap_weight;
    template._padding2 = 0;
    template.darkness_base_bps = darkness_base_bps;
    template.darkness_per_floor_bps = darkness_per_floor_bps;
    template.time_limit_seconds = time_limit_seconds;
    template.base_xp_per_room = base_xp_per_room;
    template.base_novi_per_floor = base_novi_per_floor;
    template.completion_bonus_bps = completion_bonus_bps;
    template.reward_scaling_bps = reward_scaling_bps;
    template._padding3 = [0; 4];

    Ok(())
}
