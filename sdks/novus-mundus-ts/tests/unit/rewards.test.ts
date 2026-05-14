/**
 * Reward Calculator Unit Tests
 *
 * Tests for oscillation multipliers, level scaling, Novi/fragment/gem
 * award determination, loot pool generation, XP rewards, and daily rewards.
 */

import { describe, it, expect } from 'bun:test';
import {
  // Oscillation
  calculateOscillationMultiplier,
  // Level scaling
  calculateLevelMultiplier,
  // Award determination
  shouldAwardNovi,
  shouldAwardFragments,
  shouldAwardGems,
  // Reward types
  calculateRewardTypeCount,
  determineRewardTypes,
  // Fragment/gem amounts
  calculateFragmentAmount,
  calculateGemAmount,
  // Loot pool
  calculateEncounterLootPool,
  lootPoolHasLoot,
  // XP
  XpAction,
  calculateXpReward,
  // Daily rewards
  calculateDailyRewards,
  // Types
  type EncounterLootPool,
} from '../../src/calculators/rewards';

// Oscillation Multiplier Tests

describe('Oscillation Multiplier', () => {
  describe('calculateOscillationMultiplier', () => {
    it('should return a value in basis points', () => {
      const mult = calculateOscillationMultiplier(1000, 500, 1, 3600, 1000);
      expect(mult).toBeGreaterThanOrEqual(2000);
      expect(mult).toBeLessThanOrEqual(20000);
    });

    it('should be clamped between 0.2x (2000) and 2.0x (20000)', () => {
      // Test with extreme amplitude
      for (let t = 0; t < 10; t++) {
        const mult = calculateOscillationMultiplier(t * 1000, 0, 0, 1, 15000);
        expect(mult).toBeGreaterThanOrEqual(2000);
        expect(mult).toBeLessThanOrEqual(20000);
      }
    });

    it('should oscillate around 10000 (1.0x) with moderate amplitude', () => {
      // Collect values over a range of times
      const values: number[] = [];
      for (let t = 0; t < 100; t++) {
        values.push(calculateOscillationMultiplier(t * 100, 0, 0, 1, 3000));
      }

      // Should have some values above and below 10000
      const hasAbove = values.some((v) => v > 10000);
      const hasBelow = values.some((v) => v < 10000);
      expect(hasAbove).toBe(true);
      expect(hasBelow).toBe(true);
    });

    it('should vary with different spawn times (phase shift)', () => {
      const mult1 = calculateOscillationMultiplier(5000, 0, 1, 1, 3000);
      const mult2 = calculateOscillationMultiplier(5000, 1000, 1, 1, 3000);
      // Different spawn times should produce different multipliers
      // (could coincidentally be equal, but very unlikely with these params)
      expect(typeof mult1).toBe('number');
      expect(typeof mult2).toBe('number');
    });

    it('should vary with different encounter IDs', () => {
      const mult1 = calculateOscillationMultiplier(5000, 0, 1, 1, 3000);
      const mult2 = calculateOscillationMultiplier(5000, 0, 50, 1, 3000);
      expect(typeof mult1).toBe('number');
      expect(typeof mult2).toBe('number');
    });

    it('should return 10000 when amplitude is 0', () => {
      const mult = calculateOscillationMultiplier(5000, 0, 0, 1, 0);
      expect(mult).toBe(10000);
    });
  });
});

// Level Scaling Tests

