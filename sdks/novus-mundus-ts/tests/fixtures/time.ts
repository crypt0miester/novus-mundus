/**
 * Time Manipulation Utilities
 *
 * Helpers for testing time-based game mechanics.
 * Works with local validator's clock manipulation.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// ============================================================
// Constants
// ============================================================

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_WEEK = 604800;

export const SLOTS_PER_SECOND = 2.5; // Approximate on Solana
export const MS_PER_SLOT = 400;

// ============================================================
// Clock Utilities
// ============================================================

/**
 * Get current Unix timestamp from the blockchain.
 */
export async function getCurrentTimestamp(connection: Connection): Promise<number> {
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot);
  return blockTime ?? Math.floor(Date.now() / 1000);
}

/**
 * Get current slot from the blockchain.
 */
export async function getCurrentSlot(connection: Connection): Promise<number> {
  return await connection.getSlot();
}

/**
 * Wait for a specific number of slots to pass.
 * This is useful for waiting for confirmations.
 */
export async function waitForSlots(
  connection: Connection,
  slots: number
): Promise<void> {
  const startSlot = await connection.getSlot();
  const targetSlot = startSlot + slots;

  while (true) {
    const currentSlot = await connection.getSlot();
    if (currentSlot >= targetSlot) {
      return;
    }
    await sleep(MS_PER_SLOT);
  }
}

/**
 * Wait for a specific amount of time (real time).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a specific timestamp to be reached.
 * Useful when testing with warp-to-timestamp on local validator.
 */
