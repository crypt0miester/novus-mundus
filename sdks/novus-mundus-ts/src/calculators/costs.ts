/**
 * Cost Calculators
 *
 * Unit hiring, upgrade, and various cost calculations.
 */

import {
  PHI,
  PHI_SQUARED,
  GOLDEN_ROOT,
  applyBps,
  applyBpsPenalty,
  NOVI_BASE_MULTIPLIER,
  NOVI_GOLDEN_MULTIPLIER,
} from './constants';
import { getActivityMultiplier, TimeOfDay, ActivityType, getCurrentTimeOfDay } from './time';

// Unit Hiring Costs

/** Base hiring costs by unit type */
export interface UnitHiringCosts {
  defensiveUnit1Cost: number;
  defensiveUnit2Cost: number;
  defensiveUnit3Cost: number;
  operativeUnit1Cost: number;
  operativeUnit2Cost: number;
  operativeUnit3Cost: number;
}

/**
 * Calculate unit hiring cost with time bonus.
 *
 * Hiring is best during day (more workers available).
 * Midday provides φ (1.618x) discount (inverted = lower cost).
 * Night provides penalty (higher cost).
 *
 * @param baseCost - Base cost per unit
 * @param quantity - Number of units to hire
 * @param timestamp - Current unix timestamp
 * @param longitude - Player longitude for time calculation
 * @param discountBps - Discount in basis points (optional)
 * @returns Total cost with time adjustment
 */
export function calculateHiringCost(
  baseCost: number,
  quantity: number,
  timestamp: number,
  longitude: number,
  discountBps: number = 0
): number {
  // Get time-of-day multiplier (higher = better for hiring)
  // We invert this for cost: better time = lower cost
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const hiringMultiplier = getActivityMultiplier(ActivityType.Hiring, timeOfDay);

  // Invert multiplier for cost: 1 / multiplier
  // Midday: 1/1.618 = 0.618 (38% discount)
  // DeepNight: 1/0.382 = 2.618 (162% premium)
  const costMultiplier = 1 / hiringMultiplier;

  let totalCost = Math.floor(baseCost * quantity * costMultiplier);

  // Apply discount if present
  if (discountBps > 0) {
    totalCost = applyBpsPenalty(totalCost, discountBps);
  }

  return totalCost;
}

/**
 * Calculate total hiring cost for multiple unit types.
 *
 * @param quantities - Number of each unit type to hire [du1, du2, du3, op1, op2, op3]
 * @param costs - Base costs for each unit type
 * @param timestamp - Current unix timestamp
 * @param longitude - Player longitude
 * @param discountBps - Global discount in basis points
 * @returns Total cost for all units
 */
export function calculateTotalHiringCost(
  quantities: [number, number, number, number, number, number],
  costs: UnitHiringCosts,
  timestamp: number,
  longitude: number,
  discountBps: number = 0
): number {
  const costArray = [
    costs.defensiveUnit1Cost,
    costs.defensiveUnit2Cost,
    costs.defensiveUnit3Cost,
    costs.operativeUnit1Cost,
    costs.operativeUnit2Cost,
    costs.operativeUnit3Cost,
  ];

  let total = 0;
  for (let i = 0; i < 6; i++) {
    const qty = quantities[i] ?? 0;
    const cost = costArray[i] ?? 0;
    if (qty > 0 && cost > 0) {
      total += calculateHiringCost(cost, qty, timestamp, longitude, discountBps);
    }
  }

  return total;
}

// Purchase Costs

/**
 * Calculate equipment purchase cost with time bonus.
 *
 * Purchasing follows same pattern as hiring - better during day.
 *
 * @param baseCost - Base cost per item
 * @param quantity - Number of items to purchase
 * @param timestamp - Current unix timestamp
 * @param longitude - Player longitude
 * @param discountBps - Discount in basis points
 * @returns Total cost
 */
export function calculatePurchaseCost(
  baseCost: number,
  quantity: number,
  timestamp: number,
  longitude: number,
  discountBps: number = 0
): number {
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const multiplier = getActivityMultiplier(ActivityType.Purchasing, timeOfDay);
  const costMultiplier = 1 / multiplier;

  let totalCost = Math.floor(baseCost * quantity * costMultiplier);

  if (discountBps > 0) {
    totalCost = applyBpsPenalty(totalCost, discountBps);
  }

  return totalCost;
}

