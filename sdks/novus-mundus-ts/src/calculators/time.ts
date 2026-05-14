/**
 * Time Cycle Calculators
 *
 * Location-aware day/night cycle calculations with golden ratio multipliers.
 */

import {
  CYCLE_LENGTH,
  TIME_PRECISION,
  PHI,
  GOLDEN_ROOT,
  PHI_SQUARED,
  PHI_INVERSE,
  PHI_SQUARED_INVERSE,
} from './constants';

// Time Periods

export enum TimeOfDay {
  DeepNight = 0,  // 00:00-03:00 local (0-125 in 0-1000 scale)
  Dawn = 1,       // 03:00-06:00 local (125-250) - GOLDEN HOUR
  Morning = 2,    // 06:00-09:00 local (250-375)
  Midday = 3,     // 09:00-15:00 local (375-625) - Peak day (longest period)
  Afternoon = 4,  // 15:00-18:00 local (625-750)
  Dusk = 5,       // 18:00-21:00 local (750-875) - GOLDEN HOUR
  Evening = 6,    // 21:00-00:00 local (875-1000)
}

export enum ActivityType {
  Hiring = 0,
  Purchasing = 1,
  Collecting = 2,
  Mining = 3,
  Fishing = 4,
  Attacking = 5,
  Defending = 6,
  Traveling = 7,
  Consuming = 11,
  Researching = 12,
  XPGain = 13,
  StaminaRegen = 14,
  LootDrop = 15,
}

// Time Calculation Functions

/**
 * Calculate local time based on timestamp and longitude.
 * Uses longitude to offset global time, simulating real time zones.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param longitude - Longitude in degrees (-180 to +180)
 * @returns Local time as value 0-999 (representing 0:00-24:00)
 */