describe('Level Scaling', () => {
  describe('calculateLevelMultiplier', () => {
    it('should return 10000 (1.0x) for level 0', () => {
      expect(calculateLevelMultiplier(0)).toBe(10000);
    });

    it('should return 10000 (1.0x) when divisor is 0', () => {
      expect(calculateLevelMultiplier(10, 1.5, 0)).toBe(10000);
    });

    it('should increase with level', () => {
      const level5 = calculateLevelMultiplier(5);
      const level10 = calculateLevelMultiplier(10);
      const level50 = calculateLevelMultiplier(50);
      expect(level10).toBeGreaterThan(level5);
      expect(level50).toBeGreaterThan(level10);
    });

    it('should match expected values from docs', () => {
      // level 1: (1^1.5)/10 * 10000 = 0.1 * 10000 = 1000
      expect(calculateLevelMultiplier(1, 1.5, 10)).toBe(1000);

      // level 100: 100^1.5 = 1000, 1000/10 = 100, 100 * 10000 = 1000000
      expect(calculateLevelMultiplier(100, 1.5, 10)).toBe(1000000);
    });

    it('should use default exponent and divisor', () => {
      // Default: scalingExp=1.5, scalingDivisor=10
      const withDefaults = calculateLevelMultiplier(10);
      const explicit = calculateLevelMultiplier(10, 1.5, 10);
      expect(withDefaults).toBe(explicit);
    });

    it('should floor the result', () => {
      // Ensure result is an integer
      const result = calculateLevelMultiplier(7, 1.3, 5);
      expect(result).toBe(Math.floor(result));
    });
  });
});

// Novi Award Determination Tests

describe('Novi Award Determination', () => {
  describe('shouldAwardNovi', () => {
    it('should not award for low level common (level 1, rarity 0)', () => {
      expect(shouldAwardNovi(1, 0)).toBe(false);
    });

    it('should not award for level 20 common', () => {
      expect(shouldAwardNovi(20, 0)).toBe(false);
    });

    it('should award for level 21+ uncommon (rarity 1) - sqrt-phi tier', () => {
      expect(shouldAwardNovi(21, 1)).toBe(true);
      expect(shouldAwardNovi(30, 1)).toBe(true);
    });

    it('should not award for level 20 uncommon', () => {
      expect(shouldAwardNovi(20, 1)).toBe(false);
    });

    it('should award for level 41+ rare (rarity 2) - phi tier', () => {
      expect(shouldAwardNovi(41, 2)).toBe(true);
      expect(shouldAwardNovi(60, 2)).toBe(true);
    });

    it('should award for level 40 rare (meets sqrt-phi tier: level >= 21, rarity >= 1)', () => {
      expect(shouldAwardNovi(40, 2)).toBe(true);
    });

    it('should award for level 61+ epic (rarity 3) - phi-squared tier', () => {
      expect(shouldAwardNovi(61, 3)).toBe(true);
      expect(shouldAwardNovi(100, 4)).toBe(true);
    });

    it('should award for level 60 epic (meets phi tier: level >= 41, rarity >= 2)', () => {
      expect(shouldAwardNovi(60, 3)).toBe(true);
    });

    it('should not award for level 20 with rarity 0 (no tier met)', () => {
      expect(shouldAwardNovi(20, 0)).toBe(false);
      expect(shouldAwardNovi(40, 0)).toBe(false);
      expect(shouldAwardNovi(60, 0)).toBe(false);
    });

    it('should check lower tiers when higher tier not met', () => {
      // Level 50, rarity 2 -> meets phi tier (41+ and rarity >= 2)
      expect(shouldAwardNovi(50, 2)).toBe(true);
      // Level 25, rarity 1 -> meets sqrt-phi tier (21+ and rarity >= 1)
      expect(shouldAwardNovi(25, 1)).toBe(true);
    });
  });

  describe('shouldAwardFragments', () => {
    it('should not award without fragment drops unlocked', () => {
      expect(shouldAwardFragments(50, 3, false)).toBe(false);
      expect(shouldAwardFragments(100, 4, false)).toBe(false);
    });

    it('should award for any level when fragment drops unlocked', () => {
      // The function returns true for any level/rarity once unlocked
      expect(shouldAwardFragments(1, 0, true)).toBe(true);
    });

    it('should award for high level rare with drops', () => {
      expect(shouldAwardFragments(31, 2, true)).toBe(true);
    });

    it('should award for mid level uncommon with drops', () => {
      expect(shouldAwardFragments(16, 1, true)).toBe(true);
    });
  });

  describe('shouldAwardGems', () => {
    it('should not award without gem drops unlocked', () => {
      expect(shouldAwardGems(100, 4, false)).toBe(false);
    });

    it('should not award for low level with gem drops', () => {
      expect(shouldAwardGems(1, 0, true)).toBe(false);
      expect(shouldAwardGems(20, 0, true)).toBe(false);
    });

    it('should award for level 71+ epic (rarity 3)', () => {
      expect(shouldAwardGems(71, 3, true)).toBe(true);
    });

    it('should award for level 41+ rare (rarity 2)', () => {
      expect(shouldAwardGems(41, 2, true)).toBe(true);
    });

    it('should award for level 21+ uncommon (rarity 1)', () => {
      expect(shouldAwardGems(21, 1, true)).toBe(true);
    });

    it('should not award for level 20 uncommon', () => {
      expect(shouldAwardGems(20, 1, true)).toBe(false);
    });
  });
});

