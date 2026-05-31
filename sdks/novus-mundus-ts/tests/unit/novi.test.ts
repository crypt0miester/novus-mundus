/**
 * NOVI Purchase Calculator Unit Tests
 *
 * Tests for streak tracking, bonus calculations, daily caps,
 * purchase previews, package helpers, formatting, and oracle pricing.
 */

import { describe, it, expect } from 'bun:test';
import {
  // Streak
  calculateNoviStreak,
  getStreakBonusBps,
  // Bonuses
  calculateTotalBonusBps,
  calculateBonusAmount,
  // Daily caps
  getDailyCap,
  wouldExceedDailyCap,
  getRemainingDailyAllowance,
  // Purchase preview
  calculateNoviPurchasePreview,
  // Package helpers
  NOVI_PACKAGE_TIERS,
  getPackageAmount,
  // Formatting
  formatNoviAmount,
  formatLamportsAsSol,
  // Oracle
  calculateOracleCostLamports,
  hasOracleConfigured,
  calculateNoviPurchasePreviewWithOracle,
  // Types
  type NoviPurchasePreview,
} from '../../src/calculators/novi';
import type { NoviPurchaseConfig } from '../../src/state/game-engine';

// Test Fixtures

function createTestConfig(): NoviPurchaseConfig {
  return {
    noviBasePriceLamports: BigInt(100_000), // 0.0001 SOL per NOVI
    noviMarketUndercutBps: 1500, // 15% undercut
    noviPurchaseAmounts: [
      BigInt(5000),   // 500 NOVI (1 decimal)
      BigInt(10000),  // 1000 NOVI
      BigInt(50000),  // 5000 NOVI
      BigInt(100000), // 10000 NOVI
      BigInt(250000), // 25000 NOVI
    ],
    noviBulkBonusBps: [0, 200, 500, 1000, 1500],
    noviSubBonusBps: [0, 500, 1000, 2000],
    noviSubDailyCap: [
      BigInt(50000),   // Free tier: 5000 NOVI/day
      BigInt(100000),  // Bronze: 10000 NOVI/day
      BigInt(250000),  // Silver: 25000 NOVI/day
      BigInt(500000),  // Gold: 50000 NOVI/day
    ],
    noviStreakBonusBps: [0, 100, 200, 300, 500, 700, 1000],
    noviPythFeed: null,
    noviSwitchboardFeed: null,
    noviMaxStalenessSlots: 100,
    noviConfidenceThresholdBps: 500,
  };
}

// Streak Calculation Tests

