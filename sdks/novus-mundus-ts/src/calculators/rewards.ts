/**
 * Reward Calculators
 *
 * Loot pools, XP rewards, daily rewards, and fragment/gem calculations.
 */

import {
  GOLDEN_ROOT,
  applyBps,
  chainBps,
} from './constants';
import { getActivityMultiplier, TimeOfDay, ActivityType } from './time';

// Oscillation Multiplier

/**
 * Calculate oscillating multiplier for encounter rewards.
 *
 * Uses deterministic sine wave based on:
 * - Current timestamp (when encounter dies)
 * - Encounter spawn time (phase shift - prevents manipulation)
 * - Encounter ID (additional entropy)
 * - Rarity-based frequency and amplitude
 *
 * @param currentTime - Current unix timestamp
 * @param spawnTime - When the encounter spawned
 * @param encounterId - Unique encounter ID
 * @param frequency - Oscillation frequency
 * @param amplitudeBp - Oscillation amplitude in basis points
 * @returns Multiplier in basis points (10000 = 1.0x)
 */
export function calculateOscillationMultiplier(
  currentTime: number,
  spawnTime: number,
  encounterId: number,
  frequency: number,
  amplitudeBp: number
): number {
  // Phase shift based on spawn time + encounter ID
  const phaseShift = spawnTime / 1000 + encounterId / 100;

  // Calculate oscillation: sin(time * frequency * 2π + phase)
  const time = currentTime / 1000 + phaseShift;
  const oscillation = Math.sin(time * frequency * 2 * Math.PI);

  // Map oscillation [-1, 1] to [base - amplitude, base + amplitude]
  const deviation = Math.floor(oscillation * amplitudeBp);
  const multiplier = 10000 + deviation;

  // Clamp to reasonable range (0.2x to 2.0x)
  return Math.max(2000, Math.min(20000, multiplier));
}

// Level Scaling

/**
 * Calculate level scaling multiplier (exponential growth).
 *
 * Formula: (level ^ exponent) / divisor
 *
 * @param level - Encounter or entity level
 * @param scalingExp - Exponent for scaling (default 1.5)
 * @param scalingDivisor - Divisor for scaling (default 10)
 * @returns Multiplier in basis points (10000 = 1.0x)
 *
 * @example
 * ```ts
 * calculateLevelMultiplier(1, 1.5, 10);  // ~1000 bp (0.1x)
 * calculateLevelMultiplier(50, 1.5, 10); // ~353500 bp (35.35x)
 * calculateLevelMultiplier(100, 1.5, 10); // ~1000000 bp (100x)
 * ```
 */
export function calculateLevelMultiplier(
  level: number,
  scalingExp: number = 1.5,
  scalingDivisor: number = 10
): number {
  if (level === 0 || scalingDivisor === 0) {
    return 10000; // 1.0x fallback
  }

  const scaled = Math.pow(level, scalingExp);
  const multiplierF = scaled / scalingDivisor;

  // Convert to basis points (1.0 = 10000)
  return Math.floor(multiplierF * 10000);
}

// Novi Award Determination

/**
 * Determine if Novi should be awarded (Deterministic System).
 *
 * Uses golden ratio family for deterministic thresholds based on level + rarity.
 * No randomness - higher level + rarity = guaranteed Novi above thresholds.
 *
 * Thresholds:
 * - Level >= 61 AND rarity >= 3 (Epic): Always award Novi (φ² tier)
 * - Level >= 41 AND rarity >= 2 (Rare): Always award Novi (φ tier)
 * - Level >= 21 AND rarity >= 1 (Uncommon): Award Novi (√φ tier)
 *
 * @param level - Entity level
 * @param rarity - Entity rarity (0-4)
 * @returns true if Novi should be awarded
 */
export function shouldAwardNovi(level: number, rarity: number): boolean {
  // φ² tier (Legendary/Epic at high levels)
  if (level >= 61 && rarity >= 3) {
    return true;
  }

  // φ tier (Rare+ at mid-high levels)
  if (level >= 41 && rarity >= 2) {
    return true;
  }

  // √φ tier (Uncommon+ at mid levels)
  if (level >= 21 && rarity >= 1) {
    return true;
  }

  return false;
}

// Reward Type Count

/**
 * Determine number of reward types based on level (Deterministic).
 *
 * - Level 1-5: 1 type (cash only)
 * - Level 6-15: 2 types (cash + produce)
 * - Level 16-30: 3 types (cash + produce + weapons)
 * - Level 31-50: 4 types
 * - Level 51+: 5 types (all types)
 */