export function calculateLocalTime(timestamp: number, longitude: number): number {
  // Get position within current cycle (0 to CYCLE_LENGTH-1)
  const cyclePosition = ((timestamp % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;

  // Normalize to 0-999 range (fraction of day)
  let localTime = Math.floor((cyclePosition * TIME_PRECISION) / CYCLE_LENGTH);

  // Apply longitude offset (360° = full cycle, so 1° = 1000/360 ≈ 2.78 time units)
  // East (+longitude) sees sunrise earlier, so add to local time
  const longitudeOffset = Math.floor((longitude * TIME_PRECISION) / 360);
  localTime = ((localTime + longitudeOffset) % TIME_PRECISION + TIME_PRECISION) % TIME_PRECISION;

  return localTime;
}

/**
 * Get the time period from local time value.
 *
 * @param localTime - Local time value (0-999)
 * @returns TimeOfDay enum value
 */
export function getTimeOfDay(localTime: number): TimeOfDay {
  if (localTime < 125) return TimeOfDay.DeepNight;
  if (localTime < 250) return TimeOfDay.Dawn;
  if (localTime < 375) return TimeOfDay.Morning;
  if (localTime < 625) return TimeOfDay.Midday;
  if (localTime < 750) return TimeOfDay.Afternoon;
  if (localTime < 875) return TimeOfDay.Dusk;
  return TimeOfDay.Evening;
}

/**
 * Get the current time period for a location.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param longitude - Longitude in degrees
 * @returns TimeOfDay enum value
 */
export function getCurrentTimeOfDay(timestamp: number, longitude: number): TimeOfDay {
  const localTime = calculateLocalTime(timestamp, longitude);
  return getTimeOfDay(localTime);
}

// Time Period Helpers

/** Check if a time period is a golden hour (dawn or dusk) */
export function isGoldenHour(time: TimeOfDay): boolean {
  return time === TimeOfDay.Dawn || time === TimeOfDay.Dusk;
}

/** Check if a time period is night (evening, deep night, or dawn) */
export function isNight(time: TimeOfDay): boolean {
  return time === TimeOfDay.Evening || time === TimeOfDay.DeepNight || time === TimeOfDay.Dawn;
}

/** Check if a time period is day (morning, midday, afternoon) */
export function isDay(time: TimeOfDay): boolean {
  return time === TimeOfDay.Morning || time === TimeOfDay.Midday || time === TimeOfDay.Afternoon;
}

/** Check if a time period is peak day (midday only) */
export function isPeakDay(time: TimeOfDay): boolean {
  return time === TimeOfDay.Midday;
}

/** Check if a time period is deep night */
export function isDeepNight(time: TimeOfDay): boolean {
  return time === TimeOfDay.DeepNight;
}

// Activity Multipliers (Golden Ratio Family)

/**
 * Get the time multiplier for an activity at a given time period.
 * All multipliers use the golden ratio family for consistent progression.
 *
 * @param activity - The activity type
 * @param time - The time of day
 * @returns Multiplier as a decimal (1.0 = normal, >1 = bonus, <1 = penalty)
 */
export function getActivityMultiplier(activity: ActivityType, time: TimeOfDay): number {
  // Matches Rust get_time_multiplier() in logic/time_cycle.rs exactly.
  // Most combos return 1.0 with only specific bonuses/penalties.
  switch (activity) {
    case ActivityType.Hiring:
    case ActivityType.Purchasing:
      // Peak at Midday, worst at DeepNight
      switch (time) {
        case TimeOfDay.DeepNight: return PHI_INVERSE;  // 0.618
        case TimeOfDay.Dawn: return 1.0;
        case TimeOfDay.Morning: return GOLDEN_ROOT;    // 1.272
        case TimeOfDay.Midday: return PHI;             // 1.618
        case TimeOfDay.Afternoon: return GOLDEN_ROOT;  // 1.272
        case TimeOfDay.Dusk: return 1.0;
        case TimeOfDay.Evening: return PHI_INVERSE;    // 0.618
        default: return 1.0;
      }

    case ActivityType.Collecting:
      // Cash collection — penalties at night, baseline otherwise
      switch (time) {
        case TimeOfDay.DeepNight: return PHI_INVERSE;  // 0.618
        case TimeOfDay.Evening: return PHI_INVERSE;    // 0.618
        default: return 1.0;
      }

    case ActivityType.Mining:
      // Best at DeepNight only
      switch (time) {
        case TimeOfDay.DeepNight: return PHI;          // 1.618
        default: return 1.0;
      }

    case ActivityType.Fishing:
      // Best at Dawn only (morning feeding frenzy)
      switch (time) {
        case TimeOfDay.Dawn: return PHI;               // 1.618
        default: return 1.0;
      }

    case ActivityType.Attacking:
      // Stealth advantage at night only
      switch (time) {
        case TimeOfDay.DeepNight: return PHI;          // 1.618
        case TimeOfDay.Dawn: return GOLDEN_ROOT;       // 1.272
        default: return 1.0;
      }

    case ActivityType.Defending:
      // Alertness advantage during day
      switch (time) {
        case TimeOfDay.DeepNight: return PHI_INVERSE;  // 0.618
        case TimeOfDay.Dawn: return 1.0;
        case TimeOfDay.Morning: return GOLDEN_ROOT;    // 1.272
        case TimeOfDay.Midday: return PHI;             // 1.618
        case TimeOfDay.Afternoon: return GOLDEN_ROOT;  // 1.272
        case TimeOfDay.Dusk: return 1.0;
        case TimeOfDay.Evening: return 1.0;
        default: return 1.0;
      }

    case ActivityType.Traveling:
      // Faster at night (empty roads), slower during rush hours
      switch (time) {
        case TimeOfDay.DeepNight: return PHI;          // 1.618
        case TimeOfDay.Dawn: return GOLDEN_ROOT;       // 1.272
        case TimeOfDay.Morning: return PHI_INVERSE;    // 0.618
        case TimeOfDay.Afternoon: return PHI_INVERSE;  // 0.618
        default: return 1.0;
      }

    case ActivityType.Consuming:
      // NOVI → Power conversion
      switch (time) {
        case TimeOfDay.DeepNight: return PHI_INVERSE;  // 0.618
        case TimeOfDay.Dawn: return GOLDEN_ROOT;       // 1.272
        case TimeOfDay.Evening: return PHI_INVERSE;    // 0.618
        default: return 1.0;
      }

    case ActivityType.Researching:
      // Best at night (quiet study time)
      switch (time) {
        case TimeOfDay.DeepNight: return PHI;          // 1.618
        case TimeOfDay.Dawn: return GOLDEN_ROOT;       // 1.272
        case TimeOfDay.Morning: return GOLDEN_ROOT;    // 1.272
        case TimeOfDay.Midday: return PHI_INVERSE;     // 0.618
        case TimeOfDay.Afternoon: return PHI_INVERSE;  // 0.618
        default: return 1.0;
      }

    case ActivityType.XPGain:
      // Modest night wisdom bonus only
      switch (time) {
        case TimeOfDay.DeepNight: return GOLDEN_ROOT;  // 1.272
        case TimeOfDay.Evening: return GOLDEN_ROOT;    // 1.272
        default: return 1.0;
      }

    case ActivityType.StaminaRegen:
      // Best at night (rest/sleep)
      switch (time) {
        case TimeOfDay.DeepNight: return PHI;          // 1.618
        case TimeOfDay.Dawn: return GOLDEN_ROOT;       // 1.272
        case TimeOfDay.Midday: return PHI_INVERSE;     // 0.618
        case TimeOfDay.Afternoon: return PHI_INVERSE;  // 0.618
        default: return 1.0;
      }

    case ActivityType.LootDrop:
      // Morning is best, night has modest bonus
      switch (time) {
        case TimeOfDay.DeepNight: return GOLDEN_ROOT;  // 1.272
        case TimeOfDay.Morning: return PHI;            // 1.618
        case TimeOfDay.Evening: return GOLDEN_ROOT;    // 1.272
        default: return 1.0;
      }

    default:
      return 1.0;
  }
}

/**
 * Get the time multiplier in basis points (for on-chain compatibility).
 *
 * @param activity - The activity type
 * @param time - The time of day
 * @returns Multiplier in basis points (10000 = 1.0x)
 */
export function getActivityMultiplierBps(activity: ActivityType, time: TimeOfDay): number {
  return Math.floor(getActivityMultiplier(activity, time) * 10000);
}

/**
 * Apply time multiplier to a value.
 *
 * @param value - The base value
 * @param activity - The activity type
 * @param time - The time of day
 * @returns Value with time multiplier applied
 */
export function applyTimeMultiplier(value: number, activity: ActivityType, time: TimeOfDay): number {
  const multiplier = getActivityMultiplier(activity, time);
  return Math.floor(value * multiplier);
}

// Time Display Helpers

/**
 * Get human-readable time period name.
 */
export function getTimeOfDayName(time: TimeOfDay): string {
  switch (time) {
    case TimeOfDay.DeepNight: return 'Deep Night';
    case TimeOfDay.Dawn: return 'Dawn';
    case TimeOfDay.Morning: return 'Morning';
    case TimeOfDay.Midday: return 'Midday';
    case TimeOfDay.Afternoon: return 'Afternoon';
    case TimeOfDay.Dusk: return 'Dusk';
    case TimeOfDay.Evening: return 'Evening';
    default: return 'Unknown';
  }
}

/**
 * Get approximate real-world time range for a period.
 */
export function getTimeRange(time: TimeOfDay): string {
  switch (time) {
    case TimeOfDay.DeepNight: return '00:00-03:00';
    case TimeOfDay.Dawn: return '03:00-06:00';
    case TimeOfDay.Morning: return '06:00-09:00';
    case TimeOfDay.Midday: return '09:00-15:00';
    case TimeOfDay.Afternoon: return '15:00-18:00';
    case TimeOfDay.Dusk: return '18:00-21:00';
    case TimeOfDay.Evening: return '21:00-00:00';
    default: return 'Unknown';
  }
}

/**
 * Get seconds until next time period.
 *
 * @param timestamp - Current unix timestamp
 * @param longitude - Longitude for local time
 * @returns Seconds until the time period changes
 */
export function getSecondsUntilNextPeriod(timestamp: number, longitude: number): number {
  const localTime = calculateLocalTime(timestamp, longitude);
  const currentPeriod = getTimeOfDay(localTime);

  // Find the threshold for the next period
  let nextThreshold: number;
  switch (currentPeriod) {
    case TimeOfDay.DeepNight: nextThreshold = 125; break;
    case TimeOfDay.Dawn: nextThreshold = 250; break;
    case TimeOfDay.Morning: nextThreshold = 375; break;
    case TimeOfDay.Midday: nextThreshold = 625; break;
    case TimeOfDay.Afternoon: nextThreshold = 750; break;
    case TimeOfDay.Dusk: nextThreshold = 875; break;
    case TimeOfDay.Evening: nextThreshold = 1000; break;
    default: nextThreshold = 125;
  }

  // Calculate remaining time in this period
  const remaining = nextThreshold - localTime;
  const remainingNormalized = remaining <= 0 ? remaining + TIME_PRECISION : remaining;

  // Convert back to seconds
  return Math.ceil((remainingNormalized * CYCLE_LENGTH) / TIME_PRECISION);
}