// Upgrade Costs

/**
 * Calculate building upgrade cost.
 *
 * Matches Rust: cost = baseCost × (φ²)^currentLevel
 * Uses integer approximation matching on-chain: multiply by 2618, divide by 1000 per level.
 *
 * @param baseCost - Base cost for the building type
 * @param currentLevel - Current building level (0 = first upgrade costs baseCost)
 * @param scalingFactor - Scaling factor per level (default φ² = 2.618)
 * @returns Cost to upgrade to next level
 */
export function calculateUpgradeCost(
  baseCost: number,
  currentLevel: number,
  scalingFactor: number = PHI_SQUARED
): number {
  let cost = baseCost;
  for (let i = 0; i < currentLevel; i++) {
    cost = Math.floor(cost * scalingFactor);
  }
  return cost;
}

/**
 * Calculate cumulative upgrade cost (total cost to upgrade from level 1 to targetLevel).
 *
 * Level 1 is the post-construction baseline state; upgrades start from there.
 *
 * @param baseCost - Base cost for the building type
 * @param targetLevel - Target level to reach
 * @param scalingFactor - Scaling factor per level
 * @returns Total upgrade cost from level 1 to targetLevel (0 if already at or above target)
 */
export function calculateCumulativeUpgradeCost(
  baseCost: number,
  targetLevel: number,
  scalingFactor: number = PHI_SQUARED
): number {
  let total = 0;
  for (let level = 1; level < targetLevel; level++) {
    total += calculateUpgradeCost(baseCost, level, scalingFactor);
  }
  return total;
}

/**
 * Calculate research cost.
 *
 * @param baseCost - Base cost for this research
 * @param researchLevel - Current research level
 * @param scalingFactor - Scaling factor per level (default √φ = 1.272)
 * @returns Cost to research next level
 */
export function calculateResearchCost(
  baseCost: number,
  researchLevel: number,
  scalingFactor: number = GOLDEN_ROOT
): number {
  return Math.floor(baseCost * Math.pow(scalingFactor, researchLevel));
}

// NOVI Costs

/**
 * Calculate NOVI consumption cost for power.
 *
 * NOVI converts to power at a rate based on game config.
 * Uses golden ratio multiplier for premium conversion.
 *
 * @param noviAmount - Amount of NOVI to consume
 * @param useGoldenMultiplier - Whether to use golden multiplier (premium)
 * @returns Power gained from NOVI consumption
 */
export function calculateNoviToPower(
  noviAmount: number,
  useGoldenMultiplier: boolean = false
): number {
  const multiplier = useGoldenMultiplier ? NOVI_GOLDEN_MULTIPLIER : NOVI_BASE_MULTIPLIER;
  return Math.floor(noviAmount * multiplier);
}

/**
 * Calculate NOVI required for desired power.
 *
 * @param desiredPower - Power amount needed
 * @param useGoldenMultiplier - Whether using golden multiplier
 * @returns NOVI required
 */
export function calculateNoviRequired(
  desiredPower: number,
  useGoldenMultiplier: boolean = false
): number {
  const multiplier = useGoldenMultiplier ? NOVI_GOLDEN_MULTIPLIER : NOVI_BASE_MULTIPLIER;
  return Math.ceil(desiredPower / multiplier);
}

// Speedup Costs

// Note: calculateSpeedupCost and calculateTimeReduced are exported from travel.ts

/**
 * Calculate partial speedup - how many gems to skip a specific time.
 *
 * @param secondsToSkip - Seconds to skip
 * @param gemCostPerMinute - Gem cost per minute
 * @returns Gems required
 */
export function calculatePartialSpeedupCost(
  secondsToSkip: number,
  gemCostPerMinute: number
): number {
  const minutesToSkip = Math.ceil(secondsToSkip / 60);
  return minutesToSkip * gemCostPerMinute;
}

// Subscription Costs

/** Subscription tier configuration */
export interface SubscriptionTierConfigCosts {
  priceUsdc: number;
  priceNovi: number;
  durationDays: number;
}