export async function waitForTimestamp(
  connection: Connection,
  targetTimestamp: number,
  timeoutMs: number = 60000
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    const currentTimestamp = await getCurrentTimestamp(connection);
    if (currentTimestamp >= targetTimestamp) {
      return;
    }

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for timestamp ${targetTimestamp}`);
    }

    await sleep(500);
  }
}

// ============================================================
// Time Calculation Helpers
// ============================================================

/**
 * Calculate timestamp N seconds in the future.
 */
export function futureTimestamp(nowSeconds: number, secondsAhead: number): number {
  return nowSeconds + secondsAhead;
}

/**
 * Calculate timestamp N seconds in the past.
 */
export function pastTimestamp(nowSeconds: number, secondsAgo: number): number {
  return nowSeconds - secondsAgo;
}

/**
 * Get the start of the current day (UTC midnight).
 */
export function startOfDay(timestamp: number): number {
  return Math.floor(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

/**
 * Get the start of the current week (Sunday UTC midnight).
 */
export function startOfWeek(timestamp: number): number {
  const dayOfWeek = Math.floor(timestamp / SECONDS_PER_DAY) % 7;
  return startOfDay(timestamp) - dayOfWeek * SECONDS_PER_DAY;
}

/**
 * Get the day number since epoch (useful for daily resets).
 */
export function getDayNumber(timestamp: number): number {
  return Math.floor(timestamp / SECONDS_PER_DAY);
}

/**
 * Get the week number since epoch.
 */
export function getWeekNumber(timestamp: number): number {
  return Math.floor(timestamp / SECONDS_PER_WEEK);
}

/**
 * Check if two timestamps are on the same day.
 */
export function isSameDay(timestamp1: number, timestamp2: number): boolean {
  return getDayNumber(timestamp1) === getDayNumber(timestamp2);
}

/**
 * Check if timestamp is within a time window.
 */
export function isWithinWindow(
  timestamp: number,
  windowStart: number,
  windowEnd: number
): boolean {
  return timestamp >= windowStart && timestamp < windowEnd;
}

// ============================================================
// Game Time Helpers
// ============================================================

/**
 * Calculate travel arrival time.
 */
export function calculateArrivalTime(
  departureTime: number,
  distance: number,
  speed: number
): number {
  const travelSeconds = Math.ceil(distance / speed);
  return departureTime + travelSeconds;
}

/**
 * Calculate research completion time.
 */
export function calculateResearchCompletionTime(
  startTime: number,
  baseDuration: number,
  speedBonusBps: number = 0
): number {
  const effectiveDuration = Math.ceil(
    baseDuration * (10000 - speedBonusBps) / 10000
  );
  return startTime + effectiveDuration;
}

/**
 * Calculate stamina regeneration.
 */
export function calculateStaminaRegen(
  lastUpdate: number,
  currentTime: number,
  regenPerHour: number,
  maxStamina: number,
  currentStamina: number
): number {
  const hoursPassed = (currentTime - lastUpdate) / SECONDS_PER_HOUR;
  const regenAmount = Math.floor(hoursPassed * regenPerHour);
  return Math.min(maxStamina, currentStamina + regenAmount);
}

/**
 * Check if daily reset has occurred between two timestamps.
 */
export function hasDailyReset(
  oldTimestamp: number,
  newTimestamp: number,
  resetHourUtc: number = 0
): boolean {
  const oldDay = Math.floor((oldTimestamp - resetHourUtc * SECONDS_PER_HOUR) / SECONDS_PER_DAY);
  const newDay = Math.floor((newTimestamp - resetHourUtc * SECONDS_PER_HOUR) / SECONDS_PER_DAY);
  return newDay > oldDay;
}

// ============================================================
// Protection & Cooldown Helpers
// ============================================================

/**
 * Check if new player protection is active.
 */
export function isProtectionActive(
  protectionUntil: BN | number,
  currentTime: number
): boolean {
  const protectionEnd = typeof protectionUntil === 'number'
    ? protectionUntil
    : protectionUntil.toNumber();
  return currentTime < protectionEnd;
}

/**
 * Calculate cooldown remaining.
 */
export function getCooldownRemaining(
  cooldownEnd: BN | number,
  currentTime: number
): number {
  const endTime = typeof cooldownEnd === 'number'
    ? cooldownEnd
    : cooldownEnd.toNumber();
  return Math.max(0, endTime - currentTime);
}

/**
 * Check if action is on cooldown.
 */
export function isOnCooldown(
  cooldownEnd: BN | number,
  currentTime: number
): boolean {
  return getCooldownRemaining(cooldownEnd, currentTime) > 0;
}

// ============================================================
// Time-of-Day Helpers (Game Mechanics)
// ============================================================

/**
 * Get hour of day (0-23) from timestamp.
 */
export function getHourOfDay(timestamp: number): number {
  return Math.floor(timestamp / SECONDS_PER_HOUR) % 24;
}

/**
 * Check if it's night time (for combat bonuses).
 * Night is defined as 20:00 - 06:00 UTC.
 */
export function isNightTime(timestamp: number): boolean {
  const hour = getHourOfDay(timestamp);
  return hour >= 20 || hour < 6;
}

/**
 * Check if it's peak hours (for encounter spawns).
 * Peak is defined as 12:00 - 22:00 UTC.
 */
export function isPeakHours(timestamp: number): boolean {
  const hour = getHourOfDay(timestamp);
  return hour >= 12 && hour < 22;
}

/**
 * Get time-of-day combat modifier in basis points.
 */
export function getTimeOfDayCombatModifier(timestamp: number): number {
  if (isNightTime(timestamp)) {
    return 1500; // +15% attacker bonus at night
  }
  return 0;
}

// ============================================================
// Local Validator Clock Control
// ============================================================

/**
 * Instructions for warping time on local validator.
 * These require running solana-test-validator with --warp-slot or similar.
 *
 * Usage:
 * 1. Start validator: solana-test-validator
 * 2. Warp to slot: solana validator warp --slot <target_slot>
 *
 * Note: Direct clock manipulation is not supported via RPC.
 * For comprehensive time testing, consider:
 * - Using a mock clock in your program
 * - Running separate test scenarios at different times
 * - Using the validator's warp functionality
 */
export const CLOCK_CONTROL_NOTES = `
For time-based testing:
1. Use waitForSlots() to wait for real time to pass
2. Use timestamps from the test setup for relative calculations
3. For comprehensive testing, run the validator with time warping:
   solana-test-validator --warp-slot <slot>
`;
