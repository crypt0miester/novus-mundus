use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, CityAccount, require_extension, EXT_RESEARCH},
    constants::{PLAYER_SEED, PVP_ATTACK_RANGE_METERS},
    types::EventType,
    logic::{
        calculate_damage_output,
        inflict_damage,
        update_happiness_defensive,
        calculate_networth,
        calculate_distance_meters,
        is_within_city_bounds,
        grant_xp_with_time_bonus,
        calculate_xp_reward,
        XpAction,
        get_time_of_day,
        apply_time_multiplier,
        ActivityType,
        safe_math::apply_bp,
        combat::{WeaponSet, resolve_weapon_combat},
    },
    helpers::event_scoring::update_event_score,
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
    },
};

/// PvP combat - attack another player
///
/// # Flow
/// 1. Validate attacker and defender are different players
/// 2. Validate both in same city (macro-level check)
/// 3. Validate both at same coordinates within city (micro-level check)
/// 4. Validate coordinates are within city bounds (anti-cheat)
/// 5. Calculate attacker damage output (operative units + weapons)
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
/// - [writable] attacker_event_participation: (Optional) Attacker's EventParticipation PDA
/// - [writable] attacker_event: (Optional) Attacker's EventAccount PDA
/// - [writable] defender_event_participation: (Optional) Defender's EventParticipation PDA
/// - [writable] defender_event: (Optional) Defender's EventAccount PDA
///
/// # Instruction Data
/// - drive_by: bool (1 byte) - True for drive-by attack (requires 10k+ units, 25% damage penalty)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    let (attacker_player, defender_player, attacker_owner, attacker_city, defender_city, game_engine, attacker_event_participation, attacker_event, defender_event_participation, defender_event) = if accounts.len() >= 10 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], Some(&accounts[6]), Some(&accounts[7]), Some(&accounts[8]), Some(&accounts[9]))
    } else if accounts.len() >= 8 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], Some(&accounts[6]), Some(&accounts[7]), None, None)
    } else if accounts.len() >= 6 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], None, None, None, None)
    } else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(attacker_owner)?;
    require_writable(attacker_player)?;
    require_writable(defender_player)?;
    require_owner(attacker_player, program_id)?;
    require_owner(defender_player, program_id)?;

    let attacker_bump = require_pda(attacker_player, &[PLAYER_SEED, attacker_owner.key()], program_id)?;

    // 3. Parse instruction data
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let drive_by = data[0] != 0;

    // 4. Load player data
    let mut attacker_data = attacker_player.try_borrow_mut_data()?;
    let mut defender_data = defender_player.try_borrow_mut_data()?;

    let attacker_data = unsafe {
        PlayerAccount::load_mut(&mut attacker_data)
    };

    let defender_data = unsafe {
        PlayerAccount::load_mut(&mut defender_data)
    };

    // Validate defender PDA (CRITICAL: prevents fake defender accounts)
    let defender_bump = require_pda(defender_player, &[PLAYER_SEED, &defender_data.owner], program_id)?;
    if defender_data.bump != defender_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // Load GameEngine for networth value config
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};
    let economic_config = &game_engine_data.economic_config;

    // Verify attacker ownership and bump
    if &attacker_data.owner != attacker_owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if attacker_data.bump != attacker_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4a. Require EXT_RESEARCH for PvP (attacker must have started research)
    require_extension(attacker_data, EXT_RESEARCH)?;

    // 5. Validate cannot attack self
    if attacker_player.key() == defender_player.key() {
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
    if attacker_data.rally_stats.current_rallies_joined > 0 {
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
    let defender_city_data = if attacker_city.key() == defender_city.key() {
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

    // 6d. Bounds check (security): Verify coordinates are within claimed city
    if !is_within_city_bounds(
        attacker_data.current_lat,
        attacker_data.current_long,
        attacker_city_data.latitude,
        attacker_city_data.longitude,
        attacker_city_data.radius_km,
    ) {
        return Err(GameError::InvalidLocationForCity.into());
    }

    if !is_within_city_bounds(
        defender_data.current_lat,
        defender_data.current_long,
        defender_city_data.latitude,
        defender_city_data.longitude,
        defender_city_data.radius_km,
    ) {
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

    // 7. Validate attacker has operative units
    let attacker_operative_total = attacker_data.total_operative_units();
    if attacker_operative_total == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 8. Get defender's defensive units (can be 0 - undefended targets are valid)
    let defender_defensive_total = defender_data.total_defensive_units();

    // 9. Calculate attacker damage output (PURE LOGIC)
    let gameplay_config = &game_engine_data.gameplay_config;

    // Apply research buffs and hero buffs for attacker
    let base_attacker_damage = calculate_damage_output(
        attacker_operative_total,
        attacker_data.total_weapons(),
        drive_by,
        gameplay_config,
        attacker_data.research_attack_bps,
        attacker_data.research_crit_chance_bps,
        attacker_data.research_crit_damage_bps,
        attacker_data.hero_attack_bps,
        attacker_data.hero_weapon_efficiency_bps,
        attacker_data.hero_crit_chance_bps,
        attacker_data.equipped_weapon_bonus_bps,
    );

    // 9a. Apply Time-of-Day Bonus to Attack (DETERMINISTIC)
    // Attacking is best at night (DeepNight gives φ), worst at Midday (1/φ)
    let time_of_day = get_time_of_day(now, attacker_data.current_long);
    let attacker_damage = apply_time_multiplier(base_attacker_damage, time_of_day, ActivityType::Attacking);

    if attacker_damage == 0 {
        return Err(GameError::InsufficientAttackPower.into());
    }

    // 10. Calculate defender damage output (PURE LOGIC)
    // Defenders never get drive-by bonus, but do get defense research buffs and hero buffs
    let base_defender_damage = calculate_damage_output(
        defender_defensive_total,
        defender_data.total_weapons(),
        false,
        gameplay_config,
        defender_data.research_defense_bps,
        0,  // Defenders don't get crit chance on defense
        0,  // Defenders don't get crit damage on defense
        defender_data.hero_defense_bps,
        defender_data.hero_weapon_efficiency_bps,
        0,  // Defenders don't get hero crit chance on defense
        defender_data.equipped_weapon_bonus_bps,
    );

    // 10a. Apply Time-of-Day Bonus to Defense (DETERMINISTIC)
    // Defending is best during day (Midday gives φ), worst at DeepNight (1/φ)
    // Note: Use attacker's location for time calculation (both at same location anyway)
    let defender_damage = apply_time_multiplier(base_defender_damage, time_of_day, ActivityType::Defending);

    // 11. Inflict damage on defender's defensive units (PURE LOGIC)
    // Defender's armor reduces incoming damage (boosted by hero armor efficiency + equipped armor)
    let (def_unit_1, def_unit_2, def_unit_3) = inflict_damage(
        defender_data.defensive_unit_1,
        defender_data.defensive_unit_2,
        defender_data.defensive_unit_3,
        defender_data.armor_pieces,
        attacker_damage as f64,
        gameplay_config,
        defender_data.hero_armor_efficiency_bps,
        defender_data.equipped_armor_bonus_bps,
    );

    let defender_units_lost = defender_defensive_total
        .saturating_sub(def_unit_1.saturating_add(def_unit_2).saturating_add(def_unit_3));

    defender_data.defensive_unit_1 = def_unit_1;
    defender_data.defensive_unit_2 = def_unit_2;
    defender_data.defensive_unit_3 = def_unit_3;

    // 12. Inflict damage on attacker's operative units (PURE LOGIC)
    // Attacker's armor protects operative units in counter-attack (boosted by hero armor efficiency + equipped armor)
    let (att_unit_1, att_unit_2, att_unit_3) = inflict_damage(
        attacker_data.operative_unit_1,
        attacker_data.operative_unit_2,
        attacker_data.operative_unit_3,
        attacker_data.armor_pieces,
        defender_damage as f64,
        gameplay_config,
        attacker_data.hero_armor_efficiency_bps,
        attacker_data.equipped_armor_bonus_bps,
    );

    let attacker_units_lost = attacker_operative_total
        .saturating_sub(att_unit_1.saturating_add(att_unit_2).saturating_add(att_unit_3));

    attacker_data.operative_unit_1 = att_unit_1;
    attacker_data.operative_unit_2 = att_unit_2;
    attacker_data.operative_unit_3 = att_unit_3;

    // 12a. WEAPON COMBAT RESOLUTION
    // Attacker's weapons (equipped by operative units)
    let attacker_weapons = WeaponSet::new(
        attacker_data.melee_weapons.min(attacker_operative_total),
        attacker_data.ranged_weapons.min(attacker_operative_total),
        attacker_data.siege_weapons.min(attacker_operative_total),
    );

    // Defender's weapons (equipped by defensive units)
    let defender_equipped_weapons = WeaponSet::new(
        defender_data.melee_weapons.min(defender_defensive_total),
        defender_data.ranged_weapons.min(defender_defensive_total),
        defender_data.siege_weapons.min(defender_defensive_total),
    );

    // Defender's stored weapons (entire inventory for armory raid)
    let defender_stored_weapons = WeaponSet::new(
        defender_data.melee_weapons,
        defender_data.ranged_weapons,
        defender_data.siege_weapons,
    );

    // Check if defender has operatives (for fallback defense calculation)
    let has_operatives = defender_data.total_operative_units() > 0;

    // Resolve weapon combat
    let weapon_result = resolve_weapon_combat(
        attacker_operative_total,
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
        if attacker_data.research_loot_bonus_bps > 0 {
            let multiplier = 10000u64 + attacker_data.research_loot_bonus_bps as u64;
            loot_bps = loot_bps.saturating_mul(multiplier) / 10000;
        }

        // Apply hero loot bonus (multiplicative)
        if attacker_data.hero_loot_bonus_bps > 0 {
            let multiplier = 10000u64 + attacker_data.hero_loot_bonus_bps as u64;
            loot_bps = loot_bps.saturating_mul(multiplier) / 10000;
        }

        // Apply hero luck bonus (multiplicative - luck improves loot outcomes)
        if attacker_data.hero_luck_bonus_bps > 0 {
            let multiplier = 10000u64 + attacker_data.hero_luck_bonus_bps as u64;
            loot_bps = loot_bps.saturating_mul(multiplier) / 10000;
        }

        // Cap at 100%
        loot_bps = loot_bps.min(10000);

        // 13b. Steal from cash_on_hand (no protection, no u128!)
        let cash_from_hand = apply_bp(defender_data.cash_on_hand, loot_bps)
            .unwrap_or(0);

        // 13c. Steal from cash_in_vault (with safebox protection)
        // Safebox protects X% of vault (e.g., 7500 bps = 75% protected, only 25% can be stolen)
        let unprotected_vault_bps = 10000u64.saturating_sub(gameplay_config.safebox_protection_percent as u64);
        let unprotected_vault = apply_bp(defender_data.cash_in_vault, unprotected_vault_bps)
            .unwrap_or(0);

        let cash_from_vault = apply_bp(unprotected_vault, loot_bps)
            .unwrap_or(0);

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

        // Deduct looted weapons from defender
        defender_data.melee_weapons = defender_data.melee_weapons.saturating_sub(looted.melee);
        defender_data.ranged_weapons = defender_data.ranged_weapons.saturating_sub(looted.ranged);
        defender_data.siege_weapons = defender_data.siege_weapons.saturating_sub(looted.siege);

        // Attacker loses weapons proportional to casualties, but recovers 80% and loots enemy
        // First: deduct weapons lost to casualties
        let weapons_lost_melee = attacker_weapons.melee.saturating_sub(recovered.melee);
        let weapons_lost_ranged = attacker_weapons.ranged.saturating_sub(recovered.ranged);
        let weapons_lost_siege = attacker_weapons.siege.saturating_sub(recovered.siege);

        attacker_data.melee_weapons = attacker_data.melee_weapons
            .saturating_sub(weapons_lost_melee)
            .saturating_add(looted.melee);
        attacker_data.ranged_weapons = attacker_data.ranged_weapons
            .saturating_sub(weapons_lost_ranged)
            .saturating_add(looted.ranged);
        attacker_data.siege_weapons = attacker_data.siege_weapons
            .saturating_sub(weapons_lost_siege)
            .saturating_add(looted.siege);
    } else {
        // 14b. ATTACKER LOST - Defender loots attacker's dropped weapons
        // Defender receives 60% of attacker's weapons from dead troops
        let defender_looted = weapon_result.defender_weapons_looted;

        // Deduct lost weapons from attacker (proportional to casualties)
        let casualty_ratio_bps = if attacker_operative_total > 0 {
            ((attacker_units_lost as u128 * 10000) / attacker_operative_total as u128) as u64
        } else {
            0
        };

        let attacker_melee_lost = apply_bp(attacker_weapons.melee, casualty_ratio_bps).unwrap_or(0);
        let attacker_ranged_lost = apply_bp(attacker_weapons.ranged, casualty_ratio_bps).unwrap_or(0);
        let attacker_siege_lost = apply_bp(attacker_weapons.siege, casualty_ratio_bps).unwrap_or(0);

        attacker_data.melee_weapons = attacker_data.melee_weapons.saturating_sub(attacker_melee_lost);
        attacker_data.ranged_weapons = attacker_data.ranged_weapons.saturating_sub(attacker_ranged_lost);
        attacker_data.siege_weapons = attacker_data.siege_weapons.saturating_sub(attacker_siege_lost);

        // Defender gains looted weapons from dead attackers
        defender_data.melee_weapons = defender_data.melee_weapons.saturating_add(defender_looted.melee);
        defender_data.ranged_weapons = defender_data.ranged_weapons.saturating_add(defender_looted.ranged);
        defender_data.siege_weapons = defender_data.siege_weapons.saturating_add(defender_looted.siege);
    }

    // 15. Update combat stats
    attacker_data.total_attacks += 1;
    attacker_data.total_attack_power = attacker_data.total_attack_power
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
        let base_xp = calculate_xp_reward(XpAction::DefeatPlayer { target_level: defender_data.level });
        grant_xp_with_time_bonus(attacker_data, base_xp, now)?;
        // Return base_xp for event scoring (deterministic)
        base_xp
    } else {
        0
    };

    // 18. Update networth for both players (PURE LOGIC)
    attacker_data.networth = calculate_networth(attacker_data, economic_config)?;
    defender_data.networth = calculate_networth(defender_data, economic_config)?;

    // 18. Update event scores if attacker is participating in an event
    if let (Some(attacker_event_participation), Some(attacker_event)) = (attacker_event_participation, attacker_event) {
        // Validate attacker is actually in this event
        let mut attacker_event_data_ref = attacker_event.try_borrow_data()?;
        let attacker_event_data = unsafe { crate::state::EventAccount::load(&mut attacker_event_data_ref) };
        if attacker_data.current_event != attacker_event_data.id {
            return Err(GameError::NotInEvent.into());
        }

        let attacker_key = attacker_player.key();

        // DETERMINISTIC: Use exact damage value (no randomness)
        let final_damage = attacker_damage;

        // TotalDamageDealt: Add damage dealt (deterministic)
        let _ = update_event_score(
            attacker_event_participation,
            attacker_event,
            attacker_key,
            EventType::TotalDamageDealt,
            final_damage,
            now,
        );

        // MostAttacksWonPvP: +1 if attacker wins
        if attacker_won {
            let _ = update_event_score(
                attacker_event_participation,
                attacker_event,
                attacker_key,
                EventType::MostAttacksWonPvP,
                1,
                now,
            );
        }

        // HighestCash: Current cash (snapshot)
        let _ = update_event_score(
            attacker_event_participation,
            attacker_event,
            attacker_key,
            EventType::HighestCash,
            attacker_data.cash_on_hand,
            now,
        );

        // MostXPGained: Add XP gained (deterministic)
        if attacker_xp_gained > 0 {
            let _ = update_event_score(
                attacker_event_participation,
                attacker_event,
                attacker_key,
                EventType::MostXPGained,
                attacker_xp_gained,
                now,
            );
        }
    }

    // 19. Update event scores if defender is participating in an event
    if let (Some(defender_event_participation), Some(defender_event)) = (defender_event_participation, defender_event) {
        // Validate defender is actually in this event
        let defender_event_data_ref = defender_event.try_borrow_data()?;
        let defender_event_data = unsafe { crate::state::EventAccount::load(&defender_event_data_ref) };
        if defender_data.current_event != defender_event_data.id {
            return Err(GameError::NotInEvent.into());
        }

        let defender_key = defender_player.key();

        // DETERMINISTIC: Use exact damage value (no randomness)
        let final_defender_damage = defender_damage;

        // TotalDamageDealt: Add defender damage dealt (deterministic)
        let _ = update_event_score(
            defender_event_participation,
            defender_event,
            defender_key,
            EventType::TotalDamageDealt,
            final_defender_damage,
            now,
        );

        // MostAttacksWonPvP: +1 if defender wins (defensive victory)
        if !attacker_won {
            let _ = update_event_score(
                defender_event_participation,
                defender_event,
                defender_key,
                EventType::MostAttacksWonPvP,
                1,
                now,
            );
        }

        // HighestCash: Current cash (snapshot)
        let _ = update_event_score(
            defender_event_participation,
            defender_event,
            defender_key,
            EventType::HighestCash,
            defender_data.cash_on_hand,
            now,
        );
    }

    Ok(())
}
