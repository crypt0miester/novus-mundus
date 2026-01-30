use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonTemplate, DungeonRun, DungeonStatus, RoomType},
    helpers::dungeon::{
        calculate_unit_power,
        calculate_dungeon_damage,
        calculate_enemy_damage,
        calculate_damage_taken,
        calculate_room_xp,
        has_stalwart,
        has_phoenix_feather,
        calculate_relic_lifesteal,
        calculate_synergy_bonuses,
        double_strike_chance,
        // Crit system
        calculate_relic_crit_chance,
        calculate_relic_crit_damage,
        calculate_darkness_crit_penalty,
        has_torch_bearer,
        // Time of day
        TimePeriod,
        calculate_xp_with_time,
        // Boss wrath
        DungeonTheme,
        calculate_boss_wrath,
        get_boss_wrath_damage,
        get_boss_wrath_defense,
        should_trigger_boss_ability,
        get_boss_ability,
        // Hero specialization
        apply_warrior_attack_bonus,
        apply_guardian_survival,
        apply_healing_modifier,
        // Hero effectiveness
        calculate_relic_hero_bonus,
    },
    logic::safe_math::apply_bp,
    validation::{require_signer, require_writable},
    emit,
    events::{DungeonRoomCleared, DungeonFloorCompleted, DungeonFailed},
};

/// Attack the current room enemy (single attack)
///
/// Deals damage to enemy, enemy counterattacks.
/// If enemy dies, auto-advances to next room or triggers floor completion.
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player: PlayerAccount PDA
/// - [] dungeon_template: DungeonTemplate PDA
/// - [writable] dungeon_run: DungeonRun PDA
///
/// # Instruction Data
/// - next_room_type: u8 (provided by backend for auto-advance)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    process_attacks(program_id, accounts, data, 1)
}

