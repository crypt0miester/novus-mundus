use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{
        DUNGEON_REST_HEAL_PERCENT, DUNGEON_TRAP_DAMAGE_PERCENT, DUNGEON_TRAP_XP_BONUS_BPS,
        DUNGEON_TREASURE_LOOT_MULTIPLIER_BPS,
    },
    emit,
    error::GameError,
    events::{DungeonFailed, DungeonFloorCompleted, DungeonRoomCleared},
    helpers::dungeon::{
        // Hero specialization
        apply_scout_loot_bonus,
        calculate_floor_novi,
        // Loot system
        calculate_loot_with_bonuses,
        calculate_room_xp,
        calculate_total_unit_hp,
        calculate_treasure_gems_with_time,
        calculate_xp_with_time,
        has_double_novi_relic,
        has_guaranteed_rare_drop_relic,
        // Time of day
        TimePeriod,
    },
    logic::safe_math::apply_bp,
    state::{DungeonRun, DungeonStatus, DungeonTemplate, GameEngine, PlayerAccount, RoomType},
    validation::{require_signer, require_writable},
};

/// Interact with a non-combat room (treasure, camp, rest, trap)
///
/// # Room Effects
/// - Treasure: 2x loot bonus, bonus gems
/// - Camp: Abandoned camp with supplies - temporary buff for current floor
/// - Rest: Heal 20% of lost units
/// - Trap: Take damage but gain 1.5x XP
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [signer] game_authority: Game server (validates camp bonus and room types)
/// - [writable] player: PlayerAccount PDA
/// - [] dungeon_template: DungeonTemplate PDA
/// - [writable] dungeon_run: DungeonRun PDA
/// - [] game_engine: GameEngine PDA (for game_authority validation)
///
/// # Instruction Data
/// - camp_bonus_bps: u16 (only for camp rooms, validated by game_authority signature)
/// - next_room_type: u8 (for auto-advance)
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [
        owner,
        game_authority,
        player_account,
        dungeon_template_account,
        dungeon_run_account,
        game_engine_account,
    ]);

    // 2. Validate signers
    require_signer(owner)?;
    require_signer(game_authority)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;

    // 3. Validate game_authority against GameEngine (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    if game_authority.address() != &game_engine.game_authority {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Parse instruction data
    // For camp: [camp_bonus_bps: u16][next_room_type: u8]
    // For others: [next_room_type: u8]
    let (camp_bonus_bps, next_room_type) = if data.len() >= 3 {
        let bonus = u16::from_le_bytes([data[0], data[1]]);
        (bonus, data[2])
    } else if !data.is_empty() {
        (0, data[0])
    } else {
        (0, 0)
    };

    // 5. Load player using load_checked (kingdom-scoped)
    let player = PlayerAccount::load_checked(
        player_account,
        game_engine_account.address(),
        owner.address(),
        program_id,
    )?;

    // 6. Load dungeon run using load_checked_mut (PDA derived from player_account)
    let run =
        DungeonRun::load_checked_mut(dungeon_run_account, player_account.address(), program_id)?;

    // Verify the run belongs to this player (player_account PDA stored in run.player)
    if &run.player != player_account.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Validate run is active
    let status = DungeonStatus::from_u8(run.status).ok_or(GameError::InvalidParameter)?;

    if !status.is_active() {
        return Err(GameError::DungeonNotActive.into());
    }

    // Validate room is NOT combat
    let room_type = RoomType::from_u8(run.room_type).ok_or(GameError::InvalidParameter)?;

    if room_type.is_combat() {
        return Err(GameError::InvalidRoomType.into());
    }

    // 7. Load dungeon template using load_checked
    let template =
        DungeonTemplate::load_checked(dungeon_template_account, run.dungeon_id, program_id)?;

    // Get timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Check time limit (if set)
    if template.time_limit_seconds > 0 {
        let elapsed = now.saturating_sub(run.started_at);
        if elapsed > template.time_limit_seconds as i64 {
            // Time limit exceeded - fail the run
            run.status = DungeonStatus::Failed as u8;

            emit!(DungeonFailed {
                player: *player_account.address(),
                player_name: player.name,
                dungeon_id: run.dungeon_id,
                floor: run.current_floor,
                room: run.current_room,
                enemies_killed: run.enemies_killed,
                timestamp: now,
            });

            return Err(GameError::DungeonTimeLimitExceeded.into());
        }
    }

    // Get time period for bonuses
    let time_period = TimePeriod::from_u8(run.time_period).unwrap_or(TimePeriod::Day);
    let is_first_light = TimePeriod::is_first_light(now);

    // Get hero specialization for bonuses
    let hero_spec = run.get_specialization();

    // 8. Process room interaction based on type
    let base_xp = calculate_room_xp(template.base_xp_per_room, run.current_floor);
    let mut xp_gained = calculate_xp_with_time(base_xp, time_period, is_first_light);
    let mut _gems_gained = 0u64;

    match room_type {
        RoomType::Treasure => {
            // Base gems scale with floor
            let base_gems = 50u64.saturating_mul(run.current_floor as u64);

            // Apply 2x treasure room multiplier
            let treasure_bonus_gems =
                apply_bp(base_gems, DUNGEON_TREASURE_LOOT_MULTIPLIER_BPS as u64)
                    .unwrap_or(base_gems);

            // Apply relic + synergy loot bonuses (loot relic id 6 + LOOT synergy)
            let loot_bonus_gems = calculate_loot_with_bonuses(treasure_bonus_gems, &run, 0);

            // Apply Dusk bonus (2x gems in treasure rooms)
            let time_bonus_gems = calculate_treasure_gems_with_time(loot_bonus_gems, time_period);

            // Apply Scout loot bonus (+15%)
            let scout_bonus_gems = apply_scout_loot_bonus(time_bonus_gems, hero_spec);

            // Guaranteed-rare-drop relic (id 10): +50% gems
            _gems_gained = if has_guaranteed_rare_drop_relic(&run) {
                apply_bp(scout_bonus_gems, 15000u64).unwrap_or(scout_bonus_gems)
            // +50%
            } else {
                scout_bonus_gems
            };
            run.pending_gems = run.pending_gems.saturating_add(_gems_gained);

            // Grant materials from treasure (5 base + 2 per floor)
            let base_materials = 5u64.saturating_add((run.current_floor as u64).saturating_mul(2));

            // Apply relic + synergy loot bonuses to materials
            let loot_bonus_materials = calculate_loot_with_bonuses(base_materials, &run, 0);

            // Apply Scout loot bonus to materials too
            let scout_bonus_materials = apply_scout_loot_bonus(loot_bonus_materials, hero_spec);

            // Guaranteed-rare-drop relic also boosts materials
            let materials = if has_guaranteed_rare_drop_relic(&run) {
                apply_bp(scout_bonus_materials, 15000u64).unwrap_or(scout_bonus_materials)
            // +50%
            } else {
                scout_bonus_materials
            } as u32;
            run.pending_materials = run.pending_materials.saturating_add(materials);
        }
        RoomType::Camp => {
            // Found abandoned camp - apply temporary buff from supplies
            run.camp_bonus_bps = camp_bonus_bps;
            run.camp_expires_floor = run.current_floor;
        }
        RoomType::Rest => {
            // Heal 20% of lost DEFENSIVE units (uses original_units stored in run)
            run.heal_units(DUNGEON_REST_HEAL_PERCENT);
        }
        RoomType::Trap => {
            // Take damage but gain 1.5x XP
            let total_hp = calculate_total_unit_hp(&run.remaining_units);
            let trap_damage = total_hp.saturating_mul(DUNGEON_TRAP_DAMAGE_PERCENT as u64) / 100;
            run.apply_unit_damage(trap_damage);
            run.total_damage_taken = run.total_damage_taken.saturating_add(trap_damage);

            // 1.5x XP bonus
            xp_gained = apply_bp(xp_gained, DUNGEON_TRAP_XP_BONUS_BPS as u64).unwrap_or(xp_gained);
        }
        RoomType::Combat => {
            // Should never reach here due to earlier check
            return Err(GameError::InvalidRoomType.into());
        }
    }

    // 9. Add XP reward
    run.pending_xp = run.pending_xp.saturating_add(xp_gained);
    run.rooms_cleared = run.rooms_cleared.saturating_add(1);

    emit!(DungeonRoomCleared {
        player: *player_account.address(),
        player_name: player.name,
        dungeon_id: run.dungeon_id,
        floor: run.current_floor,
        room: run.current_room,
        xp_gained,
        timestamp: now,
    });

    // 10. Check if floor complete
    if run.current_room >= template.rooms_per_floor {
        // Floor complete - await relic selection
        run.status = DungeonStatus::AwaitingRelic as u8;

        // Grant floor NOVI
        let floor_novi = calculate_floor_novi(
            template.base_novi_per_floor,
            run.current_floor,
            has_double_novi_relic(&run),
        );
        run.pending_novi = run.pending_novi.saturating_add(floor_novi);

        // Check for checkpoint
        if template.is_checkpoint(run.current_floor) {
            run.last_checkpoint = run.current_floor;
            run.checkpoint_xp = run.pending_xp;
            run.checkpoint_novi = run.pending_novi;
            run.checkpoint_gems = run.pending_gems;
        }

        emit!(DungeonFloorCompleted {
            player: *player_account.address(),
            player_name: player.name,
            dungeon_id: run.dungeon_id,
            floor: run.current_floor,
            novi_gained: floor_novi,
            is_checkpoint: template.is_checkpoint(run.current_floor),
            timestamp: now,
        });
    } else {
        // Auto-advance to next room
        run.current_room = run.current_room.saturating_add(1);
        run.room_type = next_room_type;

        // Spawn enemy if next room is combat
        let new_room_type = RoomType::from_u8(next_room_type).unwrap_or(RoomType::Combat);
        if new_room_type.is_combat() {
            let floor_power = template.get_floor_power(run.current_floor);
            run.enemy_health = (floor_power as u64).saturating_mul(10);
            run.enemy_max_health = run.enemy_health;
            run.enemy_power = floor_power;
            run.enemy_defense = 1000 + (run.current_floor as u16 * 100);
            run.is_boss = false;
        }
    }

    Ok(())
}