export function calculateRewardTypeCount(level: number): number {
  if (level < 6) return 1;
  if (level < 16) return 2;
  if (level < 31) return 3;
  if (level < 51) return 4;
  return 5;
}

/**
 * Determine which reward types to award (Deterministic).
 *
 * @param level - Entity level
 * @param awardNovi - Whether Novi should be awarded (from shouldAwardNovi)
 * @returns [awardProduce, awardWeapons, awardVehicles, awardNovi]
 */
export function determineRewardTypes(
  level: number,
  awardNovi: boolean
): [boolean, boolean, boolean, boolean] {
  const awardProduce = level >= 3;
  const awardWeapons = level >= 5;
  const awardVehicles = level >= 20;

  return [awardProduce, awardWeapons, awardVehicles, awardNovi];
}

// Fragment and Gem Awards

/**
 * Determine if fragments should be awarded (Deterministic).
 *
 * @param level - Entity level
 * @param rarity - Entity rarity (0-4)
 * @param hasFragmentDrops - Whether player has unlocked fragment drops via research
 * @returns true if fragments should be awarded
 */
export function shouldAwardFragments(
  level: number,
  rarity: number,
  hasFragmentDrops: boolean
): boolean {
  if (!hasFragmentDrops) {
    return false;
  }

  // φ² tier: High level + rare = guaranteed
  if (level >= 31 && rarity >= 2) return true;

  // φ tier: Mid level + uncommon = guaranteed
  if (level >= 16 && rarity >= 1) return true;

  // √φ tier: Any level with research unlock = fragments
  return true;
}

/**
 * Determine if gems should be awarded (Deterministic).
 *
 * Gems are rarer than fragments - require higher thresholds.
 */
export function shouldAwardGems(
  level: number,
  rarity: number,
  hasGemDrops: boolean
): boolean {
  if (!hasGemDrops) {
    return false;
  }

  // φ² tier: Very high level + epic/legendary
  if (level >= 71 && rarity >= 3) return true;

  // φ tier: High level + rare
  if (level >= 41 && rarity >= 2) return true;

  // √φ tier: Mid level + uncommon
  if (level >= 21 && rarity >= 1) return true;

  return false;
}

// Fragment and Gem Amounts

/**
 * Calculate fragment amount for loot (Deterministic).
 *
 * Uses golden ratio family for rarity scaling.
 * Base amounts scale with √φ per rarity tier.
 *
 * Base amounts by rarity (Fibonacci sequence):
 * - Common: 2 fragments
 * - Uncommon: 3 fragments
 * - Rare: 5 fragments
 * - Epic: 8 fragments
 * - Legendary: 13 fragments
 *
 * @param level - Entity level
 * @param rarity - Entity rarity (0-4)
 * @param synchronyBonusBps - Synchrony bonus in basis points
 * @param timeMult - Time-of-day multiplier (1.0 = baseline)
 * @returns Fragment amount
 */
export function calculateFragmentAmount(
  level: number,
  rarity: number,
  synchronyBonusBps: number = 0,
  timeMult: number = 1.0
): number {
  // Base amounts using Fibonacci sequence
  const baseByRarity = [2, 3, 5, 8, 13];
  const base = baseByRarity[Math.min(rarity, 4)] ?? 2;

  // Level scaling: √φ per 10 levels
  const levelExponent = level / 10;
  const levelMult = Math.pow(GOLDEN_ROOT, levelExponent);
  const levelMultBp = Math.floor(levelMult * 10000);

  // Synchrony bonus
  const synchronyMult = 10000 + synchronyBonusBps;

  // Time-of-day bonus
  const timeMultBp = Math.floor(timeMult * 10000);

  // Calculate final amount using chained multipliers
  return chainBps(base, [levelMultBp, synchronyMult, timeMultBp]);
}

/**
 * Calculate gem amount for loot (Deterministic).
 *
 * Uses Fibonacci sequence for base amounts (rarer than fragments).
 *
 * Base amounts by rarity:
 * - Common: 1 gem
 * - Uncommon: 2 gems
 * - Rare: 3 gems
 * - Epic: 5 gems
 * - Legendary: 8 gems
 *
 * Scaled by level using √φ per 20 levels (slower than fragments).
 */
