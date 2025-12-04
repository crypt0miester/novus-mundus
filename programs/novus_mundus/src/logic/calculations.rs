use crate::state::{PlayerAccount, EconomicConfig};
use crate::error::GameError;
use crate::logic::safe_math::{safe_mul, safe_add};

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
pub fn calculate_networth(player: &PlayerAccount, economic_config: &EconomicConfig) -> Result<u64, GameError> {
    // Calculate unit values with checked u64 arithmetic (no u128!)
    let defensive_1_value = safe_mul(player.defensive_unit_1, economic_config.defensive_unit_1_value)
        .ok_or(GameError::MathOverflow)?;
    let defensive_2_value = safe_mul(player.defensive_unit_2, economic_config.defensive_unit_2_value)
        .ok_or(GameError::MathOverflow)?;
    let defensive_3_value = safe_mul(player.defensive_unit_3, economic_config.defensive_unit_3_value)
        .ok_or(GameError::MathOverflow)?;

    let operative_1_value = safe_mul(player.operative_unit_1, economic_config.operative_unit_1_value)
        .ok_or(GameError::MathOverflow)?;
    let operative_2_value = safe_mul(player.operative_unit_2, economic_config.operative_unit_2_value)
        .ok_or(GameError::MathOverflow)?;
    let operative_3_value = safe_mul(player.operative_unit_3, economic_config.operative_unit_3_value)
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
    let produce_value = safe_mul(player.produce, economic_config.produce_value)
        .ok_or(GameError::MathOverflow)?;
    let vehicles_value = safe_mul(player.vehicles, economic_config.vehicle_value)
        .ok_or(GameError::MathOverflow)?;

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

/// Apply percentage modifier to a value
///
/// # Arguments
/// * `value` - Base value to modify
/// * `modifier` - Percentage modifier (can be positive or negative)
///   - Positive: bonus (e.g., 10 = +10%)
///   - Negative: penalty (e.g., -5 = -5%)
///   - Zero: no change
///
/// # Returns
/// Modified value
///
/// # Examples
/// ```ignore
/// apply_percentage_modifier(1000, 10)  // Returns 1100 (+10%)
/// apply_percentage_modifier(1000, -10) // Returns 900 (-10%)
/// apply_percentage_modifier(1000, 0)   // Returns 1000 (no change)
/// ```
pub fn apply_percentage_modifier(value: u64, modifier: i16) -> Result<u64, GameError> {
    if modifier == 0 {
        return Ok(value);
    }

    let modifier_abs = modifier.abs() as u64;
    let change = value
        .checked_mul(modifier_abs)
        .ok_or(GameError::MathOverflow)?
        .checked_div(100)
        .ok_or(GameError::MathOverflow)?;

    if modifier > 0 {
        // Bonus
        value.checked_add(change).ok_or(GameError::MathOverflow)
    } else {
        // Penalty (use saturating_sub to avoid underflow)
        Ok(value.saturating_sub(change))
    }
}

/// Calculate XP required for a given level
///
/// # Formula
/// ```text
/// xp_required = BASE_XP_PER_LEVEL * level^XP_EXPONENT
/// ```
///
/// # Constants
/// - BASE_XP_PER_LEVEL: 1000
/// - XP_EXPONENT: 2 (quadratic growth)
///
/// # Returns
/// XP required to reach the specified level
///
/// # Examples
/// ```ignore
/// calculate_xp_for_level(1)  // 1000  (1000 * 1^2)
/// calculate_xp_for_level(2)  // 4000  (1000 * 2^2)
/// calculate_xp_for_level(10) // 100000 (1000 * 10^2)
/// ```
pub fn calculate_xp_for_level(level: u8) -> u64 {
    const BASE_XP_PER_LEVEL: u64 = 1000;
    const XP_EXPONENT: u32 = 2;

    BASE_XP_PER_LEVEL * (level as u64).pow(XP_EXPONENT)
}

/// Calculate level from total XP
///
/// Iterates through levels to find the highest level
/// the player can achieve with their total XP.
///
/// # Arguments
/// * `total_xp` - Player's accumulated XP
///
/// # Returns
/// Current level (0-100)
pub fn calculate_level_from_xp(total_xp: u64) -> u8 {
    const MAX_LEVEL: u8 = 100;

    let mut level = 0u8;
    let mut xp_needed = 0u64;

    while level < MAX_LEVEL {
        let next_level_xp = calculate_xp_for_level(level + 1);
        xp_needed = xp_needed.saturating_add(next_level_xp);

        if total_xp < xp_needed {
            break;
        }

        level += 1;
    }

    level
}

/// Calculate collection amount based on happiness and location bonus
///
/// # Arguments
/// * `base_amount` - Base collection amount
/// * `happiness` - Happiness level (-100 to 100)
/// * `location_bonus` - Location-specific bonus percentage
///
/// # Returns
/// Final collection amount after modifiers
pub fn calculate_collection_amount(
    base_amount: u64,
    happiness: i16,
    location_bonus: i16,
) -> Result<u64, GameError> {
    let mut amount = base_amount;

    // Apply happiness modifier
    amount = apply_percentage_modifier(amount, happiness)?;

    // Apply location bonus
    amount = apply_percentage_modifier(amount, location_bonus)?;

    Ok(amount)
}

/// Check if player meets networth requirements
///
/// Used for:
/// - Location access restrictions
/// - Event eligibility
/// - Matchmaking
///
/// # Arguments
/// * `player_networth` - Player's current networth
/// * `min_networth` - Minimum required (None = no minimum)
/// * `max_networth` - Maximum allowed (None = no maximum)
///
/// # Returns
/// `true` if player meets requirements, `false` otherwise
pub fn check_networth_requirement(
    player_networth: u64,
    min_networth: Option<u64>,
    max_networth: Option<u64>,
) -> bool {
    if let Some(min) = min_networth {
        if player_networth < min {
            return false;
        }
    }

    if let Some(max) = max_networth {
        if player_networth > max {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_percentage_modifier() {
        assert_eq!(apply_percentage_modifier(1000, 10).unwrap(), 1100); // +10%
        assert_eq!(apply_percentage_modifier(1000, -10).unwrap(), 900); // -10%
        assert_eq!(apply_percentage_modifier(1000, 0).unwrap(), 1000);  // No change
        assert_eq!(apply_percentage_modifier(1000, 50).unwrap(), 1500); // +50%
    }

    #[test]
    fn test_calculate_xp_for_level() {
        assert_eq!(calculate_xp_for_level(1), 1000);    // 1000 * 1^2
        assert_eq!(calculate_xp_for_level(2), 4000);    // 1000 * 2^2
        assert_eq!(calculate_xp_for_level(3), 9000);    // 1000 * 3^2
        assert_eq!(calculate_xp_for_level(10), 100_000); // 1000 * 10^2
    }

    #[test]
    fn test_calculate_level_from_xp() {
        assert_eq!(calculate_level_from_xp(0), 0);
        assert_eq!(calculate_level_from_xp(1000), 1);
        assert_eq!(calculate_level_from_xp(5000), 2);   // 1000 + 4000
        assert_eq!(calculate_level_from_xp(14000), 3);  // 1000 + 4000 + 9000
    }

    #[test]
    fn test_check_networth_requirement() {
        assert!(check_networth_requirement(1000, None, None));
        assert!(check_networth_requirement(1000, Some(500), None));
        assert!(!check_networth_requirement(1000, Some(1500), None));
        assert!(check_networth_requirement(1000, None, Some(1500)));
        assert!(!check_networth_requirement(1000, None, Some(500)));
        assert!(check_networth_requirement(1000, Some(500), Some(1500)));
    }
}
