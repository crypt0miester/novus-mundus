//! Attack Castle - Solo direct attack on a castle's garrison
//!
//! Instruction 288
//!
//! A player can directly attack a castle's garrison when:
//! - Castle is in Contest or Vulnerable status
//! - Attacker is at the castle location (within attack range)
//! - Attacker has operative units
//!
//! If the attacker defeats the entire garrison, they can trigger a
//! transition to claim the castle (or it becomes vacant).

use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{CASTLE_ATTACK_RANGE_METERS, CASTLE_STATUS_TRANSITIONING},
    emit,
    error::GameError,
    events::{CastleAttacked, CastleConquered, CastleDefended},
    logic::{
        calculate_damage_output, calculate_distance_meters, calculate_networth,
        combat::{resolve_weapon_combat, WeaponSet},
        inflict_damage,
        safe_math::{apply_bp, calculate_share, mul_div},
    },
    state::{
        CastleAccount, GameEngine, GarrisonContributionAccount, LocationAccount, PlayerAccount,
    },
    utils::read_u8,
    validation::{require_owner, require_signer, require_writable},
};

/// Attack Castle instruction data
/// - city_id: u16 (bytes 0-1)
/// - castle_id: u16 (bytes 2-3)
/// - drive_by: bool (byte 4) - True for drive-by attack

