/// Event eligibility and anti-Sybil checks (pure logic)
///
/// All functions operate on primitives and can be tested independently.

use crate::error::GameError;

/// Check event eligibility based on transfer ratio
///
/// Prevents Sybil attacks where bots consolidate resources to main accounts.
///
/// # Arguments
/// * `total_received` - Total cash/resources received from transfers
/// * `total_sent` - Total cash/resources sent via transfers
/// * `max_ratio` - Maximum allowed ratio (received:sent)
///
/// # Returns
/// `Ok(())` if eligible, `Err(GameError)` if fails check
///
/// # Anti-Sybil Logic
/// Legitimate players have balanced sent/received ratios from team cooperation.
/// Bots consolidating from many accounts have high received/sent ratios.
///
/// # Examples
/// ```ignore
/// // Legitimate player (balanced transfers)
/// check_transfer_ratio(1_000_000, 800_000, 3.0)  // OK (ratio 1.25:1)
///
/// // Bot account (consolidation target)
/// check_transfer_ratio(10_000_000, 100_000, 3.0) // FAIL (ratio 100:1)
/// ```
pub fn check_transfer_ratio(
    total_received: u64,
    total_sent: u64,
    max_ratio: f64,
) -> Result<(), GameError> {
    // If no transfers received, always pass
    if total_received == 0 {
        return Ok(());
    }

    // Calculate ratio (received / sent)
    // Add 1 to sent to avoid division by zero
    let ratio = total_received as f64 / total_sent.max(1) as f64;

    if ratio > max_ratio {
        return Err(GameError::TransferRatioExceedsLimit);
    }

    Ok(())
}

/// Check account age requirement
///
/// # Arguments
/// * `created_at` - Account creation timestamp (unix seconds)
/// * `now` - Current timestamp (unix seconds)
/// * `min_age_seconds` - Minimum required age in seconds
///
/// # Returns
/// `Ok(())` if account is old enough, `Err(GameError)` otherwise
///
/// # Examples
/// ```ignore
/// // Account created 10 days ago, requires 7 days
/// check_account_age(now - (10 * 86400), now, 7 * 86400)  // OK
///
/// // Account created 5 days ago, requires 7 days
/// check_account_age(now - (5 * 86400), now, 7 * 86400)   // FAIL
/// ```
pub fn check_account_age(
    created_at: i64,
    now: i64,
    min_age_seconds: i64,
) -> Result<(), GameError> {
    let age = now - created_at;

    if age < min_age_seconds {
        return Err(GameError::AccountTooNew);
    }

    Ok(())
}

/// Check minimum activity requirement
///
/// # Arguments
/// * `total_attacks` - Number of attacks made by player
/// * `min_attacks` - Minimum required attacks
///
/// # Returns
/// `Ok(())` if player has sufficient activity, `Err(GameError)` otherwise
///
/// # Purpose
/// Ensures players have actually played the game, not just farmed passively.
///
/// # Examples
/// ```ignore
/// check_activity_requirement(25, 20)  // OK (25 >= 20)
/// check_activity_requirement(5, 20)   // FAIL (5 < 20)
/// ```
pub fn check_activity_requirement(
    total_attacks: u64,
    min_attacks: u64,
) -> Result<(), GameError> {
    if total_attacks < min_attacks {
        return Err(GameError::PlayerInactive);
    }

    Ok(())
}

/// Check networth range requirement
///
/// # Arguments
/// * `player_networth` - Player's current networth
/// * `min_networth` - Minimum required networth (None = no minimum)
/// * `max_networth` - Maximum allowed networth (None = no maximum)
///
/// # Returns
/// `Ok(())` if player is within range, `Err(GameError)` otherwise
///
/// # Purpose
/// - Prevents high-networth players from dominating low-tier events
/// - Prevents low-networth players from entering high-tier events unprepared
///
/// # Examples
/// ```ignore
/// // Player with 5M networth
/// check_networth_range(5_000_000, Some(1_000_000), Some(10_000_000))  // OK
/// check_networth_range(5_000_000, Some(10_000_000), None)             // FAIL (too low)
/// check_networth_range(5_000_000, None, Some(1_000_000))              // FAIL (too high)
/// ```
pub fn check_networth_range(
    player_networth: u64,
    min_networth: Option<u64>,
    max_networth: Option<u64>,
) -> Result<(), GameError> {
    if let Some(min) = min_networth {
        if player_networth < min {
            return Err(GameError::NetworthOutOfRange);
        }
    }

    if let Some(max) = max_networth {
        if player_networth > max {
            return Err(GameError::NetworthOutOfRange);
        }
    }

    Ok(())
}