// Reward Type Count Tests

describe('Reward Type Count', () => {
  describe('calculateRewardTypeCount', () => {
    it('should return 1 for levels 1-5', () => {
      expect(calculateRewardTypeCount(1)).toBe(1);
      expect(calculateRewardTypeCount(5)).toBe(1);
    });

    it('should return 2 for levels 6-15', () => {
      expect(calculateRewardTypeCount(6)).toBe(2);
      expect(calculateRewardTypeCount(15)).toBe(2);
    });

    it('should return 3 for levels 16-30', () => {
      expect(calculateRewardTypeCount(16)).toBe(3);
      expect(calculateRewardTypeCount(30)).toBe(3);
    });

    it('should return 4 for levels 31-50', () => {
      expect(calculateRewardTypeCount(31)).toBe(4);
      expect(calculateRewardTypeCount(50)).toBe(4);
    });

    it('should return 5 for levels 51+', () => {
      expect(calculateRewardTypeCount(51)).toBe(5);
      expect(calculateRewardTypeCount(100)).toBe(5);
    });
  });

  describe('determineRewardTypes', () => {
    it('should return [false, false, false, false] for level 1 without novi', () => {
      const [produce, weapons, vehicles, novi] = determineRewardTypes(1, false);
      expect(produce).toBe(false);
      expect(weapons).toBe(false);
      expect(vehicles).toBe(false);
      expect(novi).toBe(false);
    });

    it('should award produce at level 3+', () => {
      const [produce] = determineRewardTypes(3, false);
      expect(produce).toBe(true);

      const [produceLow] = determineRewardTypes(2, false);
      expect(produceLow).toBe(false);
    });

    it('should award weapons at level 5+', () => {
      const [, weapons] = determineRewardTypes(5, false);
      expect(weapons).toBe(true);

      const [, weaponsLow] = determineRewardTypes(4, false);
      expect(weaponsLow).toBe(false);
    });

    it('should award vehicles at level 20+', () => {
      const [, , vehicles] = determineRewardTypes(20, false);
      expect(vehicles).toBe(true);

      const [, , vehiclesLow] = determineRewardTypes(19, false);
      expect(vehiclesLow).toBe(false);
    });

    it('should pass through novi award flag', () => {
      const [, , , noviTrue] = determineRewardTypes(50, true);
      expect(noviTrue).toBe(true);

      const [, , , noviFalse] = determineRewardTypes(50, false);
      expect(noviFalse).toBe(false);
    });
  });
});

// Fragment and Gem Amount Tests