/// Accounts:
/// 0. [signer] Attacker wallet
/// 1. [writable] Attacker player account
/// 2. [writable] Castle account
/// 3. [] Game engine account
/// 4..N. [writable] Garrison contribution accounts (for updating loot/casualties)

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(
        accounts,
        [
            attacker_wallet,
            attacker_player,
            castle_account,
            game_engine_account,
        ],
        rest = garrison_accounts
    );

    // Validate accounts
    require_signer(attacker_wallet)?;
    require_writable(attacker_player)?;
    require_writable(castle_account)?;
    require_owner(attacker_player, program_id)?;

    // Parse instruction data (city_id/castle_id from account)
    let drive_by = read_u8(instruction_data, 0, "drive_by")? != 0;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Load game engine for combat config (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let gameplay_config = &game_engine.gameplay_config;
    let economic_config = &game_engine.economic_config;

    // Load castle
    let castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle can be attacked
    if !castle.can_be_attacked(now) {
        return Err(GameError::CastleNotAttackable.into());
    }

    // Load attacker (kingdom-scoped)
    let attacker = PlayerAccount::load_checked_mut(
        attacker_player,
        game_engine_account.address(),
        attacker_wallet.address(),
        program_id,
    )?;

    // Verify attacker is not traveling
    if attacker.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // Verify attacker is not in active rally
    if attacker.rally_stats().current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // Verify attacker is within attack range of the castle.
    //
    // The footprint is a full N×N Cartesian grid of cells at
    // (anchor_lat + dlat, anchor_long + dlong).
    //
    // castle.latitude/longitude are grid units (×10,000); `to_grid` /
    // `from_grid` convert against attacker.current_lat/long in degrees.
    let anchor_grid_lat = castle.latitude;
    let anchor_grid_long = castle.longitude;
    let footprint = if castle.footprint_size == 0 {
        1i32
    } else {
        castle.footprint_size as i32
    };
    let last_cell = footprint.saturating_sub(1);
    let near_grid_lat = LocationAccount::to_grid(attacker.current_lat).clamp(
        anchor_grid_lat,
        anchor_grid_lat.saturating_add(last_cell),
    );
    let near_grid_long = LocationAccount::to_grid(attacker.current_long).clamp(
        anchor_grid_long,
        anchor_grid_long.saturating_add(last_cell),
    );
    let min_distance_meters = calculate_distance_meters(
        attacker.current_lat,
        attacker.current_long,
        LocationAccount::from_grid(near_grid_lat),
        LocationAccount::from_grid(near_grid_long),
    );

    if min_distance_meters > CASTLE_ATTACK_RANGE_METERS {
        return Err(GameError::OutOfRange.into());
    }

    // Verify attacker has defensive units
    let attacker_defensive_total = attacker.total_defensive_units();
    if attacker_defensive_total == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // Aggregate garrison strength from all garrison contribution accounts
    let mut total_garrison_units: u64 = 0;
    let mut total_garrison_melee: u64 = 0;
    let mut total_garrison_ranged: u64 = 0;
    let mut total_garrison_siege: u64 = 0;
    let mut best_hero_defense_bps: u16 = 0;
    let mut best_hero_weapon_eff_bps: u16 = 0;

    // Track garrison contributions for damage distribution
    let mut garrison_powers: [u64; 20] = [0; 20];
    let mut total_garrison_power: u64 = 0;
    let garrison_count = garrison_accounts.len().min(20);

    // Dedupe garrison accounts to prevent double-counting strength
    let mut seen: [Address; 20] = [Address::default(); 20];
    let mut seen_count: usize = 0;

    // Load and validate garrison accounts
    for i in 0..garrison_count {
        let garrison_account = &garrison_accounts[i];
        if unsafe { garrison_account.owner() } != program_id {
            continue;
        }
        if garrison_account.data_len() == 0 {
            continue;
        }

        // Skip if already counted (deduplication)
        let key = *garrison_account.address();
        if seen[..seen_count].iter().any(|k| *k == key) {
            continue;
        }
        seen[seen_count] = key;
        seen_count += 1;

        let garrison_data = garrison_account.try_borrow()?;
        if garrison_data.first().copied() != Some(crate::state::AccountKey::CastleGarrison as u8) {
            continue;
        }
        let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

        // Verify garrison belongs to this castle
        if garrison.castle != *castle_account.address() {
            continue;
        }

        // Aggregate units
        total_garrison_units = total_garrison_units
            .saturating_add(garrison.units_1)
            .saturating_add(garrison.units_2)
            .saturating_add(garrison.units_3);

        // Aggregate weapons
        total_garrison_melee = total_garrison_melee.saturating_add(garrison.melee_weapons);
        total_garrison_ranged = total_garrison_ranged.saturating_add(garrison.ranged_weapons);
        total_garrison_siege = total_garrison_siege.saturating_add(garrison.siege_weapons);

        // Track best hero buffs
        best_hero_defense_bps = best_hero_defense_bps.max(garrison.hero_defense_bps);
        best_hero_weapon_eff_bps = best_hero_weapon_eff_bps.max(garrison.hero_weapon_eff_bps);

        // Track power contribution
        let power = garrison.calculate_power();
        garrison_powers[i] = power;
        total_garrison_power = total_garrison_power.saturating_add(power);
    }

    let total_garrison_weapons = total_garrison_melee
        .saturating_add(total_garrison_ranged)
        .saturating_add(total_garrison_siege);

    // Calculate attacker damage output
    let attacker_damage = calculate_damage_output(
        attacker_defensive_total,
        attacker.total_weapons(),
        drive_by,
        gameplay_config,
        attacker.research_attack_bps(),
        attacker.research_crit_chance_bps(),
        attacker.research_crit_damage_bps(),
        attacker.hero_attack_bps(),
        attacker.hero_weapon_efficiency_bps(),
        attacker.hero_crit_chance_bps(),
        attacker.equipped_weapon_bonus_bps(),
    );

    if attacker_damage == 0 {
        return Err(GameError::InsufficientAttackPower.into());
    }

    // Calculate garrison damage output (defenders don't get drive-by bonus)
    // Use king's research buffs if available (simplified - use 0 if no garrison)
    let base_garrison_damage = if total_garrison_units > 0 {
        calculate_damage_output(
            total_garrison_units,
            total_garrison_weapons,
            false, // not drive-by
            gameplay_config,
            0, // No research buffs for aggregated garrison
            0,
            0,
            best_hero_defense_bps,
            best_hero_weapon_eff_bps,
            0,
            0,
        )
    } else {
        0
    };

    // Apply castle armory bonus to boost garrison damage
    // Higher armory = more damage output from garrison
    let armory_bonus = castle.armory_bonus_bps();
    let garrison_damage = if armory_bonus > 0 {
        // value × (10000 + bonus) / 10000 in u64; bit-identical in range.
        apply_bp(base_garrison_damage, 10000 + armory_bonus as u64).unwrap_or(base_garrison_damage)
    } else {
        base_garrison_damage
    };

    // Inflict damage on attacker's defensive units (castle attacks use defensive forces)
    let (att_unit_1, att_unit_2, att_unit_3) = inflict_damage(
        attacker.defensive_unit_1,
        attacker.defensive_unit_2,
        attacker.defensive_unit_3,
        attacker.armor_pieces,
        garrison_damage as f64,
        gameplay_config,
        attacker.hero_armor_efficiency_bps(),
        attacker.equipped_armor_bonus_bps(),
    );

    let attacker_casualties = attacker_defensive_total.saturating_sub(
        att_unit_1
            .saturating_add(att_unit_2)
            .saturating_add(att_unit_3),
    );

    attacker.defensive_unit_1 = att_unit_1;
    attacker.defensive_unit_2 = att_unit_2;
    attacker.defensive_unit_3 = att_unit_3;

    // Apply castle fortification bonus to reduce effective attacker damage
    // Higher fortification = more damage reduction
    // Formula: effective_damage = base_damage * 10000 / (10000 + fortification_bonus_bps)
    let fortification_bonus = castle.fortification_bonus_bps();
    let effective_attacker_damage = if fortification_bonus > 0 {
        // u64 mul_div: runtime divisor (10000 + bonus) > 0; bit-identical
        // (attacker_damage × 10000 ≪ u64::MAX for any reachable damage).
        mul_div(attacker_damage, 10000, 10000 + fortification_bonus as u64).unwrap_or(attacker_damage)
    } else {
        attacker_damage
    };

    // Calculate garrison casualties (distributed proportionally).
    // The `× 10` denominator is an implicit garrison-HP — each garrison unit
    // soaks ~10 damage before dying. That's intentionally tankier than open-field
    // troops (per-tier `DEFENSIVE_UNIT_HEALTH` averages 4–5 HP for the starter
    // mix) because castle defenders fight from behind walls. Don't replace this
    // with `inflict_damage` here: garrison aggregates multiple players and we
    // don't carry per-tier breakdowns through the castle path.
    let garrison_casualty_ratio = if total_garrison_units > 0 && effective_attacker_damage > 0 {
        // u64 mul_div then cap; bit-identical (the `× 10` and `× 10000` only
        // overflow u64 past unreachable unit/damage magnitudes).
        mul_div(effective_attacker_damage, 10000, total_garrison_units.saturating_mul(10))
            .unwrap_or(0)
            .min(10000)
    } else {
        0
    };

    // units == 0 ⇒ numerator 0 ⇒ result 0, so the > 0 guard is redundant.
    let garrison_casualties = apply_bp(total_garrison_units, garrison_casualty_ratio).unwrap_or(0);

    // Weapon combat resolution
    let attacker_weapons = WeaponSet::new(
        attacker.melee_weapons.min(attacker_defensive_total),
        attacker.ranged_weapons.min(attacker_defensive_total),
        attacker.siege_weapons.min(attacker_defensive_total),
    );

    let garrison_equipped_weapons = WeaponSet::new(
        total_garrison_melee.min(total_garrison_units),
        total_garrison_ranged.min(total_garrison_units),
        total_garrison_siege.min(total_garrison_units),
    );

    let garrison_stored_weapons = WeaponSet::new(
        total_garrison_melee,
        total_garrison_ranged,
        total_garrison_siege,
    );

    let weapon_result = resolve_weapon_combat(
        attacker_defensive_total,
        attacker_casualties,
        attacker_weapons,
        attacker_damage,
        total_garrison_units,
        garrison_casualties,
        garrison_equipped_weapons,
        garrison_stored_weapons,
        false, // no operatives for garrison
    );

    let attacker_won = weapon_result.attacker_won;

    // Update attacker weapons based on combat result
    if attacker_won {
        // Attacker loots garrison weapons
        let looted = weapon_result.attacker_weapons_looted;
        let recovered = weapon_result.attacker_weapons_returned;

        let weapons_lost_melee = attacker_weapons.melee.saturating_sub(recovered.melee);
        let weapons_lost_ranged = attacker_weapons.ranged.saturating_sub(recovered.ranged);
        let weapons_lost_siege = attacker_weapons.siege.saturating_sub(recovered.siege);

        attacker.melee_weapons = attacker
            .melee_weapons
            .saturating_sub(weapons_lost_melee)
            .saturating_add(looted.melee);
        attacker.ranged_weapons = attacker
            .ranged_weapons
            .saturating_sub(weapons_lost_ranged)
            .saturating_add(looted.ranged);
        attacker.siege_weapons = attacker
            .siege_weapons
            .saturating_sub(weapons_lost_siege)
            .saturating_add(looted.siege);
    } else {
        // Attacker lost - loses weapons proportional to casualties
        let casualty_ratio_bps =
            mul_div(attacker_casualties, 10000, attacker_defensive_total).unwrap_or(0);

        let melee_lost = apply_bp(attacker_weapons.melee, casualty_ratio_bps).unwrap_or(0);
        let ranged_lost = apply_bp(attacker_weapons.ranged, casualty_ratio_bps).unwrap_or(0);
        let siege_lost = apply_bp(attacker_weapons.siege, casualty_ratio_bps).unwrap_or(0);

        attacker.melee_weapons = attacker.melee_weapons.saturating_sub(melee_lost);
        attacker.ranged_weapons = attacker.ranged_weapons.saturating_sub(ranged_lost);
        attacker.siege_weapons = attacker.siege_weapons.saturating_sub(siege_lost);
    }

    // Update attacker stats
    attacker.total_attacks = attacker.total_attacks.saturating_add(1);
    attacker.total_attack_power = attacker.total_attack_power.saturating_add(attacker_damage);

    // Update attacker networth
    attacker.networth = calculate_networth(&*attacker, economic_config)?;

    // Copy attacker name for event
    let mut attacker_name = [0u8; 48];
    attacker_name.copy_from_slice(&attacker.name);

    // Store king pubkey before potential transition
    let defending_king = castle.king;

    // Distribute casualties to garrison accounts and update loot
    if total_garrison_power > 0 {
        for i in 0..garrison_count {
            let garrison_account = &garrison_accounts[i];
            if unsafe { garrison_account.owner() } != program_id || garrison_account.data_len() == 0
            {
                continue;
            }

            let mut garrison_data = garrison_account.try_borrow_mut()?;
            if garrison_data.first().copied()
                != Some(crate::state::AccountKey::CastleGarrison as u8)
            {
                continue;
            }
            let garrison = unsafe { GarrisonContributionAccount::load_mut(&mut garrison_data) };

            // Skip if not this castle
            if garrison.castle != *castle_account.address() {
                continue;
            }

            // u64 mul_div instead of u128: bit-identical while garrison powers
            // stay ≪ 1.8e15 (garrison_powers[i] × 10000 never overflows u64 in
            // any reachable game state, so the divide-first fallback never fires).
            // Outer block already gates total_garrison_power > 0.
            let contribution_bps = mul_div(garrison_powers[i], 10000, total_garrison_power).unwrap_or(0);

            // Distribute casualties proportionally
            let their_casualties =
                calculate_share(garrison_casualties, contribution_bps, 10000).unwrap_or(0);

            // Reduce units (simplified - reduce proportionally across tiers)
            let their_total_units = garrison.total_units();
            if their_total_units > 0 {
                // u64 mul_div: bit-identical to the old u128 path for unit counts ≪ 1.8e15.
                let unit_1_share = mul_div(garrison.units_1, 10000, their_total_units).unwrap_or(0);
                let unit_2_share = mul_div(garrison.units_2, 10000, their_total_units).unwrap_or(0);

                garrison.units_1 = garrison.units_1.saturating_sub(
                    calculate_share(their_casualties, unit_1_share, 10000).unwrap_or(0),
                );
                garrison.units_2 = garrison.units_2.saturating_sub(
                    calculate_share(their_casualties, unit_2_share, 10000).unwrap_or(0),
                );
                garrison.units_3 = garrison.units_3.saturating_sub(
                    their_casualties
                        .saturating_sub(garrison.units_1.saturating_add(garrison.units_2))
                        .min(garrison.units_3),
                );
            }

            // If garrison won, distribute looted attacker weapons
            if !attacker_won {
                let defender_looted = weapon_result.defender_weapons_looted;
                garrison.loot_melee = garrison.loot_melee.saturating_add(
                    calculate_share(defender_looted.melee, contribution_bps, 10000).unwrap_or(0),
                );
                garrison.loot_ranged = garrison.loot_ranged.saturating_add(
                    calculate_share(defender_looted.ranged, contribution_bps, 10000).unwrap_or(0),
                );
                garrison.loot_siege = garrison.loot_siege.saturating_add(
                    calculate_share(defender_looted.siege, contribution_bps, 10000).unwrap_or(0),
                );
            }
        }
    }

    // Update castle statistics
    if attacker_won {
        castle.failed_defenses = castle.failed_defenses.saturating_add(1);

        // Check if garrison is effectively defeated (< 10% remaining or already empty)
        let remaining_garrison = total_garrison_units.saturating_sub(garrison_casualties);
        let garrison_defeated =
            remaining_garrison < total_garrison_units / 10 || total_garrison_units == 0;

        if garrison_defeated {
            // If already transitioning, just update the pending king and reset timer
            // If not transitioning, initiate transition
            if castle.status != CASTLE_STATUS_TRANSITIONING {
                castle.status = CASTLE_STATUS_TRANSITIONING;
            }

            // Update transition fields - new attacker claims the pending throne
            castle.transition_new_king = *attacker_player.address();
            // Reset the tier's contest window for others to challenge
            castle.contest_end_at = now.saturating_add(castle.contest_duration());

            // Emit conquest event
            emit!(CastleConquered {
                castle: *castle_account.address(),
                castle_name: castle.name,
                previous_king: defending_king,
                new_king: *attacker_player.address(),
                new_king_name: attacker_name,
                new_team: attacker.team_address(),
                rally_id: 0, // Solo attack, no rally
                timestamp: now,
            });
        }
    } else {
        castle.successful_defenses = castle.successful_defenses.saturating_add(1);

        // Emit defense event
        emit!(CastleDefended {
            castle: *castle_account.address(),
            castle_name: castle.name,
            king: defending_king,
            rally_id: 0, // Solo attack, no rally
            damage_dealt: garrison_damage,
            weapons_captured: weapon_result.defender_weapons_looted.total(),
            timestamp: now,
        });
    }

    // Emit attack event
    emit!(CastleAttacked {
        castle: *castle_account.address(),
        castle_name: castle.name,
        attacker: *attacker_player.address(),
        attacker_name,
        king: defending_king,
        damage_dealt: attacker_damage,
        damage_received: garrison_damage,
        attacker_casualties,
        garrison_casualties,
        attacker_won,
        timestamp: now,
    });

    Ok(())
}
