use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{DAMAGE_PER_SIEGE_WEAPON, ENCOUNTER_ATTACK_RANGE_METERS, LOOT_SEED},
    emit,
    error::GameError,
    events::{EncounterAttacked, EncounterDefeated, PlayerLeveledUp, XpGained},
    helpers::{close_account, estate::load_estate_for_player, event_scoring::update_event_score},
    logic::{
        apply_time_multiplier, calculate_damage_output, calculate_distance_meters,
        calculate_encounter_loot_pool, calculate_fragment_amount, calculate_gem_amount,
        calculate_networth, calculate_xp_reward, consume_stamina, get_time_multiplier,
        get_time_of_day, grant_xp_with_time_bonus, regenerate_stamina,
        safe_math::{apply_bp, apply_bp_bonus},
        should_award_fragments, should_award_gems, ActivityType, XpAction,
    },
    state::{
        EncounterAccount, GameEngine, LocationAccount, LootAccount, LootSourceType, PlayerAccount,
    },
    types::{EncounterType, EventType},
    utils::read_u64,
    validation::{require_key_match, require_owner, require_signer, require_writable},
};

/// PvE combat - attack an encounter (NPC enemy)
///
/// # Flow
/// 1. Validate player is at encounter location
/// 2. Validate encounter is alive and not despawned
/// 3. Calculate player's damage output (defensive units + weapons)
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
/// - [writable] encounter: EncounterAccount PDA
/// - [signer, writable] owner: Wallet that owns the PlayerAccount (pays for loot rent)
/// - [] game_engine: GameEngine PDA (for networth value config)
/// - [] system_program: System program (for creating loot account)
/// - [] estate_account: EstateAccount PDA (for Barracks unit effectiveness + Observatory loot bonus)
/// - [writable] event_participation: (Optional) EventParticipation PDA for event scoring
/// - [writable] event: (Optional) EventAccount PDA for event scoring
/// - [writable] loot: (Optional) LootAccount PDA - required if encounter will die
/// - [writable] encounter_location: (Optional) LocationAccount for encounter - required if encounter will die
/// - [writable] location_creator_refund: (Optional) Account to receive location rent refund - required if encounter will die
///
/// # Instruction Data
/// - encounter_id: u64 (8 bytes, little-endian) - ID of the encounter to attack
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    // Account layout:
    // 0-5: Required (player, encounter, owner, game_engine, system_program, estate_account)
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
    crate::extract_accounts!(
        accounts,
        [
            player,
            encounter,
            owner,
            game_engine,
            system_program,
            estate_account,
        ]
    );
    let (event_participation, event, loot, encounter_location, location_creator_refund) =
        match accounts.len() {
            11 => (
                Some(&accounts[6]),
                Some(&accounts[7]),
                Some(&accounts[8]),
                Some(&accounts[9]),
                Some(&accounts[10]),
            ),
            9 => (
                None,
                None,
                Some(&accounts[6]),
                Some(&accounts[7]),
                Some(&accounts[8]),
            ),
            8 => (Some(&accounts[6]), Some(&accounts[7]), None, None, None),
            6 => (None, None, None, None, None),
            _ => return Err(ProgramError::NotEnoughAccountKeys),
        };

    // 2. Validate signer
    require_signer(owner)?;

    // 3. Parse instruction data
    // Format: [encounter_id: u64]
    let encounter_id = read_u64(data, 0, "encounter_id")?;

    // 4. Load GameEngine first to get kingdom context
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;

    // 5. Load and verify player (kingdom-scoped)
    let player_data = PlayerAccount::load_checked_mut(
        player,
        game_engine.address(),
        owner.address(),
        program_id,
    )?;

    // 5a. Validate player not traveling (can't fight while moving)
    if player_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 5b. Validate player not in active rally (can't risk losing units before rally executes)
    if player_data.rally_stats().current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // 6. Load encounter with standardized validation (kingdom-scoped)
    // Uses player's current_city - if encounter is in different city, PDA check fails
    let encounter_data = EncounterAccount::load_checked_mut(
        encounter,
        game_engine.address(),
        player_data.current_city,
        encounter_id,
        program_id,
    )?;
    let economic_config = &game_engine_data.economic_config;

    // 5. Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 6. Regenerate stamina based on time elapsed
    regenerate_stamina(&mut *player_data, now)?;

    // 7. Validate encounter is alive
    if encounter_data.health == 0 {
        return Err(GameError::EncounterDead.into());
    }

    // 8. Validate encounter not despawned
    if now >= encounter_data.despawn_at {
        return Err(GameError::EncounterDespawned.into());
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
    let encounter_type =
        EncounterType::from_rarity(encounter_data.rarity).ok_or(GameError::InvalidParameter)?;

    consume_stamina(&mut *player_data, encounter_type)?;

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

    // 12. Validate player has defensive units
    let total_defensive = player_data.total_defensive_units();
    if total_defensive == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 13. Calculate damage output (PURE LOGIC)
    let gameplay_config = &game_engine_data.gameplay_config;

    // Apply blessed hero bonus (+25% to hero attack if active)
    let boosted_hero_attack = if player_data.blessed_hero_bonus_bps() > 0 {
        apply_bp_bonus(
            player_data.hero_attack_bps() as u64,
            player_data.blessed_hero_bonus_bps(),
        )
        .unwrap_or(player_data.hero_attack_bps() as u64) as u16
    } else {
        player_data.hero_attack_bps()
    };

    // 12a. Consume pending hero ability for encounter combat.
    //   CritNext        → +10000 bps to crit chance (forces crit)
    //   BuffNext (off)  → +param bps to attack or crit depending on stat
    //   EncounterSkip   → flag for one-shot success (consumed after damage calc)
    let mut hero_attack_bps_final = boosted_hero_attack;
    let mut hero_crit_chance_bps_final = player_data.hero_crit_chance_bps();
    let mut force_encounter_skip = false;
    match player_data.live_pending_effect(now) {
        crate::state::PENDING_CRIT_NEXT => {
            hero_crit_chance_bps_final = hero_crit_chance_bps_final.saturating_add(10000);
            player_data.clear_pending_effect();
        }
        crate::state::PENDING_BUFF_NEXT => {
            let stat = player_data.pending_effect_stat();
            let bps = player_data.pending_effect_param();
            if matches!(stat, 1 | 7 | 14) {
                match stat {
                    1 | 14 => hero_attack_bps_final = hero_attack_bps_final.saturating_add(bps),
                    7 => {
                        hero_crit_chance_bps_final = hero_crit_chance_bps_final.saturating_add(bps)
                    }
                    _ => {}
                }
                player_data.clear_pending_effect();
            }
        }
        crate::state::PENDING_ENCOUNTER_SKIP => {
            force_encounter_skip = true;
            player_data.clear_pending_effect();
        }
        _ => {}
    }

    // Apply research buffs and hero buffs for attacking encounters
    let base_damage = calculate_damage_output(
        total_defensive,
        player_data.total_weapons(),
        false, // drive_by disabled
        gameplay_config,
        player_data.research_attack_bps(),
        player_data.research_crit_chance_bps(),
        player_data.research_crit_damage_bps(),
        hero_attack_bps_final,
        player_data.hero_weapon_efficiency_bps(),
        hero_crit_chance_bps_final,
        player_data.equipped_weapon_bonus_bps(),
    );

    // 13a. Apply Time-of-Day Bonus to Attack (DETERMINISTIC)
    // Attacking is best at night (DeepNight gives φ), worst at Midday (1/φ)
    let time_of_day = get_time_of_day(now, player_data.current_long);
    let time_damage = apply_time_multiplier(base_damage, time_of_day, ActivityType::Attacking);

    // 13b. Apply Hero EncounterDamage bonus (PvE-specific multiplier, no u128!)
    // Formula: damage × (10000 + hero_encounter_damage_bps) / 10000
    let hero_damage = if player_data.hero_encounter_damage_bps() > 0 {
        apply_bp_bonus(time_damage, player_data.hero_encounter_damage_bps()).unwrap_or(time_damage)
    } else {
        time_damage
    };

    // 13c. Apply Barracks daily mini-game bonus (unit effectiveness)
    // Barracks provides 5-15% unit effectiveness bonus
    let estate = load_estate_for_player(estate_account, &*player_data, program_id)?;
    let damage = if estate.unit_effectiveness_bps > 0 {
        apply_bp_bonus(hero_damage, estate.unit_effectiveness_bps).unwrap_or(hero_damage)
    } else {
        hero_damage
    };

    if damage == 0 {
        return Err(GameError::InsufficientAttackPower.into());
    }

    // 13a. Apply encounter defense (NEW - damage reduction)
    // Defense is reduced by research encounter success buff
    let effective_defense = if player_data.research_encounter_success_bps() > 0 {
        // Reduce defense by research buff (e.g., 2000 bps = 20% defense reduction)
        let defense_reduction = ((encounter_data.defense as u64)
            .saturating_mul(player_data.research_encounter_success_bps() as u64)
            / 10000) as u32;
        encounter_data.defense.saturating_sub(defense_reduction)
    } else {
        encounter_data.defense
    };

    // Formula: damage_after_defense = damage * (10000 - defense) / 10000 (no u128!)
    // Example: 1000 damage vs 2500 defense (25%) = 1000 * 7500 / 10000 = 750
    let defense_factor = 10000u64.saturating_sub(effective_defense as u64);
    let damage_after_defense = apply_bp(damage, defense_factor).unwrap_or(0);

    // EncounterSkip overrides damage to one-shot the encounter, after defense is
    // computed (so loot/cash scales with encounter HP, not with attacker damage).
    let damage_after_defense = if force_encounter_skip {
        encounter_data.health
    } else {
        damage_after_defense
    };

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
        let siege_consumed = actual_damage
            .saturating_add(DAMAGE_PER_SIEGE_WEAPON)
            .saturating_sub(1)
            / DAMAGE_PER_SIEGE_WEAPON;
        // Cap at available siege weapons
        let siege_consumed = siege_consumed.min(player_data.siege_weapons);
        player_data.siege_weapons = player_data.siege_weapons.saturating_sub(siege_consumed);
    }

    // 15. Calculate instant cash reward (deterministic: midpoint of 5-10 = 7.5, use 7)
    let cash_per_damage = 7u64; // Deterministic: midpoint of old 5-10 range
    let instant_cash = actual_damage.saturating_mul(cash_per_damage);

    player_data.cash_on_hand = player_data.cash_on_hand.saturating_add(instant_cash);

    // 16. Track attacker for ranking rewards (DYNAMIC REALLOC)
    // Add player to attackers list if not already present
    let player_key = *player.address();
    let old_attacker_count = encounter_data.attacker_count;

    // Drop encounter_data to release the RefMut before re-borrowing
    // The health mutation above is already persisted to account data

    // Check if player already attacked (now safe to borrow)
    let already_attacking = {
        let encounter_data_check = encounter.try_borrow()?;
        let encounter_header = unsafe { EncounterAccount::load(&encounter_data_check) };
        encounter_header.has_attacked(&encounter_data_check, player.address())
    };

    // Calculate if we need to realloc BEFORE doing it
    let needs_realloc = !already_attacking;
    let new_count = if needs_realloc {
        old_attacker_count
            .checked_add(1)
            .ok_or(GameError::EncounterFull)?
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
        let old_rent = rent.try_minimum_balance(old_len)?;
        let new_rent = rent.try_minimum_balance(new_len)?;
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
        let mut encounter_data_full = encounter.try_borrow_mut()?;
        let offset = EncounterAccount::BASE_LEN + (old_attacker_count as usize * 32);
        encounter_data_full[offset..offset + 32].copy_from_slice(player_key.as_ref());

        // Update count
        let encounter_data_mut = unsafe { EncounterAccount::load_mut(&mut encounter_data_full) };
        encounter_data_mut.attacker_count = new_count;
    }

    // Re-load encounter data for remaining operations (immutable is fine now)
    let encounter_data = EncounterAccount::load_checked(
        encounter,
        game_engine.address(),
        player_data.current_city,
        encounter_id,
        program_id,
    )?;

    // 17. Update player stats
    player_data.total_attacks = player_data.total_attacks.saturating_add(1);
    player_data.total_attack_power = player_data.total_attack_power.saturating_add(damage);

    // Count as encounter participation
    player_data.total_encounter_attacks = player_data.total_encounter_attacks.saturating_add(1);

    // 18. Grant XP if encounter dies (with time-of-day bonus)
    // Golden hours (Dawn/Dusk) give φ² (2.618x) XP for enlightenment!
    let xp_gained = if encounter_data.health == 0 {
        let base_xp = calculate_xp_reward(XpAction::DefeatEncounter {
            rarity: encounter_data.rarity,
        });
        let old_level = player_data.level;
        let (levels_gained, new_level, _) =
            grant_xp_with_time_bonus(&mut *player_data, base_xp, now)?;

        // Emit XP gained event
        emit!(XpGained {
            player: *player.address(),
            player_name: player_data.name,
            amount: base_xp,
            source: 0, // 0=combat
            total_xp: player_data.current_xp,
            timestamp: now,
        });

        // Emit level up event if player leveled
        if levels_gained > 0 {
            emit!(PlayerLeveledUp {
                player: *player.address(),
                player_name: player_data.name,
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

    // Loot breakdown for the EncounterDefeated event, populated inside the
    // loot creation block below. Defaults to zero so the event still serializes
    // cleanly when the encounter dies but has_loot() returned false.
    let mut emit_loot_novi = 0u64;
    let mut emit_loot_produce = 0u64;
    let mut emit_loot_vehicles = 0u64;
    let mut emit_loot_melee = 0u64;
    let mut emit_loot_ranged = 0u64;
    let mut emit_loot_siege = 0u64;
    let mut emit_loot_fragments = 0u64;
    let mut emit_loot_gems = 0u64;

    // 18a. Create Loot if encounter dies (NEW)
    if encounter_data.health == 0 {
        // Calculate loot pool using oscillation + level scaling + time-of-day bonus
        // Night attacks = better loot (φ multiplier at DeepNight!)
        let mut loot_pool = calculate_encounter_loot_pool(
            &*encounter_data,
            now,
            player_data.current_long as f64,
            economic_config,
            &game_engine_data.gameplay_config,
        );

        // Apply hero loot bonus (multiplicative) - boosts all loot quantities
        if player_data.hero_loot_bonus_bps() > 0 {
            let multiplier = 10000u64.saturating_add(player_data.hero_loot_bonus_bps() as u64);
            loot_pool.total_cash = loot_pool.total_cash.saturating_mul(multiplier) / 10000;
            loot_pool.total_novi = loot_pool.total_novi.saturating_mul(multiplier) / 10000;
            loot_pool.total_weapons = loot_pool.total_weapons.saturating_mul(multiplier) / 10000;
            loot_pool.total_produce = loot_pool.total_produce.saturating_mul(multiplier) / 10000;
            loot_pool.total_vehicles = loot_pool.total_vehicles.saturating_mul(multiplier) / 10000;
        }

        // Apply hero synchrony bonus (multiplicative) - additional loot boost
        if player_data.hero_synchrony_bonus_bps() > 0 {
            let multiplier = 10000u64.saturating_add(player_data.hero_synchrony_bonus_bps() as u64);
            loot_pool.total_cash = loot_pool.total_cash.saturating_mul(multiplier) / 10000;
            loot_pool.total_novi = loot_pool.total_novi.saturating_mul(multiplier) / 10000;
            loot_pool.total_weapons = loot_pool.total_weapons.saturating_mul(multiplier) / 10000;
            loot_pool.total_produce = loot_pool.total_produce.saturating_mul(multiplier) / 10000;
            loot_pool.total_vehicles = loot_pool.total_vehicles.saturating_mul(multiplier) / 10000;
        }

        // Apply Observatory daily mini-game bonus (loot bonus 5-25%)
        if estate.daily_loot_bonus_bps > 0 {
            let multiplier = 10000u64.saturating_add(estate.daily_loot_bonus_bps as u64);
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
            player_data.loot_counter = player_data
                .loot_counter
                .checked_add(1)
                .ok_or(GameError::MathOverflow)?;

            // Derive and validate loot PDA (player-specific: [loot, player, loot_id])
            let (expected_loot_pda, loot_bump) = LootAccount::derive_pda(player.address(), loot_id);
            require_key_match(loot_account, &expected_loot_pda)?;

            // Calculate rent for loot account
            let loot_lamports = crate::utils::rent_exempt_const(LootAccount::LEN);

            // Create loot account PDA with signer seeds
            let loot_bump_seed = [loot_bump];
            let loot_id_bytes = loot_id.to_le_bytes();
            let loot_seeds =
                crate::seeds!(LOOT_SEED, player.address(), &loot_id_bytes, &loot_bump_seed);
            let loot_signer = pinocchio::cpi::Signer::from(&loot_seeds);

            // CPI: Create loot account
            CreateAccount {
                from: owner,
                to: loot_account,
                lamports: loot_lamports,
                space: LootAccount::LEN as u64,
                owner: program_id,
            }
            .invoke_signed(&[loot_signer])?;

            // Calculate fragments and gems based on player research
            let mut fragments = 0u64;
            let mut gems = 0u64;

            // Get time-of-day multiplier for loot drops
            // Golden hours (Dawn/Dusk) give φ (1.618x), DeepNight gives √φ (1.272x)
            let loot_time_mult = get_time_multiplier(time_of_day, ActivityType::LootDrop);

            // Check if player has fragment/gem drops unlocked via research
            if player_data.has_fragment_drops() {
                // Check for ResearchProgress to get drop rate bonus
                let fragment_bonus_bps = 0u16; // Would need ResearchProgress account for actual bonus
                if should_award_fragments(
                    encounter_data.level,
                    encounter_data.rarity,
                    player_data.has_fragment_drops(),
                    fragment_bonus_bps,
                ) {
                    fragments = calculate_fragment_amount(
                        encounter_data.level,
                        encounter_data.rarity,
                        player_data.research_synchrony_bonus_bps(),
                        loot_time_mult,
                    );
                }
            }

            if player_data.has_gem_drops() {
                // Check for ResearchProgress to get drop rate bonus
                let gem_bonus_bps = 0u16; // Would need ResearchProgress account for actual bonus
                if should_award_gems(
                    encounter_data.level,
                    encounter_data.rarity,
                    player_data.has_gem_drops(),
                    gem_bonus_bps,
                ) {
                    gems = calculate_gem_amount(
                        encounter_data.level,
                        encounter_data.rarity,
                        player_data.research_synchrony_bonus_bps(),
                        loot_time_mult,
                    );
                }
            }

            // Apply loot magnetism research buff (increases all loot)
            if player_data.research_loot_magnetism_bps() > 0 {
                let multiplier =
                    10000u64.saturating_add(player_data.research_loot_magnetism_bps() as u64);
                fragments = fragments.saturating_mul(multiplier) / 10000;
                gems = gems.saturating_mul(multiplier) / 10000;
            }

            // Initialize loot data
            let mut loot_account_data_ref = loot_account.try_borrow_mut()?;
            let loot_data = unsafe { LootAccount::load_mut(&mut loot_account_data_ref) };

            // Split weapons by rarity: Melee 50%, Ranged 30%, Siege 20%
            // This reflects: melee=common, ranged=tactical, siege=rare+powerful
            let total_weapons = loot_pool.total_weapons;
            // Rounded shares (basis-points + half-step) so low counts don't bias siege.
            let melee_share = (total_weapons.saturating_mul(5000).saturating_add(5000)) / 10000; // 50% rounded
            let ranged_share = (total_weapons.saturating_mul(3000).saturating_add(5000)) / 10000; // 30% rounded
                                                                      // Siege gets the remainder; clamp in case rounding pushed melee+ranged over total.
            let used = melee_share.saturating_add(ranged_share);
            let siege_share = total_weapons.saturating_sub(used);

            *loot_data = LootAccount {
                account_key: crate::state::AccountKey::Loot as u8,
                owner: *player.address(),
                creator: *owner.address(), // Owner pays rent, gets refund on claim
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

            // Snapshot for the EncounterDefeated event emitted later.
            emit_loot_novi = loot_pool.total_novi;
            emit_loot_produce = loot_pool.total_produce;
            emit_loot_vehicles = loot_pool.total_vehicles;
            emit_loot_melee = melee_share;
            emit_loot_ranged = ranged_share;
            emit_loot_siege = siege_share;
            emit_loot_fragments = fragments;
            emit_loot_gems = gems;
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

        let (expected_location_pda, _) = LocationAccount::derive_pda(
            &encounter_data.game_engine,
            encounter_data.city_id,
            enc_grid_lat,
            enc_grid_long,
        );

        if enc_location.address() != &expected_location_pda {
            return Err(GameError::InvalidPDA.into());
        }

        // Validate location account ownership and occupancy
        require_owner(enc_location, program_id)?;

        {
            let location_data = enc_location.try_borrow()?;
            let location = unsafe { LocationAccount::load(&location_data) };

            if !location.is_occupied_by(encounter.address()) {
                return Err(GameError::NotCellOccupant.into());
            }

            // Validate the refund recipient matches the stored location_creator
            if &location.location_creator != creator_refund.address() {
                return Err(GameError::InvalidParameter.into());
            }
        }

        // Close the location account (refund rent to creator)
        close_account(enc_location, creator_refund)?;
    }

    // 19. Update networth (PURE LOGIC)
    player_data.networth = calculate_networth(&*player_data, economic_config)?;

    // 20. Update event scores if player is participating in an event
    if let (Some(event_participation_acc), Some(event_acc)) = (event_participation, event) {
        // Validate player is in an event
        if player_data.current_event == 0 {
            return Err(GameError::NotInEvent.into());
        }

        // Load event participation with ownership validation (kingdom-scoped)
        let participation = crate::state::EventParticipation::load_checked_mut(
            event_participation_acc,
            game_engine.address(),
            player_data.current_event,
            owner.address(),
            program_id,
        )?;

        // Load event with ownership validation (kingdom-scoped)
        let event_data = crate::state::EventAccount::load_checked_mut(
            event_acc,
            game_engine.address(),
            player_data.current_event,
            program_id,
        )?;

        let player_key = owner.address();
        let event_key = event_acc.address();

        // DETERMINISTIC: Use exact damage value (no randomness)
        let final_damage = actual_damage;

        // TotalDamageDealt: Add actual damage dealt (deterministic)
        let _ = update_event_score(
            &mut *participation,
            &mut *event_data,
            event_key,
            player_key,
            player_data.name,
            EventType::TotalDamageDealt,
            final_damage,
            now,
        );

        // MostEncountersDefeated: +1 if encounter dies
        if encounter_data.health == 0 {
            let _ = update_event_score(
                &mut *participation,
                &mut *event_data,
                event_key,
                player_key,
                player_data.name,
                EventType::MostEncountersDefeated,
                1,
                now,
            );

            // MostAttacksWonPvE: +1 if encounter dies
            let _ = update_event_score(
                &mut *participation,
                &mut *event_data,
                event_key,
                player_key,
                player_data.name,
                EventType::MostAttacksWonPvE,
                1,
                now,
            );
        }

        // MostXPGained: Add XP gained (deterministic)
        if xp_gained > 0 {
            let _ = update_event_score(
                &mut *participation,
                &mut *event_data,
                event_key,
                player_key,
                player_data.name,
                EventType::MostXPGained,
                xp_gained,
                now,
            );
        }
    }

    // Mirror the actual deduction performed earlier by `consume_stamina`
    // (see logic/stamina.rs) so the emitted event matches what the player paid.
    let stamina_consumed =
        crate::constants::ENCOUNTER_STAMINA_COSTS[encounter_type as usize] as u16;

    // Emit EncounterAttacked event
    emit!(EncounterAttacked {
        player: player_key,
        player_name: player_data.name,
        encounter: *encounter.address(),
        damage_dealt: actual_damage,
        health_remaining: encounter_data.health,
        stamina_consumed,
        novi_consumed: 0, // No NOVI consumed in encounter attacks
        attacker_count: new_count,
        timestamp: now,
    });

    // Emit EncounterDefeated event if encounter dies
    if encounter_data.health == 0 {
        emit!(EncounterDefeated {
            encounter: *encounter.address(),
            encounter_type: encounter_data.rarity,
            level: encounter_data.level as u8,
            total_attackers: new_count,
            killing_blow_by: player_key,
            killing_blow_name: player_data.name,
            loot_cash: instant_cash,
            loot_novi: emit_loot_novi,
            loot_produce: emit_loot_produce,
            loot_vehicles: emit_loot_vehicles,
            loot_melee: emit_loot_melee,
            loot_ranged: emit_loot_ranged,
            loot_siege: emit_loot_siege,
            loot_fragments: emit_loot_fragments,
            loot_gems: emit_loot_gems,
            timestamp: now,
        });
    }

    Ok(())
}