/// Check subscription tier requirement
///
/// # Arguments
/// * `player_tier` - Player's current subscription tier (0=Rookie, 1=Expert, 2=Epic, 3=Legendary)
/// * `required_tier` - Minimum required tier
///
/// # Returns
/// `Ok(())` if player meets tier requirement, `Err(GameError)` otherwise
///
/// # Examples
/// ```ignore
/// check_subscription_tier(2, 1)  // OK (Epic >= Expert)
/// check_subscription_tier(0, 2)  // FAIL (Rookie < Epic)
/// ```
pub fn check_subscription_tier(
    player_tier: u8,
    required_tier: u8,
) -> Result<(), GameError> {
    if player_tier < required_tier {
        return Err(GameError::InsufficientSubscriptionTier);
    }

    Ok(())
}

/// Check level requirement
///
/// # Arguments
/// * `player_level` - Player's current level
/// * `required_level` - Minimum required level
///
/// # Returns
/// `Ok(())` if player meets level requirement, `Err(GameError)` otherwise
///
/// # Examples
/// ```ignore
/// check_level_requirement(10, 5)  // OK (10 >= 5)
/// check_level_requirement(3, 5)   // FAIL (3 < 5)
/// ```
pub fn check_level_requirement(
    player_level: u8,
    required_level: u8,
) -> Result<(), GameError> {
    if player_level < required_level {
        return Err(GameError::InsufficientLevel);
    }

    Ok(())
}

/// Calculate account age in days
///
/// # Arguments
/// * `created_at` - Account creation timestamp
/// * `now` - Current timestamp
///
/// # Returns
/// Account age in days (whole days, rounded down)
///
/// # Examples
/// ```ignore
/// let age_days = calculate_account_age_days(now - (10 * 86400), now);
/// assert_eq!(age_days, 10);
/// ```
pub fn calculate_account_age_days(created_at: i64, now: i64) -> u32 {
    let age_seconds = now - created_at;
    (age_seconds / 86400) as u32
}

/// Get eligibility tier based on Reserved Novi prize amount
///
/// Returns the transfer ratio requirement based on event value.
///
/// # Arguments
/// * `reserved_novi_prize` - Prize pool in Reserved Novi
///
/// # Returns
/// Maximum allowed transfer ratio (received:sent)
///
/// # Tiers
/// - <25K Novi: 10:1 ratio (low-value events, lenient)
/// - 25K-100K Novi: 3:1 ratio (medium-value events, moderate)
/// - 100K+ Novi: 2:1 ratio (high-value events, strict)
///
/// # Examples
/// ```ignore
/// get_transfer_ratio_for_prize(10_000)   // Returns 10.0 (low-value)
/// get_transfer_ratio_for_prize(50_000)   // Returns 3.0 (medium-value)
/// get_transfer_ratio_for_prize(200_000)  // Returns 2.0 (high-value)
/// ```
pub fn get_transfer_ratio_for_prize(reserved_novi_prize: u64) -> f64 {
    if reserved_novi_prize < 25_000 {
        10.0  // Low-value events: lenient (10:1 ratio)
    } else if reserved_novi_prize < 100_000 {
        3.0   // Medium-value events: moderate (3:1 ratio)
    } else {
        2.0   // High-value events: strict (2:1 ratio)
    }
}