export function calculateGemAmount(
  level: number,
  rarity: number,
  synchronyBonusBps: number = 0,
  timeMult: number = 1.0
): number {
  // Base amounts using Fibonacci sequence
  const baseByRarity = [1, 2, 3, 5, 8];
  const base = baseByRarity[Math.min(rarity, 4)] ?? 1;

  // Level scaling: √φ per 20 levels (slower than fragments)
  const levelExponent = level / 20;
  const levelMult = Math.pow(GOLDEN_ROOT, levelExponent);
  const levelMultBp = Math.floor(levelMult * 10000);

  // Synchrony bonus
  const synchronyMult = 10000 + synchronyBonusBps;

  // Time-of-day bonus
  const timeMultBp = Math.floor(timeMult * 10000);

  return chainBps(base, [levelMultBp, synchronyMult, timeMultBp]);
}

// Encounter Loot Pool

/** Loot pool for an encounter */
export interface EncounterLootPool {
  totalCash: number;
  totalNovi: number;
  totalWeapons: number;
  totalProduce: number;
  totalVehicles: number;
  totalFragments: number;
  totalGems: number;
}

/**
 * Calculate complete loot pool for an encounter.
 *
 * @param level - Encounter level
 * @param rarity - Encounter rarity (0-4)
 * @param spawnTime - When the encounter spawned
 * @param encounterId - Unique encounter ID
 * @param currentTime - Current unix timestamp
 * @param playerLongitude - Player longitude for time-of-day calculation
 * @param baseCash - Base cash by rarity array
 * @param baseNovi - Base novi by rarity array
 * @param baseWeapons - Base weapons by rarity array
 * @param baseProduce - Base produce by rarity array
 * @param baseVehicles - Base vehicles by rarity array
 * @param oscillationFreq - Oscillation frequency by rarity
 * @param oscillationAmp - Oscillation amplitude by rarity
 * @param lootLevelScalingExp - Level scaling exponent
 * @param lootLevelScalingDivisor - Level scaling divisor
 * @returns Encounter loot pool
 */
export function calculateEncounterLootPool(
  level: number,
  rarity: number,
  spawnTime: number,
  encounterId: number,
  currentTime: number,
  playerLongitude: number,
  baseCash: number[],
  baseNovi: number[],
  baseWeapons: number[],
  baseProduce: number[],
  baseVehicles: number[],
  oscillationFreq: number[],
  oscillationAmp: number[],
  lootLevelScalingExp: number = 1.5,
  lootLevelScalingDivisor: number = 10
): EncounterLootPool {
  const rarityIdx = Math.min(rarity, 4);

  // 1. Oscillation multiplier
  const oscMult = calculateOscillationMultiplier(
    currentTime,
    spawnTime,
    encounterId,
    oscillationFreq[rarityIdx] ?? 3600,
    oscillationAmp[rarityIdx] ?? 1000
  );

  // 2. Level scaling multiplier
  const levelMult = calculateLevelMultiplier(level, lootLevelScalingExp, lootLevelScalingDivisor);

  // 3. Time-of-day bonus
  const localTime = calculateLocalTimeFromTimestamp(currentTime, playerLongitude);
  const timeOfDay = getTimeOfDayFromLocalTime(localTime);
  const timeMult = getActivityMultiplier(ActivityType.LootDrop, timeOfDay);
  const timeMultBp = Math.floor(timeMult * 10000);

  // 4. Combined multiplier using chained basis points
  const combinedMult = chainBps(oscMult, [levelMult, timeMultBp]);

  // 5. Determine if Novi should be awarded
  const awardNovi = shouldAwardNovi(level, rarity);

  // 6. Determine which types to award
  const [awardProduce, awardWeapons, awardVehicles, finalAwardNovi] = determineRewardTypes(
    level,
    awardNovi
  );

  // 7. Apply multiplier to base rewards
  return {
    totalCash: applyBps(baseCash[rarityIdx] ?? 100, combinedMult),
    totalNovi: finalAwardNovi ? applyBps(baseNovi[rarityIdx] ?? 0, combinedMult) : 0,
    totalWeapons: awardWeapons ? applyBps(baseWeapons[rarityIdx] ?? 0, combinedMult) : 0,
    totalProduce: awardProduce ? applyBps(baseProduce[rarityIdx] ?? 0, combinedMult) : 0,
    totalVehicles: awardVehicles ? applyBps(baseVehicles[rarityIdx] ?? 0, combinedMult) : 0,
    totalFragments: 0, // Calculated separately based on player research
    totalGems: 0,
  };
}

/**
 * Check if a loot pool has any loot.
 */
