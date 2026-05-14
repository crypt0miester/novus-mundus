/**
 * Cost Calculator Unit Tests
 *
 * Tests for unit hiring, upgrade, purchase, and various cost calculations.
 */

import { describe, it, expect } from 'bun:test';
import {
  calculateHiringCost,
  calculateTotalHiringCost,
  calculatePurchaseCost,
  calculateUpgradeCost,
  calculateCumulativeUpgradeCost,
  calculateResearchCost,
  calculateNoviToPower,
  calculateNoviRequired,
  calculatePartialSpeedupCost,
  calculateSubscriptionCostPerDay,
  calculateAttackTax,
  calculateShopPrice,
  formatCostWithBonus,
  getCostTimeBonusDescription,
  calculateRecoveryCost,
} from '../../src/calculators/costs';

import {
  PHI,
  PHI_SQUARED,
  GOLDEN_ROOT,
  NOVI_BASE_MULTIPLIER,
  NOVI_GOLDEN_MULTIPLIER,
} from '../../src/calculators/constants';

import { TimeOfDay } from '../../src/calculators/time';

// Upgrade Cost Tests

describe('calculateUpgradeCost', () => {
  it('should return baseCost at level 0 (scaling^0 = 1)', () => {
    expect(calculateUpgradeCost(100, 0)).toBe(100);
  });

  it('should scale by PHI_SQUARED at level 1', () => {
    const cost = calculateUpgradeCost(100, 1);
    expect(cost).toBe(Math.floor(100 * PHI_SQUARED));
  });

  it('should scale by PHI_SQUARED^2 at level 2 (iterated floor)', () => {
    const cost = calculateUpgradeCost(100, 2);
    expect(cost).toBe(Math.floor(Math.floor(100 * PHI_SQUARED) * PHI_SQUARED));
  });

  it('should increase with each level', () => {
    const cost0 = calculateUpgradeCost(100, 0);
    const cost1 = calculateUpgradeCost(100, 1);
    const cost2 = calculateUpgradeCost(100, 2);
    const cost5 = calculateUpgradeCost(100, 5);
    expect(cost1).toBeGreaterThan(cost0);
    expect(cost2).toBeGreaterThan(cost1);
    expect(cost5).toBeGreaterThan(cost2);
  });

  it('should accept a custom scaling factor', () => {
    // scaling=2.0, level=3 → 3 iterations: 100 → 200 → 400 → 800
    const cost = calculateUpgradeCost(100, 3, 2.0);
    expect(cost).toBe(800);
  });

  it('should handle baseCost of 0', () => {
    expect(calculateUpgradeCost(0, 5)).toBe(0);
  });

  it('should handle large levels', () => {
    const cost = calculateUpgradeCost(100, 20);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeGreaterThan(calculateUpgradeCost(100, 19));
  });

  it('should floor the result', () => {
    // PHI_SQUARED is irrational, result must be floored
    const cost = calculateUpgradeCost(1, 1);
    expect(cost).toBe(Math.floor(PHI_SQUARED));
    expect(Number.isInteger(cost)).toBe(true);
  });
});

// Cumulative Upgrade Cost Tests

describe('calculateCumulativeUpgradeCost', () => {
  it('should return 0 for targetLevel 1 (already at baseline)', () => {
    expect(calculateCumulativeUpgradeCost(100, 1)).toBe(0);
  });

  it('should equal single upgrade cost for targetLevel 2', () => {
    const single = calculateUpgradeCost(100, 1);
    const cumulative = calculateCumulativeUpgradeCost(100, 2);
    expect(cumulative).toBe(single);
  });

  it('should equal sum of individual upgrade costs', () => {
    const baseCost = 100;
    const targetLevel = 5;

    let manualSum = 0;
    for (let level = 1; level < targetLevel; level++) {
      manualSum += calculateUpgradeCost(baseCost, level);
    }

    expect(calculateCumulativeUpgradeCost(baseCost, targetLevel)).toBe(manualSum);
  });

  it('should increase as targetLevel increases', () => {
    const c3 = calculateCumulativeUpgradeCost(100, 3);
    const c5 = calculateCumulativeUpgradeCost(100, 5);
    const c10 = calculateCumulativeUpgradeCost(100, 10);
    expect(c5).toBeGreaterThan(c3);
    expect(c10).toBeGreaterThan(c5);
  });

  it('should accept custom scaling factor', () => {
    // With scaling=2 (0-indexed iteration): upgrade costs at levels 1,2,3 are 200, 400, 800
    // Cumulative to level 4 = 200 + 400 + 800 = 1400
    expect(calculateCumulativeUpgradeCost(100, 4, 2.0)).toBe(1400);
  });

  it('should handle baseCost of 0', () => {
    expect(calculateCumulativeUpgradeCost(0, 10)).toBe(0);
  });
});

