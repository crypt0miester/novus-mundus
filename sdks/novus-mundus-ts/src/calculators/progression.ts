/**
 * Progression Calculators
 *
 * XP, leveling, and progression calculations.
 */

import { getActivityMultiplier, TimeOfDay, ActivityType, getCurrentTimeOfDay } from './time';
import { applyBpsBonus } from './constants';

// ============================================================
// XP Requirements
// ============================================================

/**
 * XP required to reach a specific level (cumulative from level 1).
 *
 * Formula: 100 * 2.5^(level-2) for each level
 *
 * @param level - Target level
 * @returns Total XP required to reach that level
 *
 * @example
 * ```ts
 * xpRequiredForLevel(1);  // 0
 * xpRequiredForLevel(2);  // 100
 * xpRequiredForLevel(3);  // 350 (100 + 250)
 * xpRequiredForLevel(4);  // 975 (100 + 250 + 625)
 * ```
 */
export function xpRequiredForLevel(level: number): number {
  if (level <= 1) {
    return 0;
  }

  // Exponential formula: 100 * 2.5^(level-2)
  const base = 100;
  const multiplier = 2.5;
  const exponent = level - 2;

  return Math.floor(base * Math.pow(multiplier, exponent));
}

/**
 * XP required to go from one level to the next.
 *
 * @param currentLevel - Current level
 * @returns XP needed to reach next level
 */
export function xpToNextLevel(currentLevel: number): number {
  return xpRequiredForLevel(currentLevel + 1);
}

/**
 * Calculate cumulative XP required for a level (total from level 1).
 *
 * @param level - Target level
 * @returns Cumulative XP to reach that level
 */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let i = 2; i <= level; i++) {
    total += xpRequiredForLevel(i);
  }
  return total;
}

// ============================================================
// Level Calculations
// ============================================================

/**
 * Calculate the level for a given amount of XP.
 *
 * @param totalXp - Total XP accumulated
 * @returns Level reached
 */
export function levelFromXp(totalXp: number): number {
  let level = 1;
  let remainingXp = totalXp;

  while (level < 255) {
    const xpForNext = xpRequiredForLevel(level + 1);
    if (remainingXp < xpForNext) {
      break;
    }
    remainingXp -= xpForNext;
    level++;
  }

  return level;
}

/**
 * Calculate level and overflow XP.
 *
 * @param totalXp - Total XP accumulated
 * @returns [level, overflowXp] - Current level and XP toward next level
 */
export function levelAndOverflowFromXp(totalXp: number): [number, number] {
  let level = 1;
  let remainingXp = totalXp;

  while (level < 255) {
    const xpForNext = xpRequiredForLevel(level + 1);
    if (remainingXp < xpForNext) {
      break;
    }
    remainingXp -= xpForNext;
    level++;
  }

  return [level, remainingXp];
}

/**
 * Simulate granting XP and return new level and overflow.
 *
 * @param currentLevel - Current player level
 * @param currentXp - Current XP toward next level
 * @param xpAmount - XP to grant
 * @returns [newLevel, newXp, levelsGained]
 */
export function simulateGrantXp(
  currentLevel: number,
  currentXp: number,
  xpAmount: number
): [number, number, number] {
  let level = currentLevel;
  let xp = currentXp + xpAmount;
  let levelsGained = 0;

  while (level < 255) {
    const xpForNext = xpRequiredForLevel(level + 1);
    if (xp < xpForNext) {
      break;
    }
    xp -= xpForNext;
    level++;
    levelsGained++;
  }

  return [level, xp, levelsGained];
}

// ============================================================
// XP with Time Bonus
// ============================================================

/**
 * Calculate XP with time-of-day bonus.
 *
 * Golden hours (Dawn/Dusk) provide φ² (2.618x) XP bonus.
 * Night time provides φ (1.618x) bonus for wisdom.
 * Midday provides base 1.0x.
 *
 * @param baseXp - Base XP amount
 * @param timestamp - Current unix timestamp
 * @param longitude - Player longitude for time calculation
 * @param heroXpGainBps - Hero XP gain buff in basis points (optional)
 * @returns XP amount with time bonus applied
 */
