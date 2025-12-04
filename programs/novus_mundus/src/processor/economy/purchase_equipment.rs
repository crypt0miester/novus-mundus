use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::PlayerAccount,
    constants::PLAYER_SEED,
    types::EventType,
    logic::{
        update_happiness_defensive,
        calculate_networth,
        get_time_of_day,
        get_time_multiplier,
        ActivityType,
        safe_math::apply_bp,
    },
    helpers::event_scoring::update_event_score,
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
    },
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

// Removed get_equipment_cost() - now using GameEngine.economic_config.{weapon_cost,produce_cost,vehicle_cost} with DAO multiplier

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
/// - [writable] event_participation: (Optional) EventParticipation PDA for event scoring
/// - [writable] event: (Optional) EventAccount PDA for event scoring
///
/// # Instruction Data
/// - equipment_type: u8 (1 byte) - 0=Weapons, 1=Produce, 2=Vehicles
/// - quantity: u64 (8 bytes) - Amount to purchase
/// - pay_with_cash: bool (1 byte) - True=use cash_on_hand, False=use locked_novi
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    let (player, owner, game_engine, event_participation, event) = if accounts.len() >= 5 {
        (&accounts[0], &accounts[1], &accounts[2], Some(&accounts[3]), Some(&accounts[4]))
    } else if accounts.len() >= 3 {
        (&accounts[0], &accounts[1], &accounts[2], None, None)
    } else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player)?;
    require_owner(player, program_id)?;

    let bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;

    // 3. Parse instruction data
    if data.len() != 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let equipment_type = EquipmentType::try_from(data[0])?;
    let quantity = u64::from_le_bytes([
        data[1], data[2], data[3], data[4],
        data[5], data[6], data[7], data[8],
    ]);
    let pay_with_cash = data[9] != 0;

    // Validate quantity
    if quantity == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load player and game engine data
    let mut player_data_ref = player.try_borrow_mut_data()?;
    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data_ref)
    };
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { crate::state::GameEngine::load(&game_engine_data_ref)};
    let economic_config = &game_engine_data.economic_config;

    // Verify ownership and bump
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if player_data.bump != bump {
        return Err(ProgramError::InvalidSeeds);
    }

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
    let total_cost = ((base_total_cost as f64) * cost_multiplier) as u64;

    // 6. Deduct cost from appropriate balance
    if pay_with_cash {
        if player_data.cash_on_hand < total_cost {
            return Err(GameError::InsufficientCash.into());
        }
        player_data.cash_on_hand = player_data.cash_on_hand
            .checked_sub(total_cost)
            .ok_or(GameError::MathOverflow)?;
    } else {
        if player_data.locked_novi < total_cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }
        player_data.locked_novi = player_data.locked_novi
            .checked_sub(total_cost)
            .ok_or(GameError::MathOverflow)?;
    }

    // 7. Add equipment to inventory
    match equipment_type {
        EquipmentType::MeleeWeapons => {
            player_data.melee_weapons = player_data.melee_weapons
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::RangedWeapons => {
            player_data.ranged_weapons = player_data.ranged_weapons
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::SiegeWeapons => {
            player_data.siege_weapons = player_data.siege_weapons
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::Armor => {
            player_data.armor_pieces = player_data.armor_pieces
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::Produce => {
            player_data.produce = player_data.produce
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
        EquipmentType::Vehicles => {
            player_data.vehicles = player_data.vehicles
                .checked_add(quantity)
                .ok_or(GameError::MathOverflow)?;
        }
    }

    // 8. Update happiness (weapons, produce, and armor affect defensive happiness)
    if matches!(equipment_type, EquipmentType::MeleeWeapons | EquipmentType::RangedWeapons | EquipmentType::SiegeWeapons | EquipmentType::Armor | EquipmentType::Produce) {
        let total_defensive = player_data.total_defensive_units();
        player_data.happiness_defensive = update_happiness_defensive(
            total_defensive,
            player_data.total_weapons(),
            player_data.produce,
            player_data.armor_pieces,
        );
    }

    // 9. Update networth (PURE LOGIC)
    player_data.networth = calculate_networth(player_data, economic_config)?;

    // 10. Update event scores if player is participating (only if locked Novi used)
    if !pay_with_cash {
        if let (Some(event_participation), Some(event)) = (event_participation, event) {
            // Validate player is actually in this event
            let event_data_ref = event.try_borrow_data()?;
            let event_data = unsafe { crate::state::EventAccount::load(&event_data_ref) };
            if player_data.current_event != event_data.id {
                return Err(GameError::NotInEvent.into());
            }

            let player_key = player.key();

            // DETERMINISTIC: Use exact cost value (no randomness)
            // MostNoviConsumed: Add locked_novi spent (deterministic)
            let _ = update_event_score(
                event_participation,
                event,
                player_key,
                EventType::MostNoviConsumed,
                total_cost,
                now,
            );
        }
    }

    Ok(())
}