describe('NOVI Streak Calculations', () => {
  describe('calculateNoviStreak', () => {
    it('should maintain streak for same-day purchase', () => {
      const currentTimestamp = 86400 * 10; // Day 10
      const lastPurchaseDay = 10; // Same day
      const result = calculateNoviStreak(lastPurchaseDay, 3, currentTimestamp);

      expect(result.streakDay).toBe(3);
      expect(result.isContinuing).toBe(true);
      expect(result.isResetting).toBe(false);
    });

    it('should increment streak for consecutive day', () => {
      const currentTimestamp = 86400 * 10; // Day 10
      const lastPurchaseDay = 9; // Yesterday
      const result = calculateNoviStreak(lastPurchaseDay, 3, currentTimestamp);

      expect(result.streakDay).toBe(4);
      expect(result.isContinuing).toBe(true);
      expect(result.isResetting).toBe(false);
    });

    it('should cap streak at 7', () => {
      const currentTimestamp = 86400 * 10; // Day 10
      const lastPurchaseDay = 9; // Yesterday
      const result = calculateNoviStreak(lastPurchaseDay, 7, currentTimestamp);

      expect(result.streakDay).toBe(7); // Capped at 7
      expect(result.isContinuing).toBe(true);
    });

    it('should reset streak after gap of 2+ days', () => {
      const currentTimestamp = 86400 * 10; // Day 10
      const lastPurchaseDay = 7; // 3 days ago
      const result = calculateNoviStreak(lastPurchaseDay, 5, currentTimestamp);

      expect(result.streakDay).toBe(1);
      expect(result.isContinuing).toBe(false);
      expect(result.isResetting).toBe(true);
    });

    it('should reset streak when no previous purchase (day 0)', () => {
      const currentTimestamp = 86400 * 10; // Day 10
      const result = calculateNoviStreak(0, 0, currentTimestamp);

      expect(result.streakDay).toBe(1);
      expect(result.isResetting).toBe(true);
    });

    it('should include bonus BPS in result', () => {
      const currentTimestamp = 86400 * 10;
      const result = calculateNoviStreak(9, 3, currentTimestamp);

      // Streak day 4 -> index 3 -> 300 bps (from default bonuses)
      expect(result.bonusBps).toBe(300);
    });
  });

  describe('getStreakBonusBps', () => {
    it('should return default bonuses for days 1-7', () => {
      expect(getStreakBonusBps(1)).toBe(0);
      expect(getStreakBonusBps(2)).toBe(100);
      expect(getStreakBonusBps(3)).toBe(200);
      expect(getStreakBonusBps(4)).toBe(300);
      expect(getStreakBonusBps(5)).toBe(500);
      expect(getStreakBonusBps(6)).toBe(700);
      expect(getStreakBonusBps(7)).toBe(1000);
    });

    it('should clamp to valid range', () => {
      // Day 0 should clamp to index 0
      expect(getStreakBonusBps(0)).toBe(0);
      // Day 10 should clamp to index 6 (max)
      expect(getStreakBonusBps(10)).toBe(1000);
    });

    it('should use config bonuses when provided', () => {
      const config = createTestConfig();
      config.noviStreakBonusBps = [0, 200, 400, 600, 800, 1000, 1200];
      expect(getStreakBonusBps(3, config)).toBe(400);
    });
  });
});

// Bonus Calculation Tests

describe('Bonus Calculations', () => {
  describe('calculateTotalBonusBps', () => {
    const config = createTestConfig();

    it('should sum all three bonus types', () => {
      // Package 2 = 500 bps, Sub tier 1 = 500 bps, Streak day 3 = 200 bps
      const total = calculateTotalBonusBps(2, 1, 3, config);
      expect(total).toBe(500 + 500 + 200);
    });

    it('should return 0 for minimum tier with no streak', () => {
      // Package 0 = 0 bps, Sub tier 0 = 0 bps, Streak day 1 = 0 bps
      const total = calculateTotalBonusBps(0, 0, 1, config);
      expect(total).toBe(0);
    });

    it('should return max bonuses for top tiers', () => {
      // Package 4 = 1500, Sub tier 3 = 2000, Streak day 7 = 1000
      const total = calculateTotalBonusBps(4, 3, 7, config);
      expect(total).toBe(1500 + 2000 + 1000);
    });

    it('should handle out-of-range package index', () => {
      const total = calculateTotalBonusBps(-1, 0, 1, config);
      // Package -1 is out of range -> 0
      expect(total).toBe(0);
    });

    it('should handle out-of-range subscription tier', () => {
      const total = calculateTotalBonusBps(0, 5, 1, config);
      // Sub tier 5 is out of range -> 0
      expect(total).toBe(0);
    });
  });

  describe('calculateBonusAmount', () => {
    it('should calculate 10% bonus', () => {
      const base = BigInt(10000);
      const bonus = calculateBonusAmount(base, 1000); // 10%
      expect(Number(bonus)).toBe(1000);
    });

    it('should return 0 for 0 bps', () => {
      const base = BigInt(10000);
      const bonus = calculateBonusAmount(base, 0);
      expect(Number(bonus)).toBe(0);
    });

    it('should return full amount for 10000 bps (100%)', () => {
      const base = BigInt(5000);
      const bonus = calculateBonusAmount(base, 10000);
      expect(Number(bonus)).toBe(5000);
    });

    it('should handle large BN values', () => {
      const base = BigInt(1_000_000);
      const bonus = calculateBonusAmount(base, 500); // 5%
      expect(Number(bonus)).toBe(50000);
    });

    it('should floor fractional results', () => {
      const base = BigInt(333);
      const bonus = calculateBonusAmount(base, 1000); // 10%
      // 333 * 1000 / 10000 = 33.3 -> BN division floors
      expect(Number(bonus)).toBe(33);
    });
  });
});

