/**
 * Time Manipulation Utilities
 *
 * Helpers for testing time-based game mechanics.
 * Uses LiteSVM's deterministic clock manipulation.
 */

import BN from 'bn.js';
import { type LiteSVM, Clock } from './svm';

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
 * Get current Unix timestamp from LiteSVM clock.
 */
export async function getCurrentTimestamp(svm: LiteSVM): Promise<number> {
  return Number(svm.getClock().unixTimestamp);
}

/**
 * Get current slot from LiteSVM clock.
 */
export async function getCurrentSlot(svm: LiteSVM): Promise<number> {
  return Number(svm.getClock().slot);
}

/**
 * Advance the clock by N slots. Instant with LiteSVM.
 */
export async function waitForSlots(
  svm: LiteSVM,
  slots: number
): Promise<void> {
  const clock = svm.getClock();
  svm.warpToSlot(clock.slot + BigInt(slots));
  svm.expireBlockhash();
}

/**
 * Wait for a specific amount of time (real time).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Warp the clock to a specific timestamp. Instant with LiteSVM.
 */
export async function waitForTimestamp(
  svm: LiteSVM,
  targetTimestamp: number,
): Promise<void> {
  const clock = svm.getClock();
  const newClock = new Clock(
    clock.slot,
    clock.epochStartTimestamp,
    clock.epoch,
    clock.leaderScheduleEpoch,
    BigInt(targetTimestamp),
  );
  svm.setClock(newClock);
  svm.expireBlockhash();
}

/**
 * Advance the clock by N seconds. Instant with LiteSVM.
 */
export async function advanceTime(
  svm: LiteSVM,
  seconds: number
): Promise<void> {
  const clock = svm.getClock();
  const newClock = new Clock(
    clock.slot + BigInt(Math.ceil(seconds * SLOTS_PER_SECOND)),
    clock.epochStartTimestamp,
    clock.epoch,
    clock.leaderScheduleEpoch,
    clock.unixTimestamp + BigInt(seconds),
  );
  svm.setClock(newClock);
  svm.expireBlockhash();
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
