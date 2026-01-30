use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonTemplate, DungeonRun, DungeonStatus, RoomType},
    constants::DUNGEON_RUN_SEED,
    helpers::estate::{load_estate_for_player, has_building_at_level},
    validation::{require_signer, require_writable},
    emit,
    events::DungeonEntered,
};

/// Enter a dungeon and start a new run
///
/// # Flow
/// 1. Validate player meets dungeon requirements (level, building, stamina)
/// 2. Validate and transfer champion hero NFT to escrow (MPL Core)
/// 3. Snapshot player's defensive units and weapons
/// 4. Create DungeonRun PDA
/// 5. Initialize first room (generate enemy if combat room)
///
/// # Accounts
/// - [signer, writable] owner: Player's wallet
/// - [writable] player: PlayerAccount PDA
/// - [] dungeon_template: DungeonTemplate PDA
/// - [writable] dungeon_run: DungeonRun PDA (to be created)
/// - [] estate: EstateAccount PDA (for building requirements)
/// - [writable] hero_mint: Champion hero NFT mint (MPL Core asset)
/// - [] hero_collection: Hero collection PDA
/// - [] system_program: System program
///
/// # Instruction Data
/// - dungeon_id: u16 (2 bytes, little-endian)
/// - first_room_type: u8 (provided by backend, signed)
/// - hero_specialization: u8 (0=Warrior, 1=Guardian, 2=Scout, 3=Mystic)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        owner,
        player_account,
        dungeon_template_account,
        dungeon_run_account,
        estate_account,
        hero_mint,
        hero_collection,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate signer
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;
    require_writable(hero_mint)?;

    // 3. Parse instruction data
    if data.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let dungeon_id = u16::from_le_bytes([data[0], data[1]]);
    let first_room_type = data[2];
    let hero_specialization = data[3];

    // Validate room type
    let room_type = RoomType::from_u8(first_room_type)
        .ok_or(GameError::InvalidParameter)?;

    // Validate hero specialization (0-3)
    if hero_specialization > 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load and validate player using load_checked_mut_by_key (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate dungeon run doesn't already exist
    // (account should have 0 lamports if not created)
    if dungeon_run_account.lamports() > 0 {
        return Err(GameError::DungeonRunExists.into());
    }

    // 6. Load dungeon template using load_checked
    let template = DungeonTemplate::load_checked(dungeon_template_account, dungeon_id, program_id)?;

    // 7. Validate player requirements
    // Check level requirement
    if player.level < template.min_player_level {
        return Err(GameError::InsufficientLevel.into());
    }

    // Check stamina
    if player.encounter_stamina < template.stamina_cost as u64 {
        return Err(GameError::InsufficientStamina.into());
    }

    // Check Arena building level (dungeons require Arena)
    let estate = load_estate_for_player(estate_account, &player, program_id)?;
    if !has_building_at_level(&estate, crate::state::BuildingType::Arena, template.required_building_level) {
        return Err(GameError::CatacombsRequired.into());
    }

    // Calculate building bonuses (5% per level, capped at 25%)
    let xp_building_bonus_bps = estate.find_building(crate::state::BuildingType::Academy)
        .filter(|b| b.is_active())
        .map(|b| ((b.level as u16) * 500).min(2500)) // 5% per level, max 25%
        .unwrap_or(0);

    let novi_building_bonus_bps = estate.find_building(crate::state::BuildingType::Treasury)
        .filter(|b| b.is_active())
        .map(|b| ((b.level as u16) * 500).min(2500)) // 5% per level, max 25%
        .unwrap_or(0);

    // Check player not traveling
    if player.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // Check player not in rally
    if player.rally_stats.current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // Check player has defensive units for combat
    let total_defensive = player.total_defensive_units();
    if total_defensive == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 8. Validate hero NFT ownership via MPL Core
    let asset_data = hero_mint.try_borrow_data()?;
    let asset = unsafe { p_core::state::AssetV1::load(&asset_data) };

    // CRITICAL: Verify current owner is the signer's wallet
    if asset.owner != *owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    drop(asset_data);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 9. Create DungeonRun PDA (derived from player_account, not owner)
    let (expected_run_pda, run_bump) = DungeonRun::derive_pda(player_account.key());
    if dungeon_run_account.key() != &expected_run_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Calculate rent
    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let run_lamports = rent.minimum_balance(DungeonRun::LEN);

    // Create account - signer seeds use player_account.key()
    let run_bump_seed = [run_bump];
    let run_seeds = pinocchio::seeds!(
        DUNGEON_RUN_SEED,
        player_account.key().as_ref(),
        &run_bump_seed
    );
    let run_signer = pinocchio::instruction::Signer::from(&run_seeds);

    CreateAccount {
        from: owner,
        to: dungeon_run_account,
        lamports: run_lamports,
        space: DungeonRun::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[run_signer])?;

    // 10. Transfer hero NFT to DungeonRun PDA using MPL Core
    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        current_owner: owner,
        new_owner: dungeon_run_account,
        payer: owner,
        authority: owner,
        system_program,
    }.invoke()?;

    // 11. Consume stamina
    player.encounter_stamina = player.encounter_stamina.saturating_sub(template.stamina_cost as u64);

    // Snapshot DEFENSIVE units (for combat, not operative units which are for resources)
    let remaining_units = [
        player.defensive_unit_1,
        player.defensive_unit_2,
        player.defensive_unit_3,
    ];

    // Snapshot weapons for damage calculation
    let remaining_weapons = [
        player.melee_weapons,
        player.ranged_weapons,
        player.siege_weapons,
    ];

    // Store player name for event before dropping borrow
    let player_name = player.name;

    // Drop player borrow before initializing run
    drop(player);

    // 12. Initialize DungeonRun
    let mut run_data_ref = dungeon_run_account.try_borrow_mut_data()?;
    let run_data = unsafe { DungeonRun::load_mut(&mut run_data_ref) };

    // Initialize run state - store player_account PDA for authorization (matches PDA derivation)
    run_data.player = *player_account.key();
    run_data.hero_mint = *hero_mint.key();
    run_data.dungeon_id = dungeon_id;
    run_data.status = DungeonStatus::Active as u8;
    run_data.current_floor = 1;
    run_data.current_room = 1;
    run_data.room_type = first_room_type;
    run_data.last_checkpoint = 0;
    run_data.bump = run_bump;

    // Initialize enemy if combat room
    // Apply time-of-day modifiers to enemy power
    // Use TimeOfDay from time_cycle and convert to dungeon's simpler TimePeriod
    let time_of_day = crate::logic::time_cycle::get_time_of_day(now, 0.0); // UTC
    let time_period = crate::helpers::dungeon::TimePeriod::from_time_of_day(time_of_day);
    let dungeon_theme = crate::helpers::dungeon::DungeonTheme::from_u8(template.theme)
        .unwrap_or(crate::helpers::dungeon::DungeonTheme::Crypts);

    if room_type.is_combat() {
        let base_floor_power = template.get_floor_power(1);
        // Apply time modifiers to enemy power
        let floor_power = crate::helpers::dungeon::calculate_enemy_power_with_time(
            base_floor_power,
            time_period,
            dungeon_theme,
        );
        run_data.enemy_health = (floor_power as u64).saturating_mul(10); // HP = power × 10
        run_data.enemy_max_health = run_data.enemy_health;
        run_data.enemy_power = floor_power;
        run_data.enemy_defense = 1000; // 10% base defense
        run_data.is_boss = false;
    } else {
        run_data.enemy_health = 0;
        run_data.enemy_max_health = 0;
        run_data.enemy_power = 0;
        run_data.enemy_defense = 0;
        run_data.is_boss = false;
    }

    // Store time period, theme, and hero specialization for mechanics throughout the run
    run_data.time_period = time_period as u8;
    run_data.dungeon_theme = dungeon_theme as u8;
    run_data.hero_specialization = hero_specialization;

    // Initialize boss wrath system (used when fighting bosses)
    run_data.boss_wrath = 0;
    run_data.boss_ability_active = false;
    run_data.boss_ability_counter = 0;
    run_data.boss_shield = 0;

    run_data.remaining_units = remaining_units;
    run_data.original_units = remaining_units; // Store original for Phoenix Feather and healing
    run_data.remaining_weapons = remaining_weapons;
    run_data.relic_mask = 0;
    run_data.synergy_mask = 0;
    run_data.darkness_level = 0; // Starts at 0, increases each floor
    run_data.darkness_mitigation = 0;

    run_data.pending_xp = 0;
    run_data.pending_novi = 0;
    run_data.pending_gems = 0;
    run_data.pending_materials = 0;

    run_data.checkpoint_xp = 0;
    run_data.checkpoint_novi = 0;
    run_data.checkpoint_gems = 0;

    run_data.total_damage_dealt = 0;
    run_data.total_damage_taken = 0;
    run_data.enemies_killed = 0;
    run_data.relics_collected = 0;
    run_data.rooms_cleared = 0;

    run_data.started_at = now;
    run_data.camp_bonus_bps = 0;
    run_data.camp_expires_floor = 0;
    run_data.resume_count = 0;

    // Store building bonuses
    run_data.xp_building_bonus_bps = xp_building_bonus_bps;
    run_data.novi_building_bonus_bps = novi_building_bonus_bps;

    // 13. Emit event
    emit!(DungeonEntered {
        player: *player_account.key(),
        player_name,
        dungeon_id,
        hero_mint: *hero_mint.key(),
        hero_name: [0u8; 32], // Hero template not loaded in enter - name unavailable
        stamina_spent: template.stamina_cost,
        timestamp: now,
    });

    Ok(())
}
