/// Time-of-Day Cycle System (Deterministic)
///
/// Implements a location-aware day/night cycle using real-world time.
/// All multipliers use the golden ratio family for consistent progression.
///
/// # Key Design Principles
/// - Fully deterministic: same timestamp + coordinates = same result
/// - Location-aware: longitude determines local time (like real time zones)
/// - Golden ratio multipliers: φ, √φ, φ², 1/φ for all bonuses/penalties
///
/// # Gameplay Implications
/// - Economic activities (hiring, collecting) peak at Midday
/// - Attacking is strongest at DeepNight (stealth advantage)
/// - Defending is strongest at Midday (full alertness)
/// - Golden Hours (Dawn/Dusk) give φ² spawn weight to rare encounters
/// - Rare encounters spawn at golden hours, Legendary at midnight

use crate::constants::{PHI, GOLDEN_ROOT, PHI_SQUARED, PHI_INVERSE, PHI_SQUARED_INVERSE, PHI_CUBED_INVERSE};

/// Full day/night cycle in seconds (24 real hours)
pub const CYCLE_LENGTH: i64 = 86_400;

/// Precision multiplier to avoid floating point in time calculations
const TIME_PRECISION: i64 = 1000;

// // ========================================================// ========================================================// ========================================================// ========================================================// ========================================================// ========================================================
// Time Period Definitions
// // ========================================================// ========================================================// ========================================================// ========================================================// ========================================================// ========================================================

/// Time periods in a day cycle
///
/// Each period has distinct gameplay characteristics:
/// - DeepNight: Stealth, legendary spawns, cheap markets
/// - Dawn: Golden hour, φ² collection, rare spawns
/// - Morning: Work begins, good productivity
/// - Midday: Peak productivity, best defense, expensive markets
/// - Afternoon: Work continues, good productivity
/// - Dusk: Golden hour, φ² collection, rare spawns
/// - Evening: Winding down, attack advantage begins
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TimeOfDay {
    DeepNight = 0,  // 00:00-03:00 local (0-125 in 0-1000 scale)
    Dawn = 1,       // 03:00-06:00 local (125-250) - GOLDEN HOUR
    Morning = 2,    // 06:00-09:00 local (250-375)
    Midday = 3,     // 09:00-15:00 local (375-625) - Peak day (longest period)
    Afternoon = 4,  // 15:00-18:00 local (625-750)
    Dusk = 5,       // 18:00-21:00 local (750-875) - GOLDEN HOUR
    Evening = 6,    // 21:00-00:00 local (875-1000)
}

impl TimeOfDay {
    /// Check if this is a golden hour (dawn or dusk)
    /// Used for XP bonuses and special encounter spawns
    #[inline]
    #[allow(dead_code)]
    pub fn is_golden_hour(&self) -> bool {
        matches!(self, TimeOfDay::Dawn | TimeOfDay::Dusk)
    }

    /// Check if this is night time (evening, deep night, or dawn)
    /// Used for stealth bonuses and night-specific mechanics
    #[inline]
    #[allow(dead_code)]
    pub fn is_night(&self) -> bool {
        matches!(self, TimeOfDay::Evening | TimeOfDay::DeepNight | TimeOfDay::Dawn)
    }

    /// Check if this is day time (morning, midday, afternoon)
    /// Used for day-only activities and resource collection bonuses
    #[inline]
    #[allow(dead_code)]
    pub fn is_day(&self) -> bool {
        matches!(self, TimeOfDay::Morning | TimeOfDay::Midday | TimeOfDay::Afternoon)
    }

    /// Check if this is peak day (midday only)
    /// Used for dungeon High Noon (nullifies darkness)
    #[inline]
    #[allow(dead_code)]
    pub fn is_peak_day(&self) -> bool {
        matches!(self, TimeOfDay::Midday)
    }

    /// Check if this is deep night (best for legendary encounters)
    /// Used for dungeon Witching Hour and rare spawns
    #[inline]
    #[allow(dead_code)]
    pub fn is_deep_night(&self) -> bool {
        matches!(self, TimeOfDay::DeepNight)
    }
}

// Activity Types

