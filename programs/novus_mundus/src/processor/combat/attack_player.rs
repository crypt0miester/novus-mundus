use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};

use crate::{
    constants::{PLAYER_SEED, PVP_ATTACK_RANGE_METERS},
    emit,
    error::GameError,
    events::{PlayerAttacked, PlayerLeveledUp, XpGained},
    helpers::{
        estate::{
            has_infirmary, infirmary_recovery_bps, load_estate_for_player,
            load_estate_for_player_mut,
        },
        event_scoring::update_event_score,
    },
    logic::{
        apply_time_multiplier, biome, calculate_damage_output, calculate_distance_meters,
        calculate_networth, calculate_xp_reward,
        combat::{resolve_weapon_combat, WeaponSet},
        get_time_of_day, grant_xp_with_time_bonus, inflict_damage,
        safe_math::{apply_bp, mul_div},
        update_happiness_defensive, ActivityType, XpAction,
    },
    state::{require_extension, CityAccount, PlayerAccount, EXT_RESEARCH},
    types::EventType,
    utils::read_u8,
    validation::{require_owner, require_pda, require_signer, require_writable},
};

/// PvP combat - attack another player
///
/// # Flow
/// 1. Validate attacker and defender are different players
/// 2. Validate both in same city (macro-level check)
/// 3. Validate both at same coordinates within city (micro-level check)
/// 4. Validate coordinates are within city bounds (anti-cheat)
/// 5. Calculate attacker damage output (defensive units + weapons)
/// 6. Calculate defender damage output (defensive units + weapons)
/// 7. Inflict mutual damage on both sides
/// 8. Calculate loot stolen (cash + equipment)
/// 9. Update both player states
/// 10. Update happiness and networth for both
///
/// # Accounts
/// - [writable] attacker_player: PlayerAccount PDA (attacker)
/// - [writable] defender_player: PlayerAccount PDA (defender)
/// - [signer] attacker_owner: Wallet that owns attacker account
/// - [] attacker_city: CityAccount PDA (for bounds validation)
/// - [] defender_city: CityAccount PDA (for bounds validation, may be same as attacker_city)
/// - [] game_engine: GameEngine PDA (for networth value config)
/// - [] attacker_estate: EstateAccount PDA (for Infirmary recovery)
/// - [] defender_estate: EstateAccount PDA (for Infirmary recovery)
/// - [writable] attacker_event_participation: (Optional) Attacker's EventParticipation PDA
/// - [writable] attacker_event: (Optional) Attacker's EventAccount PDA
/// - [writable] defender_event_participation: (Optional) Defender's EventParticipation PDA
/// - [writable] defender_event: (Optional) Defender's EventAccount PDA
///
/// # Instruction Data
/// - drive_by: bool (1 byte) - True for an Overrun: a 10k+ host charging for a √φ (~1.27×) damage bonus
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts (8 required, 4 optional event accounts)
    crate::extract_accounts!(
        accounts,
        [
            attacker_player,
            defender_player,
            attacker_owner,
            attacker_city,
            defender_city,
            game_engine,
            attacker_estate_account,
            defender_estate_account,
        ]
    );

    let (
        attacker_event_participation,
        attacker_event,
        defender_event_participation,
        defender_event,
    ) = if accounts.len() >= 12 {
        (
            Some(&accounts[8]),
            Some(&accounts[9]),
            Some(&accounts[10]),
            Some(&accounts[11]),
        )
    } else if accounts.len() >= 10 {
        (Some(&accounts[8]), Some(&accounts[9]), None, None)
    } else {
        (None, None, None, None)
    };

    // 2. Validate accounts
    require_signer(attacker_owner)?;
    require_writable(attacker_player)?;
    require_writable(defender_player)?;
    require_owner(attacker_player, program_id)?;
    require_owner(defender_player, program_id)?;
    require_owner(&attacker_city, program_id)?;
    if attacker_city.address() != defender_city.address() {
        require_owner(&defender_city, program_id)?;
    }

    let attacker_bump = require_pda(
        attacker_player,
        &[
            PLAYER_SEED,
            game_engine.address().as_ref(),
            attacker_owner.address().as_ref(),
        ],
        program_id,
    )?;

    // 3. Parse instruction data
    let drive_by = read_u8(data, 0, "drive_by")? != 0;

    // 4. Load player data
    let mut attacker_data = attacker_player.try_borrow_mut()?;
    let mut defender_data = defender_player.try_borrow_mut()?;

    let attacker_data = unsafe { PlayerAccount::load_mut(&mut attacker_data) };

    let defender_data = unsafe { PlayerAccount::load_mut(&mut defender_data) };

    // Validate defender PDA (CRITICAL: prevents fake defender accounts)
    let defender_bump = require_pda(
        defender_player,
        &[
            PLAYER_SEED,
            defender_data.game_engine.as_ref(),
            defender_data.owner.as_ref(),
        ],
        program_id,
    )?;
    if defender_data.bump != defender_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // Load GameEngine for networth value config
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine_data = crate::state::GameEngine::load_checked_by_key(game_engine, program_id)?;
    let economic_config = &game_engine_data.economic_config;

    // Verify attacker ownership and bump
    if &attacker_data.owner != attacker_owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    if attacker_data.bump != attacker_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4a. Require EXT_RESEARCH for PvP (attacker must have started research)
    require_extension(attacker_data, EXT_RESEARCH)?;

    // 5. Validate cannot attack self
    if attacker_player.address() == defender_player.address() {
        return Err(GameError::CannotAttackSelf.into());
    }

    // 5a. Validate attacker not traveling
    if attacker_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 5b. Validate defender not traveling
    if defender_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 5c. Validate attacker not in active rally (can't risk losing units before rally executes)
    // Note: Defender NOT blocked - being attacked shouldn't prevent self-defense
    if attacker_data.rally_stats().current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // 6. DUAL-LEVEL LOCATION VALIDATION

    // 6a. City-level check (macro): Must be in same city
    if attacker_data.current_city != defender_data.current_city {
        return Err(GameError::PlayersNotInSameCity.into());
    }

    // 6b. Load city accounts for bounds validation
    let attacker_city_data = unsafe { CityAccount::load(&attacker_city)? };

    // Defender city might be same account as attacker city (if in same city)
    // So we can't borrow mutably if they're the same
    let defender_city_data = if attacker_city.address() == defender_city.address() {
        attacker_city_data
    } else {
        unsafe { CityAccount::load(&defender_city)? }
    };

    // 6c. Validate city accounts match player claims
    if attacker_data.current_city != attacker_city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }
    if defender_data.current_city != defender_city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }

    // 6d. Bounds check (security): Verify coordinates are within claimed city (AABB).
    if !attacker_city_data.contains_coord(attacker_data.current_lat, attacker_data.current_long) {
        return Err(GameError::InvalidLocationForCity.into());
    }

    if !defender_city_data.contains_coord(defender_data.current_lat, defender_data.current_long) {
        return Err(GameError::InvalidLocationForCity.into());
    }

    // 6e. Coordinate-level check (micro): Must be within attack range (10 meters)
    let distance_meters = calculate_distance_meters(
        attacker_data.current_lat,
        attacker_data.current_long,
        defender_data.current_lat,
        defender_data.current_long,
    );

    if distance_meters > PVP_ATTACK_RANGE_METERS {
        return Err(GameError::OutOfRange.into());
    }

    // 6f. Check new player protection (prevent attacking protected players)
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    if defender_data.new_player_protection_until > now {
        return Err(GameError::TargetIsProtected.into());
    }

    // 6g. Revoke attacker's protection if they attack (no griefing with impunity)
    // If you attack another player, you lose new player protection immediately
    if attacker_data.new_player_protection_until > now {
        attacker_data.new_player_protection_until = now;
    }

    // 7. Validate attacker has defensive units
    let attacker_defensive_total = attacker_data.total_defensive_units();
    if attacker_defensive_total == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 8. Get defender's defensive units (can be 0 - undefended targets are valid)
    // Include reinforcements from teammates
    let defender_defensive_total = defender_data.total_defense_with_reinforcements();

    // Set BEFORE damage calc so the override flows into the formula.
    let mut attacker_hero_attack_bps = attacker_data.hero_attack_bps();
    let mut attacker_hero_crit_chance_bps = attacker_data.hero_crit_chance_bps();
    match attacker_data.live_pending_effect(now) {
        crate::state::PENDING_CRIT_NEXT => {
            // Force 100% crit (10000 bps caps inside the formula's threshold)
            attacker_hero_crit_chance_bps = attacker_hero_crit_chance_bps.saturating_add(10000);
            attacker_data.clear_pending_effect();
        }
        crate::state::PENDING_BUFF_NEXT => {
            let stat = attacker_data.pending_effect_stat();
            let bps = attacker_data.pending_effect_param();
            // Offensive stats: AttackPower(1), CritChance(7), EncounterDamage(14)
            if matches!(stat, 1 | 7 | 14) {
                match stat {
                    1 | 14 => {
                        attacker_hero_attack_bps = attacker_hero_attack_bps.saturating_add(bps)
                    }
                    7 => {
                        attacker_hero_crit_chance_bps =
                            attacker_hero_crit_chance_bps.saturating_add(bps)
                    }
                    _ => {}
                }
                attacker_data.clear_pending_effect();
            }
        }
        _ => {}
    }

    // 9. Calculate attacker damage output (PURE LOGIC)
    let gameplay_config = &game_engine_data.gameplay_config;

    // Apply research buffs and hero buffs for attacker
    let base_attacker_damage = calculate_damage_output(
        attacker_defensive_total,
        attacker_data.total_weapons(),
        drive_by,
        gameplay_config,
        attacker_data.research_attack_bps(),
        attacker_data.research_crit_chance_bps(),
        attacker_data.research_crit_damage_bps(),
        attacker_hero_attack_bps,
        attacker_data.hero_weapon_efficiency_bps(),
        attacker_hero_crit_chance_bps,
        attacker_data.equipped_weapon_bonus_bps(),
    );

    // 9a. Apply Time-of-Day Bonus to Attack (DETERMINISTIC)
    // Attacking is best at night (DeepNight gives φ), worst at Midday (1/φ)
    let time_of_day = get_time_of_day(now, attacker_data.current_long);
    let attacker_damage =
        apply_time_multiplier(base_attacker_damage, time_of_day, ActivityType::Attacking);

    // 9b. Compute biome combat advantage (replaces elevation high-ground bonus).
    // Attacker biome's combat_bps minus defender biome's combat_bps; signed.
    // Sampled at each player's actual cell within their respective city's grid.
    let combat_bps_net: i32 = {
        let (att_ox, att_oy) =
            attacker_city_data.offset_for(attacker_data.current_lat, attacker_data.current_long);
        let (def_ox, def_oy) =
            defender_city_data.offset_for(defender_data.current_lat, defender_data.current_long);
        let att = biome::biome_affinity(attacker_city_data.biome_at_offset(att_ox, att_oy));
        let def = biome::biome_affinity(defender_city_data.biome_at_offset(def_ox, def_oy));
        att.combat_bps as i32 - def.combat_bps as i32
    };

    // Apply biome combat advantage to attacker damage (positive net = attacker bonus).
    let attacker_damage = if combat_bps_net != 0 {
        let m = 10000i32.saturating_add(combat_bps_net).max(5000) as u64;
        attacker_damage.saturating_mul(m) / 10000
    } else {
        attacker_damage
    };

    if attacker_damage == 0 {
        return Err(GameError::InsufficientAttackPower.into());
    }

    // 10. Calculate defender damage output (PURE LOGIC)
    // Defenders never get drive-by bonus, but do get defense research buffs and hero buffs
    // Include reinforcement weapons and use best hero buffs (max of own and reinforcement)
    let defender_total_weapons = defender_data.total_weapons_with_reinforcements();
    let mut defender_hero_defense_bps = defender_data
        .hero_defense_bps()
        .max(defender_data.reinforcement_hero_defense_bps());
    let defender_hero_weapon_eff_bps = defender_data
        .hero_weapon_efficiency_bps()
        .max(defender_data.reinforcement_hero_weapon_eff_bps());

    // ShieldNext doubles effective defense via additive bps. The formula uses
    // (10000 + bps)/10000, so adding 10000 to the current value doubles the
    // multiplier — benefits both inbound armor reduction and counter-damage.
    match defender_data.live_pending_effect(now) {
        crate::state::PENDING_SHIELD_NEXT => {
            defender_hero_defense_bps = defender_hero_defense_bps.saturating_add(10000);
            defender_data.clear_pending_effect();
        }
        crate::state::PENDING_BUFF_NEXT => {
            let stat = defender_data.pending_effect_stat();
            let bps = defender_data.pending_effect_param();
            // Defensive stats: DefensePower(2), ArmorEfficiency(16)
            if matches!(stat, 2 | 16) {
                if stat == 2 {
                    defender_hero_defense_bps = defender_hero_defense_bps.saturating_add(bps);
                }
                // TODO(armor-eff): apply ArmorEfficiency variant of BuffNext.
                defender_data.clear_pending_effect();
            }
        }
        _ => {}
    }

    let base_defender_damage = calculate_damage_output(
        defender_defensive_total,
        defender_total_weapons,
        false,
        gameplay_config,
        defender_data.research_defense_bps(),
        0, // Defenders don't get crit chance on defense
        0, // Defenders don't get crit damage on defense
        defender_hero_defense_bps,
        defender_hero_weapon_eff_bps,
        0, // Defenders don't get hero crit chance on defense
        defender_data.equipped_weapon_bonus_bps(),
    );

    // 10a. Apply Time-of-Day Bonus to Defense (DETERMINISTIC)
    // Defending is best during day (Midday gives φ), worst at DeepNight (1/φ)
    // Note: Use attacker's location for time calculation (both at same location anyway)
    let defender_damage =
        apply_time_multiplier(base_defender_damage, time_of_day, ActivityType::Defending);

    // 10b. Apply biome combat advantage to defender (inverse of attacker's swing).
    // If attacker's biome favours them, defender's counterattack is weaker.
    let defender_damage = if combat_bps_net != 0 {
        let m = 10000i32.saturating_sub(combat_bps_net).max(5000) as u64;
        defender_damage.saturating_mul(m) / 10000
    } else {
        defender_damage
    };

    // 11. Inflict damage on defender's defensive units (PURE LOGIC)
    // Defender's armor reduces incoming damage (boosted by hero armor efficiency + equipped armor)
    // Use best armor efficiency from own hero or reinforcement heroes
    let defender_hero_armor_eff_bps = defender_data
        .hero_armor_efficiency_bps()
        .max(defender_data.reinforcement_hero_armor_eff_bps());

    // Capture originals for wounded tracking
    let orig_defender_own_def_1 = defender_data.defensive_unit_1;
    let orig_defender_own_def_2 = defender_data.defensive_unit_2;
    let orig_defender_own_def_3 = defender_data.defensive_unit_3;
    let orig_attacker_def_1 = attacker_data.defensive_unit_1;
    let orig_attacker_def_2 = attacker_data.defensive_unit_2;
    let orig_attacker_def_3 = attacker_data.defensive_unit_3;

    // Calculate total combined units for damage distribution
    let combined_def_1 = defender_data
        .defensive_unit_1
        .saturating_add(defender_data.reinforcement_def_1());
    let combined_def_2 = defender_data
        .defensive_unit_2
        .saturating_add(defender_data.reinforcement_def_2());
    let combined_def_3 = defender_data
        .defensive_unit_3
        .saturating_add(defender_data.reinforcement_def_3());

    let (remaining_1, remaining_2, remaining_3) = inflict_damage(
        combined_def_1,
        combined_def_2,
        combined_def_3,
        defender_data.armor_pieces,
        attacker_damage as f64,
        gameplay_config,
        defender_hero_armor_eff_bps,
        defender_data.equipped_armor_bonus_bps(),
    );

    // 11a. Infirmary recovery for defender (reduce unit losses)
    let (remaining_1, remaining_2, remaining_3) =
        if unsafe { defender_estate_account.owner() } == program_id {
            let defender_estate =
                load_estate_for_player(defender_estate_account, &*defender_data, program_id)?;
            let recovery_bps = infirmary_recovery_bps(defender_estate);
            if recovery_bps > 0 {
                let lost_1 = combined_def_1.saturating_sub(remaining_1);
                let lost_2 = combined_def_2.saturating_sub(remaining_2);
                let lost_3 = combined_def_3.saturating_sub(remaining_3);
                (
                    remaining_1.saturating_add(lost_1.saturating_mul(recovery_bps as u64) / 10000),
                    remaining_2.saturating_add(lost_2.saturating_mul(recovery_bps as u64) / 10000),
                    remaining_3.saturating_add(lost_3.saturating_mul(recovery_bps as u64) / 10000),
                )
            } else {
                (remaining_1, remaining_2, remaining_3)
            }
        } else {
            (remaining_1, remaining_2, remaining_3)
        };

    let defender_units_lost = defender_defensive_total.saturating_sub(
        remaining_1
            .saturating_add(remaining_2)
            .saturating_add(remaining_3),
    );

    // Distribute remaining units between own and reinforcement proportionally
    // Using the original ratio before combat

    // For each tier, split remaining units back to own vs reinforcement
    // Own gets (remaining × own_fraction), reinforcement gets the rest
    let def_unit_1 = if combined_def_1 > 0 {
        let own_original_ratio =
            defender_data.defensive_unit_1.saturating_mul(10000) / combined_def_1;
        remaining_1.saturating_mul(own_original_ratio) / 10000
    } else {
        0
    };
    let reinf_unit_1 = remaining_1.saturating_sub(def_unit_1);

    let def_unit_2 = if combined_def_2 > 0 {
        let own_original_ratio =
            defender_data.defensive_unit_2.saturating_mul(10000) / combined_def_2;
        remaining_2.saturating_mul(own_original_ratio) / 10000
    } else {
        0
    };
    let reinf_unit_2 = remaining_2.saturating_sub(def_unit_2);

    let def_unit_3 = if combined_def_3 > 0 {
        let own_original_ratio =
            defender_data.defensive_unit_3.saturating_mul(10000) / combined_def_3;
        remaining_3.saturating_mul(own_original_ratio) / 10000
    } else {
        0
    };
    let reinf_unit_3 = remaining_3.saturating_sub(def_unit_3);

    // Update defender's own units
    defender_data.defensive_unit_1 = def_unit_1;
    defender_data.defensive_unit_2 = def_unit_2;
    defender_data.defensive_unit_3 = def_unit_3;

    // Update reinforcement aggregates
    defender_data.set_reinforcement_def_1(reinf_unit_1);
    defender_data.set_reinforcement_def_2(reinf_unit_2);
    defender_data.set_reinforcement_def_3(reinf_unit_3);

    // 11b. Operative attrition — if entire garrison is wiped, operatives are unprotected
    // and take the same damage. Only triggers when ALL defensive units (own + reinforcement) = 0.
    let orig_defender_op_1 = defender_data.operative_unit_1;
    let orig_defender_op_2 = defender_data.operative_unit_2;
    let orig_defender_op_3 = defender_data.operative_unit_3;

    let garrison_wiped = def_unit_1 == 0
        && def_unit_2 == 0
        && def_unit_3 == 0
        && reinf_unit_1 == 0
        && reinf_unit_2 == 0
        && reinf_unit_3 == 0;

    if garrison_wiped && defender_data.total_operative_units() > 0 {
        let (op_remaining_1, op_remaining_2, op_remaining_3) = inflict_damage(
            defender_data.operative_unit_1,
            defender_data.operative_unit_2,
            defender_data.operative_unit_3,
            defender_data.armor_pieces,
            attacker_damage as f64,
            gameplay_config,
            defender_hero_armor_eff_bps,
            defender_data.equipped_armor_bonus_bps(),
        );

        // Infirmary recovery for operative losses
        let (op_remaining_1, op_remaining_2, op_remaining_3) =
            if unsafe { defender_estate_account.owner() } == program_id {
                let defender_estate =
                    load_estate_for_player(defender_estate_account, &*defender_data, program_id)?;
                let recovery_bps = infirmary_recovery_bps(defender_estate);
                if recovery_bps > 0 {
                    let lost_1 = defender_data
                        .operative_unit_1
                        .saturating_sub(op_remaining_1);
                    let lost_2 = defender_data
                        .operative_unit_2
                        .saturating_sub(op_remaining_2);
                    let lost_3 = defender_data
                        .operative_unit_3
                        .saturating_sub(op_remaining_3);
                    (
                        op_remaining_1
                            .saturating_add(lost_1.saturating_mul(recovery_bps as u64) / 10000),
                        op_remaining_2
                            .saturating_add(lost_2.saturating_mul(recovery_bps as u64) / 10000),
                        op_remaining_3
                            .saturating_add(lost_3.saturating_mul(recovery_bps as u64) / 10000),
                    )
                } else {
                    (op_remaining_1, op_remaining_2, op_remaining_3)
                }
            } else {
                (op_remaining_1, op_remaining_2, op_remaining_3)
            };

        defender_data.operative_unit_1 = op_remaining_1;
        defender_data.operative_unit_2 = op_remaining_2;
        defender_data.operative_unit_3 = op_remaining_3;
    }

    // 12. Inflict damage on attacker's defensive units (PURE LOGIC)
    // Attacker's armor protects defensive units in counter-attack (boosted by hero armor efficiency + equipped armor)
    let (att_unit_1, att_unit_2, att_unit_3) = inflict_damage(
        attacker_data.defensive_unit_1,
        attacker_data.defensive_unit_2,
        attacker_data.defensive_unit_3,
        attacker_data.armor_pieces,
        defender_damage as f64,
        gameplay_config,
        attacker_data.hero_armor_efficiency_bps(),
        attacker_data.equipped_armor_bonus_bps(),
    );

    // 12a. Infirmary recovery for attacker (reduce unit losses)
    let (att_unit_1, att_unit_2, att_unit_3) =
        if unsafe { attacker_estate_account.owner() } == program_id {
            let attacker_estate =
                load_estate_for_player(attacker_estate_account, &*attacker_data, program_id)?;
            let recovery_bps = infirmary_recovery_bps(attacker_estate);
            if recovery_bps > 0 {
                let lost_1 = attacker_data.defensive_unit_1.saturating_sub(att_unit_1);
                let lost_2 = attacker_data.defensive_unit_2.saturating_sub(att_unit_2);
                let lost_3 = attacker_data.defensive_unit_3.saturating_sub(att_unit_3);
                (
                    att_unit_1.saturating_add(lost_1.saturating_mul(recovery_bps as u64) / 10000),
                    att_unit_2.saturating_add(lost_2.saturating_mul(recovery_bps as u64) / 10000),
                    att_unit_3.saturating_add(lost_3.saturating_mul(recovery_bps as u64) / 10000),
                )
            } else {
                (att_unit_1, att_unit_2, att_unit_3)
            }
        } else {
            (att_unit_1, att_unit_2, att_unit_3)
        };

    let attacker_units_lost = attacker_defensive_total.saturating_sub(
        att_unit_1
            .saturating_add(att_unit_2)
            .saturating_add(att_unit_3),
    );

    attacker_data.defensive_unit_1 = att_unit_1;
    attacker_data.defensive_unit_2 = att_unit_2;
    attacker_data.defensive_unit_3 = att_unit_3;

    // 12b. Track wounded units on estates (Infirmary feature)
    // Only if estate exists (owned by this program) — players without estates skip wounded tracking
    // Defender: own defensive unit losses → wounded_def_*, operative losses → wounded_op_*
    if unsafe { defender_estate_account.owner() } == program_id {
        let defender_estate =
            load_estate_for_player_mut(defender_estate_account, &*defender_data, program_id)?;
        if has_infirmary(defender_estate) {
            let def_lost_1 = orig_defender_own_def_1.saturating_sub(def_unit_1) as u32;
            let def_lost_2 = orig_defender_own_def_2.saturating_sub(def_unit_2) as u32;
            let def_lost_3 = orig_defender_own_def_3.saturating_sub(def_unit_3) as u32;
            let w1 = defender_estate
                .get_wounded_def_1()
                .saturating_add(def_lost_1);
            let w2 = defender_estate
                .get_wounded_def_2()
                .saturating_add(def_lost_2);
            let w3 = defender_estate
                .get_wounded_def_3()
                .saturating_add(def_lost_3);
            defender_estate.set_wounded_def_1(w1);
            defender_estate.set_wounded_def_2(w2);
            defender_estate.set_wounded_def_3(w3);

            // Operative wounded (only if garrison was wiped)
            if garrison_wiped {
                let op_lost_1 =
                    orig_defender_op_1.saturating_sub(defender_data.operative_unit_1) as u32;
                let op_lost_2 =
                    orig_defender_op_2.saturating_sub(defender_data.operative_unit_2) as u32;
                let op_lost_3 =
                    orig_defender_op_3.saturating_sub(defender_data.operative_unit_3) as u32;
                let wo1 = defender_estate.get_wounded_op_1().saturating_add(op_lost_1);
                let wo2 = defender_estate.get_wounded_op_2().saturating_add(op_lost_2);
                let wo3 = defender_estate.get_wounded_op_3().saturating_add(op_lost_3);
                defender_estate.set_wounded_op_1(wo1);
                defender_estate.set_wounded_op_2(wo2);
                defender_estate.set_wounded_op_3(wo3);
            }
        }
    }
    // Attacker: defensive unit losses from counter-attack → wounded_def_*
    if unsafe { attacker_estate_account.owner() } == program_id {
        let attacker_estate =
            load_estate_for_player_mut(attacker_estate_account, &*attacker_data, program_id)?;
        if has_infirmary(attacker_estate) {
            let att_lost_1 = orig_attacker_def_1.saturating_sub(att_unit_1) as u32;
            let att_lost_2 = orig_attacker_def_2.saturating_sub(att_unit_2) as u32;
            let att_lost_3 = orig_attacker_def_3.saturating_sub(att_unit_3) as u32;
            let w1 = attacker_estate
                .get_wounded_def_1()
                .saturating_add(att_lost_1);
            let w2 = attacker_estate
                .get_wounded_def_2()
                .saturating_add(att_lost_2);
            let w3 = attacker_estate
                .get_wounded_def_3()
                .saturating_add(att_lost_3);
            attacker_estate.set_wounded_def_1(w1);
            attacker_estate.set_wounded_def_2(w2);
            attacker_estate.set_wounded_def_3(w3);
        }
    }

    // 12a. WEAPON COMBAT RESOLUTION
    // Attacker's weapons (equipped by defensive units)
    let attacker_weapons = WeaponSet::new(
        attacker_data.melee_weapons.min(attacker_defensive_total),
        attacker_data.ranged_weapons.min(attacker_defensive_total),
        attacker_data.siege_weapons.min(attacker_defensive_total),
    );

    // Defender's combined weapons (own + reinforcement, equipped by combined defensive units)
    let combined_melee = defender_data
        .melee_weapons
        .saturating_add(defender_data.reinforcement_melee());
    let combined_ranged = defender_data
        .ranged_weapons
        .saturating_add(defender_data.reinforcement_ranged());
    let combined_siege = defender_data
        .siege_weapons
        .saturating_add(defender_data.reinforcement_siege());

    let defender_equipped_weapons = WeaponSet::new(
        combined_melee.min(defender_defensive_total),
        combined_ranged.min(defender_defensive_total),
        combined_siege.min(defender_defensive_total),
    );

    // Defender's stored weapons (entire inventory for armory raid - only own, not reinforcement)
    // Reinforcement weapons can't be raided from armory, they return to their owners
    let defender_stored_weapons = WeaponSet::new(
        defender_data.melee_weapons,
        defender_data.ranged_weapons,
        defender_data.siege_weapons,
    );

    // Check if defender has operatives (for fallback defense calculation)
    let has_operatives = defender_data.total_operative_units() > 0;

    // Resolve weapon combat
    let weapon_result = resolve_weapon_combat(
        attacker_defensive_total,
        attacker_units_lost,
        attacker_weapons,
        attacker_damage,
        defender_defensive_total,
        defender_units_lost,
        defender_equipped_weapons,
        defender_stored_weapons,
        has_operatives,
    );

    // 13. Determine winner and transfer loot (ONLY if attacker wins)
    let attacker_won = weapon_result.attacker_won;

    if attacker_won {
        // 13a. Calculate loot percentage in basis points (DAO-controlled) - FULLY DETERMINISTIC
        // Uses single base value from config (no min/max randomness!)
        // Default: 1000 bp = 10% base loot
        // Buff stacking: Base × (1 + research) × (1 + hero_loot) × (1 + hero_luck)
        let mut loot_bps = gameplay_config.pvp_loot_percentage_base as u64;

        // Apply research loot bonus (multiplicative)
        if attacker_data.research_loot_bonus_bps() > 0 {
            let multiplier = 10000u64.saturating_add(attacker_data.research_loot_bonus_bps() as u64);
            loot_bps = loot_bps.saturating_mul(multiplier) / 10000;
        }

        // Apply hero loot bonus (multiplicative)
        if attacker_data.hero_loot_bonus_bps() > 0 {
            let multiplier = 10000u64.saturating_add(attacker_data.hero_loot_bonus_bps() as u64);
            loot_bps = loot_bps.saturating_mul(multiplier) / 10000;
        }

        // Cap at 100%
        loot_bps = loot_bps.min(10000);

        // 13b. Steal from cash_on_hand (no protection, no u128!)
        let cash_from_hand = apply_bp(defender_data.cash_on_hand, loot_bps).unwrap_or(0);

        // 13c. Steal from cash_in_vault (with safebox protection)
        // Safebox protects X% of vault (e.g., 7500 bps = 75% protected, only 25% can be stolen)
        let unprotected_vault_bps =
            10000u64.saturating_sub(gameplay_config.safebox_protection_percent as u64);
        let unprotected_vault =
            apply_bp(defender_data.cash_in_vault, unprotected_vault_bps).unwrap_or(0);

        let cash_from_vault = apply_bp(unprotected_vault, loot_bps).unwrap_or(0);

        let cash_stolen = cash_from_hand.saturating_add(cash_from_vault);

        // 13d. Steal non-weapon equipment (armor, produce, vehicles via loot_bps)
        let armor_stolen = apply_bp(defender_data.armor_pieces, loot_bps).unwrap_or(0);
        let produce_stolen = apply_bp(defender_data.produce, loot_bps).unwrap_or(0);
        let vehicles_stolen = apply_bp(defender_data.vehicles, loot_bps).unwrap_or(0);

        // 14. Transfer cash and non-weapon loot from defender to attacker
        defender_data.cash_on_hand = defender_data.cash_on_hand.saturating_sub(cash_from_hand);
        defender_data.cash_in_vault = defender_data.cash_in_vault.saturating_sub(cash_from_vault);
        defender_data.armor_pieces = defender_data.armor_pieces.saturating_sub(armor_stolen);
        defender_data.produce = defender_data.produce.saturating_sub(produce_stolen);
        defender_data.vehicles = defender_data.vehicles.saturating_sub(vehicles_stolen);

        attacker_data.cash_on_hand = attacker_data.cash_on_hand.saturating_add(cash_stolen);
        attacker_data.armor_pieces = attacker_data.armor_pieces.saturating_add(armor_stolen);
        attacker_data.produce = attacker_data.produce.saturating_add(produce_stolen);
        attacker_data.vehicles = attacker_data.vehicles.saturating_add(vehicles_stolen);

        // 14a. WEAPON LOOT via Combat Resolution (not loot_bps)
        // Attacker loots: 60% of defender's dropped weapons + armory raid
        // Attacker keeps: 80% of own dropped weapons recovered
        let looted = weapon_result.attacker_weapons_looted;
        let recovered = weapon_result.attacker_weapons_returned;

        // Calculate defender's weapon casualty ratio (weapons die with units)
        // u64 mul_div: bit-identical to the old u128 path (result is a bps ≤
        // 10000, units ≪ 1.8e15) and returns 0 when the divisor is 0.
        let defender_casualty_bps =
            mul_div(defender_units_lost, 10000, defender_defensive_total).unwrap_or(0);

        // Reinforcement weapons (die proportionally, not lootable)
        let reinf_melee_lost =
            apply_bp(defender_data.reinforcement_melee(), defender_casualty_bps).unwrap_or(0);
        let reinf_ranged_lost =
            apply_bp(defender_data.reinforcement_ranged(), defender_casualty_bps).unwrap_or(0);
        let reinf_siege_lost =
            apply_bp(defender_data.reinforcement_siege(), defender_casualty_bps).unwrap_or(0);

        defender_data.set_reinforcement_melee(
            defender_data
                .reinforcement_melee()
                .saturating_sub(reinf_melee_lost),
        );
        defender_data.set_reinforcement_ranged(
            defender_data
                .reinforcement_ranged()
                .saturating_sub(reinf_ranged_lost),
        );
        defender_data.set_reinforcement_siege(
            defender_data
                .reinforcement_siege()
                .saturating_sub(reinf_siege_lost),
        );

        // Deduct looted weapons from defender's OWN weapons (not reinforcement)
        // Note: looted may exceed casualty losses due to armory raid
        defender_data.melee_weapons = defender_data.melee_weapons.saturating_sub(looted.melee);
        defender_data.ranged_weapons = defender_data.ranged_weapons.saturating_sub(looted.ranged);
        defender_data.siege_weapons = defender_data.siege_weapons.saturating_sub(looted.siege);

        // Attacker loses weapons proportional to casualties, but recovers 80% and loots enemy
        // First: deduct weapons lost to casualties
        let weapons_lost_melee = attacker_weapons.melee.saturating_sub(recovered.melee);
        let weapons_lost_ranged = attacker_weapons.ranged.saturating_sub(recovered.ranged);
        let weapons_lost_siege = attacker_weapons.siege.saturating_sub(recovered.siege);

        attacker_data.melee_weapons = attacker_data
            .melee_weapons
            .saturating_sub(weapons_lost_melee)
            .saturating_add(looted.melee);
        attacker_data.ranged_weapons = attacker_data
            .ranged_weapons
            .saturating_sub(weapons_lost_ranged)
            .saturating_add(looted.ranged);
        attacker_data.siege_weapons = attacker_data
            .siege_weapons
            .saturating_sub(weapons_lost_siege)
            .saturating_add(looted.siege);
    } else {
        // 14b. ATTACKER LOST - Defender loots attacker's dropped weapons
        // Defender receives 60% of attacker's weapons from dead troops
        let defender_looted = weapon_result.defender_weapons_looted;

        // Deduct lost weapons from attacker (proportional to casualties)
        let casualty_ratio_bps =
            mul_div(attacker_units_lost, 10000, attacker_defensive_total).unwrap_or(0);

        let attacker_melee_lost = apply_bp(attacker_weapons.melee, casualty_ratio_bps).unwrap_or(0);
        let attacker_ranged_lost =
            apply_bp(attacker_weapons.ranged, casualty_ratio_bps).unwrap_or(0);
        let attacker_siege_lost = apply_bp(attacker_weapons.siege, casualty_ratio_bps).unwrap_or(0);

        attacker_data.melee_weapons = attacker_data
            .melee_weapons
            .saturating_sub(attacker_melee_lost);
        attacker_data.ranged_weapons = attacker_data
            .ranged_weapons
            .saturating_sub(attacker_ranged_lost);
        attacker_data.siege_weapons = attacker_data
            .siege_weapons
            .saturating_sub(attacker_siege_lost);

        // Calculate defender's weapon casualty ratio (weapons die with units even if defender wins)
        // u64 mul_div: bit-identical to the old u128 path (result is a bps ≤
        // 10000, units ≪ 1.8e15) and returns 0 when the divisor is 0.
        let defender_casualty_bps =
            mul_div(defender_units_lost, 10000, defender_defensive_total).unwrap_or(0);

        // Apply weapon losses to defender's own weapons
        let own_melee_lost =
            apply_bp(defender_data.melee_weapons, defender_casualty_bps).unwrap_or(0);
        let own_ranged_lost =
            apply_bp(defender_data.ranged_weapons, defender_casualty_bps).unwrap_or(0);
        let own_siege_lost =
            apply_bp(defender_data.siege_weapons, defender_casualty_bps).unwrap_or(0);

        defender_data.melee_weapons = defender_data.melee_weapons.saturating_sub(own_melee_lost);
        defender_data.ranged_weapons = defender_data.ranged_weapons.saturating_sub(own_ranged_lost);
        defender_data.siege_weapons = defender_data.siege_weapons.saturating_sub(own_siege_lost);

        // Apply weapon losses to reinforcement weapons (die proportionally)
        let reinf_melee_lost =
            apply_bp(defender_data.reinforcement_melee(), defender_casualty_bps).unwrap_or(0);
        let reinf_ranged_lost =
            apply_bp(defender_data.reinforcement_ranged(), defender_casualty_bps).unwrap_or(0);
        let reinf_siege_lost =
            apply_bp(defender_data.reinforcement_siege(), defender_casualty_bps).unwrap_or(0);

        defender_data.set_reinforcement_melee(
            defender_data
                .reinforcement_melee()
                .saturating_sub(reinf_melee_lost),
        );
        defender_data.set_reinforcement_ranged(
            defender_data
                .reinforcement_ranged()
                .saturating_sub(reinf_ranged_lost),
        );
        defender_data.set_reinforcement_siege(
            defender_data
                .reinforcement_siege()
                .saturating_sub(reinf_siege_lost),
        );

        // Defender gains looted weapons from dead attackers (goes to own inventory)
        defender_data.melee_weapons = defender_data
            .melee_weapons
            .saturating_add(defender_looted.melee);
        defender_data.ranged_weapons = defender_data
            .ranged_weapons
            .saturating_add(defender_looted.ranged);
        defender_data.siege_weapons = defender_data
            .siege_weapons
            .saturating_add(defender_looted.siege);
    }

    // 15. Update combat stats
    attacker_data.total_attacks = attacker_data.total_attacks.saturating_add(1);
    attacker_data.total_attack_power = attacker_data
        .total_attack_power
        .saturating_add(attacker_damage);

    // 16. Update happiness for both players (PURE LOGIC)
    attacker_data.happiness_defensive = update_happiness_defensive(
        attacker_data.total_defensive_units(),
        attacker_data.total_weapons(),
        attacker_data.produce,
        attacker_data.armor_pieces,
    );

    defender_data.happiness_defensive = update_happiness_defensive(
        defender_data.total_defensive_units(),
        defender_data.total_weapons(),
        defender_data.produce,
        defender_data.armor_pieces,
    );

    // 17. Grant XP to attacker if they win (with time-of-day bonus)
    // Golden hours (Dawn/Dusk) give φ² (2.618x) XP for enlightenment!
    let attacker_xp_gained = if attacker_won {
        let base_xp = calculate_xp_reward(XpAction::DefeatPlayer {
            target_level: defender_data.level,
        });
        let old_level = attacker_data.level;
        let (levels_gained, new_level, _) = grant_xp_with_time_bonus(attacker_data, base_xp, now)?;

        // Emit XP gained event
        emit!(XpGained {
            player: *attacker_player.address(),
            player_name: attacker_data.name,
            amount: base_xp,
            source: 0, // 0=combat
            total_xp: attacker_data.current_xp,
            timestamp: now,
        });

        // Emit level up event if player leveled
        if levels_gained > 0 {
            emit!(PlayerLeveledUp {
                player: *attacker_player.address(),
                player_name: attacker_data.name,
                old_level: old_level.into(),
                new_level: new_level.into(),
                timestamp: now,
            });
        }

        // Return base_xp for event scoring (deterministic)
        base_xp
    } else {
        0
    };

    // 18. Update networth for both players (PURE LOGIC)
    attacker_data.networth = calculate_networth(attacker_data, economic_config)?;
    defender_data.networth = calculate_networth(defender_data, economic_config)?;

    // 18. Update event scores if attacker is participating in an event
    if let (Some(attacker_event_participation), Some(attacker_event)) =
        (attacker_event_participation, attacker_event)
    {
        // Load event participation with ownership validation (kingdom-scoped)
        let attacker_participation = crate::state::EventParticipation::load_checked_mut(
            attacker_event_participation,
            &attacker_data.game_engine,
            attacker_data.current_event,
            attacker_owner.address(),
            program_id,
        )?;

        // Load event with ownership validation (kingdom-scoped)
        let attacker_event_data = crate::state::EventAccount::load_checked_mut(
            attacker_event,
            &attacker_data.game_engine,
            attacker_data.current_event,
            program_id,
        )?;

        let attacker_key = attacker_owner.address();
        let attacker_event_key = attacker_event.address();

        // DETERMINISTIC: Use exact damage value (no randomness)
        let final_damage = attacker_damage;

        // TotalDamageDealt: Add damage dealt (deterministic)
        let _ = update_event_score(
            &mut *attacker_participation,
            &mut *attacker_event_data,
            attacker_event_key,
            attacker_key,
            attacker_data.name,
            EventType::TotalDamageDealt,
            final_damage,
            now,
        );

        // MostAttacksWonPvP: +1 if attacker wins
        if attacker_won {
            let _ = update_event_score(
                &mut *attacker_participation,
                &mut *attacker_event_data,
                attacker_event_key,
                attacker_key,
                attacker_data.name,
                EventType::MostAttacksWonPvP,
                1,
                now,
            );
        }

        // HighestCash: Current cash (snapshot)
        let _ = update_event_score(
            &mut *attacker_participation,
            &mut *attacker_event_data,
            attacker_event_key,
            attacker_key,
            attacker_data.name,
            EventType::HighestCash,
            attacker_data.cash_on_hand,
            now,
        );

        // MostXPGained: Add XP gained (deterministic)
        if attacker_xp_gained > 0 {
            let _ = update_event_score(
                &mut *attacker_participation,
                &mut *attacker_event_data,
                attacker_event_key,
                attacker_key,
                attacker_data.name,
                EventType::MostXPGained,
                attacker_xp_gained,
                now,
            );
        }
    }

    // 19. Update event scores if defender is participating in an event
    if let (Some(defender_event_participation), Some(defender_event)) =
        (defender_event_participation, defender_event)
    {
        // Load event participation with ownership validation (kingdom-scoped)
        let defender_participation = crate::state::EventParticipation::load_checked_mut(
            defender_event_participation,
            &defender_data.game_engine,
            defender_data.current_event,
            &defender_data.owner,
            program_id,
        )?;

        // Load event with ownership validation (kingdom-scoped)
        let defender_event_data = crate::state::EventAccount::load_checked_mut(
            defender_event,
            &defender_data.game_engine,
            defender_data.current_event,
            program_id,
        )?;

        let defender_key = &defender_data.owner;
        let defender_event_key = defender_event.address();

        // DETERMINISTIC: Use exact damage value (no randomness)
        let final_defender_damage = defender_damage;

        // TotalDamageDealt: Add defender damage dealt (deterministic)
        let _ = update_event_score(
            &mut *defender_participation,
            &mut *defender_event_data,
            defender_event_key,
            defender_key,
            defender_data.name,
            EventType::TotalDamageDealt,
            final_defender_damage,
            now,
        );

        // MostAttacksWonPvP: +1 if defender wins (defensive victory)
        if !attacker_won {
            let _ = update_event_score(
                &mut *defender_participation,
                &mut *defender_event_data,
                defender_event_key,
                defender_key,
                defender_data.name,
                EventType::MostAttacksWonPvP,
                1,
                now,
            );
        }

        // HighestCash: Current cash (snapshot)
        let _ = update_event_score(
            &mut *defender_participation,
            &mut *defender_event_data,
            defender_event_key,
            defender_key,
            defender_data.name,
            EventType::HighestCash,
            defender_data.cash_on_hand,
            now,
        );
    }

    // Calculate units lost for event (need to get original values)
    // Since we already updated the units above, we track the lost counts
    let _attacker_melee_lost = attacker_defensive_total.saturating_sub(
        att_unit_1
            .saturating_add(att_unit_2)
            .saturating_add(att_unit_3),
    );

    // Calculate cash/armor/produce/vehicles stolen (only if attacker won)
    let (cash_stolen, armor_stolen, produce_stolen, vehicles_stolen) = if attacker_won {
        let loot_bps = gameplay_config.pvp_loot_percentage_base as u64;
        let cash_from_hand = apply_bp(
            defender_data
                .cash_on_hand
                .saturating_add(if attacker_won { 0 } else { 0 }),
            loot_bps,
        )
        .unwrap_or(0);
        // Values already transferred above
        (cash_from_hand, 0u32, 0u32, 0u32) // Simplified for now
    } else {
        (0, 0, 0, 0)
    };

    // Calculate actual per-tier losses
    let attacker_tier1_lost = attacker_data.defensive_unit_1.saturating_sub(att_unit_1);
    let attacker_tier2_lost = attacker_data.defensive_unit_2.saturating_sub(att_unit_2);
    let attacker_tier3_lost = attacker_data.defensive_unit_3.saturating_sub(att_unit_3);

    // For defender: calculate losses before/after combat was applied
    // Note: defender units already updated, so calculate from what was removed
    let defender_tier1_lost = combined_def_1.saturating_sub(remaining_1);
    let defender_tier2_lost = combined_def_2.saturating_sub(remaining_2);
    let defender_tier3_lost = combined_def_3.saturating_sub(remaining_3);

    // Emit PlayerAttacked event
    emit!(PlayerAttacked {
        attacker: *attacker_player.address(),
        attacker_name: attacker_data.name,
        defender: *defender_player.address(),
        defender_name: defender_data.name,
        damage_dealt: attacker_damage,
        damage_received: defender_damage,
        cash_stolen,
        armor_stolen: armor_stolen as u64,
        produce_stolen: produce_stolen as u64,
        vehicles_stolen: vehicles_stolen as u64,
        attacker_units_lost: [
            attacker_tier1_lost,
            attacker_tier2_lost,
            attacker_tier3_lost,
        ],
        defender_units_lost: [
            defender_tier1_lost,
            defender_tier2_lost,
            defender_tier3_lost,
        ],
        attacker_won,
        drive_by,
        timestamp: now,
    });

    Ok(())
}