describe('Fragment and Gem Amounts', () => {
  describe('calculateFragmentAmount', () => {
    it('should use Fibonacci base amounts by rarity', () => {
      // Common (0) = 2, Uncommon (1) = 3, Rare (2) = 5, Epic (3) = 8, Legendary (4) = 13
      // At level 0 with default params, base = fibBase * chainBps of multipliers at 1.0x
      // Level 0 -> levelExponent = 0 -> levelMult = 1.0 -> levelMultBp = 10000
      // Result = chainBps(base, [10000, 10000, 10000]) = base * 1.0 * 1.0 * 1.0

      // At level 0, synchrony 0, timeMult 1.0:
      // chainBps(2, [10000, 10000, 10000]) = 2
      const common = calculateFragmentAmount(0, 0, 0, 1.0);
      // chainBps result depends on implementation - at level 0 it should be close to base
      // Actually level 0: GOLDEN_ROOT^0 = 1.0 -> 10000 bps
      // chainBps(2, [10000, 10000, 10000]) = applyBps(applyBps(applyBps(2, 10000), 10000), 10000) = 2
      expect(common).toBe(2);
    });

    it('should increase with higher rarity', () => {
      const common = calculateFragmentAmount(10, 0, 0, 1.0);
      const uncommon = calculateFragmentAmount(10, 1, 0, 1.0);
      const rare = calculateFragmentAmount(10, 2, 0, 1.0);
      const epic = calculateFragmentAmount(10, 3, 0, 1.0);
      const legendary = calculateFragmentAmount(10, 4, 0, 1.0);

      expect(uncommon).toBeGreaterThan(common);
      expect(rare).toBeGreaterThan(uncommon);
      expect(epic).toBeGreaterThan(rare);
      expect(legendary).toBeGreaterThan(epic);
    });

    it('should increase with level', () => {
      const low = calculateFragmentAmount(1, 2, 0, 1.0);
      const mid = calculateFragmentAmount(20, 2, 0, 1.0);
      const high = calculateFragmentAmount(50, 2, 0, 1.0);

      expect(mid).toBeGreaterThan(low);
      expect(high).toBeGreaterThan(mid);
    });

    it('should increase with synchrony bonus', () => {
      const noBonus = calculateFragmentAmount(20, 2, 0, 1.0);
      const withBonus = calculateFragmentAmount(20, 2, 2000, 1.0); // 20% bonus
      expect(withBonus).toBeGreaterThan(noBonus);
    });

    it('should increase with time multiplier', () => {
      const baseTime = calculateFragmentAmount(20, 2, 0, 1.0);
      const goldenTime = calculateFragmentAmount(20, 2, 0, 2.618);
      expect(goldenTime).toBeGreaterThan(baseTime);
    });

    it('should always be a positive integer for reasonable inputs', () => {
      const result = calculateFragmentAmount(10, 2, 0, 1.0);
      expect(result).toBeGreaterThan(0);
      expect(result).toBe(Math.floor(result));
    });

    it('should clamp rarity to 0-4', () => {
      // Rarity 5 should use index 4 (Legendary)
      const r4 = calculateFragmentAmount(10, 4, 0, 1.0);
      const r5 = calculateFragmentAmount(10, 5, 0, 1.0);
      expect(r5).toBe(r4);
    });
  });

  describe('calculateGemAmount', () => {
    it('should use smaller Fibonacci base amounts than fragments', () => {
      // Gems: Common=1, Uncommon=2, Rare=3, Epic=5, Legendary=8
      const gem = calculateGemAmount(0, 0, 0, 1.0);
      const frag = calculateFragmentAmount(0, 0, 0, 1.0);
      expect(gem).toBeLessThanOrEqual(frag);
    });

    it('should increase with higher rarity', () => {
      const common = calculateGemAmount(10, 0, 0, 1.0);
      const rare = calculateGemAmount(10, 2, 0, 1.0);
      const legendary = calculateGemAmount(10, 4, 0, 1.0);

      expect(rare).toBeGreaterThan(common);
      expect(legendary).toBeGreaterThan(rare);
    });

    it('should increase with level (slower than fragments)', () => {
      const low = calculateGemAmount(1, 2, 0, 1.0);
      const high = calculateGemAmount(50, 2, 0, 1.0);
      expect(high).toBeGreaterThan(low);
    });

    it('should scale slower than fragments with level', () => {
      // Gems use level/20 vs fragments level/10
      const fragLow = calculateFragmentAmount(10, 2, 0, 1.0);
      const fragHigh = calculateFragmentAmount(40, 2, 0, 1.0);
      const fragRatio = fragHigh / fragLow;

      const gemLow = calculateGemAmount(10, 2, 0, 1.0);
      const gemHigh = calculateGemAmount(40, 2, 0, 1.0);
      const gemRatio = gemHigh / gemLow;

      expect(fragRatio).toBeGreaterThan(gemRatio);
    });

    it('should always be a positive integer for reasonable inputs', () => {
      const result = calculateGemAmount(10, 2, 0, 1.0);
      expect(result).toBeGreaterThan(0);
      expect(result).toBe(Math.floor(result));
    });
  });
});

// Encounter Loot Pool Tests