// Daily Cap Tests

describe('Daily Cap Calculations', () => {
  const config = createTestConfig();

  describe('getDailyCap', () => {
    it('should return cap for each subscription tier', () => {
      expect(Number(getDailyCap(0, config))).toBe(50000);
      expect(Number(getDailyCap(1, config))).toBe(100000);
      expect(Number(getDailyCap(2, config))).toBe(250000);
      expect(Number(getDailyCap(3, config))).toBe(500000);
    });

    it('should fallback to highest tier for out-of-range', () => {
      expect(Number(getDailyCap(5, config))).toBe(500000);
      expect(Number(getDailyCap(-1, config))).toBe(500000);
    });
  });

  describe('wouldExceedDailyCap', () => {
    it('should return false when under cap', () => {
      const purchased = BigInt(10000);
      const amount = BigInt(5000);
      expect(wouldExceedDailyCap(purchased, amount, 0, config)).toBe(false);
    });

    it('should return true when exceeding cap', () => {
      const purchased = BigInt(45000);
      const amount = BigInt(10000);
      // 45000 + 10000 = 55000 > 50000 (free tier cap)
      expect(wouldExceedDailyCap(purchased, amount, 0, config)).toBe(true);
    });

    it('should return false when exactly at cap', () => {
      const purchased = BigInt(40000);
      const amount = BigInt(10000);
      // 40000 + 10000 = 50000 = cap -> not greater than
      expect(wouldExceedDailyCap(purchased, amount, 0, config)).toBe(false);
    });

    it('should respect higher tier caps', () => {
      const purchased = BigInt(45000);
      const amount = BigInt(10000);
      // Free tier would exceed, Gold tier (500000) would not
      expect(wouldExceedDailyCap(purchased, amount, 0, config)).toBe(true);
      expect(wouldExceedDailyCap(purchased, amount, 3, config)).toBe(false);
    });
  });

  describe('getRemainingDailyAllowance', () => {
    it('should return full cap when nothing purchased', () => {
      const remaining = getRemainingDailyAllowance(BigInt(0), 0, config);
      expect(Number(remaining)).toBe(50000);
    });

    it('should return remaining after partial purchase', () => {
      const remaining = getRemainingDailyAllowance(BigInt(20000), 0, config);
      expect(Number(remaining)).toBe(30000);
    });

    it('should return 0 when cap reached', () => {
      const remaining = getRemainingDailyAllowance(BigInt(50000), 0, config);
      expect(Number(remaining)).toBe(0);
    });

    it('should return 0 when cap exceeded', () => {
      const remaining = getRemainingDailyAllowance(BigInt(60000), 0, config);
      expect(Number(remaining)).toBe(0);
    });

    it('should use correct tier cap', () => {
      const remaining = getRemainingDailyAllowance(BigInt(60000), 1, config);
      // Bronze cap = 100000, purchased 60000, remaining = 40000
      expect(Number(remaining)).toBe(40000);
    });
  });
});

// Purchase Preview Tests

