use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    constants::PLAYER_SEED,
    error::GameError,
    logic::{
        consume_novi_logic, calculate_synchrony, calculate_networth, update_happiness_defensive,
        get_time_of_day, apply_time_multiplier, ActivityType,
        safe_math::{apply_bp, mul_div},
    },
    state::PlayerAccount,
    types::{UnitType, EventType},
    helpers::{
        event_scoring::update_event_score,
        estate::{required_barracks_level_for_unit, load_estate_for_player, require_barracks},
    },
    validation::{require_signer, require_writable, require_owner, require_pda},
    emit,
    events::UnitsHired,
};

/// Hire units by consuming locked NOVI
///
/// This instruction demonstrates the complete three-layer architecture:
/// 1. Processor validates accounts and parses data
/// 2. Pure logic calculates power from NOVI consumption
/// 3. State is updated with new units
///
/// # Flow
/// 1. User specifies amount of locked NOVI to consume + unit type to hire
/// 2. System generates power using `consume_novi_logic()` (DETERMINISTIC: 13.75x × √φ × synchrony × time bonus)
/// 3. Power is converted to units based on power cost per unit type
/// 4. Locked NOVI is deducted, units are added
/// 5. Happiness and networth are recalculated
///
/// # Accounts Expected
/// 1. `[writable]` player - Player account PDA ([b"player", owner.key()])
/// 2. `[signer]` owner - Player's wallet (authority)
/// 3. `[writable]` player_token_account - Player's NOVI token account (ATA)
/// 4. `[writable]` novi_mint - NOVI token mint
/// 5. `[]` game_engine - GameEngine PDA (for burn authority)
/// 6. `[]` token_program - SPL Token program
/// 7. `[]` estate_account - EstateAccount PDA (for Barracks requirement)
/// 8. `[writable]` event_participation - (Optional) EventParticipation PDA for event scoring
/// 9. `[writable]` event - (Optional) EventAccount PDA for event scoring
///
/// # Building Requirements
/// Requires Barracks at specific levels based on unit type:
/// - Unit 1: Barracks Level 1
/// - Unit 2: Barracks Level 5
/// - Unit 3: Barracks Level 10
///
/// # Instruction Data
/// ```text
/// [0]      unit_type: u8     - Which unit to hire (0-5, see UnitType enum)
/// [1..9]   novi_amount: u64  - Amount of locked NOVI to consume (little-endian)
/// ```
///
/// # Unit Power Costs
/// - DefensiveUnit1: 100 power per unit
/// - DefensiveUnit2: 200 power per unit
/// - DefensiveUnit3: 500 power per unit
/// - OperativeUnit1: 150 power per unit
/// - OperativeUnit2: 300 power per unit
/// - OperativeUnit3: 750 power per unit
///
/// # Example
/// ```ignore
/// // Consume 100 locked NOVI to hire DefensiveUnit1
/// // Power generated: ~1750 (DETERMINISTIC: 100 × 13.75 × 1.272 = 1750 base, adjusted by synchrony & time)
/// // Units hired: 17 units (power / 100)
/// // Midday hiring gets φ bonus (best time for economic activity!)
/// ```
///
/// # Returns
/// - `Ok(())` on success
/// - `Err(GameError::InsufficientLockedNovi)` if not enough locked NOVI
/// - `Err(GameError::InsufficientPower)` if generated power < unit cost
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts
    let (player, owner, player_token_account, novi_mint, game_engine, _token_program, estate_account, event_participation, event) = if accounts.len() >= 9 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], &accounts[6], Some(&accounts[7]), Some(&accounts[8]))
    } else if accounts.len() >= 7 {
        (&accounts[0], &accounts[1], &accounts[2], &accounts[3], &accounts[4], &accounts[5], &accounts[6], None, None)
    } else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    // Owner must sign to authorize spending locked NOVI
    require_signer(owner)?;

    // Player must be writable (updating units and locked NOVI)
    require_writable(player)?;

    // Player must be owned by this program
    require_owner(player, program_id)?;

    // Verify player PDA matches expected derivation
    let bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;

    // 3. Parse Instruction Data

    if data.len() != 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let unit_type = UnitType::try_from(data[0])?;
    let novi_amount = u64::from_le_bytes([
        data[1], data[2], data[3], data[4],
        data[5], data[6], data[7], data[8],
    ]);

    // 4. Load Player and GameEngine Data

    // SAFETY: We validated:
    // - Account is owned by this program
    // - Account is writable
    // - Account PDA matches expected derivation
    let mut player_data_ref = player.try_borrow_mut_data()?;
    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data_ref)
    };

    // Verify owner matches
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. HARD GATE: Check Barracks Requirement
    let estate = load_estate_for_player(estate_account, player_data, program_id)?;

    // Get required Barracks level for this unit type
    let required_level = required_barracks_level_for_unit(unit_type);

    // Validate Barracks meets requirement
    require_barracks(estate, required_level)?;

    // Load GameEngine for cost configuration
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};
    let economic_config = &game_engine_data.economic_config;

    // Verify bump matches
    if player_data.bump != bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // Validate player not traveling (can't hire while traveling)
    if player_data.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 5. Validate Sufficient Locked NOVI

    if player_data.locked_novi < novi_amount {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // 6. Get current timestamp (needed for subscription expiration check and time bonuses)
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 6a. Calculate Power from NOVI Consumption (PURE LOGIC)

    // Calculate player's synchrony multiplier (using basis points from config)
    let synchrony = calculate_synchrony(
        player_data,
        &game_engine_data.gameplay_config,
        &game_engine_data.subscription_tiers,
        now,
    );

    // Generate base power from consuming NOVI
    let base_power = consume_novi_logic(novi_amount, synchrony, economic_config);

    // 6b. Apply Consumption Time Bonus (DETERMINISTIC)
    // Consuming NOVI is more efficient during the day (peak business hours)
    // Morning/Midday gives φ (1.618x), DeepNight gives 1/φ (0.618x)
    let time_of_day = get_time_of_day(now, player_data.current_long);
    let power = apply_time_multiplier(base_power, time_of_day, ActivityType::Consuming);

    // 7. Calculate Units from Power

    // Get base unit cost from GameEngine config
    let base_unit_cost = match unit_type {
        UnitType::DefensiveUnit1 => economic_config.defensive_unit_1_cost,
        UnitType::DefensiveUnit2 => economic_config.defensive_unit_2_cost,
        UnitType::DefensiveUnit3 => economic_config.defensive_unit_3_cost,
        UnitType::OperativeUnit1 => economic_config.operative_unit_1_cost,
        UnitType::OperativeUnit2 => economic_config.operative_unit_2_cost,
        UnitType::OperativeUnit3 => economic_config.operative_unit_3_cost,
    };

    // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
    let adjusted_unit_cost = apply_bp(base_unit_cost, economic_config.cost_multiplier as u64)
        .ok_or(GameError::MathOverflow)?;

    // Apply hero training cost reduction (reduces effective cost)
    // Formula: cost × (10000 - hero_training_cost_reduction_bps) / 10000
    // Higher reduction = lower cost (e.g., 2000 bps = 20% discount)
    let power_cost = if player_data.hero_training_cost_reduction_bps > 0 {
        let discount = player_data.hero_training_cost_reduction_bps.min(9000) as u64; // Cap at 90% reduction
        let cost_ratio = 10000u64.saturating_sub(discount);
        adjusted_unit_cost.saturating_mul(cost_ratio) / 10000
    } else {
        adjusted_unit_cost
    }.max(1); // Minimum cost of 1 to prevent division by zero

    // Calculate base units (integer division)
    let base_units = power.checked_div(power_cost).ok_or(GameError::MathOverflow)?;
    let remainder = power % power_cost;

    // Deterministic rounding: award bonus unit if remainder >= 50% of cost
    // Example: 150 remainder / 200 cost = 75% -> award bonus unit (no u128!)
    let units_to_hire = if remainder > 0 {
        // Calculate remainder ratio in basis points
        let remainder_ratio_bp = mul_div(remainder, 10000, power_cost)
            .ok_or(GameError::MathOverflow)?;

        // Deterministic: Award bonus unit if ratio >= 50% (5000 bp)
        if remainder_ratio_bp >= 5000 {
            base_units.checked_add(1).ok_or(GameError::MathOverflow)?
        } else {
            base_units
        }
    } else {
        base_units
    };

    // Ensure we can hire at least 1 unit
    if units_to_hire == 0 {
        return Err(GameError::InsufficientPower.into());
    }

    // 7a. Apply Time-of-Day Hiring Bonus (DETERMINISTIC)
    // Hiring is best during the day (workers available, peak productivity)
    // Midday gives φ (1.618x), DeepNight gives 1/φ (0.618x)
    // Note: time_of_day already calculated above for Consuming bonus
    let units_with_time_bonus = apply_time_multiplier(units_to_hire, time_of_day, ActivityType::Hiring);

    // 8. Update Player State

    // Deduct locked NOVI from state
    player_data.locked_novi = player_data.locked_novi
        .checked_sub(novi_amount)
        .ok_or(GameError::MathOverflow)?;

    // 8a. Actually BURN the NOVI tokens (SPL Token CPI)

    // Load GameEngine to get mint authority bump
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};

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

    // Add units based on type (with time-of-day bonus applied)
    match unit_type {
        UnitType::DefensiveUnit1 => {
            player_data.defensive_unit_1 = player_data.defensive_unit_1
                .checked_add(units_with_time_bonus)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::DefensiveUnit2 => {
            player_data.defensive_unit_2 = player_data.defensive_unit_2
                .checked_add(units_with_time_bonus)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::DefensiveUnit3 => {
            player_data.defensive_unit_3 = player_data.defensive_unit_3
                .checked_add(units_with_time_bonus)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::OperativeUnit1 => {
            player_data.operative_unit_1 = player_data.operative_unit_1
                .checked_add(units_with_time_bonus)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::OperativeUnit2 => {
            player_data.operative_unit_2 = player_data.operative_unit_2
                .checked_add(units_with_time_bonus)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::OperativeUnit3 => {
            player_data.operative_unit_3 = player_data.operative_unit_3
                .checked_add(units_with_time_bonus)
                .ok_or(GameError::MathOverflow)?;
        }
    }

    // 9. Update Happiness and Networth (PURE LOGIC)

    // Update happiness for defensive units (operative happiness calculated separately)
    if matches!(unit_type, UnitType::DefensiveUnit1 | UnitType::DefensiveUnit2 | UnitType::DefensiveUnit3) {
        let total_defensive = player_data.total_defensive_units();
        player_data.happiness_defensive = update_happiness_defensive(
            total_defensive,
            player_data.total_weapons(),
            player_data.produce,
            player_data.armor_pieces,
        );
    }

    // Recalculate networth
    player_data.networth = calculate_networth(player_data, economic_config)?;

    // 10. Update Event Scores (if participating)

    if let (Some(event_participation), Some(event)) = (event_participation, event) {
        // Load event participation with ownership validation (kingdom-scoped)
        let mut participation = crate::state::EventParticipation::load_checked_mut(
            event_participation,
            game_engine.key(),
            player_data.current_event,
            owner.key(),
            program_id,
        )?;

        // Load event with ownership validation (kingdom-scoped)
        let mut event_data = crate::state::EventAccount::load_checked_mut(
            event,
            game_engine.key(),
            player_data.current_event,
            program_id,
        )?;

        let player_key = player.key();
        let event_key = event.key();

        // DETERMINISTIC: Use exact novi amount (no randomness)
        // MostNoviConsumed: Add novi_amount burned (deterministic)
        let _ = update_event_score(
            &mut *participation,
            &mut *event_data,
            event_key,
            player_key,
            player_data.name,
            EventType::MostNoviConsumed,
            novi_amount,
            now,
        );
    }

    // Calculate time bonus in basis points for event
    let _base_bp = 10000u64;
    let time_bonus_bps = if units_with_time_bonus > units_to_hire {
        let bonus_ratio = (units_with_time_bonus - units_to_hire) * 10000 / units_to_hire.max(1);
        bonus_ratio as u16
    } else {
        0
    };

    // Emit UnitsHired event
    emit!(UnitsHired {
        player: *player.key(),
        player_name: player_data.name,
        unit_type: unit_type as u8,
        base_quantity: units_to_hire,
        final_quantity: units_with_time_bonus,
        novi_burned: novi_amount,
        time_bonus_bps,
        timestamp: now,
    });

    Ok(())
}

// Removed get_unit_power_cost() - now using GameEngine.economic_config.*_unit_cost with DAO multiplier