/// Activity types for time-based multiplier lookup
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ActivityType {
    // Economic Activities
    Hiring = 0,        // Hiring units (best during day - workers available)
    Purchasing = 1,    // Buying equipment
    Collecting = 2,    // Cash collection
    Mining = 3,        // Gem mining (better at night - cooler, less distraction)
    Fishing = 4,       // Fishing (best at dawn/dusk - feeding times)

    // Combat Activities
    Attacking = 5,     // Offensive combat (stealth advantage at night)
    Defending = 6,     // Defensive combat (alertness advantage during day)

    // Movement
    Traveling = 7,     // Intercity/intracity travel (faster at night - empty roads)

    // Consumption & Production
    Consuming = 11,    // NOVI → Power conversion (best during day - peak efficiency)

    // Research & Learning
    Researching = 12,  // Research speed (best at night - quiet study time)
    XPGain = 13,       // XP earning multiplier (best at golden hours - enlightenment)

    // Recovery
    StaminaRegen = 14, // Stamina regeneration rate (best at night - rest/sleep)

    // Loot & Fortune
    LootDrop = 15,     // Loot quality/quantity multiplier (best at golden hours)
}

// Core Time Calculation Functions

/// Calculate local time of day based on timestamp and longitude
///
/// Uses longitude to offset global time, simulating real time zones.
/// Eastern locations see sunrise earlier than western locations.
///
/// # Arguments
/// * `timestamp` - Unix timestamp in seconds
/// * `longitude` - Longitude in degrees (-180 to +180)
///
/// # Returns
/// Local time as value 0-999 (representing 0:00-24:00)
#[inline]
pub fn calculate_local_time(timestamp: i64, longitude: f64) -> i64 {
    // Get position within current cycle (0 to CYCLE_LENGTH-1)
    let cycle_position = timestamp.rem_euclid(CYCLE_LENGTH);

    // Normalize to 0-999 range (fraction of day)
    let global_time = (cycle_position * TIME_PRECISION) / CYCLE_LENGTH;

    // Longitude offset: -180° to +180° maps to -500 to +500.
    // This means 180° east is 12 hours ahead, 180° west is 12 hours behind,
    // and longitude 0 (Greenwich) keeps UTC — no offset.
    let longitude_offset = (longitude / 360.0 * TIME_PRECISION as f64) as i64;

    // Calculate local time with wraparound
    (global_time + longitude_offset).rem_euclid(TIME_PRECISION)
}

/// Get the time of day period for a given timestamp and location
///
/// # Arguments
/// * `timestamp` - Unix timestamp in seconds
/// * `longitude` - Longitude in degrees (-180 to +180)
///
/// # Returns
/// TimeOfDay enum representing the current period
#[inline]
pub fn get_time_of_day(timestamp: i64, longitude: f64) -> TimeOfDay {
    let local_time = calculate_local_time(timestamp, longitude);

    match local_time {
        0..=124 => TimeOfDay::DeepNight,    // 00:00-03:00
        125..=249 => TimeOfDay::Dawn,        // 03:00-06:00 (Golden Hour)
        250..=374 => TimeOfDay::Morning,     // 06:00-09:00
        375..=624 => TimeOfDay::Midday,      // 09:00-15:00 (Peak, longest)
        625..=749 => TimeOfDay::Afternoon,   // 15:00-18:00
        750..=874 => TimeOfDay::Dusk,        // 18:00-21:00 (Golden Hour)
        _ => TimeOfDay::Evening,             // 21:00-00:00
    }
}

// Activity Multipliers (Golden Ratio Based)