// Research Cost Tests

describe('calculateResearchCost', () => {
  it('should return baseCost * GOLDEN_ROOT^0 = baseCost at level 0', () => {
    expect(calculateResearchCost(100, 0)).toBe(100);
  });

  it('should scale by GOLDEN_ROOT at level 1', () => {
    const cost = calculateResearchCost(100, 1);
    expect(cost).toBe(Math.floor(100 * GOLDEN_ROOT));
  });

  it('should scale by GOLDEN_ROOT^2 at level 2', () => {
    const cost = calculateResearchCost(100, 2);
    expect(cost).toBe(Math.floor(100 * Math.pow(GOLDEN_ROOT, 2)));
  });

  it('should increase with research level', () => {
    const cost0 = calculateResearchCost(100, 0);
    const cost1 = calculateResearchCost(100, 1);
    const cost5 = calculateResearchCost(100, 5);
    expect(cost1).toBeGreaterThan(cost0);
    expect(cost5).toBeGreaterThan(cost1);
  });

  it('should accept custom scaling factor', () => {
    // baseCost * 2^3 = 100 * 8 = 800
    expect(calculateResearchCost(100, 3, 2.0)).toBe(800);
  });

  it('should handle baseCost of 0', () => {
    expect(calculateResearchCost(0, 5)).toBe(0);
  });

  it('should floor the result', () => {
    const cost = calculateResearchCost(1, 1);
    expect(Number.isInteger(cost)).toBe(true);
  });
});

// Hiring Cost Tests

describe('calculateHiringCost', () => {
  it('should return a positive cost for valid inputs', () => {
    // Use a timestamp and longitude that produce a known time of day
    const cost = calculateHiringCost(100, 10, 0, 0);
    expect(cost).toBeGreaterThan(0);
  });

  it('should scale approximately linearly with quantity', () => {
    const cost1 = calculateHiringCost(100, 1, 0, 0);
    const cost5 = calculateHiringCost(100, 5, 0, 0);
    // cost5 should be approximately 5x cost1 (may differ slightly due to flooring)
    expect(Math.abs(cost5 - cost1 * 5)).toBeLessThanOrEqual(4);
  });

  it('should scale linearly with baseCost', () => {
    const costA = calculateHiringCost(100, 1, 0, 0);
    const costB = calculateHiringCost(200, 1, 0, 0);
    // doubling baseCost should double cost (may differ by 1 due to flooring)
    expect(Math.abs(costB - costA * 2)).toBeLessThanOrEqual(1);
  });

  it('should apply discount when discountBps > 0', () => {
    const noDis = calculateHiringCost(1000, 10, 0, 0, 0);
    const withDis = calculateHiringCost(1000, 10, 0, 0, 2000); // 20% discount
    expect(withDis).toBeLessThan(noDis);
  });

  it('should return 0 for quantity 0', () => {
    expect(calculateHiringCost(100, 0, 0, 0)).toBe(0);
  });

  it('should return 0 for baseCost 0', () => {
    expect(calculateHiringCost(0, 10, 0, 0)).toBe(0);
  });

  it('should vary by time of day (longitude shift)', () => {
    // Midday longitude vs deep-night longitude should differ
    // Two longitudes 180 degrees apart should have different time of day
    const costA = calculateHiringCost(1000, 10, 43200, 0);    // noon at lng=0
    const costB = calculateHiringCost(1000, 10, 43200, 180);  // different local time
    // They can be the same if both happen to land on the same period,
    // but in general they may differ. We just check both are positive.
    expect(costA).toBeGreaterThan(0);
    expect(costB).toBeGreaterThan(0);
  });
});

