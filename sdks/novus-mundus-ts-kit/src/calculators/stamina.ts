/**
 * Stamina Calculators
 *
 * Stamina regeneration, consumption, and management calculations.
 */

import { getActivityMultiplier, TimeOfDay, ActivityType, getCurrentTimeOfDay } from './time';
import { applyBpsBonus } from './constants';
import {
  STAMINA_REGEN_INTERVAL,
  ENCOUNTER_STAMINA_COSTS,
  MAX_STAMINA_BY_TIER,
} from '../constants';

// Re-export constants from main module for convenience
export { STAMINA_REGEN_INTERVAL, ENCOUNTER_STAMINA_COSTS, MAX_STAMINA_BY_TIER };

// Stamina Regeneration

/**
 * Calculate stamina regeneration with time-of-day bonus.
 *
 * Night time regenerates faster (rest/sleep), daytime slower (active time).
 *
 * Time Bonuses (Golden Ratio Based):
 * - DeepNight: φ² (2.618x) - Deep sleep, fast recovery
 * - Dawn/Dusk: φ (1.618x) - Transition periods
 * - Morning: √φ (1.272x) - Fresh from sleep
 * - Midday: 1/φ (0.618x) - Active time, slow recovery
 *
 * @param currentStamina - Current stamina amount
 * @param maxStamina - Maximum stamina capacity
 * @param lastUpdate - Last stamina update timestamp
 * @param now - Current timestamp
 * @param longitude - Player longitude for time calculation
 * @param heroStaminaRegenBps - Hero stamina regen buff in basis points (optional)
 * @returns [newStamina, staminaGained]
 */
export function calculateStaminaRegeneration(
  currentStamina: number,
  maxStamina: number,
  lastUpdate: number,
  now: number,
  longitude: number,
  heroStaminaRegenBps: number = 0
): [number, number] {
  const elapsed = now - lastUpdate;

  // Not enough time passed
  if (elapsed < STAMINA_REGEN_INTERVAL) {
    return [currentStamina, 0];
  }

  // Calculate intervals passed
  const intervals = Math.floor(elapsed / STAMINA_REGEN_INTERVAL);
  const baseStaminaToGain = intervals;

  // Apply time-of-day bonus
  const timeOfDay = getCurrentTimeOfDay(now, longitude);
  const regenMultiplier = getActivityMultiplier(ActivityType.StaminaRegen, timeOfDay);
  let timeStamina = Math.floor(baseStaminaToGain * regenMultiplier);

  // Apply hero stamina regen buff (multiplicative)
  if (heroStaminaRegenBps > 0) {
    timeStamina = applyBpsBonus(timeStamina, heroStaminaRegenBps);
  }

  // Apply max cap
  const newStamina = Math.min(currentStamina + timeStamina, maxStamina);
  const actualGained = newStamina - currentStamina;

  return [newStamina, actualGained];
}

/**
 * Calculate stamina gain without time-of-day bonus (simple version).
 *
 * @param currentStamina - Current stamina amount
 * @param maxStamina - Maximum stamina capacity
 * @param elapsedSeconds - Seconds elapsed since last update
 * @returns [newStamina, staminaGained]
 */
export function calculateSimpleStaminaRegen(
  currentStamina: number,
  maxStamina: number,
  elapsedSeconds: number
): [number, number] {
  const intervals = Math.floor(elapsedSeconds / STAMINA_REGEN_INTERVAL);
  const newStamina = Math.min(currentStamina + intervals, maxStamina);
  const actualGained = newStamina - currentStamina;
  return [newStamina, actualGained];
}

// Stamina Consumption

/**
 * Check if player has enough stamina for an encounter.
 *
 * @param currentStamina - Current stamina amount
 * @param encounterType - Type of encounter (0-5)
 * @returns true if player has enough stamina
 */
export function hasEnoughStamina(currentStamina: number, encounterType: number): boolean {
  const cost = ENCOUNTER_STAMINA_COSTS[Math.min(encounterType, 5)] ?? 1;
  return currentStamina >= cost;
}

