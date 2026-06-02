use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};

use crate::{
    constants::PLAYER_SEED,
    emit,
    error::GameError,
    events::{PlayerLeveledUp, ResourcesCollected, XpGained},
    helpers::{
        estate::{
            dock_fishing_bonus_bps, farm_produce_bonus_bps, load_estate_for_player,
            mine_mining_bonus_bps, observatory_loot_bonus_bps, require_dock, require_farm,
            require_mine,
        },
        event_scoring::update_event_score,
    },
    logic::{
        apply_time_multiplier, biome, calculate_networth, calculate_synchrony,
        calculate_xp_reward, consume_novi_logic, consume_produce, get_time_of_day,
        grant_xp_with_time_bonus,
        safe_math::{pow_three_quarters, sqrt_product},
        update_happiness_operative, ActivityType, XpAction,
    },
    state::{CityAccount, GameEngine, PlayerAccount, UserAccount},
    types::{CollectionType, EventType},
    utils::{read_u64, read_u8},
    validation::require_signer,
};

// Tuning for `saturating_yield` — `output = M·raw/(raw+K) + raw^0.75/D`.
// M (`_CEILING`) is the plateau; K (`_HALF`) is the raw at which the plateau
// reaches M/2, so it sets how far the rising part stretches; D
// (`_TAIL_DIVISOR`) sets where the soft tail overtakes the plateau (`D ≈
// raw_whale^0.75 / M`, anchored at raw_whale ≈ 1e12).
const CASH_YIELD_CEILING: u64 = 5_000_000;
const CASH_YIELD_HALF: u64 = 1_000_000;
const CASH_YIELD_TAIL_DIVISOR: u64 = 200;

const GEM_YIELD_CEILING: u64 = 2_000;
const GEM_YIELD_HALF: u64 = 5_000;
const GEM_YIELD_TAIL_DIVISOR: u64 = 500_000;

// Flat fragment drops, awarded once research unlocks them.
const MINING_FRAGMENT_DROP: u64 = 10;
const FISHING_FRAGMENT_DROP: u64 = 8;

/// Saturating yield curve for cash and gem collection.
///
/// `output = ceiling·raw/(raw + half)  +  raw^0.75 / tail_divisor`
///
/// * The first term plateaus at `ceiling` — a soft cap.
/// * The second is an unbounded but sub-linear tail (`x^0.75`), so whales
///   keep climbing past the plateau rather than hitting a hard wall.
///
/// `half` is the `raw` at which the plateau term reaches `ceiling/2`.
fn saturating_yield(raw: u64, ceiling: u64, half: u64, tail_divisor: u64) -> u64 {
    let denom = (raw as u128).saturating_add(half as u128).max(1);
    // plateau ≤ ceiling, so the downcast to u64 cannot truncate.
    let plateau = ((ceiling as u128).saturating_mul(raw as u128) / denom) as u64;
    let tail = pow_three_quarters(raw) / tail_divisor.max(1);
    plateau.saturating_add(tail)
}