export function calculateXpWithTimeBonus(
  baseXp: number,
  timestamp: number,
  longitude: number,
  heroXpGainBps: number = 0
): number {
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const xpMultiplier = getActivityMultiplier(ActivityType.XPGain, timeOfDay);
  let timeXp = Math.floor(baseXp * xpMultiplier);

  // Apply hero XP gain buff
  if (heroXpGainBps > 0) {
    timeXp = applyBpsBonus(timeXp, heroXpGainBps);
  }

  return timeXp;
}

/**
 * Calculate XP bonus multiplier for display purposes.
 *
 * @param timeOfDay - Current time of day
 * @returns Multiplier as a decimal (e.g., 2.618 for golden hours)
 */
export function getXpBonusMultiplier(timeOfDay: TimeOfDay): number {
  return getActivityMultiplier(ActivityType.XPGain, timeOfDay);
}

// ============================================================
// Progress Display Helpers
// ============================================================

/**
 * Calculate progress percentage to next level.
 *
 * @param currentLevel - Current player level
 * @param currentXp - Current XP toward next level
 * @returns Progress as a percentage (0-100)
 */
export function levelProgressPercent(currentLevel: number, currentXp: number): number {
  const xpForNext = xpRequiredForLevel(currentLevel + 1);
  if (xpForNext === 0) return 100;
  return Math.min(100, Math.floor((currentXp / xpForNext) * 100));
}

/**
 * Calculate XP remaining to next level.
 *
 * @param currentLevel - Current player level
 * @param currentXp - Current XP toward next level
 * @returns XP remaining to reach next level
 */
export function xpRemainingToNextLevel(currentLevel: number, currentXp: number): number {
  const xpForNext = xpRequiredForLevel(currentLevel + 1);
  return Math.max(0, xpForNext - currentXp);
}

/**
 * Format level progress as a string.
 *
 * @param currentLevel - Current player level
 * @param currentXp - Current XP toward next level
 * @returns Formatted string like "1,234 / 5,000 XP (24%)"
 */
export function formatLevelProgress(currentLevel: number, currentXp: number): string {
  const xpForNext = xpRequiredForLevel(currentLevel + 1);
  const percent = levelProgressPercent(currentLevel, currentXp);
  return `${currentXp.toLocaleString()} / ${xpForNext.toLocaleString()} XP (${percent}%)`;
}

// ============================================================
// XP Estimation
// ============================================================

/**
 * Estimate actions needed to level up.
 *
 * @param currentLevel - Current player level
 * @param currentXp - Current XP toward next level
 * @param xpPerAction - XP gained per action
 * @returns Number of actions needed to level up
 */
export function actionsToLevelUp(
  currentLevel: number,
  currentXp: number,
  xpPerAction: number
): number {
  if (xpPerAction <= 0) return Infinity;

  const remaining = xpRemainingToNextLevel(currentLevel, currentXp);
  return Math.ceil(remaining / xpPerAction);
}

/**
 * Estimate XP per hour at a given encounter rate.
 *
 * @param encountersPerHour - Number of encounters defeated per hour
 * @param averageRarity - Average encounter rarity (0-5)
 * @param timeOfDay - Current time of day for bonus
 * @returns Estimated XP per hour
 */
export function estimateXpPerHour(
  encountersPerHour: number,
  averageRarity: number,
  timeOfDay: TimeOfDay
): number {
  // Base XP by rarity
  const xpByRarity = [10, 25, 50, 100, 250, 500];
  const baseXp = xpByRarity[Math.min(Math.floor(averageRarity), 5)] ?? 10;

  // Apply time bonus
  const multiplier = getActivityMultiplier(ActivityType.XPGain, timeOfDay);
  const xpPerEncounter = Math.floor(baseXp * multiplier);

  return encountersPerHour * xpPerEncounter;
}
