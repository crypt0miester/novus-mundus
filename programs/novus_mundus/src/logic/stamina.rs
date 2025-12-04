/// Stamina system for encounter attacks (pure logic)
///
/// This module provides stamina management functions:
/// - Time-based regeneration (with time-of-day bonus)
/// - Consumption for encounter attacks
/// - Adding stamina (from purchases/rewards)
///
/// All functions are pure - no AccountInfo dependencies

use crate::{
    state::PlayerAccount,
    constants::*,
    error::GameError,
    types::EncounterType,
    logic::{get_time_of_day, get_time_multiplier, ActivityType},
};

/// Regenerate player's stamina based on time elapsed with time-of-day bonus
///
/// Automatically called before stamina-consuming actions.
/// Regenerates 1 stamina per STAMINA_REGEN_INTERVAL (5 minutes).
/// Night time regenerates faster (rest/sleep), daytime slower (active time).
///
/// # Time Bonuses (DETERMINISTIC - Golden Ratio Based)
/// - DeepNight: φ (1.618x) - Deep sleep, fast recovery
/// - Midday: 1/φ (0.618x) - Active time, slow recovery
///
/// # Arguments
/// * `player` - Mutable reference to PlayerAccount
/// * `now` - Current unix timestamp
///
/// # Returns
/// Amount of stamina actually regenerated (capped by max)
///
/// # Example
/// ```ignore
/// let gained = regenerate_stamina(&mut player, Clock::get()?.unix_timestamp)?;
/// // If 15 minutes passed at DeepNight, gained = ~5 stamina (3 * 1.618)
/// ```
pub fn regenerate_stamina(
    player: &mut PlayerAccount,
    now: i64,
) -> Result<u64, GameError> {
    let elapsed = now.saturating_sub(player.last_stamina_update);

    // Not enough time passed
    if elapsed < STAMINA_REGEN_INTERVAL {
        return Ok(0);
    }

    // Calculate intervals passed
    let intervals = elapsed / STAMINA_REGEN_INTERVAL;
    let base_stamina_to_gain = intervals as u64;

    // Apply time-of-day bonus (DETERMINISTIC)
    // Night = rest = faster recovery, Day = active = slower recovery
    let time_of_day = get_time_of_day(now, player.current_long);
    let regen_multiplier = get_time_multiplier(time_of_day, ActivityType::StaminaRegen);
    let time_stamina = ((base_stamina_to_gain as f64) * regen_multiplier) as u64;

    // Apply hero stamina regen buff (multiplicative)
    // Formula: stamina × (10000 + hero_stamina_regen_bps) / 10000
    let stamina_to_gain = if player.hero_stamina_regen_bps > 0 {
        let hero_multiplier = 10000u64 + player.hero_stamina_regen_bps as u64;
        time_stamina.saturating_mul(hero_multiplier) / 10000
    } else {
        time_stamina
    };

    // Apply max cap
    let new_stamina = player.encounter_stamina
        .saturating_add(stamina_to_gain)
        .min(player.max_encounter_stamina);

    let actual_gained = new_stamina.saturating_sub(player.encounter_stamina);

    // Update player state
    player.encounter_stamina = new_stamina;
    player.last_stamina_update = now;

    Ok(actual_gained)
}

/// Check if player has enough stamina for encounter attack
///
/// # Arguments
/// * `player` - PlayerAccount to check
/// * `encounter_type` - Type of encounter being attacked
///
/// # Returns
/// true if player has sufficient stamina, false otherwise
#[inline]
pub fn has_stamina_for_encounter(
    player: &PlayerAccount,
    encounter_type: EncounterType,
) -> bool {
    let cost = ENCOUNTER_STAMINA_COSTS[encounter_type as usize];
    player.encounter_stamina >= cost
}

/// Consume stamina for encounter attack
///
/// Call this AFTER regenerate_stamina() to ensure up-to-date stamina.
///
/// # Arguments
/// * `player` - Mutable reference to PlayerAccount
/// * `encounter_type` - Type of encounter being attacked
///
/// # Returns
/// Ok(()) if successful, Err if insufficient stamina
///
/// # Errors
/// Returns `GameError::InsufficientStamina` if player doesn't have enough
pub fn consume_stamina(
    player: &mut PlayerAccount,
    encounter_type: EncounterType,
) -> Result<(), GameError> {
    let cost = ENCOUNTER_STAMINA_COSTS[encounter_type as usize];

    if player.encounter_stamina < cost {
        return Err(GameError::InsufficientStamina);
    }

    player.encounter_stamina = player.encounter_stamina.saturating_sub(cost);

    Ok(())
}