/// Core attack processing logic (shared with attack_multi)
pub fn process_attacks(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
    attack_count: u8,
) -> ProgramResult {
    // 1. Parse accounts
    let [
        owner,
        player_account,
        dungeon_template_account,
        dungeon_run_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate signer
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;

    // 3. Parse instruction data
    // data[0]: next_room_type
    // data[1]: double_strike flag (1 = double strike triggered by backend RNG)
    // data[2]: crit flag (1 = critical hit triggered by backend RNG)
    let next_room_type = if !data.is_empty() { data[0] } else { 0 };
    let double_strike_triggered = data.get(1).map(|&b| b == 1).unwrap_or(false);
    let crit_triggered = data.get(2).map(|&b| b == 1).unwrap_or(false);

    // 4. Load and validate player using load_checked_by_key (kingdom-scoped)
    let player = PlayerAccount::load_checked_by_key(player_account, program_id)?;
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load and validate dungeon run using load_checked_mut (PDA derived from player_account)
    let mut run = DungeonRun::load_checked_mut(dungeon_run_account, player_account.key(), program_id)?;

    // Verify the run belongs to this player (player_account PDA stored in run.player)
    if &run.player != player_account.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Validate run is active
    let status = DungeonStatus::from_u8(run.status)
        .ok_or(GameError::InvalidParameter)?;

    if !status.is_active() {
        return Err(GameError::DungeonNotActive.into());
    }

    // Validate room is combat
    let room_type = RoomType::from_u8(run.room_type)
        .ok_or(GameError::InvalidParameter)?;

    if !room_type.is_combat() {
        return Err(GameError::NotCombatRoom.into());
    }

    // Validate enemy is alive
    if run.enemy_health == 0 {
        return Err(GameError::EnemyAlreadyDead.into());
    }

    // 6. Load dungeon template using load_checked
    let template = DungeonTemplate::load_checked(dungeon_template_account, run.dungeon_id, program_id)?;

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
                player: *player_account.key(),
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

    // 7. Process attacks
    // Use defensive units AND weapons for damage calculation
    let base_unit_power = calculate_unit_power(&run.remaining_units);
    let weapon_power = run.total_remaining_weapons();

    let synergies = calculate_synergy_bonuses(&run);
    let lifesteal_bps = calculate_relic_lifesteal(&run).saturating_add(synergies.lifesteal_bps);

    // Check for Double Strike relic (15% chance, verified by backend)
    let has_double_strike = double_strike_chance(&run) > 0;
    let apply_double_strike = has_double_strike && double_strike_triggered;

    // Calculate crit chance and damage (verified by backend RNG)
    // Crit chance = relic bonus + synergy bonus - darkness penalty
    let base_crit_chance = calculate_relic_crit_chance(&run).saturating_add(synergies.crit_chance_bps);
    let torch_bearer = has_torch_bearer(&run);
    let darkness_crit_penalty = calculate_darkness_crit_penalty(
        run.current_floor,
        synergies.darkness_reduction_bps,
        torch_bearer,
    );
    let effective_crit_chance = base_crit_chance.saturating_sub(darkness_crit_penalty);
    let has_crit = effective_crit_chance > 0;
    let apply_crit = has_crit && crit_triggered;

    // Crit damage multiplier (150% base + relic bonus + synergy bonus)
    let crit_damage_mult = if apply_crit {
        let relic_crit_dmg = calculate_relic_crit_damage(&run) as u64;
        let synergy_crit_dmg = synergies.crit_damage_bps as u64;
        15000u64.saturating_add(relic_crit_dmg).saturating_add(synergy_crit_dmg) // 150% + bonuses
    } else {
        10000u64 // 100% (no crit)
    };

    // Get time period and theme for modifiers
    let time_period = TimePeriod::from_u8(run.time_period).unwrap_or(TimePeriod::Day);
    let dungeon_theme = DungeonTheme::from_u8(run.dungeon_theme).unwrap_or(DungeonTheme::Crypts);
    let is_first_light = TimePeriod::is_first_light(now);

    // Get hero specialization for bonuses
    let hero_spec = run.get_specialization();

    // Track actual attacks used to determine if prediction was accurate
    let mut attacks_used: u8 = 0;

    for _ in 0..attack_count {
        // Check if enemy still alive
        if run.enemy_health == 0 {
            break;
        }

        // Check if player still has units
        if run.is_wiped() {
            break;
        }

        // Count this attack
        attacks_used = attacks_used.saturating_add(1);

        // Calculate player damage
        let base_damage = calculate_dungeon_damage(
            &run,
            base_unit_power,
            player.hero_attack_bps,
            weapon_power,
            run.is_boss,
        );
        // Apply Warrior attack bonus (+20%) or Guardian penalty (-15%)
        let warrior_damage = apply_warrior_attack_bonus(base_damage, hero_spec);

        // Apply Hero's Blessing relic bonus (+25% hero effectiveness)
        let hero_bonus = calculate_relic_hero_bonus(&run);
        let hero_boosted_damage = if hero_bonus > 0 {
            apply_bp(warrior_damage, 10000u64 + hero_bonus as u64).unwrap_or(warrior_damage)
        } else {
            warrior_damage
        };

        // Apply crit damage multiplier (150% base + relic bonus on crit)
        let mut player_damage = apply_bp(hero_boosted_damage, crit_damage_mult).unwrap_or(hero_boosted_damage);

        // BOSS WRATH: Apply wrath defense reduction (boss takes more damage at high wrath)
        if run.is_boss && run.boss_wrath > 0 {
            let wrath_defense_mult = get_boss_wrath_defense(run.boss_wrath);
            if wrath_defense_mult < 10000 {
                // Boss takes MORE damage (multiply player damage)
                let bonus_mult = 10000u64.saturating_mul(10000) / (wrath_defense_mult as u64);
                player_damage = apply_bp(player_damage, bonus_mult).unwrap_or(player_damage);
            }
        }

        // Determine number of strikes (1 or 2 with Double Strike)
        let strike_count = if apply_double_strike { 2u8 } else { 1u8 };

        // Apply damage for each strike
        for _ in 0..strike_count {
            if run.enemy_health == 0 {
                break;
            }

            // FORGE BOSS: Damage goes to shield first
            let mut damage_to_deal = player_damage;
            if run.is_boss && run.boss_shield > 0 {
                let shield_damage = damage_to_deal.min(run.boss_shield);
                run.boss_shield = run.boss_shield.saturating_sub(shield_damage);
                damage_to_deal = damage_to_deal.saturating_sub(shield_damage);
                // OFFENSE synergy: Shield takes 2x damage
                if synergies.attack_bps >= 2500 {
                    run.boss_shield = run.boss_shield.saturating_sub(shield_damage); // Extra damage
                }
            }

            let actual_damage = damage_to_deal.min(run.enemy_health);
            run.enemy_health = run.enemy_health.saturating_sub(actual_damage);
            run.total_damage_dealt = run.total_damage_dealt.saturating_add(actual_damage);

            // BOSS WRATH: Update wrath after damage
            if run.is_boss {
                let old_wrath = run.boss_wrath;
                let total_damage_to_boss = run.enemy_max_health.saturating_sub(run.enemy_health);
                run.boss_wrath = calculate_boss_wrath(total_damage_to_boss, run.enemy_max_health);

                // Check for ability trigger at 50 wrath
                if should_trigger_boss_ability(old_wrath, run.boss_wrath) && !run.boss_ability_active {
                    run.boss_ability_active = true;
                    // Initialize ability based on theme
                    let ability = get_boss_ability(dungeon_theme, run.enemy_max_health, &run);
                    run.boss_ability_counter = ability.remaining_attacks;
                    if dungeon_theme == DungeonTheme::Forge {
                        run.boss_shield = ability.shield_hp;
                    }
                }
            }

            // CRYPTS BOSS: Boss heals from damage dealt (Soul Harvest)
            if run.is_boss && run.boss_ability_active && dungeon_theme == DungeonTheme::Crypts {
                // Check if player has SUSTAIN 3-piece (reverses lifesteal)
                if synergies.lifesteal_bps < 1000 { // No strong sustain counter
                    let boss_heal = apply_bp(actual_damage, 2000u64).unwrap_or(0); // 20% lifesteal
                    run.enemy_health = run.enemy_health.saturating_add(boss_heal).min(run.enemy_max_health);
                }
            }

            // Apply player lifesteal - heal units based on damage dealt
            if lifesteal_bps > 0 && actual_damage > 0 {
                let base_heal = apply_bp(actual_damage, lifesteal_bps as u64).unwrap_or(0);
                // Apply Warrior healing penalty (-10%)
                let heal_amount = apply_healing_modifier(base_heal, hero_spec);
                if heal_amount > 0 {
                    run.heal_units_by_hp(heal_amount);
                }
            }
        }

        // Enemy counterattack (if still alive)
        if run.enemy_health > 0 {
            let mut enemy_damage = calculate_enemy_damage(
                &run,
                run.enemy_power,
                run.is_boss,
            );

            // BOSS WRATH: Apply wrath damage multiplier
            if run.is_boss {
                let (wrath_damage_mult, wrath_attacks) = get_boss_wrath_damage(run.boss_wrath, &run);

                // Apply wrath damage multiplier
                if wrath_damage_mult > 10000 {
                    enemy_damage = apply_bp(enemy_damage, wrath_damage_mult as u64).unwrap_or(enemy_damage);
                }

                // ABYSS BOSS: Darkness multiplier (x3 darkness effects when ability active)
                if run.boss_ability_active && dungeon_theme == DungeonTheme::Abyss {
                    // Extra darkness damage (darkness already applied in calculate_enemy_damage)
                    // Apply 2x more since base already has 1x
                    let extra_darkness = apply_bp(enemy_damage, 2000u64).unwrap_or(0);
                    enemy_damage = enemy_damage.saturating_add(extra_darkness);
                }

                // Boss attacks multiple times at high wrath
                for attack_num in 0..wrath_attacks {
                    if run.is_wiped() {
                        break;
                    }

                    // CAVERNS BOSS: Defense pierce (Blood Frenzy)
                    let effective_defense = if run.boss_ability_active
                        && dungeon_theme == DungeonTheme::Caverns
                        && run.boss_ability_counter > 0
                    {
                        // Ignores player defense
                        if attack_num == 0 {
                            run.boss_ability_counter = run.boss_ability_counter.saturating_sub(1);
                        }
                        0 // No defense
                    } else {
                        player.research_defense_bps
                    };

                    let base_damage_taken = calculate_damage_taken(
                        &run,
                        enemy_damage,
                        effective_defense,
                    );
                    // Apply Guardian survival bonus (+25% damage reduction)
                    let damage_taken = apply_guardian_survival(base_damage_taken, hero_spec);

                    // Apply stalwart protection (min 1 unit survives per hit)
                    let protected_damage = if has_stalwart(&run) {
                        let total_hp = crate::helpers::dungeon::calculate_total_unit_hp(&run.remaining_units);
                        damage_taken.min(total_hp.saturating_sub(1))
                    } else {
                        damage_taken
                    };

                    // Apply damage to units
                    run.apply_unit_damage(protected_damage);
                    run.total_damage_taken = run.total_damage_taken.saturating_add(protected_damage);
                }
            } else {
                // Regular enemy (non-boss) - single attack
                let base_damage_taken = calculate_damage_taken(
                    &run,
                    enemy_damage,
                    player.research_defense_bps,
                );
                // Apply Guardian survival bonus (+25% damage reduction)
                let damage_taken = apply_guardian_survival(base_damage_taken, hero_spec);

                // Apply stalwart protection (min 1 unit survives per hit)
                let protected_damage = if has_stalwart(&run) {
                    let total_hp = crate::helpers::dungeon::calculate_total_unit_hp(&run.remaining_units);
                    damage_taken.min(total_hp.saturating_sub(1))
                } else {
                    damage_taken
                };

                // Apply damage to units
                run.apply_unit_damage(protected_damage);
                run.total_damage_taken = run.total_damage_taken.saturating_add(protected_damage);
            }
        }
    }

    // Check if attack_count estimate was accurate (enemy died on exact attack)
    let accurate_estimate = run.enemy_health == 0 && attacks_used == attack_count;

    // 8. Check for wipe
    if run.is_wiped() {
        // Check for Phoenix Feather (one-time resurrection)
        if has_phoenix_feather(&run) && run.relic_mask & (1 << 11) != 0 {
            // Resurrect with 25% of original DEFENSIVE units from dungeon entry
            run.remaining_units[0] = run.original_units[0] / 4;
            run.remaining_units[1] = run.original_units[1] / 4;
            run.remaining_units[2] = run.original_units[2] / 4;
            // Mark Phoenix Feather as used (clear the bit)
            run.relic_mask &= !(1 << 11);
        } else {
            // Run failed
            run.status = DungeonStatus::Failed as u8;

            emit!(DungeonFailed {
                player: *player_account.key(),
                player_name: player.name,
                dungeon_id: run.dungeon_id,
                floor: run.current_floor,
                room: run.current_room,
                enemies_killed: run.enemies_killed,
                timestamp: now,
            });

            return Ok(());
        }
    }

    // 9. Handle enemy death (auto-advance)
    if run.enemy_health == 0 {
        run.enemies_killed = run.enemies_killed.saturating_add(1);
        run.rooms_cleared = run.rooms_cleared.saturating_add(1);

        // Grant materials for enemy kill (1 base + floor/2, boss gets 10 + floor×3)
        let base_materials = if run.is_boss {
            10u32.saturating_add((run.current_floor as u32).saturating_mul(3))
        } else {
            1u32.saturating_add((run.current_floor as u32) / 2)
        };
        run.pending_materials = run.pending_materials.saturating_add(base_materials);

        // Grant room XP (2x bonus if attack_count estimate was accurate)
        let base_room_xp = calculate_room_xp(template.base_xp_per_room, run.current_floor);
        let mut room_xp = if accurate_estimate {
            base_room_xp.saturating_mul(2) // 2x XP for accurate estimate
        } else {
            base_room_xp
        };

        // Apply time-of-day XP bonus (Dawn +15%, First Light +50%)
        room_xp = calculate_xp_with_time(room_xp, time_period, is_first_light);

        run.pending_xp = run.pending_xp.saturating_add(room_xp);

        emit!(DungeonRoomCleared {
            player: *player_account.key(),
            player_name: player.name,
            dungeon_id: run.dungeon_id,
            floor: run.current_floor,
            room: run.current_room,
            xp_gained: room_xp,
            timestamp: now,
        });

        // Check if floor complete
        if run.current_room >= template.rooms_per_floor {
            // Floor complete - await relic selection
            run.status = DungeonStatus::AwaitingRelic as u8;

            // Grant floor NOVI
            let floor_novi = crate::helpers::dungeon::calculate_floor_novi(
                template.base_novi_per_floor,
                run.current_floor,
                crate::helpers::dungeon::has_golden_touch(&run),
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
                player: *player_account.key(),
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

            // Spawn next enemy if combat room
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
    }

    Ok(())
}