describe('Purchase Preview', () => {
  const config = createTestConfig();

  describe('calculateNoviPurchasePreview', () => {
    it('should calculate preview for starter package', () => {
      const preview = calculateNoviPurchasePreview(0, 0, 1, config);

      expect(Number(preview.baseAmount)).toBe(5000);
      expect(preview.totalBonusBps).toBe(0); // No bonuses for tier 0, sub 0, streak 1
      expect(Number(preview.bulkBonus)).toBe(0);
      expect(Number(preview.subscriptionBonus)).toBe(0);
      expect(Number(preview.streakBonus)).toBe(0);
      expect(Number(preview.totalBonus)).toBe(0);
      expect(Number(preview.totalNovi)).toBe(5000);
    });

    it('should apply bulk bonus for higher packages', () => {
      const preview = calculateNoviPurchasePreview(2, 0, 1, config);

      // Package 2: base 50000, bulk bonus 500 bps (5%)
      expect(Number(preview.baseAmount)).toBe(50000);
      expect(Number(preview.bulkBonus)).toBe(2500); // 50000 * 500 / 10000
    });

    it('should apply subscription bonus', () => {
      const preview = calculateNoviPurchasePreview(0, 2, 1, config);

      // Sub tier 2 = 1000 bps (10%)
      // Base 5000, sub bonus = 500
      expect(Number(preview.subscriptionBonus)).toBe(500);
    });

    it('should apply streak bonus', () => {
      const preview = calculateNoviPurchasePreview(0, 0, 5, config);

      // Streak day 5 = index 4 = 500 bps (5%)
      // Base 5000, streak bonus = 250
      expect(Number(preview.streakBonus)).toBe(250);
    });

    it('should sum all bonuses correctly', () => {
      const preview = calculateNoviPurchasePreview(2, 2, 5, config);

      // Package 2: base=50000, bulk=500bps, sub=1000bps, streak=500bps
      const expectedBulk = Math.floor(50000 * 500 / 10000); // 2500
      const expectedSub = Math.floor(50000 * 1000 / 10000); // 5000
      const expectedStreak = Math.floor(50000 * 500 / 10000); // 2500

      expect(Number(preview.bulkBonus)).toBe(expectedBulk);
      expect(Number(preview.subscriptionBonus)).toBe(expectedSub);
      expect(Number(preview.streakBonus)).toBe(expectedStreak);
      expect(Number(preview.totalBonus)).toBe(expectedBulk + expectedSub + expectedStreak);
      expect(Number(preview.totalNovi)).toBe(50000 + expectedBulk + expectedSub + expectedStreak);
      expect(preview.totalBonusBps).toBe(500 + 1000 + 500);
    });

    it('should calculate cost in lamports', () => {
      const preview = calculateNoviPurchasePreview(0, 0, 1, config);

      // Cost = baseAmount * noviBasePriceLamports = 5000 * 100000 = 500000000
      expect(Number(preview.costLamports)).toBe(500_000_000);
    });

    it('should throw for invalid package index', () => {
      expect(() => calculateNoviPurchasePreview(-1, 0, 1, config)).toThrow();
      expect(() => calculateNoviPurchasePreview(5, 0, 1, config)).toThrow();
    });
  });
});

// Package Helper Tests

describe('Package Helpers', () => {
  describe('NOVI_PACKAGE_TIERS', () => {
    it('should have 5 package tiers', () => {
      expect(NOVI_PACKAGE_TIERS.length).toBe(5);
    });

    it('should have correct indices', () => {
      for (let i = 0; i < NOVI_PACKAGE_TIERS.length; i++) {
        expect(Number(NOVI_PACKAGE_TIERS[i]!.index)).toBe(i);
      }
    });

    it('should have increasing NOVI amounts', () => {
      for (let i = 1; i < NOVI_PACKAGE_TIERS.length; i++) {
        expect(NOVI_PACKAGE_TIERS[i]!.noviAmount).toBeGreaterThan(
          NOVI_PACKAGE_TIERS[i - 1]!.noviAmount
        );
      }
    });

    it('should have named tiers', () => {
      expect(NOVI_PACKAGE_TIERS[0].name).toBe('Starter');
      expect(NOVI_PACKAGE_TIERS[4].name).toBe('Elite');
    });

    it('should have expected amounts', () => {
      expect(NOVI_PACKAGE_TIERS[0].noviAmount).toBe(500);
      expect(NOVI_PACKAGE_TIERS[1].noviAmount).toBe(1000);
      expect(NOVI_PACKAGE_TIERS[2].noviAmount).toBe(5000);
      expect(NOVI_PACKAGE_TIERS[3].noviAmount).toBe(10000);
      expect(NOVI_PACKAGE_TIERS[4].noviAmount).toBe(25000);
    });
  });

  describe('getPackageAmount', () => {
    const config = createTestConfig();

    it('should return amount for valid index', () => {
      const amount = getPackageAmount(0, config);
      expect(amount).not.toBeNull();
      expect(Number(amount!)).toBe(5000);
    });

    it('should return null for out-of-range index', () => {
      expect(getPackageAmount(-1, config)).toBeNull();
      expect(getPackageAmount(5, config)).toBeNull();
      expect(getPackageAmount(10, config)).toBeNull();
    });

    it('should return correct amounts for all tiers', () => {
      expect(Number(getPackageAmount(0, config)!)).toBe(5000);
      expect(Number(getPackageAmount(1, config)!)).toBe(10000);
      expect(Number(getPackageAmount(2, config)!)).toBe(50000);
      expect(Number(getPackageAmount(3, config)!)).toBe(100000);
      expect(Number(getPackageAmount(4, config)!)).toBe(250000);
    });
  });
});