/**
 * Calculate stamina cost for an encounter.
 *
 * @param encounterType - Type of encounter (0-5)
 * @returns Stamina cost
 */
export function getEncounterStaminaCost(encounterType: number): number {
  return ENCOUNTER_STAMINA_COSTS[Math.min(encounterType, 5)] ?? 1;
}

/**
 * Calculate stamina after consuming for an encounter.
 *
 * @param currentStamina - Current stamina amount
 * @param encounterType - Type of encounter (0-5)
 * @returns [newStamina, success] - Returns new stamina and whether consumption was successful
 */
export function consumeStamina(
  currentStamina: number,
  encounterType: number
): [number, boolean] {
  const cost = ENCOUNTER_STAMINA_COSTS[Math.min(encounterType, 5)] ?? 1;

  if (currentStamina < cost) {
    return [currentStamina, false];
  }

  return [currentStamina - cost, true];
}

// Stamina Addition

/**
 * Add stamina to player (from purchases, rewards, achievements).
 *
 * @param currentStamina - Current stamina amount
 * @param maxStamina - Maximum stamina capacity
 * @param amount - Stamina to add
 * @returns [newStamina, actualAdded]
 */
export function addStamina(
  currentStamina: number,
  maxStamina: number,
  amount: number
): [number, number] {
  const newStamina = Math.min(currentStamina + amount, maxStamina);
  const actualAdded = newStamina - currentStamina;
  return [newStamina, actualAdded];
}

// Max Stamina Calculations

/**
 * Get max stamina for a subscription tier.
 *
 * @param tier - Subscription tier (0-3)
 * @returns Maximum stamina capacity
 */
export function getMaxStaminaForTier(tier: number): number {
  return MAX_STAMINA_BY_TIER[Math.min(tier, 3)] ?? 10;
}

/**
 * Calculate max stamina with any bonuses.
 *
 * @param tier - Subscription tier (0-3)
 * @param bonusBps - Bonus in basis points (optional)
 * @returns Maximum stamina capacity with bonuses
 */
export function calculateMaxStamina(tier: number, bonusBps: number = 0): number {
  const baseMax = MAX_STAMINA_BY_TIER[Math.min(tier, 3)] ?? 10;
  return bonusBps > 0 ? applyBpsBonus(baseMax, bonusBps) : baseMax;
}

// Time Estimation

/**
 * Calculate time until full stamina recovery.
 *
 * @param currentStamina - Current stamina amount
 * @param maxStamina - Maximum stamina capacity
 * @param timeOfDay - Current time of day (for regen rate)
 * @returns Seconds until full recovery (0 if already full)
 */
export function timeUntilFullStamina(
  currentStamina: number,
  maxStamina: number,
  timeOfDay: TimeOfDay
): number {
  if (currentStamina >= maxStamina) {
    return 0;
  }

  const needed = maxStamina - currentStamina;
  const regenMultiplier = getActivityMultiplier(ActivityType.StaminaRegen, timeOfDay);

  // Effective intervals needed (accounting for time bonus)
  const intervalsNeeded = Math.ceil(needed / regenMultiplier);

  return intervalsNeeded * STAMINA_REGEN_INTERVAL;
}

/**
 * Calculate time until enough stamina for an encounter.
 *
 * @param currentStamina - Current stamina amount
 * @param encounterType - Type of encounter (0-5)
 * @param timeOfDay - Current time of day
 * @returns Seconds until enough stamina (0 if already enough)
 */
export function timeUntilEncounterReady(
  currentStamina: number,
  encounterType: number,
  timeOfDay: TimeOfDay
): number {
  const cost = ENCOUNTER_STAMINA_COSTS[Math.min(encounterType, 5)] ?? 1;

  if (currentStamina >= cost) {
    return 0;
  }

  const needed = cost - currentStamina;
  const regenMultiplier = getActivityMultiplier(ActivityType.StaminaRegen, timeOfDay);

  const intervalsNeeded = Math.ceil(needed / regenMultiplier);

  return intervalsNeeded * STAMINA_REGEN_INTERVAL;
}