/// Operative units collect resources (cash, gems, or produce)
///
/// # Flow
/// 1. Consume locked Novi to generate power
/// 2. Power determines collection efficiency
/// 3. Based on collection type:
///    - Cash: Generate reserved novi based on unit multipliers
///    - Mining: Generate gems + chance for fragments (research locked)
///    - Fishing: Generate produce + chance for fragments (research locked)
/// 4. Consume produce (1 per operative unit total)
/// 5. Update operative happiness based on produce availability
/// 6. Apply research buffs to collection output
/// 7. Update networth
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [writable] user: UserAccount PDA
/// - [signer] owner: Wallet that owns both accounts
/// - [writable] player_token_account: Player's NOVI token account (ATA)
/// - [writable] novi_mint: NOVI token mint
/// - [] game_engine: GameEngine PDA (for burn authority)
/// - [] token_program: SPL Token program
/// - [] estate_account: EstateAccount PDA (for Observatory bonus)
/// - [writable] event_participation: (Optional) EventParticipation PDA for event scoring
/// - [writable] event: (Optional) EventAccount PDA for event scoring
/// - [] research_progress: (Optional) ResearchProgress PDA for economy buffs
///
/// # Building Bonuses
/// Observatory provides collection bonus:
/// - Lv 5-9: +10% collection output
/// - Lv 10-14: +25% collection output
/// - Lv 15-19: +40% collection output
/// - Lv 20+: +60% collection output
///
/// # Instruction Data
/// - novi_amount: u64 (8 bytes) - Amount of locked Novi to consume
/// - collection_type: u8 (1 byte) - 0=Cash, 1=Mining, 2=Fishing
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    // estate_account is required, event accounts are optional
    crate::extract_accounts!(
        accounts,
        [
            player,
            user,
            owner,
            player_token_account,
            novi_mint,
            game_engine,
            _token_program,
            estate_account,
        ]
    );
    let (event_participation, event) = if accounts.len() >= 10 {
        (Some(&accounts[8]), Some(&accounts[9]))
    } else {
        (None, None)
    };

    // 2. Validate signer
    require_signer(owner)?;

    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "collect_resources.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Parse instruction data
    if data.len() != 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let novi_amount = read_u64(data, 0, "novi_amount")?;

    let collection_type = CollectionType::try_from(read_u8(data, 8, "collection_type")?)?;

    // 4. Load GameEngine for config (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;

    // 5. Load and verify player/user accounts (PDA + ownership + bump in one call)
    let player_data = PlayerAccount::load_checked_mut(
        player,
        game_engine.address(),
        owner.address(),
        program_id,
    )?;
    let _user_data = UserAccount::load_checked_mut(user, owner.address(), program_id)?;

    // Validate player not traveling (can't collect while traveling)
    if player_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }
    let economic_config = &game_engine_data.economic_config;

    // 5. Validate sufficient locked Novi
    if player_data.locked_novi < novi_amount {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // 6. Validate has operative units
    let total_operative = player_data.total_operative_units();
    if total_operative == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // Load estate once — reused for the collection-type gate, the Observatory
    // bonus, and the per-building bonus below.
    let estate = load_estate_for_player(estate_account, &*player_data, program_id)?;

    // 6a. Validate collection type is unlocked
    match collection_type {
        CollectionType::Mining => {
            if !player_data.has_mining() {
                return Err(GameError::FeatureLocked.into());
            }
            // Mining requires Mine building (split from Workshop)
            require_mine(estate, 1)?;
        }
        CollectionType::Fishing => {
            if !player_data.has_fishing() {
                return Err(GameError::FeatureLocked.into());
            }
            // Fishing requires Dock building (minimum level 1)
            require_dock(estate, 1)?;
        }
        CollectionType::Farming => {
            // Farming requires Farm building
            require_farm(estate, 1)?;
        }
        CollectionType::Cash => {} // Always unlocked
    }

    // 7. Get current timestamp (needed for subscription expiration check and time bonuses)
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 7a. Calculate power from NOVI consumption (PURE LOGIC)
    let synchrony = calculate_synchrony(
        &*player_data,
        &game_engine_data.gameplay_config,
        &game_engine_data.subscription_tiers,
        now,
    );
    let base_power = consume_novi_logic(novi_amount, synchrony, economic_config);

    // 7b. Apply Consumption Time Bonus (DETERMINISTIC)
    // Consuming NOVI is more efficient during the day (peak business hours)
    // Morning/Midday gives φ (1.618x), DeepNight gives 1/φ (0.618x)
    let time_of_day = get_time_of_day(now, player_data.current_long);
    let power = apply_time_multiplier(base_power, time_of_day, ActivityType::Consuming);

    if power == 0 {
        return Err(GameError::InsufficientPower.into());
    }

    // 8. Calculate resource generation based on collection type
    let base_output = match collection_type {
        CollectionType::Cash => {
            // Cash from operative units, weighted by tier: 10x / 8x / 5x.
            let unit_factor = player_data
                .operative_unit_1
                .saturating_mul(10)
                .saturating_add(player_data.operative_unit_2.saturating_mul(8))
                .saturating_add(player_data.operative_unit_3.saturating_mul(5));
            let raw = unit_factor.saturating_mul(power);
            saturating_yield(
                raw,
                CASH_YIELD_CEILING,
                CASH_YIELD_HALF,
                CASH_YIELD_TAIL_DIVISOR,
            )
        }
        CollectionType::Mining => {
            // Gems from operative units, weighted by tier: 3x / 2x / 1x.
            let unit_factor = player_data
                .operative_unit_1
                .saturating_mul(3)
                .saturating_add(player_data.operative_unit_2.saturating_mul(2))
                .saturating_add(player_data.operative_unit_3);
            let raw = unit_factor.saturating_mul(power);
            saturating_yield(
                raw,
                GEM_YIELD_CEILING,
                GEM_YIELD_HALF,
                GEM_YIELD_TAIL_DIVISOR,
            )
        }
        CollectionType::Fishing => {
            // Fishing generates produce based on power and unit count
            // operative_unit_1: 5x (skilled fishers)
            // operative_unit_2: 4x
            // operative_unit_3: 3x
            let produce_from_unit_1 = player_data.operative_unit_1.saturating_mul(5);

            let produce_from_unit_2 = player_data.operative_unit_2.saturating_mul(4);

            let produce_from_unit_3 = player_data.operative_unit_3.saturating_mul(3);

            let unit_factor = produce_from_unit_1
                .saturating_add(produce_from_unit_2)
                .saturating_add(produce_from_unit_3);

            // Fishing scales better than mining but worse than cash (no u128!)
            // Use power^0.75 scaling (approximated with integer math)
            // This gives better returns than mining but still has diminishing returns

            // Calculate base scaled value using sqrt_product for (unit_factor * power)
            let sqrt_scaled = sqrt_product(unit_factor, power);

            // Apply ^0.75 approximation using pow_three_quarters
            // The pow_three_quarters function uses sqrt(x) * sqrt(sqrt(x))
            let base_output = pow_three_quarters(sqrt_scaled);

            // Scale back up and ensure reasonable output
            // Produce is 3x more common than gems
            base_output.saturating_mul(3)
        }
        CollectionType::Farming => {
            // Farming generates produce using operative units
            // operative_unit_1: 5x
            // operative_unit_2: 4x
            // operative_unit_3: 3x
            let produce_from_unit_1 = player_data.operative_unit_1.saturating_mul(5);

            let produce_from_unit_2 = player_data.operative_unit_2.saturating_mul(4);

            let produce_from_unit_3 = player_data.operative_unit_3.saturating_mul(3);

            let unit_factor = produce_from_unit_1
                .saturating_add(produce_from_unit_2)
                .saturating_add(produce_from_unit_3);

            // Same scaling as fishing (power^0.75)
            let sqrt_scaled = sqrt_product(unit_factor, power);
            let base_output = pow_three_quarters(sqrt_scaled);

            // Produce is 3x more common than gems
            base_output.saturating_mul(3)
        }
    };

    if base_output == 0 {
        return Err(GameError::InsufficientPower.into());
    }

    // 8x. Apply terrain affinity bonus (mining near mountains, fishing near coast)
    // City account is optional at the end of accounts list:
    //   9 accounts (8 base + city, no events) or 11 accounts (8 base + 2 events + city)
    let base_output = {
        let city_idx = match accounts.len() {
            9 => Some(8usize),
            11 => Some(10usize),
            _ => None,
        };
        if let Some(idx) = city_idx {
            let city_acc = &accounts[idx];
            if unsafe { city_acc.owner() } == program_id && city_acc.data_len() >= CityAccount::SIZE
            {
                let city_data = unsafe { CityAccount::load(city_acc)? };
                // Validate city matches player's current city
                if city_data.city_id == player_data.current_city {
                    let (ox, oy) =
                        city_data.offset_for(player_data.current_lat, player_data.current_long);
                    let aff = biome::biome_affinity(city_data.biome_at_offset(ox, oy));
                    let bonus = match collection_type {
                        CollectionType::Mining => aff.mining_bps,
                        CollectionType::Fishing => aff.fishing_bps,
                        _ => 0,
                    };
                    if bonus > 0 {
                        let m = 10000u64.saturating_add(bonus as u64);
                        base_output.saturating_mul(m) / 10000
                    } else {
                        base_output
                    }
                } else {
                    base_output
                }
            } else {
                base_output
            }
        } else {
            base_output
        }
    };

    // 8a. Apply Time-of-Day Collection Bonus (DETERMINISTIC)
    // Each collection type has optimal times:
    // - Cash: Best at Midday (φ), worst at DeepNight (1/φ)
    // - Mining: Best at night (φ), worst at Midday (1/φ) - cooler temperatures
    // - Fishing: Best at Dawn/Dusk (φ) - fish feeding times
    // Note: time_of_day already calculated above for Consuming bonus

    let time_activity = match collection_type {
        CollectionType::Cash => ActivityType::Collecting,
        CollectionType::Mining => ActivityType::Mining,
        CollectionType::Fishing | CollectionType::Farming => ActivityType::Fishing,
    };

    let time_adjusted_output = apply_time_multiplier(base_output, time_of_day, time_activity);

    // 8b. Apply Observatory building bonus (BUILDING BONUS)
    // Observatory increases all collection output
    let loot_bonus_bps = observatory_loot_bonus_bps(estate);

    // Apply bonus: output × (10000 + bonus_bps) / 10000
    let base_output = if loot_bonus_bps > 0 {
        let bonus_multiplier = 10000u64.saturating_add(loot_bonus_bps as u64);
        time_adjusted_output.saturating_mul(bonus_multiplier) / 10000
    } else {
        time_adjusted_output
    };

    // 9. Consume produce (1 per operative unit)
    let produce_consumed = consume_produce(total_operative, player_data.produce);

    player_data.produce = player_data.produce.saturating_sub(produce_consumed);

    // 10. Update operative happiness based on produce availability (PURE LOGIC)
    player_data.happiness_operative =
        update_happiness_operative(total_operative, player_data.produce);

    // 10a. Calculate abandonment based on happiness (PURE LOGIC)
    let gameplay_config = &game_engine_data.gameplay_config;

    let units_to_abandon = crate::logic::calculate_abandonment(
        total_operative,
        player_data.happiness_operative,
        gameplay_config,
    );

    // Apply abandonment (proportionally distributed across unit types).
    // Integer round-half-up of unit × units_to_abandon / total_operative.
    if units_to_abandon > 0 {
        let share = |units: u64| -> u64 {
            units
                .saturating_mul(units_to_abandon)
                .saturating_add(total_operative / 2)
                / total_operative
        };
        let abandon_unit_1 = share(player_data.operative_unit_1);
        let abandon_unit_2 = share(player_data.operative_unit_2);
        let abandon_unit_3 = share(player_data.operative_unit_3);

        player_data.operative_unit_1 = player_data.operative_unit_1.saturating_sub(abandon_unit_1);
        player_data.operative_unit_2 = player_data.operative_unit_2.saturating_sub(abandon_unit_2);
        player_data.operative_unit_3 = player_data.operative_unit_3.saturating_sub(abandon_unit_3);
    }

    // 11. Consume locked Novi from state
    player_data.locked_novi = player_data
        .locked_novi
        .checked_sub(novi_amount)
        .ok_or(GameError::MathOverflow)?;

    // 11a. Actually BURN the NOVI tokens (SPL Token CPI)
    // Player PDA owns the token account, so player is the burn authority
    // Must drop player_data (LoadedMut) before CPI to release RefMut on player
    let player_bump = player_data.bump;

    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(
        PLAYER_SEED,
        game_engine.address(),
        owner.address(),
        &bump_seed
    );
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    crate::helpers::burn_tokens(
        player_token_account,
        novi_mint,
        player,
        novi_amount,
        &[player_signer],
    )?;

    // Re-load player data after CPI (mutations from before drop are preserved in
    // the buffer). Identity was verified pre-CPI — skip PDA re-derivation.
    let player_data = PlayerAccount::load_mut_unchecked(player, program_id)?;

    // 12. Transfer resources based on collection type
    // (clock already obtained above for time-of-day calculation)

    // Track total resources for XP and event scoring
    let mut fragments_earned: u64 = 0;
    let total_resources_collected = match collection_type {
        CollectionType::Cash => {
            // Apply research buff for cash generation
            let mut buffed_output = if player_data.research_collection_bonus_bps() > 0 {
                let multiplier =
                    10000u64.saturating_add(player_data.research_collection_bonus_bps() as u64);
                base_output.saturating_mul(multiplier) / 10000
            } else {
                base_output
            };

            // Apply hero economy buff (multiplicative)
            if player_data.hero_economy_bps() > 0 {
                let hero_multiplier = 10000u64.saturating_add(player_data.hero_economy_bps() as u64);
                buffed_output = buffed_output.saturating_mul(hero_multiplier) / 10000;
            }

            // Cash Generation research (buff_type 15)
            if player_data.research_cash_generation_bps() > 0 {
                let m = 10000u64.saturating_add(player_data.research_cash_generation_bps() as u64);
                buffed_output = buffed_output.saturating_mul(m) / 10000;
            }

            player_data.cash_on_hand = player_data
                .cash_on_hand
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;
            buffed_output
        }
        CollectionType::Mining => {
            // Apply research buff for mining output
            let mut buffed_output = if player_data.research_collection_bonus_bps() > 0 {
                let multiplier =
                    10000u64.saturating_add(player_data.research_collection_bonus_bps() as u64);
                base_output.saturating_mul(multiplier) / 10000
            } else {
                base_output
            };

            // Apply hero collection rate buff (gems + fragments)
            if player_data.hero_collection_rate_bps() > 0 {
                let hero_multiplier =
                    10000u64.saturating_add(player_data.hero_collection_rate_bps() as u64);
                buffed_output = buffed_output.saturating_mul(hero_multiplier) / 10000;
            }

            // Apply Mine building bonus (split from Workshop)
            let mine_bonus = mine_mining_bonus_bps(estate);
            if mine_bonus > 0 {
                let mine_multiplier = 10000u64.saturating_add(mine_bonus as u64);
                buffed_output = buffed_output.saturating_mul(mine_multiplier) / 10000;
            }

            player_data.gems = player_data
                .gems
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;

            // Hero collection-rate buff also scales the fragment drop.
            if player_data.has_fragment_drops() {
                let mut fragments = MINING_FRAGMENT_DROP;
                if player_data.hero_collection_rate_bps() > 0 {
                    let hero_multiplier =
                        10000u64.saturating_add(player_data.hero_collection_rate_bps() as u64);
                    fragments = fragments.saturating_mul(hero_multiplier) / 10000;
                }
                player_data.fragments = player_data
                    .fragments
                    .checked_add(fragments)
                    .ok_or(GameError::MathOverflow)?;
                fragments_earned = fragments;
            }
            buffed_output
        }
        CollectionType::Fishing => {
            // Apply research buff for fishing output
            let mut buffed_output = if player_data.research_collection_bonus_bps() > 0 {
                let multiplier =
                    10000u64.saturating_add(player_data.research_collection_bonus_bps() as u64);
                base_output.saturating_mul(multiplier) / 10000
            } else {
                base_output
            };

            // Apply hero produce generation buff (multiplicative)
            if player_data.hero_produce_generation_bps() > 0 {
                let hero_multiplier =
                    10000u64.saturating_add(player_data.hero_produce_generation_bps() as u64);
                buffed_output = buffed_output.saturating_mul(hero_multiplier) / 10000;
            }

            // Production Efficiency research (buff_type 10) — produce output.
            if player_data.research_production_efficiency_bps() > 0 {
                let m =
                    10000u64.saturating_add(player_data.research_production_efficiency_bps() as u64);
                buffed_output = buffed_output.saturating_mul(m) / 10000;
            }

            // Apply Dock building bonus
            let dock_bonus = dock_fishing_bonus_bps(estate);
            if dock_bonus > 0 {
                let dock_multiplier = 10000u64.saturating_add(dock_bonus as u64);
                buffed_output = buffed_output.saturating_mul(dock_multiplier) / 10000;
            }

            player_data.produce = player_data
                .produce
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;

            // Hero collection-rate buff also scales the fragment drop.
            if player_data.has_fragment_drops() {
                let mut fragments = FISHING_FRAGMENT_DROP;
                if player_data.hero_collection_rate_bps() > 0 {
                    let hero_multiplier =
                        10000u64.saturating_add(player_data.hero_collection_rate_bps() as u64);
                    fragments = fragments.saturating_mul(hero_multiplier) / 10000;
                }
                player_data.fragments = player_data
                    .fragments
                    .checked_add(fragments)
                    .ok_or(GameError::MathOverflow)?;
                fragments_earned = fragments;
            }
            buffed_output
        }
        CollectionType::Farming => {
            // Apply research buff for farming output
            let mut buffed_output = if player_data.research_collection_bonus_bps() > 0 {
                let multiplier =
                    10000u64.saturating_add(player_data.research_collection_bonus_bps() as u64);
                base_output.saturating_mul(multiplier) / 10000
            } else {
                base_output
            };

            // Apply hero produce generation buff (multiplicative)
            if player_data.hero_produce_generation_bps() > 0 {
                let hero_multiplier =
                    10000u64.saturating_add(player_data.hero_produce_generation_bps() as u64);
                buffed_output = buffed_output.saturating_mul(hero_multiplier) / 10000;
            }

            // Production Efficiency research (buff_type 10) — produce output.
            if player_data.research_production_efficiency_bps() > 0 {
                let m =
                    10000u64.saturating_add(player_data.research_production_efficiency_bps() as u64);
                buffed_output = buffed_output.saturating_mul(m) / 10000;
            }

            // Apply Farm building bonus
            let farm_bonus = farm_produce_bonus_bps(estate);
            if farm_bonus > 0 {
                let farm_multiplier = 10000u64.saturating_add(farm_bonus as u64);
                buffed_output = buffed_output.saturating_mul(farm_multiplier) / 10000;
            }

            player_data.produce = player_data
                .produce
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;

            // Deterministic fragment bonus (always award 1 fragment if unlocked)
            if player_data.has_fragment_drops() {
                let mut fragments = 1u64;
                if player_data.hero_collection_rate_bps() > 0 {
                    let hero_multiplier =
                        10000u64.saturating_add(player_data.hero_collection_rate_bps() as u64);
                    fragments = fragments.saturating_mul(hero_multiplier) / 10000;
                }
                player_data.fragments = player_data
                    .fragments
                    .checked_add(fragments)
                    .ok_or(GameError::MathOverflow)?;
                fragments_earned = fragments;
            }
            buffed_output
        }
    };

    // 13. Grant XP (1 XP per 1000 resources collected) - with time-of-day bonus!
    // Golden hours (Dawn/Dusk) grant φ² bonus, night grants √φ bonus
    let xp_amount = calculate_xp_reward(XpAction::CollectResources {
        amount: total_resources_collected,
    });
    let old_level = player_data.level;
    let (levels_gained, new_level, _) =
        grant_xp_with_time_bonus(&mut *player_data, xp_amount, now)?;

    // Emit XP gained event
    emit!(XpGained {
        player: *player.address(),
        player_name: player_data.name,
        amount: xp_amount,
        source: 1, // 1=collection
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

    // 14. Update networth (PURE LOGIC)
    player_data.networth = calculate_networth(&*player_data, economic_config)?;

    // 14. Update event scores if player is participating in an event
    if let (Some(event_participation), Some(event)) = (event_participation, event) {
        // Load event participation with ownership validation (kingdom-scoped)
        let participation = crate::state::EventParticipation::load_checked_mut(
            event_participation,
            game_engine.address(),
            player_data.current_event,
            owner.address(),
            program_id,
        )?;

        // Load event with ownership validation (kingdom-scoped)
        let event_data = crate::state::EventAccount::load_checked_mut(
            event,
            game_engine.address(),
            player_data.current_event,
            program_id,
        )?;

        let player_key = owner.address();
        let event_key = event.address();

        // DETERMINISTIC: Use exact resource value (no randomness)
        // MostResourcesCollected: Add resources collected (deterministic)
        let _ = update_event_score(
            &mut *participation,
            &mut *event_data,
            event_key,
            player_key,
            player_data.name,
            EventType::MostResourcesCollected,
            total_resources_collected,
            now,
        );

        // HighestCash: Current cash (snapshot)
        let _ = update_event_score(
            &mut *participation,
            &mut *event_data,
            event_key,
            player_key,
            player_data.name,
            EventType::HighestCash,
            player_data.cash_on_hand,
            now,
        );

        // MostXPGained: Add XP gained (deterministic)
        if xp_amount > 0 {
            let _ = update_event_score(
                &mut *participation,
                &mut *event_data,
                event_key,
                player_key,
                player_data.name,
                EventType::MostXPGained,
                xp_amount,
                now,
            );
        }
    }

    // Gems earned (mining yields gems; other collection types yield none).
    let gems_earned = match collection_type {
        CollectionType::Mining => total_resources_collected,
        _ => 0,
    };

    // Emit ResourcesCollected event
    emit!(ResourcesCollected {
        player: *player.address(),
        player_name: player_data.name,
        collection_type: collection_type as u8,
        novi_consumed: novi_amount,
        base_output,
        final_output: total_resources_collected,
        gems_earned,
        fragments_earned,
        xp_gained: xp_amount,
        timestamp: now,
    });

    Ok(())
}