/**
 * Calculate subscription cost per day.
 *
 * @param tierConfig - Subscription tier configuration
 * @param payInNovi - Whether paying in NOVI (vs USDC)
 * @returns Cost per day
 */
export function calculateSubscriptionCostPerDay(
  tierConfig: SubscriptionTierConfigCosts,
  payInNovi: boolean
): number {
  const price = payInNovi ? tierConfig.priceNovi : tierConfig.priceUsdc;
  return price / tierConfig.durationDays;
}

// Tax and Fee Calculations

/**
 * Calculate attack tax based on resources looted.
 *
 * @param lootedAmount - Amount of resources looted
 * @param taxBps - Tax rate in basis points
 * @returns Tax amount
 */
export function calculateAttackTax(lootedAmount: number, taxBps: number): number {
  return applyBps(lootedAmount, taxBps);
}

/**
 * Calculate shop item cost with subscription discount.
 *
 * @param basePrice - Base item price
 * @param subscriptionTier - Player's subscription tier (0-3)
 * @param tierDiscountBps - Discount per tier in basis points
 * @returns Final price
 */
export function calculateShopPrice(
  basePrice: number,
  subscriptionTier: number,
  tierDiscountBps: number[]
): number {
  const discount = tierDiscountBps[Math.min(subscriptionTier, tierDiscountBps.length - 1)];
  return discount ? applyBpsPenalty(basePrice, discount) : basePrice;
}

// Cost Display Helpers

/**
 * Format cost with time bonus indicator.
 *
 * @param baseCost - Base cost
 * @param actualCost - Actual cost after time bonus
 * @returns Formatted string with bonus indicator
 */
export function formatCostWithBonus(baseCost: number, actualCost: number): string {
  const ratio = actualCost / baseCost;

  if (ratio < 0.95) {
    // Discount
    const discount = Math.round((1 - ratio) * 100);
    return `${actualCost.toLocaleString()} (-${discount}%)`;
  } else if (ratio > 1.05) {
    // Premium
    const premium = Math.round((ratio - 1) * 100);
    return `${actualCost.toLocaleString()} (+${premium}%)`;
  }

  return actualCost.toLocaleString();
}

/**
 * Get time bonus description for costs.
 *
 * @param timeOfDay - Current time of day
 * @returns Description of the time bonus/penalty
 */
export function getCostTimeBonusDescription(timeOfDay: TimeOfDay): string {
  const multiplier = getActivityMultiplier(ActivityType.Hiring, timeOfDay);
  const costMultiplier = 1 / multiplier;

  if (costMultiplier < 0.7) {
    return 'Peak hours - Best prices!';
  } else if (costMultiplier < 0.95) {
    return 'Good time for purchases';
  } else if (costMultiplier > 1.5) {
    return 'Off-peak - Higher prices';
  } else if (costMultiplier > 1.05) {
    return 'Slight price increase';
  }

  return 'Normal prices';
}

// Troop Recovery Costs (Infirmary)

/** Recovery cost discount: 50% of normal hire cost */
const RECOVERY_COST_DISCOUNT_BPS = 5000;

/**
 * Calculate cost to recover wounded troops from Infirmary.
 *
 * Cost = base_hire_cost × 50% × (1 - infirmary_level_discount) × (1 - daily_buff_discount)
 *
 * @param baseUnitCost - Base hiring cost for the unit type
 * @param infirmaryRecoveryBps - Infirmary level discount (25 bps per level)
 * @param infirmaryDailyBps - Daily Infirmary buff discount
 * @param amount - Number of units to recover
 * @returns Total NOVI cost
 */
export function calculateRecoveryCost(
  baseUnitCost: number,
  infirmaryRecoveryBps: number,
  infirmaryDailyBps: number,
  amount: number
): number {
  // 50% base discount
  let perUnit = applyBps(baseUnitCost, RECOVERY_COST_DISCOUNT_BPS);

  // Infirmary level discount
  if (infirmaryRecoveryBps > 0) {
    perUnit = perUnit * (10000 - infirmaryRecoveryBps) / 10000;
  }

  // Daily buff discount
  if (infirmaryDailyBps > 0) {
    perUnit = perUnit * (10000 - infirmaryDailyBps) / 10000;
  }

  return Math.max(1, Math.floor(perUnit)) * amount;
}