/// Get the time-based multiplier for an activity
///
/// All multipliers use the golden ratio family:
/// - φ ≈ 1.618 (strong bonus)
/// - √φ ≈ 1.272 (moderate bonus)
/// - 1.0 (baseline, no modifier)
/// - 1/√φ ≈ 0.786 (moderate penalty)
/// - 1/φ ≈ 0.618 (strong penalty)
///
/// # Arguments
/// * `time` - Current time of day
/// * `activity` - Activity type
///
/// # Returns
/// Multiplier as f64
pub fn get_time_multiplier(time: TimeOfDay, activity: ActivityType) -> f64 {
    match activity {
        // ECONOMIC ACTIVITIES - Peak at Midday, worst at DeepNight
        ActivityType::Hiring | ActivityType::Purchasing => match time {
            TimeOfDay::DeepNight => PHI_INVERSE,  // 0.618x - Workers asleep
            TimeOfDay::Dawn => 1.0,               // 1.0x - Starting to wake
            TimeOfDay::Morning => GOLDEN_ROOT,    // 1.272x - Work begins
            TimeOfDay::Midday => PHI,             // 1.618x - Peak productivity
            TimeOfDay::Afternoon => GOLDEN_ROOT,  // 1.272x - Work continues
            TimeOfDay::Dusk => 1.0,               // 1.0x - Winding down
            TimeOfDay::Evening => PHI_INVERSE,    // 0.618x - Shops closing
        },

        ActivityType::Collecting => match time {
            TimeOfDay::DeepNight => PHI_INVERSE,  // 0.618x - Dangerous, no visibility
            TimeOfDay::Evening => PHI_INVERSE,    // 0.618x - Getting dark
            _ => 1.0,
        },

        ActivityType::Mining => match time {
            TimeOfDay::DeepNight => PHI,          // 1.618x - Optimal mining conditions
            _ => 1.0,
        },

        ActivityType::Fishing => match time {
            TimeOfDay::Dawn => PHI,               // 1.618x - Morning feeding frenzy
            _ => 1.0,
        },

        // COMBAT - Attacking best at night, Defending best at day
        ActivityType::Attacking => match time {
            TimeOfDay::DeepNight => PHI,          // 1.618x - Maximum stealth advantage
            TimeOfDay::Dawn => GOLDEN_ROOT,       // 1.272x - Low visibility surprise
            _ => 1.0,
        },

        ActivityType::Defending => match time {
            TimeOfDay::DeepNight => PHI_INVERSE,  // 0.618x - Guards tired, low visibility
            TimeOfDay::Dawn => 1.0,               // 1.0x - Waking up
            TimeOfDay::Morning => GOLDEN_ROOT,    // 1.272x - Alert
            TimeOfDay::Midday => PHI,             // 1.618x - Maximum alertness
            TimeOfDay::Afternoon => GOLDEN_ROOT,  // 1.272x - Still alert
            TimeOfDay::Dusk => 1.0,               // 1.0x - Guard change
            TimeOfDay::Evening => 1.0,            // 1.0x - Fatigue setting in
        },

        // TRAVEL - Faster at night (empty roads), slower during day (traffic)
        ActivityType::Traveling => match time {
            TimeOfDay::DeepNight => PHI,          // 1.618x - Empty roads, fast travel!
            TimeOfDay::Dawn => GOLDEN_ROOT,       // 1.272x - Light traffic
            TimeOfDay::Morning => PHI_INVERSE,    // 0.618x - Rush hour traffic
            TimeOfDay::Afternoon => PHI_INVERSE,  // 0.618x - Rush hour traffic
            _ => 1.0,
        },

        // CONSUMPTION - NOVI → Power conversion (best during day - peak efficiency)
        ActivityType::Consuming => match time {
            TimeOfDay::DeepNight => PHI_INVERSE,  // 0.618x - Underground operations less efficient
            TimeOfDay::Dawn => GOLDEN_ROOT,       // 1.272x - Early morning productivity
            TimeOfDay::Evening => PHI_INVERSE,    // 0.618x - Night operations less efficient
            _ => 1.0,            
        },

        // RESEARCH - Study/learning speed (best at night - quiet focus time)
        ActivityType::Researching => match time {
            TimeOfDay::DeepNight => PHI,          // 1.618x - Deep focus, no distractions
            TimeOfDay::Dawn => GOLDEN_ROOT,       // 1.272x - Early morning clarity
            TimeOfDay::Morning => GOLDEN_ROOT,    // 1.0x - Normal study
            TimeOfDay::Midday => PHI_INVERSE,     // 0.618x - Too busy, interruptions
            TimeOfDay::Afternoon => PHI_INVERSE,  // 0.618x - Energy slump
            _ => 1.0,
        },

        // XP GAIN - Learning/enlightenment (best at golden hours)
        ActivityType::XPGain => match time {
            TimeOfDay::DeepNight => GOLDEN_ROOT,  // 1.272x - Night wisdom
            TimeOfDay::Morning => 1.0,            // 1.0x - Normal learning
            TimeOfDay::Midday => 1.0,             // 1.0x - Normal learning
            TimeOfDay::Afternoon => 1.0,          // 1.0x - Normal learning
            TimeOfDay::Evening => GOLDEN_ROOT,    // 1.272x - Night wisdom
            _ => 1.0,
        },

        // STAMINA REGEN - Rest/recovery (best at night - sleep time)
        ActivityType::StaminaRegen => match time {
            TimeOfDay::DeepNight => PHI,          // 1.618x - Deep sleep, fast recovery
            TimeOfDay::Dawn => GOLDEN_ROOT,       // 1.272x - Waking rested
            TimeOfDay::Midday => PHI_INVERSE,     // 0.618x - Active time, slow recovery
            TimeOfDay::Afternoon => PHI_INVERSE,  // 0.618x - Active time, slow recovery
            _ => 1.0,
        },

        // LOOT DROP - Fortune/quality (best at golden hours)
        ActivityType::LootDrop => match time {
            TimeOfDay::DeepNight => GOLDEN_ROOT,  // 1.272x - Night treasures
            TimeOfDay::Morning => PHI,            // 1.0x - Normal drops
            TimeOfDay::Evening => GOLDEN_ROOT,    // 1.272x - Night treasures
            _ => 1.0,
        },
    }
}