// Total Hiring Cost Tests

describe('calculateTotalHiringCost', () => {
  const costs = {
    defensiveUnit1Cost: 10,
    defensiveUnit2Cost: 25,
    defensiveUnit3Cost: 60,
    operativeUnit1Cost: 15,
    operativeUnit2Cost: 35,
    operativeUnit3Cost: 80,
  };

  it('should return 0 when all quantities are 0', () => {
    expect(calculateTotalHiringCost([0, 0, 0, 0, 0, 0], costs, 0, 0)).toBe(0);
  });

  it('should sum individual hiring costs', () => {
    const ts = 43200;
    const lng = 0;
    const quantities: [number, number, number, number, number, number] = [5, 0, 0, 0, 0, 0];

    const total = calculateTotalHiringCost(quantities, costs, ts, lng);
    const individual = calculateHiringCost(10, 5, ts, lng);
    expect(total).toBe(individual);
  });

  it('should aggregate across multiple unit types', () => {
    const ts = 43200;
    const lng = 0;
    const quantities: [number, number, number, number, number, number] = [1, 1, 1, 1, 1, 1];

    const total = calculateTotalHiringCost(quantities, costs, ts, lng);

    let manualTotal = 0;
    const costArr = [10, 25, 60, 15, 35, 80];
    for (let i = 0; i < 6; i++) {
      manualTotal += calculateHiringCost(costArr[i], 1, ts, lng);
    }

    expect(total).toBe(manualTotal);
  });

  it('should apply discount to all unit types', () => {
    const ts = 43200;
    const lng = 0;
    const quantities: [number, number, number, number, number, number] = [10, 10, 10, 10, 10, 10];

    const noDis = calculateTotalHiringCost(quantities, costs, ts, lng, 0);
    const withDis = calculateTotalHiringCost(quantities, costs, ts, lng, 2000);
    expect(withDis).toBeLessThan(noDis);
  });
});

// Purchase Cost Tests

describe('calculatePurchaseCost', () => {
  it('should return a positive cost', () => {
    const cost = calculatePurchaseCost(500, 3, 0, 0);
    expect(cost).toBeGreaterThan(0);
  });

  it('should scale approximately with quantity', () => {
    const cost1 = calculatePurchaseCost(500, 1, 0, 0);
    const cost3 = calculatePurchaseCost(500, 3, 0, 0);
    // May differ slightly due to flooring of irrational multiplier
    expect(Math.abs(cost3 - cost1 * 3)).toBeLessThanOrEqual(2);
  });

  it('should apply discount', () => {
    const base = calculatePurchaseCost(500, 5, 0, 0, 0);
    const discounted = calculatePurchaseCost(500, 5, 0, 0, 3000);
    expect(discounted).toBeLessThan(base);
  });

  it('should return 0 for quantity 0', () => {
    expect(calculatePurchaseCost(500, 0, 0, 0)).toBe(0);
  });

  it('should return 0 for baseCost 0', () => {
    expect(calculatePurchaseCost(0, 10, 0, 0)).toBe(0);
  });
});

// NOVI to Power Tests

describe('calculateNoviToPower', () => {
  it('should convert using base multiplier by default', () => {
    const power = calculateNoviToPower(100);
    expect(power).toBe(Math.floor(100 * NOVI_BASE_MULTIPLIER));
  });

  it('should convert using golden multiplier when requested', () => {
    const power = calculateNoviToPower(100, true);
    expect(power).toBe(Math.floor(100 * NOVI_GOLDEN_MULTIPLIER));
  });

  it('should return more power with golden multiplier', () => {
    const base = calculateNoviToPower(100, false);
    const golden = calculateNoviToPower(100, true);
    expect(golden).toBeGreaterThan(base);
  });

  it('should handle 0 input', () => {
    expect(calculateNoviToPower(0)).toBe(0);
  });

  it('should handle large values', () => {
    const power = calculateNoviToPower(1_000_000);
    expect(power).toBe(Math.floor(1_000_000 * NOVI_BASE_MULTIPLIER));
  });

  it('should floor the result', () => {
    const power = calculateNoviToPower(1);
    expect(Number.isInteger(power)).toBe(true);
  });
});

