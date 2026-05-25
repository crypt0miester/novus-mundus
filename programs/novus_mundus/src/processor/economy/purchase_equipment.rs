use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};

use crate::{
    emit,
    error::GameError,
    events::EquipmentPurchased,
    helpers::{
        estate::{load_estate_for_player, market_discount_bps, require_market},
        event_scoring::update_event_score,
    },
    logic::{
        calculate_networth, get_time_multiplier, get_time_of_day, safe_math::apply_bp,
        update_happiness_defensive, ActivityType,
    },
    state::{GameEngine, PlayerAccount},
    types::EventType,
    utils::{read_u64, read_u8},
    validation::require_signer,
};

/// Equipment type for purchases
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EquipmentType {
    MeleeWeapons = 0,
    RangedWeapons = 1,
    SiegeWeapons = 2,
    Produce = 3,
    Vehicles = 4,
    Armor = 5,
}

impl TryFrom<u8> for EquipmentType {
    type Error = ProgramError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(EquipmentType::MeleeWeapons),
            1 => Ok(EquipmentType::RangedWeapons),
            2 => Ok(EquipmentType::SiegeWeapons),
            3 => Ok(EquipmentType::Produce),
            4 => Ok(EquipmentType::Vehicles),
            5 => Ok(EquipmentType::Armor),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

/// Purchase equipment using locked Novi or cash
///
/// # Flow
/// 1. Parse equipment type and quantity
/// 2. Calculate total cost
/// 3. Deduct from locked Novi or cash on hand
/// 4. Add equipment to inventory
/// 5. Update happiness and networth
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [signer] owner: Wallet that owns the account
/// - [] game_engine: GameEngine PDA (for cost config)
/// - [] estate_account: EstateAccount PDA (for Market discount)
/// - [writable] event_participation: (Optional) EventParticipation PDA for event scoring
/// - [writable] event: (Optional) EventAccount PDA for event scoring
///
/// # Building Bonuses
/// Market building provides discounts on equipment purchases:
/// - 1% discount per Market level (max 20% at level 20)
///
/// # Instruction Data
/// - equipment_type: u8 (1 byte) - 0=Weapons, 1=Produce, 2=Vehicles
/// - quantity: u64 (8 bytes) - Amount to purchase
/// - pay_with_cash: bool (1 byte) - True=use cash_on_hand, False=use locked_novi
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    // estate_account is required, event accounts are optional
    crate::extract_accounts!(accounts, [player, owner, game_engine, estate_account,]);
    let (event_participation, event) = if accounts.len() >= 6 {
        (Some(&accounts[4]), Some(&accounts[5]))
    } else {
        (None, None)
    };

    // 2. Validate signer
    require_signer(owner)?;

    // 3. Parse instruction data
    if data.len() != 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let equipment_type = EquipmentType::try_from(read_u8(data, 0, "equipment_type")?)?;
    let quantity = read_u64(data, 1, "quantity")?;
    let pay_with_cash = read_u8(data, 9, "pay_with_cash")? != 0;

