/**
 * NOVI Purchase Calculators
 *
 * Calculations for NOVI token purchases from the shop.
 * Matches the on-chain logic in processor/shop/purchase_novi.rs
 */

import BN from 'bn.js';
import type { NoviPurchaseConfig } from '../state/game-engine.ts';

// ============================================================
// Types
// ============================================================

/** NOVI purchase preview result */
export interface NoviPurchasePreview {
  /** Base NOVI amount (before bonuses) */
  baseAmount: BN;
  /** Bulk bonus amount */
  bulkBonus: BN;
  /** Subscription bonus amount */
  subscriptionBonus: BN;
  /** Streak bonus amount */
  streakBonus: BN;
  /** Total bonus amount (all bonuses combined) */
  totalBonus: BN;
  /** Total NOVI to receive (base + bonuses) */
  totalNovi: BN;
  /** Cost in lamports */
  costLamports: BN;
  /** Total bonus in basis points */
  totalBonusBps: number;
}

/** Streak calculation result */
export interface NoviStreakResult {
  /** Current streak day (1-7) */
  streakDay: number;
  /** Streak bonus in basis points */
  bonusBps: number;
  /** Is streak continuing (consecutive day) */
  isContinuing: boolean;
  /** Is streak resetting (broken) */
  isResetting: boolean;
}

// ============================================================
// Streak Calculations
// ============================================================

/**
 * Calculate NOVI purchase streak after a purchase.
 *
 * @param lastPurchaseDay - Last purchase day (day number since epoch)
 * @param currentStreak - Current streak count
 * @param currentTimestamp - Current unix timestamp
 * @returns Streak calculation result
 */
export function calculateNoviStreak(
  lastPurchaseDay: number,
  currentStreak: number,
  currentTimestamp: number
): NoviStreakResult {
  const currentDay = Math.floor(currentTimestamp / 86400);

  // Same day purchase - keep current streak
  if (lastPurchaseDay === currentDay) {
    return {
      streakDay: currentStreak,
      bonusBps: getStreakBonusBps(currentStreak),
      isContinuing: true,
      isResetting: false,
    };
  }

  // Consecutive day - increment streak (max 7)
  if (lastPurchaseDay === currentDay - 1) {
    const newStreak = Math.min(currentStreak + 1, 7);
    return {
      streakDay: newStreak,
      bonusBps: getStreakBonusBps(newStreak),
      isContinuing: true,
      isResetting: false,
    };
  }

  // Streak broken - reset to day 1
  return {
    streakDay: 1,
    bonusBps: getStreakBonusBps(1),
    isContinuing: false,
    isResetting: true,
  };
}

/**
 * Get streak bonus in basis points for a given streak day.
 * Default values: [0, 100, 200, 300, 500, 700, 1000] for days 1-7
 *
 * @param streakDay - Streak day (1-7)
 * @param config - Optional config with custom streak bonuses
 * @returns Bonus in basis points
 */
export function getStreakBonusBps(
  streakDay: number,
  config?: NoviPurchaseConfig
): number {
  const defaultBonuses = [0, 100, 200, 300, 500, 700, 1000];
  const bonuses = config?.noviStreakBonusBps ?? defaultBonuses;

  const index = Math.max(0, Math.min(streakDay - 1, 6));
  return bonuses[index] ?? 0;
}

// ============================================================
// Bonus Calculations
// ============================================================

/**
 * Calculate total bonus in basis points.
 *
 * @param packageIndex - Package tier (0-4)
 * @param subscriptionTier - Subscription tier (0-3)
 * @param streakDay - Current streak day (1-7)
 * @param config - NOVI purchase config
 * @returns Total bonus in basis points
 */
export function calculateTotalBonusBps(
  packageIndex: number,
  subscriptionTier: number,
  streakDay: number,
  config: NoviPurchaseConfig
): number {
  // Bulk bonus (0-4 package tiers)
  const bulkBonus = packageIndex >= 0 && packageIndex < 5
    ? config.noviBulkBonusBps[packageIndex] ?? 0
    : 0;

  // Subscription bonus (0-3 tiers)
  const subBonus = subscriptionTier >= 0 && subscriptionTier < 4
    ? config.noviSubBonusBps[subscriptionTier] ?? 0
    : 0;

  // Streak bonus (days 1-7)
  const streakIndex = Math.max(0, Math.min(streakDay - 1, 6));
  const streakBonus = config.noviStreakBonusBps[streakIndex] ?? 0;

  return bulkBonus + subBonus + streakBonus;
}

/**
 * Calculate bonus amount from basis points.
 *
 * @param baseAmount - Base NOVI amount
 * @param bonusBps - Bonus in basis points
 * @returns Bonus amount
 */