export function lootPoolHasLoot(pool: EncounterLootPool): boolean {
  return (
    pool.totalCash > 0 ||
    pool.totalNovi > 0 ||
    pool.totalWeapons > 0 ||
    pool.totalProduce > 0 ||
    pool.totalVehicles > 0 ||
    pool.totalFragments > 0 ||
    pool.totalGems > 0
  );
}

// XP Rewards

/** Actions that grant XP */
export enum XpAction {
  DefeatPlayer = 0,
  DefeatEncounter = 1,
  CompleteTravel = 2,
  CollectResources = 3,
}

/**
 * Calculate XP reward for an action.
 *
 * @param action - The XP action type
 * @param value - Context value (target level, rarity, distance km, amount)
 * @returns XP reward amount
 */
export function calculateXpReward(action: XpAction, value: number): number {
  switch (action) {
    case XpAction.DefeatPlayer:
      // More XP for defeating higher-level players
      return 50 + value * 10;
    case XpAction.DefeatEncounter:
      // XP scales with encounter rarity
      const xpByRarity = [10, 25, 50, 100, 250, 500];
      return xpByRarity[Math.min(value, 5)] ?? 10;
    case XpAction.CompleteTravel:
      // 1 XP per km traveled
      return value;
    case XpAction.CollectResources:
      // 1 XP per 1000 resources collected
      return Math.floor(value / 1000);
    default:
      return 0;
  }
}

// Daily Rewards

/** Daily reward amounts */
export interface DailyRewards {
  cash: number;
  produce: number;
  xp: number;
}

/**
 * Calculate daily rewards with subscription tier multipliers.
 *
 * @param baseCash - Base cash reward
 * @param baseProduce - Base produce reward
 * @param baseXp - Base XP reward
 * @param tierMultiplierBps - Tier multiplier in basis points (10000 = 1.0x)
 * @returns Daily rewards with tier multipliers applied
 */
export function calculateDailyRewards(
  baseCash: number,
  baseProduce: number,
  baseXp: number,
  tierMultiplierBps: number
): DailyRewards {
  return {
    cash: applyBps(baseCash, tierMultiplierBps),
    produce: applyBps(baseProduce, tierMultiplierBps),
    xp: applyBps(baseXp, tierMultiplierBps),
  };
}

/**
 * Effective castle reward for `days`, mirroring on-chain `calculate_reward`
 * (state/castle.rs): `base × tierMult × (1 + treasuryLevel×10%) × days`.
 *
 * Castle per-day base rates are stored FLAT across tiers — the tier is expressed
 * entirely through `tierMultiplierBps` (0.25x Outpost → 2.0x Citadel), with a
 * further +10%/level treasury bonus. Kept in bigint to match the chain's u64
 * truncation exactly (NOVI is stored in deci units and rewards can be large).
 */
export function calculateCastleReward(
  baseRate: bigint,
  tierMultiplierBps: number,
  treasuryLevel: number,
  days: number,
): bigint {
  if (days <= 0) return 0n;
  // Tier multiplier first, then the +10%/level treasury bonus (truncating
  // integer division at each step, exactly as the on-chain u64 path does).
  const tierAdjusted = (baseRate * BigInt(tierMultiplierBps)) / 10000n;
  const treasuryBonusBps = BigInt(treasuryLevel) * 1000n;
  const withTreasury = (tierAdjusted * (10000n + treasuryBonusBps)) / 10000n;
  return withTreasury * BigInt(days);
}

// Helper Functions

/** Calculate local time from timestamp and longitude (0-999 scale) */
function calculateLocalTimeFromTimestamp(timestamp: number, longitude: number): number {
  const CYCLE_LENGTH = 86400;
  const TIME_PRECISION = 1000;

  const cyclePosition = ((timestamp % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
  let localTime = Math.floor((cyclePosition * TIME_PRECISION) / CYCLE_LENGTH);
  const longitudeOffset = Math.floor((longitude * TIME_PRECISION) / 360);
  localTime = ((localTime + longitudeOffset) % TIME_PRECISION + TIME_PRECISION) % TIME_PRECISION;

  return localTime;
}

/** Get TimeOfDay from local time value */
function getTimeOfDayFromLocalTime(localTime: number): TimeOfDay {
  if (localTime < 125) return TimeOfDay.DeepNight;
  if (localTime < 250) return TimeOfDay.Dawn;
  if (localTime < 375) return TimeOfDay.Morning;
  if (localTime < 625) return TimeOfDay.Midday;
  if (localTime < 750) return TimeOfDay.Afternoon;
  if (localTime < 875) return TimeOfDay.Dusk;
  return TimeOfDay.Evening;
}