/// Time-of-day multiplier in basis points (10000 = 1.0x). Integer-only twin of
/// [`get_time_multiplier`] for the compute-metered hot path — avoids soft-float.
/// Values: φ = 16180, √φ = 12720, 1.0 = 10000, 1/φ = 6180.
/// Keep the arms in sync with `get_time_multiplier` above.
pub fn get_time_multiplier_bp(time: TimeOfDay, activity: ActivityType) -> u16 {
    match activity {
        ActivityType::Hiring | ActivityType::Purchasing => match time {
            TimeOfDay::DeepNight => 6180,
            TimeOfDay::Dawn => 10000,
            TimeOfDay::Morning => 12720,
            TimeOfDay::Midday => 16180,
            TimeOfDay::Afternoon => 12720,
            TimeOfDay::Dusk => 10000,
            TimeOfDay::Evening => 6180,
        },
        ActivityType::Collecting => match time {
            TimeOfDay::DeepNight => 6180,
            TimeOfDay::Evening => 6180,
            _ => 10000,
        },
        ActivityType::Mining => match time {
            TimeOfDay::DeepNight => 16180,
            _ => 10000,
        },
        ActivityType::Fishing => match time {
            TimeOfDay::Dawn => 16180,
            _ => 10000,
        },
        ActivityType::Attacking => match time {
            TimeOfDay::DeepNight => 16180,
            TimeOfDay::Dawn => 12720,
            _ => 10000,
        },
        ActivityType::Defending => match time {
            TimeOfDay::DeepNight => 6180,
            TimeOfDay::Dawn => 10000,
            TimeOfDay::Morning => 12720,
            TimeOfDay::Midday => 16180,
            TimeOfDay::Afternoon => 12720,
            TimeOfDay::Dusk => 10000,
            TimeOfDay::Evening => 10000,
        },
        ActivityType::Traveling => match time {
            TimeOfDay::DeepNight => 16180,
            TimeOfDay::Dawn => 12720,
            TimeOfDay::Morning => 6180,
            TimeOfDay::Afternoon => 6180,
            _ => 10000,
        },
        ActivityType::Consuming => match time {
            TimeOfDay::DeepNight => 6180,
            TimeOfDay::Dawn => 12720,
            TimeOfDay::Evening => 6180,
            _ => 10000,
        },
        ActivityType::Researching => match time {
            TimeOfDay::DeepNight => 16180,
            TimeOfDay::Dawn => 12720,
            TimeOfDay::Morning => 12720,
            TimeOfDay::Midday => 6180,
            TimeOfDay::Afternoon => 6180,
            _ => 10000,
        },
        ActivityType::XPGain => match time {
            TimeOfDay::DeepNight => 12720,
            TimeOfDay::Evening => 12720,
            _ => 10000,
        },
        ActivityType::StaminaRegen => match time {
            TimeOfDay::DeepNight => 16180,
            TimeOfDay::Dawn => 12720,
            TimeOfDay::Midday => 6180,
            TimeOfDay::Afternoon => 6180,
            _ => 10000,
        },
        ActivityType::LootDrop => match time {
            TimeOfDay::DeepNight => 12720,
            TimeOfDay::Morning => 16180,
            TimeOfDay::Evening => 12720,
            _ => 10000,
        },
    }
}