export function calculateBonusAmount(baseAmount: BN, bonusBps: number): BN {
  return baseAmount.mul(new BN(bonusBps)).div(new BN(10000));
}

// ============================================================
// Daily Cap Calculations
// ============================================================

/**
 * Get daily cap for a subscription tier.
 *
 * @param subscriptionTier - Subscription tier (0-3)
 * @param config - NOVI purchase config
 * @returns Daily cap in NOVI (with 1 decimal, e.g., 100_000 = 10k NOVI)
 */
export function getDailyCap(
  subscriptionTier: number,
  config: NoviPurchaseConfig
): BN {
  if (subscriptionTier >= 0 && subscriptionTier < 4) {
    const cap = config.noviSubDailyCap[subscriptionTier];
    if (cap) return cap;
  }
  // Default to highest tier cap (Legendary)
  return config.noviSubDailyCap[3]!;
}

/**
 * Check if a purchase would exceed daily cap.
 *
 * @param purchasedToday - Amount already purchased today
 * @param purchaseAmount - Amount to purchase
 * @param subscriptionTier - Subscription tier (0-3)
 * @param config - NOVI purchase config
 * @returns Whether purchase would exceed cap
 */
export function wouldExceedDailyCap(
  purchasedToday: BN,
  purchaseAmount: BN,
  subscriptionTier: number,
  config: NoviPurchaseConfig
): boolean {
  const cap = getDailyCap(subscriptionTier, config);
  const newTotal = purchasedToday.add(purchaseAmount);
  return newTotal.gt(cap);
}

/**
 * Get remaining daily purchase allowance.
 *
 * @param purchasedToday - Amount already purchased today
 * @param subscriptionTier - Subscription tier (0-3)
 * @param config - NOVI purchase config
 * @returns Remaining allowance (0 if cap reached)
 */
export function getRemainingDailyAllowance(
  purchasedToday: BN,
  subscriptionTier: number,
  config: NoviPurchaseConfig
): BN {
  const cap = getDailyCap(subscriptionTier, config);
  if (purchasedToday.gte(cap)) {
    return new BN(0);
  }
  return cap.sub(purchasedToday);
}

// ============================================================
// Purchase Preview
// ============================================================

/**
 * Calculate full purchase preview.
 *
 * @param packageIndex - Package tier (0-4)
 * @param subscriptionTier - Subscription tier (0-3)
 * @param streakDay - Current streak day (1-7)
 * @param config - NOVI purchase config
 * @returns Full purchase preview
 */
export function calculateNoviPurchasePreview(
  packageIndex: number,
  subscriptionTier: number,
  streakDay: number,
  config: NoviPurchaseConfig
): NoviPurchasePreview {
  // Get base amount from package
  if (packageIndex < 0 || packageIndex >= 5) {
    throw new Error(`Invalid package index: ${packageIndex}`);
  }
  const baseAmount = config.noviPurchaseAmounts[packageIndex];
  if (!baseAmount) {
    throw new Error(`Package ${packageIndex} not configured`);
  }

  // Calculate individual bonuses
  const bulkBonusBps = config.noviBulkBonusBps[packageIndex] ?? 0;
  const subBonusBps = subscriptionTier >= 0 && subscriptionTier < 4
    ? (config.noviSubBonusBps[subscriptionTier] ?? 0)
    : 0;
  const streakIndex = Math.max(0, Math.min(streakDay - 1, 6));
  const streakBonusBps = config.noviStreakBonusBps[streakIndex] ?? 0;

  const totalBonusBps = bulkBonusBps + subBonusBps + streakBonusBps;

  // Calculate bonus amounts
  const bulkBonus = calculateBonusAmount(baseAmount, bulkBonusBps);
  const subscriptionBonus = calculateBonusAmount(baseAmount, subBonusBps);
  const streakBonus = calculateBonusAmount(baseAmount, streakBonusBps);
  const totalBonus = bulkBonus.add(subscriptionBonus).add(streakBonus);

  // Total NOVI
  const totalNovi = baseAmount.add(totalBonus);

  // Cost in lamports (pay for base amount only, bonuses are free)
  const costLamports = baseAmount.mul(config.noviBasePriceLamports);

  return {
    baseAmount,
    bulkBonus,
    subscriptionBonus,
    streakBonus,
    totalBonus,
    totalNovi,
    costLamports,
    totalBonusBps,
  };
}

// ============================================================
// Package Helpers
// ============================================================

/** NOVI package tiers */
export const NOVI_PACKAGE_TIERS = [
  { index: 0, name: 'Starter', noviAmount: 500 },
  { index: 1, name: 'Basic', noviAmount: 1000 },
  { index: 2, name: 'Standard', noviAmount: 5000 },
  { index: 3, name: 'Premium', noviAmount: 10000 },
  { index: 4, name: 'Elite', noviAmount: 25000 },
] as const;