    // Validate quantity
    if quantity == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load and verify accounts (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;
    let player_data = PlayerAccount::load_checked_mut(
        player,
        game_engine.address(),
        owner.address(),
        program_id,
    )?;
    let economic_config = &game_engine_data.economic_config;

    // 5. Calculate total cost with DAO multiplier
    // Get base cost from GameEngine config (differentiated by type using φ ratios)
    let base_unit_cost = match equipment_type {
        EquipmentType::MeleeWeapons => economic_config.melee_weapon_cost,
        EquipmentType::RangedWeapons => economic_config.ranged_weapon_cost,
        EquipmentType::SiegeWeapons => economic_config.siege_weapon_cost,
        EquipmentType::Armor => economic_config.armor_cost,
        EquipmentType::Produce => economic_config.produce_cost,
        EquipmentType::Vehicles => economic_config.vehicle_cost,
    };

    // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
    let adjusted_unit_cost = apply_bp(base_unit_cost, economic_config.cost_multiplier as u64)
        .ok_or(GameError::MathOverflow)?;

    let base_total_cost = (quantity as u64)
        .checked_mul(adjusted_unit_cost)
        .ok_or(GameError::MathOverflow)?;

    // 5a. Apply Time-of-Day Cost Multiplier (DETERMINISTIC)
    // "Early bird gets the worm" - buying is CHEAPEST in the morning (0.618x)!
    // Expensive at Midday (1.618x) due to peak demand
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let time_of_day = get_time_of_day(now, player_data.current_long);
    let cost_multiplier = get_time_multiplier(time_of_day, ActivityType::Purchasing);

    // Apply cost multiplier (lower multiplier = cheaper purchase)
    let time_adjusted_cost = ((base_total_cost as f64) * cost_multiplier) as u64;

    // 5b. HARD GATE: Require Market building for equipment purchases
    let estate = load_estate_for_player(estate_account, &*player_data, program_id)?;
    require_market(estate, 1)?;

    // Apply Market building discount (BUILDING BONUS)
    // Market level provides 1% discount per level, max 20%
    let discount_bps = market_discount_bps(estate);

    // Apply discount: cost × (10000 - discount_bps) / 10000
    let total_cost = if discount_bps > 0 {
        let cost_ratio = 10000u64.saturating_sub(discount_bps as u64);
        time_adjusted_cost.saturating_mul(cost_ratio) / 10000
    } else {
        time_adjusted_cost
    };

    // 6. Deduct cost from appropriate balance
    if pay_with_cash {
        if player_data.cash_on_hand < total_cost {
            return Err(GameError::InsufficientCash.into());
        }
        player_data.cash_on_hand = player_data
            .cash_on_hand
            .checked_sub(total_cost)
            .ok_or(GameError::MathOverflow)?;
    } else {
        if player_data.locked_novi < total_cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }
        player_data.locked_novi = player_data
            .locked_novi
            .checked_sub(total_cost)
            .ok_or(GameError::MathOverflow)?;
    }

    // 7. Add equipment to inventory
    match equipment_type {
        EquipmentType::MeleeWeapons => {
            player_data.melee_weapons = player_data
                .melee_weapons
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::RangedWeapons => {
            player_data.ranged_weapons = player_data
                .ranged_weapons
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::SiegeWeapons => {
            player_data.siege_weapons = player_data
                .siege_weapons
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::Armor => {
            player_data.armor_pieces = player_data
                .armor_pieces
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::Produce => {
            player_data.produce = player_data
                .produce
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::Vehicles => {
            player_data.vehicles = player_data
                .vehicles
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
    }

    // 8. Update happiness (weapons, produce, and armor affect defensive happiness)
    if matches!(
        equipment_type,
        EquipmentType::MeleeWeapons
            | EquipmentType::RangedWeapons
            | EquipmentType::SiegeWeapons
            | EquipmentType::Armor
            | EquipmentType::Produce
    ) {
        let total_defensive = player_data.total_defensive_units();
        player_data.happiness_defensive = update_happiness_defensive(
            total_defensive,
            player_data.total_weapons(),
            player_data.produce,
            player_data.armor_pieces,
        );
    }

    // 9. Update networth (PURE LOGIC)
    player_data.networth = calculate_networth(&*player_data, economic_config)?;

    // 10. Update event scores if player is participating (only if locked Novi used)
    if !pay_with_cash {
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

            // DETERMINISTIC: Use exact cost value (no randomness)
            // MostNoviConsumed: Add locked_novi spent (deterministic)
            let _ = update_event_score(
                &mut *participation,
                &mut *event_data,
                event_key,
                player_key,
                player_data.name,
                EventType::MostNoviConsumed,
                total_cost,
                now,
            );
        }
    }

    // Emit EquipmentPurchased event (only for non-cash purchases since that burns NOVI)
    if !pay_with_cash {
        emit!(EquipmentPurchased {
            player: *player.address(),
            player_name: player_data.name,
            slot: equipment_type as u8,
            tier: 1, // Base tier (no upgrade tiers in current implementation)
            novi_burned: total_cost,
            timestamp: now,
        });
    }

    Ok(())
}
