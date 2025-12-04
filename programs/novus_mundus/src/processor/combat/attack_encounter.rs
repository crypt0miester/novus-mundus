use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{PlayerAccount, EncounterAccount, UserAccount, LootAccount, LootSourceType, ResearchProgress, LocationAccount, OCCUPANT_NONE},
    constants::{PLAYER_SEED, USER_SEED, LOOT_SEED, RESEARCH_SEED, ENCOUNTER_ATTACK_RANGE_METERS, LOCATION_SEED, DAMAGE_PER_SIEGE_WEAPON},
    types::{EncounterType, EventType},
    logic::{
        calculate_damage_output,
        calculate_distance_meters,
        calculate_networth,
        regenerate_stamina,
        consume_stamina,
        grant_xp_with_time_bonus,
        calculate_xp_reward,
        XpAction,
        calculate_encounter_loot_pool,
        should_award_fragments,
        should_award_gems,
        calculate_fragment_amount,
        calculate_gem_amount,
        get_time_of_day,
        get_time_multiplier,
        apply_time_multiplier,
        ActivityType,
        safe_math::{apply_bp, apply_bp_bonus},
    },
    helpers::{close_account, event_scoring::update_event_score},
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
        require_key_match,
    },
};

/// PvE combat - attack an encounter (NPC enemy)
///
/// # Flow
/// 1. Validate player is at encounter location
/// 2. Validate encounter is alive and not despawned
/// 3. Calculate player's damage output (operative units + weapons)
/// 4. Apply damage to encounter health
/// 5. Track attacker contribution
/// 6. Award instant loot (cash) based on damage dealt
/// 7. Update player stats
///
/// # Dual Reward System
/// - **Instant reward**: Cash proportional to damage dealt (awarded immediately)
/// - **Ranking reward**: Reserved Novi based on final contribution ranking (claimed after encounter dies)
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [writable] user: UserAccount PDA (for loot counter)
/// - [writable] encounter: EncounterAccount PDA
/// - [signer, writable] owner: Wallet that owns the PlayerAccount (pays for loot rent)
/// - [] game_engine: GameEngine PDA (for networth value config)
/// - [] system_program: System program (for creating loot account)
/// - [writable] event_participation: (Optional) EventParticipation PDA for event scoring
/// - [writable] event: (Optional) EventAccount PDA for event scoring
/// - [writable] loot: (Optional) LootAccount PDA - required if encounter will die
/// - [writable] encounter_location: (Optional) LocationAccount for encounter - required if encounter will die
/// - [writable] location_creator_refund: (Optional) Account to receive location rent refund - required if encounter will die
///
/// # Instruction Data
/// - drive_by: bool (1 byte) - True for drive-by attack (25% damage penalty)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    // Account layout:
    // 0-5: Required (player, user, encounter, owner, game_engine, system_program)
    // 6-7: Optional event accounts (event_participation, event) - must be paired
    // Death accounts (when encounter will die - must all be present together):
    //   - loot: LootAccount PDA to create
    //   - encounter_location: LocationAccount to close
    //   - location_creator_refund: Account to receive location rent refund
    //
    // Valid combinations:
    // 6: base only
    // 8: base + event
    // 9: base + death (loot + encounter_location + location_creator_refund)
    // 11: base + event + death
    let (player, user, encounter, owner, game_engine, system_program, event_participation, event, loot, encounter_location, location_creator_refund) = match accounts.len() {
        11 => (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5],
              Some(&accounts[6]), Some(&accounts[7]),
              Some(&accounts[8]), Some(&accounts[9]), Some(&accounts[10])),
        9 => (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5],
             None, None,
             Some(&accounts[6]), Some(&accounts[7]), Some(&accounts[8])),
        8 => (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5],
             Some(&accounts[6]), Some(&accounts[7]),
             None, None, None),
        6 => (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5],
             None, None,
             None, None, None),
        _ => return Err(ProgramError::NotEnoughAccountKeys),
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player)?;
    require_writable(user)?;
    require_writable(encounter)?;
    require_owner(player, program_id)?;
    require_owner(user, program_id)?;
    require_owner(encounter, program_id)?;

    let player_bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;
    let user_bump = require_pda(user, &[USER_SEED, owner.key()], program_id)?;

    // 3. Parse instruction data
    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let drive_by = data[0] != 0;

    // 4. Load data
    let mut player_data_ref = player.try_borrow_mut_data()?;
    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data_ref)
    };

    let mut user_data_ref = user.try_borrow_mut_data()?;
    let user_data = unsafe {
        UserAccount::load_mut(&mut user_data_ref)
    };

    let mut encounter_data_ref = encounter.try_borrow_mut_data()?;
    let encounter_data = unsafe {
        EncounterAccount::load_mut(&mut encounter_data_ref)
    };

    // Load GameEngine for networth value config
    let mut game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&mut game_engine_data_ref)};
    let economic_config = &game_engine_data.economic_config;

    // Verify ownership and bump
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if player_data.bump != player_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    if &user_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if user_data.bump != user_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4a. Validate player not traveling (can't fight while moving)
    if player_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 4b. Validate player not in active rally (can't risk losing units before rally executes)
    if player_data.rally_stats.current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // 5. Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 6. Regenerate stamina based on time elapsed
    regenerate_stamina(player_data, now)?;

    // 7. Validate encounter is alive
    if encounter_data.health == 0 {
        return Err(GameError::EncounterDead.into());
    }

    // 8. Validate encounter not despawned
    if now >= encounter_data.despawn_at {
        return Err(GameError::EncounterDespawned.into());
    }

    // 9. Validate player is in same city as encounter
    if player_data.current_city != encounter_data.city_id {
        return Err(GameError::WrongCity.into());
    }

    // 10. Validate player is within attack range (10 meters)
    let distance_meters = calculate_distance_meters(
        player_data.current_lat,
        player_data.current_long,
        encounter_data.location_lat,
        encounter_data.location_long,
    );

    if distance_meters > ENCOUNTER_ATTACK_RANGE_METERS {
        return Err(GameError::OutOfRange.into());
    }

    // 11. Convert rarity to EncounterType and consume stamina
    let encounter_type = EncounterType::from_rarity(encounter_data.rarity)
        .ok_or(GameError::InvalidParameter)?;

    consume_stamina(player_data, encounter_type)?;

    // 11a. Validate player level vs encounter level (NEW)
    let level_diff = if encounter_data.level >= player_data.level {
        (encounter_data.level - player_data.level) as i16
    } else {
        (player_data.level - encounter_data.level) as i16
    };
    let gameplay_config = &game_engine_data.gameplay_config;

    if level_diff > gameplay_config.max_encounter_level_diff as i16 {
        return Err(GameError::EncounterLevelMismatch.into());
    }

    // 12. Validate player has operative units
    let total_operative = player_data.total_operative_units();
    if total_operative == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 13. Calculate damage output (PURE LOGIC)
    let gameplay_config = &game_engine_data.gameplay_config;

    // Apply research buffs and hero buffs for attacking encounters
    let base_damage = calculate_damage_output(
        total_operative,
        player_data.total_weapons(),
        drive_by,
        gameplay_config,
        player_data.research_attack_bps,
        player_data.research_crit_chance_bps,
        player_data.research_crit_damage_bps,
        player_data.hero_attack_bps,
        player_data.hero_weapon_efficiency_bps,
        player_data.hero_crit_chance_bps,
        player_data.equipped_weapon_bonus_bps,
    );

    // 13a. Apply Time-of-Day Bonus to Attack (DETERMINISTIC)
    // Attacking is best at night (DeepNight gives φ), worst at Midday (1/φ)
    let time_of_day = get_time_of_day(now, player_data.current_long);
    let time_damage = apply_time_multiplier(base_damage, time_of_day, ActivityType::Attacking);

    // 13b. Apply Hero EncounterDamage bonus (PvE-specific multiplier, no u128!)
    // Formula: damage × (10000 + hero_encounter_damage_bps) / 10000
    let damage = if player_data.hero_encounter_damage_bps > 0 {
        apply_bp_bonus(time_damage, player_data.hero_encounter_damage_bps)
            .unwrap_or(time_damage)
    } else {
        time_damage
    };

    if damage == 0 {
        return Err(GameError::InsufficientAttackPower.into());
    }

    // 13a. Apply encounter defense (NEW - damage reduction)
    // Defense is reduced by research encounter success buff
    let effective_defense = if player_data.research_encounter_success_bps > 0 {
        // Reduce defense by research buff (e.g., 2000 bps = 20% defense reduction)
        let defense_reduction = ((encounter_data.defense as u64)
            .saturating_mul(player_data.research_encounter_success_bps as u64)
            / 10000) as u32;
        encounter_data.defense.saturating_sub(defense_reduction)
    } else {
        encounter_data.defense
    };

    // Formula: damage_after_defense = damage * (10000 - defense) / 10000 (no u128!)
    // Example: 1000 damage vs 2500 defense (25%) = 1000 * 7500 / 10000 = 750
    let defense_factor = 10000u64.saturating_sub(effective_defense as u64);
    let damage_after_defense = apply_bp(damage, defense_factor).unwrap_or(0);

    if damage_after_defense == 0 {
        return Err(GameError::EncounterDefenseTooHigh.into());
    }

    // 14. Apply damage to encounter
    let actual_damage = damage_after_defense.min(encounter_data.health);
    encounter_data.health = encounter_data.health.saturating_sub(actual_damage);

    // 14a. Consume siege weapons based on damage dealt
    // Siege weapons are consumed proportionally to damage: 1 siege weapon = DAMAGE_PER_SIEGE_WEAPON damage
    // This prevents infinite siege use and creates strategic resource management
    if player_data.siege_weapons > 0 && actual_damage > 0 {
        // Calculate siege weapons consumed: damage / DAMAGE_PER_SIEGE_WEAPON (rounded up)
        let siege_consumed = (actual_damage + DAMAGE_PER_SIEGE_WEAPON - 1) / DAMAGE_PER_SIEGE_WEAPON;
        // Cap at available siege weapons
        let siege_consumed = siege_consumed.min(player_data.siege_weapons);
        player_data.siege_weapons = player_data.siege_weapons.saturating_sub(siege_consumed);
    }

    // 15. Calculate instant cash reward (deterministic: midpoint of 5-10 = 7.5, use 7)
    let cash_per_damage = 7u64;  // Deterministic: midpoint of old 5-10 range
    let instant_cash = actual_damage
        .saturating_mul(cash_per_damage);

    player_data.cash_on_hand = player_data.cash_on_hand
        .saturating_add(instant_cash);

    // 16. Track attacker for ranking rewards (DYNAMIC REALLOC)
    // Add player to attackers list if not already present
    let player_key = *player.key();
    let old_attacker_count = encounter_data.attacker_count;

    // Check if player already attacked (need immutable borrow for this)
    let already_attacking = {
        let encounter_data_check = encounter.try_borrow_data()?;
        let encounter_header = unsafe { EncounterAccount::load(&encounter_data_check) };
        encounter_header.has_attacked(&encounter_data_check, player.key())
    };

    // Calculate if we need to realloc BEFORE doing it
    let needs_realloc = !already_attacking;
    let new_count = if needs_realloc {
        old_attacker_count.checked_add(1).ok_or(GameError::EncounterFull)?
    } else {
        old_attacker_count
    };

    // Perform realloc if needed
    if needs_realloc {
        // Calculate new account size (add 32 bytes for new attacker)
        let old_len = encounter.data_len();
        let new_len = EncounterAccount::calculate_len(new_count);

        // Calculate additional rent needed
        let rent = pinocchio::sysvars::rent::Rent::get()?;
        let old_rent = rent.minimum_balance(old_len);
        let new_rent = rent.minimum_balance(new_len);
        let rent_diff = new_rent.saturating_sub(old_rent);

        // Attacker pays for rent increase (fair cost distribution!)
        if rent_diff > 0 {
            let transfer_ix = pinocchio_system::instructions::Transfer {
                from: owner,
                to: encounter,
                lamports: rent_diff,
            };
            transfer_ix.invoke()?;
        }

        // Realloc account to fit new attacker
        encounter.resize(new_len)?;

        // Add attacker pubkey to end of list and update count
        let mut encounter_data_full = encounter.try_borrow_mut_data()?;
        let offset = EncounterAccount::BASE_LEN + (old_attacker_count as usize * 32);
        encounter_data_full[offset..offset+32].copy_from_slice(player_key.as_ref());

        // Update count
        let encounter_data_mut = unsafe { EncounterAccount::load_mut(&mut encounter_data_full) };
        encounter_data_mut.attacker_count = new_count;
    }

    // 17. Update player stats
    player_data.total_attacks += 1;
    player_data.total_attack_power = player_data.total_attack_power
        .saturating_add(damage);

    // Count as encounter participation
    player_data.total_encounter_attacks = player_data.total_encounter_attacks
        .saturating_add(1);

    // 18. Grant XP if encounter dies (with time-of-day bonus)
    // Golden hours (Dawn/Dusk) give φ² (2.618x) XP for enlightenment!
    let xp_gained = if encounter_data.health == 0 {
        let base_xp = calculate_xp_reward(XpAction::DefeatEncounter { rarity: encounter_data.rarity });
        grant_xp_with_time_bonus(player_data, base_xp, now)?;
        // Return base_xp for event scoring (deterministic)
        base_xp
    } else {
        0
    };

    // 18a. Create Loot if encounter dies (NEW)
    if encounter_data.health == 0 {
        // Calculate loot pool using oscillation + level scaling + time-of-day bonus
        // Night attacks = better loot (φ multiplier at DeepNight!)
        let mut loot_pool = calculate_encounter_loot_pool(
            encounter_data,
            now,
            player_data.current_long as f64,
            economic_config,
            &game_engine_data.gameplay_config,
        );

        // Apply hero loot bonus (multiplicative) - boosts all loot quantities
        if player_data.hero_loot_bonus_bps > 0 {
            let multiplier = 10000u64 + player_data.hero_loot_bonus_bps as u64;
            loot_pool.total_cash = loot_pool.total_cash.saturating_mul(multiplier) / 10000;
            loot_pool.total_novi = loot_pool.total_novi.saturating_mul(multiplier) / 10000;
            loot_pool.total_weapons = loot_pool.total_weapons.saturating_mul(multiplier) / 10000;
            loot_pool.total_produce = loot_pool.total_produce.saturating_mul(multiplier) / 10000;
            loot_pool.total_vehicles = loot_pool.total_vehicles.saturating_mul(multiplier) / 10000;
        }

        // Apply hero luck bonus (multiplicative) - additional loot boost
        if player_data.hero_luck_bonus_bps > 0 {
            let multiplier = 10000u64 + player_data.hero_luck_bonus_bps as u64;
            loot_pool.total_cash = loot_pool.total_cash.saturating_mul(multiplier) / 10000;
            loot_pool.total_novi = loot_pool.total_novi.saturating_mul(multiplier) / 10000;
            loot_pool.total_weapons = loot_pool.total_weapons.saturating_mul(multiplier) / 10000;
            loot_pool.total_produce = loot_pool.total_produce.saturating_mul(multiplier) / 10000;
            loot_pool.total_vehicles = loot_pool.total_vehicles.saturating_mul(multiplier) / 10000;
        }

        // Only create loot if there are actual rewards AND loot account provided
        if loot_pool.has_loot() {
            // Loot account is REQUIRED when encounter dies
            let loot_account = loot.ok_or(GameError::MissingRequiredAccount)?;

            // Validate system_program
            require_key_match(system_program, &pinocchio_system::ID)?;
            require_writable(loot_account)?;

            // Get current loot_id and increment counter
            let loot_id = player_data.loot_counter;
            player_data.loot_counter = player_data.loot_counter
                .checked_add(1)
                .ok_or(GameError::MathOverflow)?;

            // Derive and validate loot PDA
            let (expected_loot_pda, loot_bump) = LootAccount::derive_pda(owner.key(), loot_id);
            require_key_match(loot_account, &expected_loot_pda)?;

            // Calculate rent for loot account
            let rent = pinocchio::sysvars::rent::Rent::get()?;
            let loot_lamports = rent.minimum_balance(LootAccount::LEN);

            // Create loot account PDA with signer seeds
            let loot_bump_seed = [loot_bump];
            let loot_id_bytes = loot_id.to_le_bytes();
            let loot_seeds = pinocchio::seeds!(
                LOOT_SEED,
                owner.key().as_ref(),
                &loot_id_bytes,
                &loot_bump_seed
            );
            let loot_signer = pinocchio::instruction::Signer::from(&loot_seeds);

            // CPI: Create loot account
            CreateAccount {
                from: owner,
                to: loot_account,
                lamports: loot_lamports,
                space: LootAccount::LEN as u64,
                owner: program_id,
            }.invoke_signed(&[loot_signer])?;

            // Calculate fragments and gems based on player research
            let mut fragments = 0u64;
            let mut gems = 0u64;

            // Get time-of-day multiplier for loot drops
            // Golden hours (Dawn/Dusk) give φ (1.618x), DeepNight gives √φ (1.272x)
            let loot_time_mult = get_time_multiplier(time_of_day, ActivityType::LootDrop);

            // Check if player has fragment/gem drops unlocked via research
            if player_data.has_fragment_drops {
                // Check for ResearchProgress to get drop rate bonus
                let fragment_bonus_bps = 0u16; // Would need ResearchProgress account for actual bonus
                if should_award_fragments(
                    encounter_data.level,
                    encounter_data.rarity,
                    player_data.has_fragment_drops,
                    fragment_bonus_bps,
                ) {
                    fragments = calculate_fragment_amount(
                        encounter_data.level,
                        encounter_data.rarity,
                        player_data.research_luck_bonus_bps,
                        loot_time_mult,
                    );
                }
            }

            if player_data.has_gem_drops {
                // Check for ResearchProgress to get drop rate bonus
                let gem_bonus_bps = 0u16; // Would need ResearchProgress account for actual bonus
                if should_award_gems(
                    encounter_data.level,
                    encounter_data.rarity,
                    player_data.has_gem_drops,
                    gem_bonus_bps,
                ) {
                    gems = calculate_gem_amount(
                        encounter_data.level,
                        encounter_data.rarity,
                        player_data.research_luck_bonus_bps,
                        loot_time_mult,
                    );
                }
            }

            // Apply loot magnetism research buff (increases all loot)
            if player_data.research_loot_magnetism_bps > 0 {
                let multiplier = 10000u64 + player_data.research_loot_magnetism_bps as u64;
                fragments = (fragments.saturating_mul(multiplier) / 10000);
                gems = (gems.saturating_mul(multiplier) / 10000);
            }

            // Initialize loot data
            let mut loot_account_data_ref = loot_account.try_borrow_mut_data()?;
            let loot_data = unsafe {
                LootAccount::load_mut(&mut loot_account_data_ref)
            };

            // Split weapons by rarity: Melee 50%, Ranged 30%, Siege 20%
            // This reflects: melee=common, ranged=tactical, siege=rare+powerful
            let total_weapons = loot_pool.total_weapons;
            let melee_share = total_weapons / 2;                    // 50%
            let ranged_share = (total_weapons * 3) / 10;            // 30%
            let siege_share = total_weapons - melee_share - ranged_share; // 20% + remainder

            *loot_data = LootAccount {
                owner: *owner.key(),
                creator: *owner.key(), // Owner pays rent, gets refund on claim
                loot_id,
                bump: loot_bump,
                source_type: LootSourceType::Encounter as u8,
                claimed: false,
                _padding1: [0; 5],
                created_at: now,
                expires_at: now.saturating_add(LootAccount::EXPIRATION_DURATION),
                source_id: encounter_data.id,
                contribution: actual_damage, // Player's damage contribution
                source_level: encounter_data.level,
                source_rarity: encounter_data.rarity,
                _padding2: [0; 6],
                cash: loot_pool.total_cash,
                reserved_novi: loot_pool.total_novi,
                melee_weapons: melee_share,
                ranged_weapons: ranged_share,
                siege_weapons: siege_share,
                produce: loot_pool.total_produce,
                vehicles: loot_pool.total_vehicles,
                fragments,
                gems,
            };
        }

        // 18b. Close Encounter's LocationAccount (refund rent to creator)
        // The encounter occupied this cell - now release it for other entities
        let enc_location = encounter_location.ok_or(GameError::MissingRequiredAccount)?;
        let creator_refund = location_creator_refund.ok_or(GameError::MissingRequiredAccount)?;

        require_writable(enc_location)?;
        require_writable(creator_refund)?;

        // Derive expected location PDA from encounter coordinates
        let enc_grid_lat = LocationAccount::to_grid(encounter_data.location_lat);
        let enc_grid_long = LocationAccount::to_grid(encounter_data.location_long);
        let enc_city_bytes = encounter_data.city_id.to_le_bytes();
        let enc_lat_bytes = enc_grid_lat.to_le_bytes();
        let enc_long_bytes = enc_grid_long.to_le_bytes();

        let (expected_location_pda, _) = pinocchio::pubkey::find_program_address(
            &[LOCATION_SEED, &enc_city_bytes, &enc_lat_bytes, &enc_long_bytes],
            program_id,
        );

        if enc_location.key() != &expected_location_pda {
            return Err(GameError::InvalidPDA.into());
        }

        // Validate location is occupied by this encounter
        {
            let location_data = enc_location.try_borrow_data()?;
            let location = unsafe { LocationAccount::load(&location_data) };

            if !location.is_occupied_by(encounter.key()) {
                return Err(GameError::NotCellOccupant.into());
            }

            // Validate the refund recipient matches the stored location_creator
            if &location.location_creator != creator_refund.key() {
                return Err(GameError::InvalidParameter.into());
            }
        }

        // Close the location account (refund rent to creator)
        close_account(enc_location, creator_refund)?;
    }

    // 19. Update networth (PURE LOGIC)
    player_data.networth = calculate_networth(player_data, economic_config)?;

    // 20. Update event scores if player is participating in an event
    if let (Some(event_participation), Some(event)) = (event_participation, event) {
        // Validate player is actually in this event
        let event_data_ref = event.try_borrow_data()?;
        let event_data = unsafe { crate::state::EventAccount::load(&event_data_ref) };
        if player_data.current_event != event_data.id {
            return Err(GameError::NotInEvent.into());
        }

        let player_key = player.key();

        // DETERMINISTIC: Use exact damage value (no randomness)
        let final_damage = actual_damage;

        // TotalDamageDealt: Add actual damage dealt (deterministic)
        let _ = update_event_score(
            event_participation,
            event,
            player_key,
            EventType::TotalDamageDealt,
            final_damage,
            now,
        );

        // MostEncountersDefeated: +1 if encounter dies
        if encounter_data.health == 0 {
            let _ = update_event_score(
                event_participation,
                event,
                player_key,
                EventType::MostEncountersDefeated,
                1,
                now,
            );

            // MostAttacksWonPvE: +1 if encounter dies
            let _ = update_event_score(
                event_participation,
                event,
                player_key,
                EventType::MostAttacksWonPvE,
                1,
                now,
            );
        }

        // MostXPGained: Add XP gained (deterministic)
        if xp_gained > 0 {
            let _ = update_event_score(
                event_participation,
                event,
                player_key,
                EventType::MostXPGained,
                xp_gained,
                now,
            );
        }
    }

    Ok(())
}