/**
 * Get package amount from config.
 *
 * @param packageIndex - Package tier (0-4)
 * @param config - NOVI purchase config
 * @returns NOVI amount (with 1 decimal)
 */
export function getPackageAmount(
  packageIndex: number,
  config: NoviPurchaseConfig
): BN | null {
  if (packageIndex >= 0 && packageIndex < 5) {
    return config.noviPurchaseAmounts[packageIndex] ?? null;
  }
  return null;
}

/**
 * Format NOVI amount for display (handles 1 decimal).
 *
 * @param amount - Raw amount (with 1 decimal, e.g., 5000 = 500 NOVI)
 * @returns Formatted string
 */
export function formatNoviAmount(amount: BN | number): string {
  const value = typeof amount === 'number' ? amount : amount.toNumber();
  return (value / 10).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/**
 * Format lamports as SOL for display.
 *
 * @param lamports - Amount in lamports
 * @returns Formatted SOL string
 */
export function formatLamportsAsSol(lamports: BN | number): string {
  const value = typeof lamports === 'number' ? lamports : lamports.toNumber();
  const sol = value / 1_000_000_000;
  return sol.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }) + ' SOL';
}

// ============================================================
// Oracle Price Calculation
// ============================================================

/**
 * Calculate NOVI cost in lamports using oracle prices with undercut.
 *
 * Formula: lamports = (base_amount * novi_usd / sol_usd) * (10^9 / 10^1) * (1 - undercut)
 *
 * @param baseAmount - Base NOVI amount (with 1 decimal, e.g., 5000 = 500 NOVI)
 * @param noviUsdPrice - NOVI/USD price (e.g., 0.05 = $0.05 per NOVI)
 * @param solUsdPrice - SOL/USD price (e.g., 100 = $100 per SOL)
 * @param undercutBps - Undercut in basis points (e.g., 1500 = 15% off market)
 * @returns Cost in lamports
 */
export function calculateOracleCostLamports(
  baseAmount: BN | number,
  noviUsdPrice: number,
  solUsdPrice: number,
  undercutBps: number = 1500
): BN {
  const amount = typeof baseAmount === 'number' ? baseAmount : baseAmount.toNumber();

  // Calculate: (amount * novi_usd / sol_usd) * 10^8
  // NOVI has 1 decimal in base_amount, SOL has 9 decimals in lamports
  // Conversion factor: 10^9 / 10^1 = 10^8
  const lamportsBeforeUndercut = (amount * noviUsdPrice / solUsdPrice) * 100_000_000;

  // Apply undercut (reduce price by undercut percentage)
  const lamportsAfterUndercut = lamportsBeforeUndercut * (10000 - undercutBps) / 10000;

  return new BN(Math.floor(lamportsAfterUndercut));
}

/**
 * Check if oracle is configured in NOVI purchase config.
 *
 * @param config - NOVI purchase config
 * @returns True if Pyth or Switchboard oracle is configured
 */
export function hasOracleConfigured(config: NoviPurchaseConfig): boolean {
  return config.noviPythFeed !== null || config.noviSwitchboardFeed !== null;
}

/**
 * Calculate purchase preview with oracle pricing.
 * Falls back to DAO price if oracle prices not provided.
 *
 * @param packageIndex - Package tier (0-4)
 * @param subscriptionTier - Subscription tier (0-3)
 * @param streakDay - Current streak day (1-7)
 * @param config - NOVI purchase config
 * @param oraclePrices - Optional oracle prices for market pricing
 * @returns Full purchase preview with oracle or fallback pricing
 */
export function calculateNoviPurchasePreviewWithOracle(
  packageIndex: number,
  subscriptionTier: number,
  streakDay: number,
  config: NoviPurchaseConfig,
  oraclePrices?: { noviUsd: number; solUsd: number }
): NoviPurchasePreview & { usedOracle: boolean } {
  // Get base preview (uses fallback price)
  const basePreview = calculateNoviPurchasePreview(
    packageIndex,
    subscriptionTier,
    streakDay,
    config
  );

  // If oracle prices provided and oracle configured, recalculate with oracle
  if (oraclePrices && hasOracleConfigured(config)) {
    const costLamports = calculateOracleCostLamports(
      basePreview.baseAmount,
      oraclePrices.noviUsd,
      oraclePrices.solUsd,
      config.noviMarketUndercutBps
    );

    return {
      ...basePreview,
      costLamports,
      usedOracle: true,
    };
  }

  return {
    ...basePreview,
    usedOracle: false,
  };
}