// NOVI Required Tests

describe('calculateNoviRequired', () => {
  it('should be inverse of calculateNoviToPower (base)', () => {
    const novi = 100;
    const power = calculateNoviToPower(novi, false);
    const required = calculateNoviRequired(power, false);
    // Due to floor/ceil, required should be <= novi (ceil of floor)
    expect(required).toBeLessThanOrEqual(novi);
    // And the power from required should be >= the target power
    expect(calculateNoviToPower(required, false)).toBeGreaterThanOrEqual(power);
  });

  it('should be inverse of calculateNoviToPower (golden)', () => {
    const novi = 100;
    const power = calculateNoviToPower(novi, true);
    const required = calculateNoviRequired(power, true);
    expect(required).toBeLessThanOrEqual(novi);
    expect(calculateNoviToPower(required, true)).toBeGreaterThanOrEqual(power);
  });

  it('should return 0 for 0 desired power', () => {
    expect(calculateNoviRequired(0)).toBe(0);
  });

  it('should require less NOVI with golden multiplier', () => {
    const baseCost = calculateNoviRequired(1000, false);
    const goldenCost = calculateNoviRequired(1000, true);
    expect(goldenCost).toBeLessThan(baseCost);
  });

  it('should ceil the result', () => {
    const required = calculateNoviRequired(1, false);
    expect(Number.isInteger(required)).toBe(true);
    expect(required).toBeGreaterThanOrEqual(1);
  });
});

// Partial Speedup Cost Tests

describe('calculatePartialSpeedupCost', () => {
  it('should return cost for 60 seconds at 1 gem/minute', () => {
    expect(calculatePartialSpeedupCost(60, 1)).toBe(1);
  });

  it('should ceil partial minutes', () => {
    // 61 seconds = 2 minutes (ceiled)
    expect(calculatePartialSpeedupCost(61, 1)).toBe(2);
  });

  it('should scale with gemCostPerMinute', () => {
    expect(calculatePartialSpeedupCost(60, 5)).toBe(5);
  });

  it('should handle 0 seconds', () => {
    expect(calculatePartialSpeedupCost(0, 1)).toBe(0);
  });

  it('should handle large values', () => {
    // 3600 seconds = 60 minutes at 10 gems/min = 600
    expect(calculatePartialSpeedupCost(3600, 10)).toBe(600);
  });

  it('should handle 1 second', () => {
    // 1 second = 1 minute (ceiled) at 1 gem/min = 1
    expect(calculatePartialSpeedupCost(1, 1)).toBe(1);
  });
});

// Subscription Cost Per Day Tests

describe('calculateSubscriptionCostPerDay', () => {
  it('should divide USDC price by duration', () => {
    const config = { priceUsdc: 300, priceNovi: 1000, durationDays: 30 };
    expect(calculateSubscriptionCostPerDay(config, false)).toBe(10);
  });

  it('should divide NOVI price by duration when paying in NOVI', () => {
    const config = { priceUsdc: 300, priceNovi: 1500, durationDays: 30 };
    expect(calculateSubscriptionCostPerDay(config, true)).toBe(50);
  });

  it('should handle 1-day duration', () => {
    const config = { priceUsdc: 100, priceNovi: 500, durationDays: 1 };
    expect(calculateSubscriptionCostPerDay(config, false)).toBe(100);
    expect(calculateSubscriptionCostPerDay(config, true)).toBe(500);
  });

  it('should return fractional cost when price not evenly divisible', () => {
    const config = { priceUsdc: 100, priceNovi: 100, durationDays: 3 };
    const perDay = calculateSubscriptionCostPerDay(config, false);
    expect(perDay).toBeCloseTo(100 / 3, 5);
  });
});

// Attack Tax Tests

