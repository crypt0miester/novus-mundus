use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, UserAccount, ResearchProgress},
    constants::{PLAYER_SEED, USER_SEED, RESEARCH_SEED},
    types::{EventType, CollectionType},
    logic::{
        consume_novi_logic,
        calculate_luck,
        consume_produce,
        update_happiness_operative,
        calculate_networth,
        grant_xp_with_time_bonus,
        calculate_xp_reward,
        XpAction,
        get_time_of_day,
        apply_time_multiplier,
        ActivityType,
        safe_math::{sqrt_product, pow_three_quarters},
    },
    helpers::event_scoring::update_event_score,
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
    },
};

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
/// - [writable] event_participation: (Optional) EventParticipation PDA for event scoring
/// - [writable] event: (Optional) EventAccount PDA for event scoring
/// - [] research_progress: (Optional) ResearchProgress PDA for economy buffs
///
/// # Instruction Data
/// - novi_amount: u64 (8 bytes) - Amount of locked Novi to consume
/// - collection_type: u8 (1 byte) - 0=Cash, 1=Mining, 2=Fishing
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    let (player, user, owner, player_token_account, novi_mint, game_engine, token_program, event_participation, event) = if accounts.len() >= 9 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], &accounts[6], Some(&accounts[7]), Some(&accounts[8]))
    } else if accounts.len() >= 7 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], &accounts[6], None, None)
    } else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player)?;
    require_writable(user)?;
    require_owner(player, program_id)?;
    require_owner(user, program_id)?;

    let player_bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;
    let user_bump = require_pda(user, &[USER_SEED, owner.key()], program_id)?;

    // 3. Parse instruction data
    if data.len() != 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let novi_amount = u64::from_le_bytes([
        data[0], data[1], data[2], data[3],
        data[4], data[5], data[6], data[7],
    ]);

    let collection_type = CollectionType::try_from(data[8])?;

    // 4. Load player and user data
    let mut player_data = player.try_borrow_mut_data()?;
    let mut user_data = user.try_borrow_mut_data()?;

    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data)
    };

    let user_data = unsafe {
        UserAccount::load_mut(&mut user_data)
    };

    // Verify ownership and bumps
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

    // Validate player not traveling (can't collect while traveling)
    if player_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // Load GameEngine for config
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};
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

    // 6a. Validate collection type is unlocked
    match collection_type {
        CollectionType::Mining => {
            if !player_data.has_mining {
                return Err(GameError::FeatureLocked.into());
            }
        },
        CollectionType::Fishing => {
            if !player_data.has_fishing {
                return Err(GameError::FeatureLocked.into());
            }
        },
        CollectionType::Cash => {}, // Always unlocked
    }

    // 7. Get current timestamp (needed for subscription expiration check and time bonuses)
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 7a. Calculate power from NOVI consumption (PURE LOGIC)
    let luck = calculate_luck(
        player_data,
        &game_engine_data.gameplay_config,
        &game_engine_data.subscription_tiers,
        now,
    );
    let base_power = consume_novi_logic(novi_amount, luck, economic_config);

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
            // Cash generation based on operative units
            // operative_unit_1: 10x (highest tier)
            // operative_unit_2: 8x (mid tier)
            // operative_unit_3: 5x (lowest tier)
            let cash_from_unit_1 = player_data.operative_unit_1
                .saturating_mul(10)
                .saturating_mul(power);

            let cash_from_unit_2 = player_data.operative_unit_2
                .saturating_mul(8)
                .saturating_mul(power);

            let cash_from_unit_3 = player_data.operative_unit_3
                .saturating_mul(5)
                .saturating_mul(power);

            cash_from_unit_1
                .saturating_add(cash_from_unit_2)
                .saturating_add(cash_from_unit_3)
        },
        CollectionType::Mining => {
            // Mining generates gems based on power and unit count
            // Less efficient than cash but produces valuable gems
            // operative_unit_1: 3x (best miners)
            // operative_unit_2: 2x
            // operative_unit_3: 1x
            let gems_from_unit_1 = player_data.operative_unit_1
                .saturating_mul(3);

            let gems_from_unit_2 = player_data.operative_unit_2
                .saturating_mul(2);

            let gems_from_unit_3 = player_data.operative_unit_3
                .saturating_mul(1);

            let unit_factor = gems_from_unit_1
                .saturating_add(gems_from_unit_2)
                .saturating_add(gems_from_unit_3);

            // Scale with power but apply square root for diminishing returns (no u128!)
            // This makes gems scale with NOVI input but not linearly
            // sqrt(power * unit_factor) gives meaningful scaling
            // Example: 100 power * 100 units = sqrt(10000) = 100 gems
            // Example: 1000 power * 100 units = sqrt(100000) = 316 gems
            // Uses safe sqrt_product that stays in u64
            sqrt_product(unit_factor, power)
        },
        CollectionType::Fishing => {
            // Fishing generates produce based on power and unit count
            // operative_unit_1: 5x (skilled fishers)
            // operative_unit_2: 4x
            // operative_unit_3: 3x
            let produce_from_unit_1 = player_data.operative_unit_1
                .saturating_mul(5);

            let produce_from_unit_2 = player_data.operative_unit_2
                .saturating_mul(4);

            let produce_from_unit_3 = player_data.operative_unit_3
                .saturating_mul(3);

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
    };

    if base_output == 0 {
        return Err(GameError::InsufficientPower.into());
    }

    // 8a. Apply Time-of-Day Collection Bonus (DETERMINISTIC)
    // Each collection type has optimal times:
    // - Cash: Best at Midday (φ), worst at DeepNight (1/φ)
    // - Mining: Best at night (φ), worst at Midday (1/φ) - cooler temperatures
    // - Fishing: Best at Dawn/Dusk (φ) - fish feeding times
    // Note: time_of_day already calculated above for Consuming bonus

    let time_activity = match collection_type {
        CollectionType::Cash => ActivityType::Collecting,
        CollectionType::Mining => ActivityType::Mining,
        CollectionType::Fishing => ActivityType::Fishing,
    };

    let base_output = apply_time_multiplier(base_output, time_of_day, time_activity);

    // 9. Consume produce (1 per operative unit)
    let produce_consumed = consume_produce(total_operative, player_data.produce);

    player_data.produce = player_data.produce
        .saturating_sub(produce_consumed);

    // 10. Update operative happiness based on produce availability (PURE LOGIC)
    player_data.happiness_operative = update_happiness_operative(
        total_operative,
        player_data.produce,
    );

    // 10a. Calculate abandonment based on happiness (PURE LOGIC)
    // Load GameEngine for abandonment rate config (loading early to use later)
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data_temp = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};
    let gameplay_config = &game_engine_data_temp.gameplay_config;

    let units_to_abandon = crate::logic::calculate_abandonment(
        total_operative,
        player_data.happiness_operative,
        gameplay_config,
    );

    // Apply abandonment (proportionally distributed across unit types)
    if units_to_abandon > 0 {
        let abandon_pct = units_to_abandon as f64 / total_operative as f64;

        let abandon_unit_1 = libm::round(player_data.operative_unit_1 as f64 * abandon_pct) as u64;
        let abandon_unit_2 = libm::round(player_data.operative_unit_2 as f64 * abandon_pct) as u64;
        let abandon_unit_3 = libm::round(player_data.operative_unit_3 as f64 * abandon_pct) as u64;

        player_data.operative_unit_1 = player_data.operative_unit_1.saturating_sub(abandon_unit_1);
        player_data.operative_unit_2 = player_data.operative_unit_2.saturating_sub(abandon_unit_2);
        player_data.operative_unit_3 = player_data.operative_unit_3.saturating_sub(abandon_unit_3);
    }

    // 11. Consume locked Novi from state
    player_data.locked_novi = player_data.locked_novi
        .checked_sub(novi_amount)
        .ok_or(GameError::MathOverflow)?;

    // 11a. Actually BURN the NOVI tokens (SPL Token CPI)
    // Load GameEngine to get mint authority bump
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};
    let economic_config = &game_engine_data.economic_config;

    // Create PDA signer for GameEngine (mint/burn authority)
    let bump_seed = [game_engine_data.bump];
    let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

    // Burn tokens from player's token account (permanently reduces supply)
    crate::helpers::burn_tokens(
        player_token_account,
        novi_mint,
        game_engine,
        novi_amount,
        &[signer],
    )?;

    // 12. Transfer resources based on collection type
    // (clock already obtained above for time-of-day calculation)

    // Track total resources for XP and event scoring
    let total_resources_collected = match collection_type {
        CollectionType::Cash => {
            // Apply research buff for cash generation
            let mut buffed_output = if player_data.research_collection_bonus_bps > 0 {
                let multiplier = 10000u64 + player_data.research_collection_bonus_bps as u64;
                base_output.saturating_mul(multiplier) / 10000
            } else {
                base_output
            };

            // Apply hero economy buff (multiplicative)
            if player_data.hero_economy_bps > 0 {
                let hero_multiplier = 10000u64 + player_data.hero_economy_bps as u64;
                buffed_output = buffed_output.saturating_mul(hero_multiplier) / 10000;
            }

            user_data.reserved_novi = user_data.reserved_novi
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;
            user_data.reserved_novi_earned_at = now;
            buffed_output
        },
        CollectionType::Mining => {
            // Apply research buff for mining output
            let buffed_output = if player_data.research_collection_bonus_bps > 0 {
                let multiplier = 10000u64 + player_data.research_collection_bonus_bps as u64;
                (base_output.saturating_mul(multiplier) / 10000)
            } else {
                base_output
            };

            player_data.gems = player_data.gems
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;

            // Deterministic fragment bonus (always award 2 fragments if unlocked)
            if player_data.has_fragment_drops {
                let fragments = 2u64; // Deterministic: midpoint of old 1-3 range
                player_data.fragments = player_data.fragments
                    .checked_add(fragments)
                    .ok_or(GameError::MathOverflow)?;
            }
            buffed_output
        },
        CollectionType::Fishing => {
            // Apply research buff for fishing output
            let mut buffed_output = if player_data.research_collection_bonus_bps > 0 {
                let multiplier = 10000u64 + player_data.research_collection_bonus_bps as u64;
                base_output.saturating_mul(multiplier) / 10000
            } else {
                base_output
            };

            // Apply hero produce generation buff (multiplicative)
            if player_data.hero_produce_generation_bps > 0 {
                let hero_multiplier = 10000u64 + player_data.hero_produce_generation_bps as u64;
                buffed_output = buffed_output.saturating_mul(hero_multiplier) / 10000;
            }

            player_data.produce = player_data.produce
                .checked_add(buffed_output)
                .ok_or(GameError::MathOverflow)?;

            // Deterministic fragment bonus (always award 1 fragment if unlocked)
            if player_data.has_fragment_drops {
                let fragments = 1u64; // Deterministic: lower end of old 1-2 range (fishing less efficient)
                player_data.fragments = player_data.fragments
                    .checked_add(fragments)
                    .ok_or(GameError::MathOverflow)?;
            }
            buffed_output
        }
    };

    // 13. Grant XP (1 XP per 1000 resources collected) - with time-of-day bonus!
    // Golden hours (Dawn/Dusk) grant φ² bonus, night grants √φ bonus
    let xp_amount = calculate_xp_reward(XpAction::CollectResources { amount: total_resources_collected });
    grant_xp_with_time_bonus(player_data, xp_amount, now)?;

    // 14. Update networth (PURE LOGIC)
    player_data.networth = calculate_networth(player_data, economic_config)?;

    // 14. Update event scores if player is participating in an event
    if let (Some(event_participation), Some(event)) = (event_participation, event) {
        // Validate player is actually in this event
        let event_data_ref = event.try_borrow_data()?;
        let event_data = unsafe { crate::state::EventAccount::load(&event_data_ref) };
        if player_data.current_event != event_data.id {
            return Err(GameError::NotInEvent.into());
        }

        let player_key = player.key();

        // DETERMINISTIC: Use exact resource value (no randomness)
        // MostResourcesCollected: Add resources collected (deterministic)
        let _ = update_event_score(
            event_participation,
            event,
            player_key,
            EventType::MostResourcesCollected,
            total_resources_collected,
            now,
        );

        // HighestCash: Current cash (snapshot)
        let _ = update_event_score(
            event_participation,
            event,
            player_key,
            EventType::HighestCash,
            player_data.cash_on_hand,
            now,
        );

        // MostXPGained: Add XP gained (deterministic)
        if xp_amount > 0 {
            let _ = update_event_score(
                event_participation,
                event,
                player_key,
                EventType::MostXPGained,
                xp_amount,
                now,
            );
        }
    }

    Ok(())
}
