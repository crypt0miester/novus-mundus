use crate::error::GameError;
use crate::logic::safe_math::{safe_add, safe_mul};
use crate::state::{EconomicConfig, PlayerAccount};

/// Calculate player's total networth (no u128!)
///
/// Networth includes all assets:
/// - Units (defensive + operative)
/// - Equipment (weapons by type, armor, produce, vehicles)
/// - Cash (on hand + in vault)
///
/// Values are taken from GameEngine's EconomicConfig.
/// All calculations use u64 with checked arithmetic.
///
/// Max networth analysis: ~10^13 (fits in u64 with 1M× headroom)
pub fn calculate_networth(
    player: &PlayerAccount,
    economic_config: &EconomicConfig,
) -> Result<u64, GameError> {
    // Calculate unit values with checked u64 arithmetic (no u128!)
    let defensive_1_value = safe_mul(
        player.defensive_unit_1,
        economic_config.defensive_unit_1_value,
    )
    .ok_or(GameError::MathOverflow)?;
    let defensive_2_value = safe_mul(
        player.defensive_unit_2,
        economic_config.defensive_unit_2_value,
    )
    .ok_or(GameError::MathOverflow)?;
    let defensive_3_value = safe_mul(
        player.defensive_unit_3,
        economic_config.defensive_unit_3_value,
    )
    .ok_or(GameError::MathOverflow)?;

    let operative_1_value = safe_mul(
        player.operative_unit_1,
        economic_config.operative_unit_1_value,
    )
    .ok_or(GameError::MathOverflow)?;
    let operative_2_value = safe_mul(
        player.operative_unit_2,
        economic_config.operative_unit_2_value,
    )
    .ok_or(GameError::MathOverflow)?;
    let operative_3_value = safe_mul(
        player.operative_unit_3,
        economic_config.operative_unit_3_value,
    )
    .ok_or(GameError::MathOverflow)?;

    // Weapon values
    let melee_weapons_value = safe_mul(player.melee_weapons, economic_config.melee_weapon_value)
        .ok_or(GameError::MathOverflow)?;
    let ranged_weapons_value = safe_mul(player.ranged_weapons, economic_config.ranged_weapon_value)
        .ok_or(GameError::MathOverflow)?;
    let siege_weapons_value = safe_mul(player.siege_weapons, economic_config.siege_weapon_value)
        .ok_or(GameError::MathOverflow)?;

    // Equipment values
    let armor_value = safe_mul(player.armor_pieces, economic_config.armor_value)
        .ok_or(GameError::MathOverflow)?;
    let produce_value =
        safe_mul(player.produce, economic_config.produce_value).ok_or(GameError::MathOverflow)?;
    let vehicles_value =
        safe_mul(player.vehicles, economic_config.vehicle_value).ok_or(GameError::MathOverflow)?;

    // Sum all values using checked arithmetic
    let mut total = 0u64;
    total = safe_add(total, defensive_1_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, defensive_2_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, defensive_3_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, operative_1_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, operative_2_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, operative_3_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, melee_weapons_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, ranged_weapons_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, siege_weapons_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, armor_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, produce_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, vehicles_value).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, player.cash_on_hand).ok_or(GameError::MathOverflow)?;
    total = safe_add(total, player.cash_in_vault).ok_or(GameError::MathOverflow)?;

    Ok(total)
}