/// Get minimum account age for event based on prize value
///
/// # Arguments
/// * `reserved_novi_prize` - Prize pool in Reserved Novi
///
/// # Returns
/// Minimum account age in seconds
///
/// # Examples
/// ```ignore
/// get_min_age_for_prize(10_000)   // Returns 604800 (7 days)
/// get_min_age_for_prize(50_000)   // Returns 2592000 (30 days)
/// get_min_age_for_prize(200_000)  // Returns 5184000 (60 days)
/// ```
pub fn get_min_age_for_prize(reserved_novi_prize: u64) -> i64 {
    if reserved_novi_prize < 25_000 {
        7 * 86400     // 7 days
    } else if reserved_novi_prize < 100_000 {
        30 * 86400    // 30 days
    } else {
        60 * 86400    // 60 days
    }
}

/// Get minimum attacks required for event based on prize value
///
/// # Arguments
/// * `reserved_novi_prize` - Prize pool in Reserved Novi
///
/// # Returns
/// Minimum number of attacks required
///
/// # Examples
/// ```ignore
/// get_min_attacks_for_prize(10_000)   // Returns 5
/// get_min_attacks_for_prize(50_000)   // Returns 20
/// get_min_attacks_for_prize(200_000)  // Returns 50
/// ```
pub fn get_min_attacks_for_prize(reserved_novi_prize: u64) -> u64 {
    if reserved_novi_prize < 25_000 {
        5     // Low-value: minimal activity
    } else if reserved_novi_prize < 100_000 {
        20    // Medium-value: moderate activity
    } else {
        50    // High-value: significant activity
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transfer_ratio_check() {
        // Legitimate player (balanced)
        assert!(check_transfer_ratio(1_000_000, 800_000, 3.0).is_ok());

        // Bot consolidation target (high ratio)
        assert!(check_transfer_ratio(10_000_000, 100_000, 3.0).is_err());

        // No transfers received (always pass)
        assert!(check_transfer_ratio(0, 0, 3.0).is_ok());

        // Exactly at limit
        assert!(check_transfer_ratio(3_000_000, 1_000_000, 3.0).is_ok());

        // Just over limit
        assert!(check_transfer_ratio(3_000_001, 1_000_000, 3.0).is_err());
    }

    #[test]
    fn test_account_age_check() {
        let now = 1_000_000;
        let seven_days = 7 * 86400;

        // Account old enough
        assert!(check_account_age(now - (10 * 86400), now, seven_days).is_ok());

        // Account too new
        assert!(check_account_age(now - (5 * 86400), now, seven_days).is_err());

        // Exactly at requirement
        assert!(check_account_age(now - seven_days, now, seven_days).is_ok());
    }

    #[test]
    fn test_activity_requirement() {
        assert!(check_activity_requirement(25, 20).is_ok());
        assert!(check_activity_requirement(20, 20).is_ok());
        assert!(check_activity_requirement(19, 20).is_err());
    }

    #[test]
    fn test_networth_range() {
        // Within range
        assert!(check_networth_range(5_000_000, Some(1_000_000), Some(10_000_000)).is_ok());

        // Too low
        assert!(check_networth_range(500_000, Some(1_000_000), None).is_err());

        // Too high
        assert!(check_networth_range(15_000_000, None, Some(10_000_000)).is_err());

        // No restrictions
        assert!(check_networth_range(5_000_000, None, None).is_ok());
    }

    #[test]
    fn test_tier_based_requirements() {
        // Low-value event
        assert_eq!(get_transfer_ratio_for_prize(10_000), 10.0);
        assert_eq!(get_min_age_for_prize(10_000), 7 * 86400);
        assert_eq!(get_min_attacks_for_prize(10_000), 5);

        // Medium-value event
        assert_eq!(get_transfer_ratio_for_prize(50_000), 3.0);
        assert_eq!(get_min_age_for_prize(50_000), 30 * 86400);
        assert_eq!(get_min_attacks_for_prize(50_000), 20);

        // High-value event
        assert_eq!(get_transfer_ratio_for_prize(200_000), 2.0);
        assert_eq!(get_min_age_for_prize(200_000), 60 * 86400);
        assert_eq!(get_min_attacks_for_prize(200_000), 50);
    }

    #[test]
    fn test_calculate_account_age_days() {
        let now = 1_000_000;
        assert_eq!(calculate_account_age_days(now - (10 * 86400), now), 10);
        assert_eq!(calculate_account_age_days(now - (1 * 86400), now), 1);
        assert_eq!(calculate_account_age_days(now, now), 0);
    }
}
