use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};

use crate::{
    constants::PLAYER_SEED,
    emit,
    error::GameError,
    events::UnitsHired,
    helpers::{
        estate::{
            load_estate_for_player, require_building, required_building_for_unit,
            required_level_for_unit,
        },
        event_scoring::update_event_score,
    },
    logic::{
        apply_time_multiplier, calculate_networth, calculate_synchrony, consume_novi_logic,
        get_time_of_day,
        safe_math::{apply_bp, mul_div},
        update_happiness_defensive, ActivityType,
    },
    state::PlayerAccount,
    types::{EventType, UnitType},
    utils::{read_u64, read_u8},
    validation::{require_owner, require_pda, require_signer, require_writable},
};

/// Hire units by consuming locked NOVI
///
/// # Accounts Expected
/// 1. `[writable]` player - Player account PDA ([b"player", game_engine, owner.address()])
/// 2. `[signer]` owner - Player's wallet (authority)
/// 3. `[writable]` player_token_account - Player's NOVI token account (ATA)
/// 4. `[writable]` novi_mint - NOVI token mint
/// 5. `[]` game_engine - GameEngine PDA (for config)
/// 6. `[]` token_program - SPL Token program
/// 7. `[]` estate_account - EstateAccount PDA (for Barracks requirement)
/// 8. `[writable]` event_participation - (Optional) EventParticipation PDA for event scoring
/// 9. `[writable]` event - (Optional) EventAccount PDA for event scoring
///
/// # Instruction Data
/// ```text
/// [0]      unit_type: u8     - Which unit to hire (0-5, see UnitType enum)
/// [1..9]   novi_amount: u64  - Amount of locked NOVI to consume (little-endian)
/// ```
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts
    crate::extract_accounts!(
        accounts,
        [
            player,
            owner,
            player_token_account,
            novi_mint,
            game_engine,
            _token_program,
            estate_account,
        ]
    );
    let (event_participation, event) = if accounts.len() >= 9 {
        (Some(&accounts[7]), Some(&accounts[8]))
    } else {
        (None, None)
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player)?;
    require_owner(player, program_id)?;

    // Verify player PDA matches expected derivation
    let bump = require_pda(
        player,
        &[
            PLAYER_SEED,
            game_engine.address().as_ref(),
            owner.address().as_ref(),
        ],
        program_id,
    )?;

    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "hire_units.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Parse Instruction Data
    if data.len() != 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let unit_type = UnitType::try_from(read_u8(data, 0, "unit_type")?)?;
    let novi_amount = read_u64(data, 1, "novi_amount")?;

    // 4. PHASE 1: Validate and calculate (scoped player borrow - dropped before CPI)
    let (units_with_time_bonus, units_to_hire, time_bonus_bps, player_name, current_event, now) = {
        let mut player_data_ref = player.try_borrow_mut()?;
        let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

        // Verify owner matches
        if &player_data.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }

        // HARD GATE: Check building requirement (Barracks for defensive, Camp for operative)
        let estate = load_estate_for_player(estate_account, player_data, program_id)?;
        let building = required_building_for_unit(unit_type);
        let required_level = required_level_for_unit(unit_type);
        require_building(estate, building, required_level)?;

        // Validate game_engine account (ownership + PDA + discriminator + bump)
        let game_engine_data =
            crate::state::GameEngine::load_checked_by_key(game_engine, program_id)?;
        let economic_config = &game_engine_data.economic_config;

        // Verify bump matches
        if player_data.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        // Validate player not traveling
        if player_data.is_traveling_any() {
            return Err(GameError::PlayerTraveling.into());
        }

        // Validate Sufficient Locked NOVI
        if player_data.locked_novi < novi_amount {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        // Get current timestamp
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // Calculate Power from NOVI Consumption
        let synchrony = calculate_synchrony(
            player_data,
            &game_engine_data.gameplay_config,
            &game_engine_data.subscription_tiers,
            now,
        );
        let base_power = consume_novi_logic(novi_amount, synchrony, economic_config);
        let time_of_day = get_time_of_day(now, player_data.current_long);
        let power = apply_time_multiplier(base_power, time_of_day, ActivityType::Consuming);

        // Calculate Units from Power
        let base_unit_cost = match unit_type {
            UnitType::DefensiveUnit1 => economic_config.defensive_unit_1_cost,
            UnitType::DefensiveUnit2 => economic_config.defensive_unit_2_cost,
            UnitType::DefensiveUnit3 => economic_config.defensive_unit_3_cost,
            UnitType::OperativeUnit1 => economic_config.operative_unit_1_cost,
            UnitType::OperativeUnit2 => economic_config.operative_unit_2_cost,
            UnitType::OperativeUnit3 => economic_config.operative_unit_3_cost,
        };

        let adjusted_unit_cost = apply_bp(base_unit_cost, economic_config.cost_multiplier as u64)
            .ok_or(GameError::MathOverflow)?;

        let power_cost = if player_data.hero_training_cost_reduction_bps() > 0 {
            let discount = player_data.hero_training_cost_reduction_bps().min(9000) as u64;
            let cost_ratio = 10000u64.saturating_sub(discount);
            adjusted_unit_cost.saturating_mul(cost_ratio) / 10000
        } else {
            adjusted_unit_cost
        }
        .max(1);

        let base_units = power
            .checked_div(power_cost)
            .ok_or(GameError::MathOverflow)?;
        let remainder = power % power_cost;

        let units_to_hire = if remainder > 0 {
            let remainder_ratio_bp =
                mul_div(remainder, 10000, power_cost).ok_or(GameError::MathOverflow)?;
            if remainder_ratio_bp >= 5000 {
                base_units.checked_add(1).ok_or(GameError::MathOverflow)?
            } else {
                base_units
            }
        } else {
            base_units
        };

        if units_to_hire == 0 {
            return Err(GameError::InsufficientPower.into());
        }

        let units_with_time_bonus =
            apply_time_multiplier(units_to_hire, time_of_day, ActivityType::Hiring);

        // Ensure final unit count is at least 1 (time penalty can zero out small hires)
        if units_with_time_bonus == 0 {
            return Err(GameError::InsufficientPower.into());
        }

        // Deduct locked NOVI from state
        player_data.locked_novi = player_data
            .locked_novi
            .checked_sub(novi_amount)
            .ok_or(GameError::MathOverflow)?;

        // Calculate time bonus bps
        let time_bonus_bps = if units_with_time_bonus > units_to_hire {
            let diff = units_with_time_bonus
                .checked_sub(units_to_hire)
                .ok_or(GameError::MathOverflow)?;
            let bonus_ratio =
                mul_div(diff, 10000, units_to_hire.max(1)).ok_or(GameError::MathOverflow)?;
            u16::try_from(bonus_ratio.min(u16::MAX as u64)).unwrap_or(u16::MAX)
        } else {
            0
        };

        // Capture values needed after CPI
        let player_name = player_data.name;
        let current_event = player_data.current_event;

        (
            units_with_time_bonus,
            units_to_hire,
            time_bonus_bps,
            player_name,
            current_event,
            now,
        )
    }; // player_data_ref dropped here — required before CPI that touches player account

    // 5. PHASE 2: Burn NOVI tokens (CPI - requires no active borrows on player)
    // Player PDA owns the token account, so player is the burn authority
    let bump_seed = [bump];
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

    // 6. PHASE 3: Re-borrow and update state (after CPI)
    {
        let mut player_data_ref = player.try_borrow_mut()?;
        let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

        // Add units based on type (with time-of-day bonus applied)
        match unit_type {
            UnitType::DefensiveUnit1 => {
                player_data.defensive_unit_1 = player_data
                    .defensive_unit_1
                    .checked_add(units_with_time_bonus)
                    .ok_or(GameError::MathOverflow)?;
            }
            UnitType::DefensiveUnit2 => {
                player_data.defensive_unit_2 = player_data
                    .defensive_unit_2
                    .checked_add(units_with_time_bonus)
                    .ok_or(GameError::MathOverflow)?;
            }
            UnitType::DefensiveUnit3 => {
                player_data.defensive_unit_3 = player_data
                    .defensive_unit_3
                    .checked_add(units_with_time_bonus)
                    .ok_or(GameError::MathOverflow)?;
            }
            UnitType::OperativeUnit1 => {
                player_data.operative_unit_1 = player_data
                    .operative_unit_1
                    .checked_add(units_with_time_bonus)
                    .ok_or(GameError::MathOverflow)?;
            }
            UnitType::OperativeUnit2 => {
                player_data.operative_unit_2 = player_data
                    .operative_unit_2
                    .checked_add(units_with_time_bonus)
                    .ok_or(GameError::MathOverflow)?;
            }
            UnitType::OperativeUnit3 => {
                player_data.operative_unit_3 = player_data
                    .operative_unit_3
                    .checked_add(units_with_time_bonus)
                    .ok_or(GameError::MathOverflow)?;
            }
        }

        // Update happiness for defensive units
        if matches!(
            unit_type,
            UnitType::DefensiveUnit1 | UnitType::DefensiveUnit2 | UnitType::DefensiveUnit3
        ) {
            let total_defensive = player_data.total_defensive_units();
            player_data.happiness_defensive = update_happiness_defensive(
                total_defensive,
                player_data.total_weapons(),
                player_data.produce,
                player_data.armor_pieces,
            );
        }

        // Recalculate networth (re-borrow game_engine for economic_config)
        let game_engine_data =
            crate::state::GameEngine::load_checked_by_key(game_engine, program_id)?;
        let economic_config = &game_engine_data.economic_config;
        player_data.networth = calculate_networth(player_data, economic_config)?;

        // Update Event Scores (if participating)
        if let (Some(event_participation), Some(event)) = (event_participation, event) {
            let participation = crate::state::EventParticipation::load_checked_mut(
                event_participation,
                game_engine.address(),
                current_event,
                owner.address(),
                program_id,
            )?;

            let event_data = crate::state::EventAccount::load_checked_mut(
                event,
                game_engine.address(),
                current_event,
                program_id,
            )?;

            let player_key = owner.address();
            let event_key = event.address();

            let _ = update_event_score(
                &mut *participation,
                &mut *event_data,
                event_key,
                player_key,
                player_name,
                EventType::MostNoviConsumed,
                novi_amount,
                now,
            );
        }
    }

    // Emit UnitsHired event
    emit!(UnitsHired {
        player: *player.address(),
        player_name,
        unit_type: unit_type as u8,
        base_quantity: units_to_hire,
        final_quantity: units_with_time_bonus,
        novi_burned: novi_amount,
        time_bonus_bps,
        timestamp: now,
    });

    Ok(())
}
