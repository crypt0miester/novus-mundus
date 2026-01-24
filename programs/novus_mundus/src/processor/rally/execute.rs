use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::{MIN_RALLY_PARTICIPANTS, CASTLE_STATUS_TRANSITIONING, CASTLE_CONTEST_DURATION},
    error::GameError,
    logic::{
        calculate_damage_output,
        inflict_damage,
        calculate_networth,
        calculate_encounter_loot_pool,
        safe_math::calculate_share,
        combat::{WeaponSet, resolve_weapon_combat},
    },
    state::{
        PlayerAccount,
        RallyAccount,
        RallyParticipant,
        RallyStatus,
        EncounterAccount,
        EstateAccount,
        CastleAccount,
        GarrisonContributionAccount,
    },
    helpers::estate::citadel_rally_damage_bps,
    validation::{require_writable, require_owner},
    emit,
    events::{RallyExecuted, CastleConquered, CastleDefended},
};

/// Execute a rally
///
/// Resolves combat and distributes loot shares to RallyParticipant accounts.
/// Loot is NOT transferred yet - that happens in ProcessReturn.
///
/// # New Design (no PlayerAccount needed!)
/// - Units and weapons are committed in RallyParticipant at join time
/// - Leader buffs are stored in RallyAccount at create time
/// - Loot shares are stored in RallyParticipant
/// - ProcessReturn creates LootAccount and returns units/weapons
///
/// # Accounts (N = participant_count)
/// - [writable] rally: RallyAccount
/// - [writable] target: PlayerAccount or EncounterAccount
/// - [] game_engine: GameEngine PDA (for gameplay config)
/// - [] leader_estate: EstateAccount PDA (leader's estate for Citadel bonus)
/// - [0..N] rally_participants: RallyParticipant accounts (writable)
///
/// # Building Bonuses
/// Leader's Citadel provides rally damage bonus:
/// - 0.5% damage bonus per Citadel level
///
/// # Instruction Data
/// None (target_type stored in RallyAccount)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Fixed Accounts

    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let rally_account = &accounts[0];
    let target_account = &accounts[1];
    let game_engine_account = &accounts[2];
    let leader_estate_account = &accounts[3];

    // Load rally to get participant count
    // RallyAccount doesn't have load_checked - verify program ownership manually
    require_owner(rally_account, program_id)?;
    let rally_data_check = rally_account.try_borrow_data()?;
    let rally_header = unsafe { RallyAccount::load(&rally_data_check) };
    let participant_count = rally_header.participant_count as usize;
    let rally_creator = rally_header.creator;
    let rally_id = rally_header.id;
    let rally_team = rally_header.team;
    drop(rally_data_check);

    // Calculate expected account count: 4 fixed + N rally_participants
    let expected_accounts = 4 + participant_count;
    if accounts.len() < expected_accounts {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Parse variable accounts
    let rally_participant_accounts = &accounts[4..4 + participant_count];

    // 2. Validate Accounts

    require_writable(rally_account)?;
    require_writable(target_account)?;

    for rp_account in rally_participant_accounts.iter() {
        require_writable(rp_account)?;
        // RallyParticipant doesn't have load_checked - verify program ownership
        if rp_account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }
    }

    // 3. Load Clock

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Rally Account and GameEngine

    // RallyAccount doesn't have load_checked - verify program ownership manually
    require_owner(rally_account, program_id)?;
    let rally_data_check = rally_account.try_borrow_data()?;
    let rally_data = unsafe { RallyAccount::load(&rally_data_check) };
    let game_engine_data = crate::state::GameEngine::load_checked(game_engine_account, program_id)?;
    let gameplay_config = &game_engine_data.gameplay_config;
    let economic_config = &game_engine_data.economic_config;

    // 5. Validate Rally State

    // Rally must be in Gathering or Marching status
    if rally_data.status != RallyStatus::Gathering as u8 &&
       rally_data.status != RallyStatus::Marching as u8 {
        return Err(GameError::RallyAlreadyExecuted.into());
    }

    // Must have minimum participants
    if rally_data.participant_count < MIN_RALLY_PARTICIPANTS {
        return Err(GameError::NotEnoughParticipants.into());
    }

    // Must have reached execution time
    if now < rally_data.execute_at {
        return Err(GameError::RallyNotReadyToExecute.into());
    }

    // Verify target matches rally target
    if target_account.key() != &rally_data.target {
        return Err(GameError::InvalidRallyTarget.into());
    }

    // Get leader buffs from rally account (stored at create time)
    let leader_research_attack_bps = rally_data.leader_research_attack_bps;
    let leader_research_crit_chance_bps = rally_data.leader_research_crit_chance_bps;
    let leader_research_crit_damage_bps = rally_data.leader_research_crit_damage_bps;
    let leader_hero_attack_bps = rally_data.leader_hero_attack_bps;
    let leader_hero_weapon_efficiency_bps = rally_data.leader_hero_weapon_efficiency_bps;
    let leader_hero_crit_chance_bps = rally_data.leader_hero_crit_chance_bps;
    let leader_equipped_weapon_bonus_bps = rally_data.leader_equipped_weapon_bonus_bps;

    let target_type = rally_data.target_type;
    drop(rally_data_check);

    // 6. Aggregate Power from All RallyParticipants

    let mut total_units = 0u64;
    let mut total_melee = 0u64;
    let mut total_ranged = 0u64;
    let mut total_siege = 0u64;

    // Track contributions for loot distribution
    let mut contributions = [0u64; 20];
    let mut marched_count = 0u8;

    for i in 0..participant_count {
        let rp_account = &rally_participant_accounts[i];
        let mut rp_data_ref = rp_account.try_borrow_mut_data()?;
        let rp_data = unsafe { RallyParticipant::load_mut(&mut rp_data_ref) };

        // Verify RallyParticipant belongs to this rally
        if rp_data.rally_id != rally_id || rp_data.rally_creator != rally_creator {
            return Err(GameError::InvalidRallyParticipantAccount.into());
        }

        // Update arrived_at_rally if travel time has elapsed
        // (The boolean is only set at join for same-city joiners)
        if !rp_data.arrived_at_rally && now >= rp_data.arrives_at_rally {
            rp_data.arrived_at_rally = true;
        }

        // Only include participants who arrived
        if !rp_data.arrived_at_rally {
            continue;
        }

        // Mark as included in march
        rp_data.included_in_march = true;
        marched_count += 1;

        // Aggregate units (committed at join time)
        let participant_units = rp_data.total_units();
        total_units = total_units.saturating_add(participant_units);

        // Aggregate weapons (committed at join time)
        total_melee = total_melee.saturating_add(rp_data.melee_weapons_committed);
        total_ranged = total_ranged.saturating_add(rp_data.ranged_weapons_committed);
        total_siege = total_siege.saturating_add(rp_data.siege_weapons_committed);

        // Contribution = units + weapons
        let contribution = participant_units
            .saturating_add(rp_data.melee_weapons_committed)
            .saturating_add(rp_data.ranged_weapons_committed)
            .saturating_add(rp_data.siege_weapons_committed);
        rp_data.contribution_power = contribution;
        contributions[i] = contribution;
    }

    let total_weapons = total_melee.saturating_add(total_ranged).saturating_add(total_siege);
    let total_contribution: u64 = contributions[..participant_count].iter().sum();

    // Calculate contribution_bps for each participant
    if total_contribution > 0 {
        for i in 0..participant_count {
            let rp_account = &rally_participant_accounts[i];
            let mut rp_data_ref = rp_account.try_borrow_mut_data()?;
            let rp_data = unsafe { RallyParticipant::load_mut(&mut rp_data_ref) };

            if rp_data.included_in_march {
                rp_data.contribution_bps = ((contributions[i] as u128 * 10000) / total_contribution as u128) as u16;
            }
        }
    }

    // 7. Calculate Total Damage Output

    let base_total_damage = calculate_damage_output(
        total_units,
        total_weapons,
        true, // drive-by rally attack
        gameplay_config,
        leader_research_attack_bps,
        leader_research_crit_chance_bps,
        leader_research_crit_damage_bps,
        leader_hero_attack_bps,
        leader_hero_weapon_efficiency_bps,
        leader_hero_crit_chance_bps,
        leader_equipped_weapon_bonus_bps,
    );

    // 7a. Apply Citadel rally damage bonus (BUILDING BONUS)
    // Leader's Citadel provides 0.5% damage bonus per level
    // EstateAccount doesn't have load_checked - verify program ownership manually
    require_owner(leader_estate_account, program_id)?;
    let leader_estate_data = leader_estate_account.try_borrow_data()?;
    let leader_estate = unsafe { EstateAccount::load(&leader_estate_data) };
    let citadel_bonus_bps = citadel_rally_damage_bps(leader_estate);
    drop(leader_estate_data);

    // Apply bonus: damage × (10000 + bonus_bps) / 10000
    let total_damage = if citadel_bonus_bps > 0 {
        let bonus_multiplier = 10000u64.saturating_add(citadel_bonus_bps as u64);
        base_total_damage.saturating_mul(bonus_multiplier) / 10000
    } else {
        base_total_damage
    };

    // 8. Execute Attack Based on Target Type

    let mut total_loot_cash = 0u64;
    let mut total_loot_locked_novi = 0u64;
    let mut total_loot_melee = 0u64;
    let mut total_loot_ranged = 0u64;
    let mut total_loot_siege = 0u64;
    let mut total_loot_produce = 0u64;
    let mut total_loot_vehicles = 0u64;
    let mut total_loot_fragments = 0u64;
    let mut total_loot_gems = 0u64;

    let mut attacker_casualties = 0u64;
    let mut fallback_triggered = false;
    let mut attacker_won = true;

    match target_type {
        0 => {
            // ============================================================
            // PvP Rally Attack - Full Weapon Combat Mechanics
            // ============================================================
            // Target PlayerAccount - verify program ownership (not signer, so can't use load_checked)
            require_owner(target_account, program_id)?;
            let mut target_account_data = target_account.try_borrow_mut_data()?;
            let target_player = unsafe { PlayerAccount::load_mut(&mut target_account_data) };

            // Get defender's garrison
            let defender_troops = target_player.defensive_unit_1
                .saturating_add(target_player.defensive_unit_2)
                .saturating_add(target_player.defensive_unit_3);

            // Check for fallback mode (no garrison)
            let has_operatives = target_player.operative_unit_1
                .saturating_add(target_player.operative_unit_2)
                .saturating_add(target_player.operative_unit_3) > 0;

            fallback_triggered = defender_troops == 0;

            // Defender's weapons (equipped by garrison)
            let defender_equipped_weapons = WeaponSet::new(
                target_player.melee_weapons.min(defender_troops),
                target_player.ranged_weapons.min(defender_troops),
                target_player.siege_weapons.min(defender_troops),
            );

            // Defender's stored weapons (for armory raid)
            let defender_stored_weapons = WeaponSet::new(
                target_player.melee_weapons,
                target_player.ranged_weapons,
                target_player.siege_weapons,
            );

            // Calculate defender's damage to attacker
            let defender_damage = if defender_troops > 0 {
                calculate_damage_output(
                    defender_troops,
                    defender_equipped_weapons.total(),
                    false, // not drive-by
                    gameplay_config,
                    target_player.research_attack_bps,
                    target_player.research_crit_chance_bps,
                    target_player.research_crit_damage_bps,
                    target_player.hero_attack_bps,
                    target_player.hero_weapon_efficiency_bps,
                    target_player.hero_crit_chance_bps,
                    target_player.equipped_weapon_bonus_bps,
                )
            } else if has_operatives {
                // Operatives defend at 50% effectiveness
                let op_power = target_player.operative_unit_1
                    .saturating_add(target_player.operative_unit_2.saturating_mul(2))
                    .saturating_add(target_player.operative_unit_3.saturating_mul(3));
                op_power / 2
            } else {
                0
            };

            // Calculate attacker casualties (simplified - proportional to defender damage)
            attacker_casualties = if total_units > 0 && defender_damage > 0 {
                let casualty_ratio = defender_damage.min(total_units * 100) / total_units.max(1);
                (total_units as u128 * casualty_ratio as u128 / 100) as u64
            } else {
                0
            };

            // Inflict damage on defender's defensive units
            let (new_def1, new_def2, new_def3) = inflict_damage(
                target_player.defensive_unit_1,
                target_player.defensive_unit_2,
                target_player.defensive_unit_3,
                target_player.armor_pieces,
                total_damage as f64,
                gameplay_config,
                target_player.hero_armor_efficiency_bps,
                target_player.equipped_armor_bonus_bps,
            );

            let defender_casualties = target_player.defensive_unit_1
                .saturating_add(target_player.defensive_unit_2)
                .saturating_add(target_player.defensive_unit_3)
                .saturating_sub(new_def1.saturating_add(new_def2).saturating_add(new_def3));

            target_player.defensive_unit_1 = new_def1;
            target_player.defensive_unit_2 = new_def2;
            target_player.defensive_unit_3 = new_def3;

            // Resolve weapon combat
            let attacker_weapons = WeaponSet::new(total_melee, total_ranged, total_siege);
            let weapon_result = resolve_weapon_combat(
                total_units,
                attacker_casualties,
                attacker_weapons,
                total_damage,
                defender_troops,
                defender_casualties,
                defender_equipped_weapons,
                defender_stored_weapons,
                has_operatives,
            );

            attacker_won = weapon_result.attacker_won;

            if attacker_won {
                // Attacker loots weapons
                total_loot_melee = weapon_result.attacker_weapons_looted.melee;
                total_loot_ranged = weapon_result.attacker_weapons_looted.ranged;
                total_loot_siege = weapon_result.attacker_weapons_looted.siege;

                // Deduct looted weapons from defender
                target_player.melee_weapons = target_player.melee_weapons
                    .saturating_sub(total_loot_melee);
                target_player.ranged_weapons = target_player.ranged_weapons
                    .saturating_sub(total_loot_ranged);
                target_player.siege_weapons = target_player.siege_weapons
                    .saturating_sub(total_loot_siege);

                // Loot other resources (25% of target's resources)
                total_loot_cash = target_player.cash_on_hand / 4;
                total_loot_produce = target_player.produce / 4;
                total_loot_vehicles = target_player.vehicles / 4;
                total_loot_fragments = target_player.fragments / 4;
                total_loot_gems = target_player.gems / 4;

                // Apply fallback bonus (φ = 1.618x) on cash if no garrison
                if fallback_triggered {
                    total_loot_cash = (total_loot_cash as u128 * 16180 / 10000) as u64;
                }

                // Deduct from target
                target_player.cash_on_hand = target_player.cash_on_hand.saturating_sub(total_loot_cash);
                target_player.produce = target_player.produce.saturating_sub(total_loot_produce);
                target_player.vehicles = target_player.vehicles.saturating_sub(total_loot_vehicles);
                target_player.fragments = target_player.fragments.saturating_sub(total_loot_fragments);
                target_player.gems = target_player.gems.saturating_sub(total_loot_gems);
            } else {
                // Attacker lost - defender gets weapons from dead attackers
                target_player.melee_weapons = target_player.melee_weapons
                    .saturating_add(weapon_result.defender_weapons_looted.melee);
                target_player.ranged_weapons = target_player.ranged_weapons
                    .saturating_add(weapon_result.defender_weapons_looted.ranged);
                target_player.siege_weapons = target_player.siege_weapons
                    .saturating_add(weapon_result.defender_weapons_looted.siege);
            }

            // Update target networth
            target_player.networth = calculate_networth(target_player, economic_config)?;
        },
        1 => {
            // ============================================================
            // Encounter Rally Attack
            // ============================================================
            // EncounterAccount - verify program ownership
            require_owner(target_account, program_id)?;
            let mut target_account_data = target_account.try_borrow_mut_data()?;
            let encounter = unsafe { EncounterAccount::load_mut(&mut target_account_data) };

            // Reduce encounter health
            encounter.health = encounter.health.saturating_sub(total_damage);

            // If encounter defeated, calculate loot pool
            if encounter.health == 0 {
                let loot_pool = calculate_encounter_loot_pool(
                    encounter,
                    now,
                    encounter.location_long,
                    economic_config,
                    gameplay_config,
                );

                total_loot_cash = loot_pool.total_cash;
                total_loot_locked_novi = loot_pool.total_novi;

                // Split weapons by type
                let weapons = loot_pool.total_weapons;
                total_loot_melee = weapons / 2;
                total_loot_ranged = (weapons * 3) / 10;
                total_loot_siege = weapons.saturating_sub(total_loot_melee).saturating_sub(total_loot_ranged);

                total_loot_produce = loot_pool.total_produce;
                total_loot_vehicles = loot_pool.total_vehicles;
                total_loot_fragments = loot_pool.total_fragments;
                total_loot_gems = loot_pool.total_gems;
            }
        },
        2 => {
            // ============================================================
            // Castle Rally Attack - Siege the garrison
            // ============================================================
            // Target CastleAccount - verify program ownership
            require_owner(target_account, program_id)?;

            // Load castle - extract city_id and castle_id from the account data
            let mut target_account_data = target_account.try_borrow_mut_data()?;
            let castle = unsafe { CastleAccount::load_mut(&mut target_account_data) };

            // Verify castle can be attacked
            if !castle.can_be_attacked(now) {
                return Err(GameError::CastleNotAttackable.into());
            }

            // For rally castle attacks, garrison accounts are expected after rally participant accounts
            // Account indices: 4 + participant_count .. end are garrison accounts
            let garrison_start_index = 4 + participant_count;
            let garrison_accounts = if accounts.len() > garrison_start_index {
                &accounts[garrison_start_index..]
            } else {
                &accounts[0..0] // Empty slice if no garrison accounts provided
            };

            // Aggregate garrison strength
            let mut total_garrison_units: u64 = 0;
            let mut total_garrison_melee: u64 = 0;
            let mut total_garrison_ranged: u64 = 0;
            let mut total_garrison_siege: u64 = 0;
            let mut best_hero_defense_bps: u16 = 0;
            let mut best_hero_weapon_eff_bps: u16 = 0;

            for garrison_account in garrison_accounts.iter() {
                if garrison_account.owner() != program_id || garrison_account.data_len() == 0 {
                    continue;
                }

                let garrison_data = garrison_account.try_borrow_data()?;
                let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

                // Verify garrison belongs to this castle
                if garrison.castle != *target_account.key() {
                    continue;
                }

                total_garrison_units = total_garrison_units
                    .saturating_add(garrison.units_1)
                    .saturating_add(garrison.units_2)
                    .saturating_add(garrison.units_3);

                total_garrison_melee = total_garrison_melee.saturating_add(garrison.melee_weapons);
                total_garrison_ranged = total_garrison_ranged.saturating_add(garrison.ranged_weapons);
                total_garrison_siege = total_garrison_siege.saturating_add(garrison.siege_weapons);

                best_hero_defense_bps = best_hero_defense_bps.max(garrison.hero_defense_bps);
                best_hero_weapon_eff_bps = best_hero_weapon_eff_bps.max(garrison.hero_weapon_eff_bps);
            }

            let total_garrison_weapons = total_garrison_melee
                .saturating_add(total_garrison_ranged)
                .saturating_add(total_garrison_siege);

            // No garrison = fallback mode
            fallback_triggered = total_garrison_units == 0;

            // Calculate garrison damage output
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
                (base_garrison_damage as u128 * (10000 + armory_bonus as u128) / 10000) as u64
            } else {
                base_garrison_damage
            };

            // Calculate attacker casualties
            attacker_casualties = if total_units > 0 && garrison_damage > 0 {
                let casualty_ratio = garrison_damage.min(total_units * 100) / total_units.max(1);
                (total_units as u128 * casualty_ratio as u128 / 100) as u64
            } else {
                0
            };

            // Apply castle fortification bonus to reduce effective attacker damage
            // Higher fortification = more damage reduction
            // Formula: effective_damage = base_damage * 10000 / (10000 + fortification_bonus_bps)
            let fortification_bonus = castle.fortification_bonus_bps();
            let effective_total_damage = if fortification_bonus > 0 {
                (total_damage as u128 * 10000 / (10000 + fortification_bonus as u128)) as u64
            } else {
                total_damage
            };

            // Calculate garrison casualties
            let garrison_casualty_ratio = if total_garrison_units > 0 && effective_total_damage > 0 {
                ((effective_total_damage as u128 * 10000) / (total_garrison_units as u128 * 10)).min(10000) as u64
            } else {
                0
            };

            let garrison_casualties = if total_garrison_units > 0 {
                (total_garrison_units as u128 * garrison_casualty_ratio as u128 / 10000) as u64
            } else {
                0
            };

            // Weapon combat resolution
            let attacker_weapons = WeaponSet::new(total_melee, total_ranged, total_siege);

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
                total_units,
                attacker_casualties,
                attacker_weapons,
                total_damage,
                total_garrison_units,
                garrison_casualties,
                garrison_equipped_weapons,
                garrison_stored_weapons,
                false,
            );

            attacker_won = weapon_result.attacker_won;

            // Capture looted weapons if attackers win
            if attacker_won {
                total_loot_melee = weapon_result.attacker_weapons_looted.melee;
                total_loot_ranged = weapon_result.attacker_weapons_looted.ranged;
                total_loot_siege = weapon_result.attacker_weapons_looted.siege;

                // Check if garrison is defeated enough to trigger conquest
                // Conquest requires wiping out 90%+ of garrison or empty garrison
                let remaining_garrison = total_garrison_units.saturating_sub(garrison_casualties);
                if remaining_garrison < total_garrison_units / 10 || total_garrison_units == 0 {
                    // Initiate ownership transition (or update if already transitioning)
                    let defending_king = castle.king;

                    if castle.status != CASTLE_STATUS_TRANSITIONING {
                        castle.status = CASTLE_STATUS_TRANSITIONING;
                    }

                    // Set/reset transition fields - rally creator claims the pending throne
                    castle.transition_new_king = rally_creator;
                    // Start/reset 2-hour contest window for others to challenge
                    castle.contest_end_at = now + CASTLE_CONTEST_DURATION;
                    castle.failed_defenses = castle.failed_defenses.saturating_add(1);

                    // Leader name not available in execute - will be filled during transition finalize
                    let new_king_name = [0u8; 48];

                    // Emit conquest event
                    emit!(CastleConquered {
                        castle: *target_account.key(),
                        castle_name: castle.name,
                        previous_king: defending_king,
                        new_king: rally_creator,
                        new_king_name,
                        new_team: rally_team,
                        rally_id,
                        timestamp: now,
                    });
                }
            } else {
                castle.successful_defenses = castle.successful_defenses.saturating_add(1);

                // Emit defense event
                emit!(CastleDefended {
                    castle: *target_account.key(),
                    castle_name: castle.name,
                    king: castle.king,
                    rally_id,
                    damage_dealt: garrison_damage,
                    weapons_captured: weapon_result.defender_weapons_looted.total(),
                    timestamp: now,
                });
            }
        },
        _ => return Err(GameError::InvalidParameter.into()),
    }

    // 9. Distribute Casualties and Loot Shares to Participants

    if total_contribution > 0 {
        for i in 0..participant_count {
            let rp_account = &rally_participant_accounts[i];
            let mut rp_data_ref = rp_account.try_borrow_mut_data()?;
            let rp_data = unsafe { RallyParticipant::load_mut(&mut rp_data_ref) };

            if !rp_data.included_in_march {
                continue;
            }

            let contribution_bps = rp_data.contribution_bps as u64;

            // Distribute casualties proportionally
            let participant_casualties = calculate_share(attacker_casualties, contributions[i], total_contribution)
                .unwrap_or(0);

            // Distribute casualties by unit type (proportional to committed)
            let participant_total_units = rp_data.total_units();
            if participant_total_units > 0 {
                rp_data.casualties_1 = calculate_share(
                    participant_casualties,
                    rp_data.units_committed_1,
                    participant_total_units,
                ).unwrap_or(0).min(rp_data.units_committed_1);

                rp_data.casualties_2 = calculate_share(
                    participant_casualties,
                    rp_data.units_committed_2,
                    participant_total_units,
                ).unwrap_or(0).min(rp_data.units_committed_2);

                rp_data.casualties_3 = calculate_share(
                    participant_casualties,
                    rp_data.units_committed_3,
                    participant_total_units,
                ).unwrap_or(0).min(rp_data.units_committed_3);
            }

            // Distribute loot shares (only if attacker won)
            if attacker_won {
                rp_data.loot_cash = calculate_share(total_loot_cash, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_locked_novi = calculate_share(total_loot_locked_novi, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_melee = calculate_share(total_loot_melee, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_ranged = calculate_share(total_loot_ranged, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_siege = calculate_share(total_loot_siege, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_produce = calculate_share(total_loot_produce, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_vehicles = calculate_share(total_loot_vehicles, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_fragments = calculate_share(total_loot_fragments, contribution_bps, 10000).unwrap_or(0);
                rp_data.loot_gems = calculate_share(total_loot_gems, contribution_bps, 10000).unwrap_or(0);
            }

            // Set return journey timing
            rp_data.return_started_at = now;
            rp_data.return_duration = rp_data.travel_duration; // Same duration as travel to rally
        }
    }

    // 10. Update Rally Account

    let mut rally_data_mut = rally_account.try_borrow_mut_data()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_mut) };

    rally.total_units = total_units;
    rally.total_melee_weapons = total_melee;
    rally.total_ranged_weapons = total_ranged;
    rally.total_siege_weapons = total_siege;
    rally.total_power = total_damage;
    rally.total_casualties = attacker_casualties;
    rally.attack_damage_dealt = total_damage;
    rally.marched_count = marched_count;

    rally.total_loot_cash = total_loot_cash;
    rally.total_loot_locked_novi = total_loot_locked_novi;
    rally.total_loot_melee = total_loot_melee;
    rally.total_loot_ranged = total_loot_ranged;
    rally.total_loot_siege = total_loot_siege;
    rally.total_loot_produce = total_loot_produce;
    rally.total_loot_vehicles = total_loot_vehicles;
    rally.total_loot_fragments = total_loot_fragments;
    rally.total_loot_gems = total_loot_gems;

    rally.fallback_triggered = fallback_triggered;
    rally.attacker_won = attacker_won;
    rally.status = RallyStatus::Returning as u8;

    // Emit RallyExecuted event
    // Note: team_name not available here - would need to pass team account
    emit!(RallyExecuted {
        rally: *rally_account.key(),
        team_name: [0u8; 32], // Team name not available in execute, lookup via rally.team
        target: rally.target,
        damage_dealt: total_damage,
        damage_received: attacker_casualties,
        loot_captured: total_loot_cash
            .saturating_add(total_loot_produce)
            .saturating_add(total_loot_vehicles),
        participant_count: marched_count,
        timestamp: now,
    });

    Ok(())
}