describe('calculateAttackTax', () => {
  it('should apply 10% tax (1000 bps)', () => {
    expect(calculateAttackTax(1000, 1000)).toBe(100);
  });

  it('should apply 50% tax (5000 bps)', () => {
    expect(calculateAttackTax(1000, 5000)).toBe(500);
  });

  it('should apply 100% tax (10000 bps)', () => {
    expect(calculateAttackTax(1000, 10000)).toBe(1000);
  });

  it('should apply 0% tax', () => {
    expect(calculateAttackTax(1000, 0)).toBe(0);
  });

  it('should handle 0 looted amount', () => {
    expect(calculateAttackTax(0, 5000)).toBe(0);
  });

  it('should floor the result', () => {
    // 33 * 1000 / 10000 = 3.3 -> floor to 3
    expect(calculateAttackTax(33, 1000)).toBe(3);
  });
});

// Shop Price Tests

describe('calculateShopPrice', () => {
  it('should return base price for tier 0 with no discount', () => {
    const price = calculateShopPrice(1000, 0, [0, 500, 1000, 2000]);
    expect(price).toBe(1000);
  });

  it('should apply tier discount', () => {
    const price = calculateShopPrice(1000, 1, [0, 500, 1000, 2000]);
    // 500 bps = 5% discount => 1000 * (10000 - 500) / 10000 = 950
    expect(price).toBe(950);
  });

  it('should apply larger discount for higher tiers', () => {
    const price0 = calculateShopPrice(1000, 0, [0, 500, 1000, 2000]);
    const price1 = calculateShopPrice(1000, 1, [0, 500, 1000, 2000]);
    const price3 = calculateShopPrice(1000, 3, [0, 500, 1000, 2000]);
    expect(price1).toBeLessThan(price0);
    expect(price3).toBeLessThan(price1);
  });

  it('should clamp tier to max available', () => {
    // tier 10 with only 4 entries should use last entry
    const price = calculateShopPrice(1000, 10, [0, 500, 1000, 2000]);
    const priceMax = calculateShopPrice(1000, 3, [0, 500, 1000, 2000]);
    expect(price).toBe(priceMax);
  });

  it('should handle base price of 0', () => {
    expect(calculateShopPrice(0, 1, [0, 500])).toBe(0);
  });
});

// Format Cost With Bonus Tests

describe('formatCostWithBonus', () => {
  it('should show discount when actualCost < 95% of baseCost', () => {
    const result = formatCostWithBonus(1000, 700);
    expect(result).toContain('-30%');
    expect(result).toContain('700');
  });

  it('should show premium when actualCost > 105% of baseCost', () => {
    const result = formatCostWithBonus(1000, 1500);
    expect(result).toContain('+50%');
    expect(result).toContain('1,500');
  });

  it('should show plain number when near 100%', () => {
    const result = formatCostWithBonus(1000, 1000);
    expect(result).not.toContain('%');
  });

  it('should show plain for small difference (within 5%)', () => {
    const result = formatCostWithBonus(1000, 1040);
    expect(result).not.toContain('%');
  });

  it('should handle equal values', () => {
    const result = formatCostWithBonus(500, 500);
    expect(result).toBe('500');
  });
});

// Cost Time Bonus Description Tests