/// Add stamina to player (from purchases, rewards, achievements, etc.)
///
/// Respects max_encounter_stamina cap.
/// Used for:
/// - In-game purchases (buy stamina refills)
/// - Achievement rewards
/// - Event prizes
/// - Daily login bonuses
///
/// # Arguments
/// * `player` - Mutable reference to PlayerAccount
/// * `amount` - Stamina to add
///
/// # Returns
/// Amount of stamina actually added (capped by max)
///
/// # Example
/// ```ignore
/// let added = add_stamina(&mut player, 50);
/// // If player had 80/100 stamina, added = 20 (capped)
/// ```
pub fn add_stamina(
    player: &mut PlayerAccount,
    amount: u64,
) -> u64 {
    let new_stamina = player.encounter_stamina
        .saturating_add(amount)
        .min(player.max_encounter_stamina);

    let actual_added = new_stamina.saturating_sub(player.encounter_stamina);
    player.encounter_stamina = new_stamina;

    actual_added
}

/// Update max stamina based on subscription tier
///
/// Call this when player's subscription tier changes.
///
/// # Arguments
/// * `player` - Mutable reference to PlayerAccount
///
/// # Example
/// ```ignore
/// player.subscription_tier = 2; // Epic tier
/// update_max_stamina_for_tier(&mut player);
/// // max_encounter_stamina = 500
/// ```
pub fn update_max_stamina_for_tier(player: &mut PlayerAccount) {
    let tier_index = (player.subscription_tier as usize).min(MAX_STAMINA_BY_TIER.len() - 1);
    player.max_encounter_stamina = MAX_STAMINA_BY_TIER[tier_index];

    // If current stamina exceeds new max (tier downgrade), cap it
    player.encounter_stamina = player.encounter_stamina.min(player.max_encounter_stamina);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::player::NULL_PUBKEY;

    // Use 8 AM UTC (28800 seconds) which is Morning (1.0x StaminaRegen multiplier)
    const MORNING_BASE: i64 = 28800;

    #[test]
    fn test_stamina_regeneration() {
        let mut player = PlayerAccount::init(NULL_PUBKEY, 1000, 1);
        player.encounter_stamina = 50;
        player.max_encounter_stamina = 100;
        player.last_stamina_update = MORNING_BASE;
        player.current_long = 0.0; // UTC

        // 15 minutes later (3 intervals) during Morning (1.0x multiplier)
        let gained = regenerate_stamina(&mut player, MORNING_BASE + (15 * 60)).unwrap();

        assert_eq!(gained, 3);
        assert_eq!(player.encounter_stamina, 53);
    }

    #[test]
    fn test_stamina_capped_at_max() {
        let mut player = PlayerAccount::init(NULL_PUBKEY, 1000, 1);
        player.encounter_stamina = 95;
        player.max_encounter_stamina = 100;
        player.last_stamina_update = MORNING_BASE;
        player.current_long = 0.0; // UTC

        // 1 hour later (12 intervals) during Morning (1.0x multiplier)
        let gained = regenerate_stamina(&mut player, MORNING_BASE + 3600).unwrap();

        assert_eq!(gained, 5); // Only gained 5 to reach cap
        assert_eq!(player.encounter_stamina, 100);
    }

    #[test]
    fn test_consume_stamina_success() {
        let mut player = PlayerAccount::init(NULL_PUBKEY, 1000, 1);
        player.encounter_stamina = 100;

        let result = consume_stamina(&mut player, EncounterType::Common);

        assert!(result.is_ok());
        assert_eq!(player.encounter_stamina, 90); // Cost 10 for Common
    }

    #[test]
    fn test_consume_stamina_insufficient() {
        let mut player = PlayerAccount::init(NULL_PUBKEY, 1000, 1);
        player.encounter_stamina = 5;

        let result = consume_stamina(&mut player, EncounterType::Common);

        assert!(result.is_err());
    }

    #[test]
    fn test_add_stamina() {
        let mut player = PlayerAccount::init(NULL_PUBKEY, 1000, 1);
        player.encounter_stamina = 70;
        player.max_encounter_stamina = 100;

        let added = add_stamina(&mut player, 50);

        assert_eq!(added, 30); // Capped at 100
        assert_eq!(player.encounter_stamina, 100);
    }
}