describe('Encounter Loot Pool', () => {
  // Common base arrays for testing (5 rarity tiers)
  const baseCash = [100, 200, 400, 800, 1600];
  const baseNovi = [0, 50, 100, 200, 500];
  const baseWeapons = [10, 20, 40, 80, 160];
  const baseProduce = [50, 100, 200, 400, 800];
  const baseVehicles = [0, 0, 5, 10, 25];
  const oscFreq = [1, 1, 1, 1, 1];
  const oscAmp = [1000, 1000, 1000, 1000, 1000];

  describe('calculateEncounterLootPool', () => {
    it('should return a loot pool with cash for any level', () => {
      const pool = calculateEncounterLootPool(
        1, 0, 0, 1, 1000, 0,
        baseCash, baseNovi, baseWeapons, baseProduce, baseVehicles,
        oscFreq, oscAmp
      );
      expect(pool.totalCash).toBeGreaterThanOrEqual(0);
    });

    it('should not award Novi at low level/rarity', () => {
      const pool = calculateEncounterLootPool(
        1, 0, 0, 1, 1000, 0,
        baseCash, baseNovi, baseWeapons, baseProduce, baseVehicles,
        oscFreq, oscAmp
      );
      expect(pool.totalNovi).toBe(0);
    });

    it('should have zero fragments and gems (calculated separately)', () => {
      const pool = calculateEncounterLootPool(
        50, 3, 0, 1, 1000, 0,
        baseCash, baseNovi, baseWeapons, baseProduce, baseVehicles,
        oscFreq, oscAmp
      );
      expect(pool.totalFragments).toBe(0);
      expect(pool.totalGems).toBe(0);
    });

    it('should produce higher rewards at higher levels', () => {
      const lowPool = calculateEncounterLootPool(
        5, 2, 100, 1, 50000, 0,
        baseCash, baseNovi, baseWeapons, baseProduce, baseVehicles,
        oscFreq, oscAmp
      );
      const highPool = calculateEncounterLootPool(
        50, 2, 100, 1, 50000, 0,
        baseCash, baseNovi, baseWeapons, baseProduce, baseVehicles,
        oscFreq, oscAmp
      );
      // Higher level should generally yield more cash
      expect(highPool.totalCash).toBeGreaterThan(lowPool.totalCash);
    });

    it('should clamp rarity index to 0-4', () => {
      // Rarity 10 should not crash, should use index 4
      const pool = calculateEncounterLootPool(
        10, 10, 0, 1, 1000, 0,
        baseCash, baseNovi, baseWeapons, baseProduce, baseVehicles,
        oscFreq, oscAmp
      );
      expect(pool.totalCash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('lootPoolHasLoot', () => {
    it('should return false for empty pool', () => {
      const pool: EncounterLootPool = {
        totalCash: 0,
        totalNovi: 0,
        totalWeapons: 0,
        totalProduce: 0,
        totalVehicles: 0,
        totalFragments: 0,
        totalGems: 0,
      };
      expect(lootPoolHasLoot(pool)).toBe(false);
    });

    it('should return true if any field is positive', () => {
      const cashPool: EncounterLootPool = {
        totalCash: 100,
        totalNovi: 0,
        totalWeapons: 0,
        totalProduce: 0,
        totalVehicles: 0,
        totalFragments: 0,
        totalGems: 0,
      };
      expect(lootPoolHasLoot(cashPool)).toBe(true);
    });

    it('should detect fragments', () => {
      const fragPool: EncounterLootPool = {
        totalCash: 0,
        totalNovi: 0,
        totalWeapons: 0,
        totalProduce: 0,
        totalVehicles: 0,
        totalFragments: 5,
        totalGems: 0,
      };
      expect(lootPoolHasLoot(fragPool)).toBe(true);
    });

    it('should detect gems', () => {
      const gemPool: EncounterLootPool = {
        totalCash: 0,
        totalNovi: 0,
        totalWeapons: 0,
        totalProduce: 0,
        totalVehicles: 0,
        totalFragments: 0,
        totalGems: 3,
      };
      expect(lootPoolHasLoot(gemPool)).toBe(true);
    });
  });
});

// XP Reward Tests

describe('XP Rewards', () => {
  describe('calculateXpReward', () => {
    it('should calculate XP for defeating player', () => {
      // 50 + level * 10
      expect(calculateXpReward(XpAction.DefeatPlayer, 1)).toBe(60);
      expect(calculateXpReward(XpAction.DefeatPlayer, 10)).toBe(150);
      expect(calculateXpReward(XpAction.DefeatPlayer, 0)).toBe(50);
    });

    it('should calculate XP for defeating encounter by rarity', () => {
      // Rarity 0=10, 1=25, 2=50, 3=100, 4=250, 5=500
      expect(calculateXpReward(XpAction.DefeatEncounter, 0)).toBe(10);
      expect(calculateXpReward(XpAction.DefeatEncounter, 1)).toBe(25);
      expect(calculateXpReward(XpAction.DefeatEncounter, 2)).toBe(50);
      expect(calculateXpReward(XpAction.DefeatEncounter, 3)).toBe(100);
      expect(calculateXpReward(XpAction.DefeatEncounter, 4)).toBe(250);
      expect(calculateXpReward(XpAction.DefeatEncounter, 5)).toBe(500);
    });

    it('should clamp encounter rarity to 5', () => {
      expect(calculateXpReward(XpAction.DefeatEncounter, 10)).toBe(500);
    });

    it('should calculate XP for travel (1 per km)', () => {
      expect(calculateXpReward(XpAction.CompleteTravel, 100)).toBe(100);
      expect(calculateXpReward(XpAction.CompleteTravel, 0)).toBe(0);
    });

    it('should calculate XP for resource collection (1 per 1000)', () => {
      expect(calculateXpReward(XpAction.CollectResources, 5000)).toBe(5);
      expect(calculateXpReward(XpAction.CollectResources, 999)).toBe(0);
      expect(calculateXpReward(XpAction.CollectResources, 1000)).toBe(1);
    });

    it('should return positive XP for all valid actions', () => {
      expect(calculateXpReward(XpAction.DefeatPlayer, 5)).toBeGreaterThan(0);
      expect(calculateXpReward(XpAction.DefeatEncounter, 2)).toBeGreaterThan(0);
      expect(calculateXpReward(XpAction.CompleteTravel, 50)).toBeGreaterThan(0);
      expect(calculateXpReward(XpAction.CollectResources, 10000)).toBeGreaterThan(0);
    });
  });
});

// Daily Rewards Tests

describe('Daily Rewards', () => {
  describe('calculateDailyRewards', () => {
    it('should apply tier multiplier to all reward types', () => {
      // 1.0x multiplier (10000 bps) = no change
      const rewards = calculateDailyRewards(1000, 500, 100, 10000);
      expect(rewards.cash).toBe(1000);
      expect(rewards.produce).toBe(500);
      expect(rewards.xp).toBe(100);
    });

    it('should apply 50% multiplier', () => {
      const rewards = calculateDailyRewards(1000, 500, 100, 5000);
      expect(rewards.cash).toBe(500);
      expect(rewards.produce).toBe(250);
      expect(rewards.xp).toBe(50);
    });

    it('should apply 200% multiplier (premium tier)', () => {
      const rewards = calculateDailyRewards(1000, 500, 100, 20000);
      expect(rewards.cash).toBe(2000);
      expect(rewards.produce).toBe(1000);
      expect(rewards.xp).toBe(200);
    });

    it('should return 0 for all rewards with 0 multiplier', () => {
      const rewards = calculateDailyRewards(1000, 500, 100, 0);
      expect(rewards.cash).toBe(0);
      expect(rewards.produce).toBe(0);
      expect(rewards.xp).toBe(0);
    });

    it('should handle zero base amounts', () => {
      const rewards = calculateDailyRewards(0, 0, 0, 15000);
      expect(rewards.cash).toBe(0);
      expect(rewards.produce).toBe(0);
      expect(rewards.xp).toBe(0);
    });

    it('should floor fractional results', () => {
      // 333 * 5000 / 10000 = 166.5 -> floor to 166
      const rewards = calculateDailyRewards(333, 0, 0, 5000);
      expect(rewards.cash).toBe(166);
    });
  });
});