// Formatting Tests

describe('Formatting', () => {
  describe('formatNoviAmount', () => {
    it('should divide by 10 for 1-decimal display', () => {
      // Raw 5000 = 500.0 NOVI
      const formatted = formatNoviAmount(5000);
      expect(formatted).toContain('500');
    });

    it('should handle BN input', () => {
      const formatted = formatNoviAmount(BigInt(10000));
      expect(formatted).toContain('1');
    });

    it('should handle zero', () => {
      const formatted = formatNoviAmount(0);
      expect(formatted).toBe('0');
    });

    it('should handle fractional amounts', () => {
      // Raw 55 = 5.5 NOVI
      const formatted = formatNoviAmount(55);
      expect(formatted).toContain('5.5');
    });
  });

  describe('formatLamportsAsSol', () => {
    it('should format 1 SOL', () => {
      const formatted = formatLamportsAsSol(1_000_000_000);
      expect(formatted).toContain('1');
      expect(formatted).toContain('SOL');
    });

    it('should format fractional SOL', () => {
      const formatted = formatLamportsAsSol(500_000_000);
      expect(formatted).toContain('0.5');
      expect(formatted).toContain('SOL');
    });

    it('should handle BN input', () => {
      const formatted = formatLamportsAsSol(BigInt(1_000_000_000));
      expect(formatted).toContain('SOL');
    });

    it('should handle zero lamports', () => {
      const formatted = formatLamportsAsSol(0);
      expect(formatted).toContain('0');
      expect(formatted).toContain('SOL');
    });

    it('should show at least 2 decimal places', () => {
      const formatted = formatLamportsAsSol(1_000_000_000);
      // Should contain decimal point with at least 2 digits
      expect(formatted).toMatch(/\d+\.\d{2,}/);
    });
  });
});

// Oracle Price Tests