/// Apply a time multiplier to a base value (u64)
///
/// Uses the golden ratio multiplier for the given time and activity.
#[inline]
pub fn apply_time_multiplier(base: u64, time: TimeOfDay, activity: ActivityType) -> u64 {
    let bp = get_time_multiplier_bp(time, activity) as u64;
    crate::logic::safe_math::apply_bp(base, bp).unwrap_or(base)
}

// Encounter Spawn Timing

/// Rarity spawn weights by time of day
///
/// Returns spawn weight multiplier for each rarity based on time.
/// Higher weight = more likely to spawn at this time.
///
/// - Common: Any time, slightly more during day
/// - Uncommon: Weighted toward morning/afternoon
/// - Rare: Golden hours (dawn/dusk) - the special spawns
/// - Epic: Night periods preferred
/// - Legendary: DeepNight only - the midnight hunt
pub fn get_rarity_spawn_weight(time: TimeOfDay, rarity: u8) -> f64 {
    match rarity {
        0 => match time { // Common - available anytime
            TimeOfDay::Midday => GOLDEN_ROOT,     // 1.272x during safe times
            TimeOfDay::DeepNight => PHI_INVERSE,  // 0.618x at night
            _ => 1.0,
        },
        1 => match time { // Uncommon - daytime preferred
            TimeOfDay::Morning | TimeOfDay::Afternoon => PHI,
            TimeOfDay::Midday => GOLDEN_ROOT,
            TimeOfDay::DeepNight | TimeOfDay::Evening => PHI_INVERSE,
            _ => 1.0,
        },
        2 => match time { // Rare - GOLDEN HOURS!
            TimeOfDay::Dawn | TimeOfDay::Dusk => PHI_SQUARED, // 2.618x at golden hours!
            TimeOfDay::Midday => PHI_INVERSE,
            TimeOfDay::DeepNight => GOLDEN_ROOT,
            _ => 1.0,
        },
        3 => match time { // Epic - night encounters
            TimeOfDay::DeepNight => PHI,          // 1.618x
            TimeOfDay::Evening => GOLDEN_ROOT,    // 1.272x
            TimeOfDay::Dawn => GOLDEN_ROOT,       // Early risers catch epics too
            TimeOfDay::Midday => PHI_SQUARED_INVERSE, // 0.382x - Very rare during day (1/φ²)
            _ => PHI_INVERSE,
        },
        4 => match time { // Legendary - THE MIDNIGHT HUNT
            TimeOfDay::DeepNight => PHI_SQUARED,  // 2.618x - Only serious hunters find these
            TimeOfDay::Dawn => PHI_INVERSE,       // 0.618x - Possible but rare
            TimeOfDay::Evening => PHI_INVERSE,    // 0.618x - Possible but rare
            _ => PHI_CUBED_INVERSE,               // 0.236x - Almost never during day (1/φ³)
        },
        _ => 1.0, // WorldEvent and others - special timing
    }
}

/// Check if an encounter rarity can spawn at the current time
///
/// Legendary encounters require DeepNight or adjacent periods.
/// Returns true if spawn is allowed, false if time restriction blocks it.
pub fn can_spawn_rarity_at_time(time: TimeOfDay, rarity: u8) -> bool {
    match rarity {
        4 => matches!(time, TimeOfDay::DeepNight | TimeOfDay::Dawn | TimeOfDay::Evening),
        3 => matches!(time, TimeOfDay::DeepNight | TimeOfDay::Evening | TimeOfDay::Dawn | TimeOfDay::Dusk),
        _ => true, // Common, Uncommon, Rare can spawn anytime
    }
}

// Tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_of_day_calculation() {
        // Noon UTC at longitude 0 should be Midday
        let timestamp = 12 * 3600; // 12:00 UTC
        let time = get_time_of_day(timestamp, 0.0);
        assert_eq!(time, TimeOfDay::Midday);

        // Midnight UTC at longitude 0 should be DeepNight
        let time = get_time_of_day(0, 0.0);
        assert_eq!(time, TimeOfDay::DeepNight);
    }

    #[test]
    fn test_longitude_offset() {
        // Same global time, but different longitudes = different local times
        let timestamp = 6 * 3600; // 06:00 UTC

        // At longitude 0, it's Morning (6am local)
        let time_london = get_time_of_day(timestamp, 0.0);
        assert_eq!(time_london, TimeOfDay::Morning);

        // At longitude 180 (12 hours ahead), it's Dusk (6pm local)
        let time_far_east = get_time_of_day(timestamp, 180.0);
        assert_eq!(time_far_east, TimeOfDay::Dusk);
    }

    #[test]
    fn test_golden_hour_detection() {
        assert!(TimeOfDay::Dawn.is_golden_hour());
        assert!(TimeOfDay::Dusk.is_golden_hour());
        assert!(!TimeOfDay::Midday.is_golden_hour());
        assert!(!TimeOfDay::DeepNight.is_golden_hour());
    }

    #[test]
    fn test_multipliers_are_golden_ratio() {
        // Verify all multipliers use golden ratio family
        // Attacking at night should give φ bonus
        let attack_night = get_time_multiplier(TimeOfDay::DeepNight, ActivityType::Attacking);
        assert!((attack_night - PHI).abs() < 0.0001);

        // Defending at midday should give φ bonus
        let defend_day = get_time_multiplier(TimeOfDay::Midday, ActivityType::Defending);
        assert!((defend_day - PHI).abs() < 0.0001);

        // Collection at deep night should give a 1/φ penalty (golden-ratio family)
        let collect_night = get_time_multiplier(TimeOfDay::DeepNight, ActivityType::Collecting);
        assert!((collect_night - PHI_INVERSE).abs() < 0.0001);
    }

    #[test]
    fn test_legendary_spawn_restrictions() {
        // Legendary should only spawn at night
        assert!(can_spawn_rarity_at_time(TimeOfDay::DeepNight, 4));
        assert!(can_spawn_rarity_at_time(TimeOfDay::Dawn, 4));
        assert!(can_spawn_rarity_at_time(TimeOfDay::Evening, 4));
        assert!(!can_spawn_rarity_at_time(TimeOfDay::Midday, 4));
        assert!(!can_spawn_rarity_at_time(TimeOfDay::Morning, 4));
    }

    /// `get_time_multiplier_bp` is a hand-maintained integer twin of the f64
    /// `get_time_multiplier` — guard against the two tables drifting apart.
    #[test]
    fn time_multiplier_bp_matches_float() {
        let times = [
            TimeOfDay::DeepNight,
            TimeOfDay::Dawn,
            TimeOfDay::Morning,
            TimeOfDay::Midday,
            TimeOfDay::Afternoon,
            TimeOfDay::Dusk,
            TimeOfDay::Evening,
        ];
        let activities = [
            ActivityType::Hiring,
            ActivityType::Purchasing,
            ActivityType::Collecting,
            ActivityType::Mining,
            ActivityType::Fishing,
            ActivityType::Attacking,
            ActivityType::Defending,
            ActivityType::Traveling,
            ActivityType::Consuming,
            ActivityType::Researching,
            ActivityType::XPGain,
            ActivityType::StaminaRegen,
            ActivityType::LootDrop,
        ];
        for &t in &times {
            for &a in &activities {
                let bp = get_time_multiplier_bp(t, a) as f64 / 10000.0;
                let f = get_time_multiplier(t, a);
                assert!(
                    (bp - f).abs() < 0.001,
                    "time multiplier drift for {:?}/{:?}: bp={} float={}",
                    t,
                    a,
                    bp,
                    f,
                );
            }
        }
    }
}