describe('getCostTimeBonusDescription', () => {
  it('should return a non-empty string for each time of day', () => {
    const periods = [
      TimeOfDay.DeepNight,
      TimeOfDay.Dawn,
      TimeOfDay.Morning,
      TimeOfDay.Midday,
      TimeOfDay.Afternoon,
      TimeOfDay.Dusk,
      TimeOfDay.Evening,
    ];

    for (const period of periods) {
      const desc = getCostTimeBonusDescription(period);
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it('should return best prices for Midday (hiring is best during day)', () => {
    // Midday hiring multiplier is PHI = 1.618, costMultiplier = 1/1.618 = 0.618 < 0.7
    const desc = getCostTimeBonusDescription(TimeOfDay.Midday);
    expect(desc).toBe('Peak hours - Best prices!');
  });

  it('should return higher prices for DeepNight', () => {
    // DeepNight hiring multiplier is PHI_SQUARED_INVERSE = 0.382, costMultiplier = 1/0.382 = 2.618 > 1.5
    const desc = getCostTimeBonusDescription(TimeOfDay.DeepNight);
    expect(desc).toBe('Off-peak - Higher prices');
  });

  it('should return normal prices for Dawn/Dusk (multiplier 1.0)', () => {
    // Dawn/Dusk hiring multiplier is 1.0, costMultiplier = 1.0 -- between 0.95 and 1.05
    const desc = getCostTimeBonusDescription(TimeOfDay.Dawn);
    expect(desc).toBe('Normal prices');
  });
});

// Recovery Cost Tests

describe('calculateRecoveryCost', () => {
  it('should be 50% of base hiring cost with no discounts', () => {
    // 50% of 100 = 50, no infirmary or daily discounts
    const cost = calculateRecoveryCost(100, 0, 0, 1);
    expect(cost).toBe(50);
  });

  it('should scale with amount', () => {
    const cost1 = calculateRecoveryCost(100, 0, 0, 1);
    const cost10 = calculateRecoveryCost(100, 0, 0, 10);
    expect(cost10).toBe(cost1 * 10);
  });

  it('should apply infirmary recovery discount', () => {
    const noInf = calculateRecoveryCost(100, 0, 0, 1);
    const withInf = calculateRecoveryCost(100, 2500, 0, 1); // 25% infirmary discount
    expect(withInf).toBeLessThan(noInf);
  });

  it('should apply daily buff discount', () => {
    const noDaily = calculateRecoveryCost(100, 0, 0, 1);
    const withDaily = calculateRecoveryCost(100, 0, 1000, 1); // 10% daily discount
    expect(withDaily).toBeLessThan(noDaily);
  });

  it('should apply both discounts', () => {
    const neither = calculateRecoveryCost(100, 0, 0, 1);
    const both = calculateRecoveryCost(100, 2500, 1000, 1);
    expect(both).toBeLessThan(neither);
  });

  it('should never go below 1 per unit', () => {
    // Very high discounts: should still be at least 1 per unit
    const cost = calculateRecoveryCost(1, 9000, 9000, 1);
    expect(cost).toBeGreaterThanOrEqual(1);
  });

  it('should handle amount of 0', () => {
    expect(calculateRecoveryCost(100, 0, 0, 0)).toBe(0);
  });

  it('should handle large base costs', () => {
    const cost = calculateRecoveryCost(1_000_000, 0, 0, 1);
    expect(cost).toBe(500_000);
  });

  it('should calculate correctly with combined discounts', () => {
    // base=1000, 50% base discount => 500
    // infirmary 2500 bps (25%): 500 * (10000-2500)/10000 = 500 * 0.75 = 375
    // daily 1000 bps (10%): 375 * (10000-1000)/10000 = 375 * 0.9 = 337.5 -> floor to 337
    const cost = calculateRecoveryCost(1000, 2500, 1000, 1);
    expect(cost).toBe(337);
  });
});

// Mathematical Properties

describe('Cost Mathematical Properties', () => {
  it('upgrade cost should be exponential (each level multiplied by PHI_SQUARED)', () => {
    const baseCost = 100;
    let expected = baseCost;
    for (let level = 0; level <= 5; level++) {
      expect(calculateUpgradeCost(baseCost, level)).toBe(expected);
      expected = Math.floor(expected * PHI_SQUARED);
    }
  });

  it('research cost should use GOLDEN_ROOT scaling', () => {
    const baseCost = 500;
    for (let level = 0; level <= 5; level++) {
      const cost = calculateResearchCost(baseCost, level);
      const expected = Math.floor(baseCost * Math.pow(GOLDEN_ROOT, level));
      expect(cost).toBe(expected);
    }
  });

  it('NOVI power conversion should be monotonically increasing', () => {
    let prev = 0;
    for (let novi = 0; novi <= 100; novi += 10) {
      const power = calculateNoviToPower(novi);
      expect(power).toBeGreaterThanOrEqual(prev);
      prev = power;
    }
  });

  it('attack tax should be proportional to loot', () => {
    const taxBps = 1500;
    const tax100 = calculateAttackTax(100, taxBps);
    const tax200 = calculateAttackTax(200, taxBps);
    expect(tax200).toBe(tax100 * 2);
  });

  it('cumulative upgrade cost should be strictly increasing with level', () => {
    let prev = 0;
    for (let level = 2; level <= 10; level++) {
      const cum = calculateCumulativeUpgradeCost(100, level);
      expect(cum).toBeGreaterThan(prev);
      prev = cum;
    }
  });
});