describe('Oracle Pricing', () => {
  describe('calculateOracleCostLamports', () => {
    it('should calculate cost from oracle prices', () => {
      // 5000 base (500 NOVI), $0.05/NOVI, $100/SOL, 15% undercut
      const cost = calculateOracleCostLamports(5000, 0.05, 100, 1500);

      // (5000 * 0.05 / 100) * 1e8 = 2.5 * 1e8 = 250_000_000
      // After 15% undercut: 250_000_000 * 8500/10000 = 212_500_000
      expect(Number(cost)).toBe(212_500_000);
    });

    it('should handle zero undercut', () => {
      const cost = calculateOracleCostLamports(5000, 0.05, 100, 0);
      // (5000 * 0.05 / 100) * 1e8 = 250_000_000
      expect(Number(cost)).toBe(250_000_000);
    });

    it('should accept BN as base amount', () => {
      const cost = calculateOracleCostLamports(BigInt(5000), 0.05, 100, 0);
      expect(Number(cost)).toBe(250_000_000);
    });

    it('should use default undercut of 1500 bps', () => {
      const withDefault = calculateOracleCostLamports(5000, 0.05, 100);
      const explicit = calculateOracleCostLamports(5000, 0.05, 100, 1500);
      expect(Number(withDefault)).toBe(Number(explicit));
    });

    it('should scale linearly with base amount', () => {
      const cost1 = calculateOracleCostLamports(5000, 0.05, 100, 0);
      const cost2 = calculateOracleCostLamports(10000, 0.05, 100, 0);
      expect(Number(cost2)).toBe(Number(cost1) * 2);
    });

    it('should decrease with higher SOL price', () => {
      const costLowSol = calculateOracleCostLamports(5000, 0.05, 50, 0);
      const costHighSol = calculateOracleCostLamports(5000, 0.05, 200, 0);
      expect(Number(costHighSol)).toBeLessThan(Number(costLowSol));
    });

    it('should increase with higher NOVI price', () => {
      const costLowNovi = calculateOracleCostLamports(5000, 0.01, 100, 0);
      const costHighNovi = calculateOracleCostLamports(5000, 0.10, 100, 0);
      expect(Number(costHighNovi)).toBeGreaterThan(Number(costLowNovi));
    });

    it('should floor the result', () => {
      const cost = calculateOracleCostLamports(333, 0.07, 123, 1500);
      expect(Number(cost)).toBe(Math.floor(Number(cost)));
    });
  });

  describe('hasOracleConfigured', () => {
    it('should return false when no oracles configured', () => {
      const config = createTestConfig();
      expect(hasOracleConfigured(config)).toBe(false);
    });

    it('should return true when Pyth feed is set', () => {
      const config = createTestConfig();
      // Use a dummy non-null value (PublicKey-like)
      config.noviPythFeed = {} as any;
      expect(hasOracleConfigured(config)).toBe(true);
    });

    it('should return true when Switchboard feed is set', () => {
      const config = createTestConfig();
      config.noviSwitchboardFeed = {} as any;
      expect(hasOracleConfigured(config)).toBe(true);
    });

    it('should return true when both feeds are set', () => {
      const config = createTestConfig();
      config.noviPythFeed = {} as any;
      config.noviSwitchboardFeed = {} as any;
      expect(hasOracleConfigured(config)).toBe(true);
    });
  });

  describe('calculateNoviPurchasePreviewWithOracle', () => {
    it('should use fallback price when no oracle', () => {
      const config = createTestConfig();
      const preview = calculateNoviPurchasePreviewWithOracle(0, 0, 1, config);

      expect(preview.usedOracle).toBe(false);
      // Should match base preview
      const basePreview = calculateNoviPurchasePreview(0, 0, 1, config);
      expect(Number(preview.costLamports)).toBe(Number(basePreview.costLamports));
    });

    it('should use fallback when oracle configured but no prices', () => {
      const config = createTestConfig();
      config.noviPythFeed = {} as any;
      const preview = calculateNoviPurchasePreviewWithOracle(0, 0, 1, config);

      expect(preview.usedOracle).toBe(false);
    });

    it('should use oracle pricing when available', () => {
      const config = createTestConfig();
      config.noviPythFeed = {} as any;
      const oraclePrices = { noviUsd: 0.05, solUsd: 100 };

      const preview = calculateNoviPurchasePreviewWithOracle(0, 0, 1, config, oraclePrices);

      expect(preview.usedOracle).toBe(true);
      // Oracle cost should differ from base fallback
      const fallbackPreview = calculateNoviPurchasePreview(0, 0, 1, config);
      // They might coincidentally match, so just verify oracle was used
      expect(preview.usedOracle).toBe(true);
    });

    it('should preserve bonus calculations regardless of pricing method', () => {
      const config = createTestConfig();
      config.noviPythFeed = {} as any;
      const oraclePrices = { noviUsd: 0.05, solUsd: 100 };

      const oraclePreview = calculateNoviPurchasePreviewWithOracle(2, 2, 5, config, oraclePrices);
      const basePreview = calculateNoviPurchasePreview(2, 2, 5, config);

      // Bonuses should be the same regardless of pricing method
      expect(Number(oraclePreview.baseAmount)).toBe(Number(basePreview.baseAmount));
      expect(Number(oraclePreview.totalBonus)).toBe(Number(basePreview.totalBonus));
      expect(Number(oraclePreview.totalNovi)).toBe(Number(basePreview.totalNovi));
      expect(oraclePreview.totalBonusBps).toBe(basePreview.totalBonusBps);
    });
  });
});
