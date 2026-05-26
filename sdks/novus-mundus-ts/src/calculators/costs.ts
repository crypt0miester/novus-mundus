/**
 * Cost Calculators
 *
 * Unit hiring, upgrade, and various cost calculations.
 */

import {
  PHI,
  PHI_SQUARED,
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
 * Calculate equipment purchase cost with the time-of-day multiplier.
 *
 * The multiplier is applied DIRECTLY — matching the on-chain
 * purchase_equipment.rs (`base_total_cost * cost_multiplier`): purchasing is
 * dearest at Midday (1.618×) and cheapest at DeepNight / Evening (0.618×).
 * It is NOT inverted.
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
  const costMultiplier = getActivityMultiplier(ActivityType.Purchasing, timeOfDay);

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
 * NOVI cost to research a node at a given level.
 *
 * Mirrors the on-chain `ResearchTemplate::calculate_novi_cost` exactly —
 * `exp_growth(baseCost, 5, 4, level)`: baseCost compounded by ×1.25 per
 * level, floored at every step (matching the program's integer math). Using
 * a different factor here would let the UI show a cost lower than the chain
 * actually charges, producing a false "you can afford it".
 *
 * @param baseCost - Template base NOVI cost (level-1 base)
 * @param researchLevel - Target research level
 * @returns Cost to research that level
 */
export function calculateResearchCost(
  baseCost: number,
  researchLevel: number,
): number {
  let cost = Math.floor(baseCost);
  for (let i = 0; i < researchLevel; i++) {
    cost = Math.floor((cost * 5) / 4);
  }
  return cost;
}

// Building Costs

/**
 * NOVI cost of a building action at `level` — mirrors the on-chain
 * BuildingTemplate per-step integer-floor formula exactly.
 *
 * `level = 0` -> base cost (a new build). An upgrade from level L pays
 * `base x (costGrowthBps / 10_000)^L`, flooring after every step. BigInt is
 * used for the intermediate product so high levels stay precise.
 *
 * @param baseCost - Template base NOVI cost
 * @param level - Building's current level (0 for a fresh build)
 * @param costGrowthBps - Per-level growth in bps of 10_000 (26_180 = x2.618)
 * @returns NOVI cost
 */
export function calculateBuildingCost(
  baseCost: number,
  level: number,
  costGrowthBps: number = 26180
): number {
  let cost = BigInt(Math.trunc(baseCost));
  const num = BigInt(Math.trunc(costGrowthBps));
  for (let i = 0; i < level; i++) {
    cost = (cost * num) / 10000n;
  }
  return Number(cost);
}

/**
 * Construction time in seconds for a building action at `level`.
 * Time scales once per 5 levels (slower than cost).
 *
 * @param baseSeconds - Template base construction time
 * @param level - Building's current level (0 for a fresh build)
 * @param timeGrowthBps - Per-(level/5) growth in bps of 10_000
 * @returns Construction time in seconds
 */
export function calculateBuildingTime(
  baseSeconds: number,
  level: number,
  timeGrowthBps: number = 26180
): number {
  let time = BigInt(Math.trunc(baseSeconds));
  const num = BigInt(Math.trunc(timeGrowthBps));
  const steps = Math.floor(level / 5);
  for (let i = 0; i < steps; i++) {
    time = (time * num) / 10000n;
  }
  return Number(time);
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
 *
 * @deprecated Use {@link calculateFinalShopPrice} instead — this helper
 * only applies one layer of discount, while the chain stacks subscription,
 * milestone, streak, fib, and market discounts multiplicatively. Kept for
 * backwards-compat with older call sites; new code should pass the full
 * layered context.
 */
export function calculateShopPrice(
  basePrice: number,
  subscriptionTier: number,
  tierDiscountBps: number[]
): number {
  const discount = tierDiscountBps[Math.min(subscriptionTier, tierDiscountBps.length - 1)];
  return discount ? applyBpsPenalty(basePrice, discount) : basePrice;
}

/**
 * Subscription-tier discount basis points. Mirrors the hardcoded table in
 * `programs/novus_mundus/src/processor/shop/common.rs::calculate_subscription_discount`.
 * Index by tier: 0=No Charter, 1=Rookie, 2=Expert, 3=Epic, 4=Legendary.
 */
export const SUBSCRIPTION_DISCOUNT_BPS = [0, 500, 1000, 1500, 2500] as const;

export function subscriptionDiscountBps(tier: number): number {
  if (tier < 0 || tier >= SUBSCRIPTION_DISCOUNT_BPS.length) return 0;
  return SUBSCRIPTION_DISCOUNT_BPS[tier]!;
}

/**
 * ShopConfig-derived milestone tier bps for a given lifetime spend.
 * Mirrors `calculate_milestone_discount` in
 * programs/novus_mundus/src/processor/shop/common.rs.
 *
 * Thresholds are u64 on chain and arrive here as BN values. We use BN's
 * own `gte` for comparison so the chain-side bucketing matches exactly
 * regardless of value magnitude (no JS Number truncation).
 */
import type BN from 'bn.js';

export interface ShopConfigForMilestone {
  bronzeThreshold: BN;
  silverThreshold: BN;
  goldThreshold: BN;
  platinumThreshold: BN;
  diamondThreshold: BN;
  bronzeDiscountBps: number;
  silverDiscountBps: number;
  goldDiscountBps: number;
  platinumDiscountBps: number;
  diamondDiscountBps: number;
}

export function milestoneDiscountBps(
  totalSpent: BN,
  config: ShopConfigForMilestone,
): number {
  if (totalSpent.gte(config.diamondThreshold)) return config.diamondDiscountBps;
  if (totalSpent.gte(config.platinumThreshold)) return config.platinumDiscountBps;
  if (totalSpent.gte(config.goldThreshold)) return config.goldDiscountBps;
  if (totalSpent.gte(config.silverThreshold)) return config.silverDiscountBps;
  if (totalSpent.gte(config.bronzeThreshold)) return config.bronzeDiscountBps;
  return 0;
}

/**
 * ShopConfig-derived loyalty-streak bps. Mirrors `calculate_streak_discount`
 * in shop/common.rs (streak buckets: 7+, 5-6, 3-4, 2, <2).
 */
export interface ShopConfigForStreak {
  streakDay2Bps: number;
  streakDay3Bps: number;
  streakDay5Bps: number;
  streakDay7Bps: number;
}
export function streakDiscountBps(streak: number, config: ShopConfigForStreak): number {
  if (streak >= 7) return config.streakDay7Bps;
  if (streak >= 5) return config.streakDay5Bps;
  if (streak >= 3) return config.streakDay3Bps;
  if (streak >= 2) return config.streakDay2Bps;
  return 0;
}

/**
 * ShopConfig-derived fibonacci-bonus bps for consecutive same-day purchases.
 * Mirrors `calculate_fib_bonus` in shop/common.rs.
 */
export interface ShopConfigForFib {
  maxFibDiscountBps: number;
}
export function fibDiscountBps(
  dailyPurchaseCount: number,
  config: ShopConfigForFib,
): number {
  let base: number;
  if (dailyPurchaseCount >= 6) base = 800;
  else if (dailyPurchaseCount === 5) base = 500;
  else if (dailyPurchaseCount === 4) base = 300;
  else if (dailyPurchaseCount === 3) base = 200;
  else if (dailyPurchaseCount === 2) base = 100;
  else base = 0;
  return Math.min(base, config.maxFibDiscountBps);
}

export interface ShopPriceContext {
  /** Base discount applied first — usually a flash-sale or daily-deal discount. */
  baseDiscountBps?: number;
  /** Bundle-specific discount (only for bundle purchases). */
  bundleDiscountBps?: number;
  /** Fibonacci same-day-purchase bonus from ShopConfig. */
  fibDiscountBps?: number;
  /** Subscription tier (0-4) — looked up via {@link subscriptionDiscountBps}. */
  subscriptionTier?: number;
  /** Milestone tier bps (cumulative-spend bucket from ShopConfig). */
  milestoneDiscountBps?: number;
  /** Loyalty streak bps from ShopConfig. */
  loyaltyDiscountBps?: number;
  /** Market building + daily-mini-game bonus, summed. */
  marketDiscountBps?: number;
  /** ShopConfig.max_total_discount_bps — caps how far the layers can stack. */
  maxTotalDiscountBps?: number;
}

/**
 * Mirror of `programs/novus_mundus/src/processor/shop/common.rs::calculate_final_price`.
 *
 * Stacks discount layers multiplicatively (each `value × (1 - bps/10000)`)
 * in the same order as chain — subscription, milestone, etc. are NOT
 * additive, so a 10% sub + 6% milestone is not 16% off, it's
 * (1 - 0.10) × (1 - 0.06) = 15.4% off. The final price is floored at
 * `basePrice × (1 - maxTotalDiscountBps/10000)`, then `max(1)`.
 *
 * Use for any UI preview that wants to match what the chain will actually
 * charge — strike-through prices, "you save X" labels, etc.
 */
export function calculateFinalShopPrice(
  basePrice: number,
  ctx: ShopPriceContext,
): number {
  let price = basePrice;
  price = applyBpsPenalty(price, ctx.baseDiscountBps ?? 0);
  price = applyBpsPenalty(price, ctx.bundleDiscountBps ?? 0);
  price = applyBpsPenalty(price, ctx.fibDiscountBps ?? 0);
  price = applyBpsPenalty(price, subscriptionDiscountBps(ctx.subscriptionTier ?? 0));
  price = applyBpsPenalty(price, ctx.milestoneDiscountBps ?? 0);
  price = applyBpsPenalty(price, ctx.loyaltyDiscountBps ?? 0);
  price = applyBpsPenalty(price, ctx.marketDiscountBps ?? 0);
  const minPrice =
    ctx.maxTotalDiscountBps != null
      ? applyBpsPenalty(basePrice, ctx.maxTotalDiscountBps)
      : 0;
  return Math.max(price, minPrice, 1);
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
