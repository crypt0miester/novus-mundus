/**
 * Progression Calculator Unit Tests
 *
 * Tests for XP, leveling, and progression calculations.
 */

import { describe, it, expect } from 'bun:test';
import {
  xpRequiredForLevel,
  xpToNextLevel,
  cumulativeXpForLevel,
  levelFromXp,
  levelAndOverflowFromXp,
  simulateGrantXp,
  calculateXpWithTimeBonus,
  getXpBonusMultiplier,
  levelProgressPercent,
  xpRemainingToNextLevel,
  formatLevelProgress,
  actionsToLevelUp,
  estimateXpPerHour,
} from '../../src/calculators/progression';

import { TimeOfDay } from '../../src/calculators/time';
import { PHI_SQUARED } from '../../src/calculators/constants';

// ============================================================
// XP Required For Level Tests
// ============================================================

describe('xpRequiredForLevel', () => {
  it('should return 0 for level 1', () => {
    expect(xpRequiredForLevel(1)).toBe(0);
  });

  it('should return 0 for level 0', () => {
    expect(xpRequiredForLevel(0)).toBe(0);
  });

  it('should return 0 for negative levels', () => {
    expect(xpRequiredForLevel(-5)).toBe(0);
  });

  it('should return 100 for level 2', () => {
    // 100 * 2.5^(2-2) = 100 * 1 = 100
    expect(xpRequiredForLevel(2)).toBe(100);
  });

  it('should return 250 for level 3', () => {
    // 100 * 2.5^(3-2) = 100 * 2.5 = 250
    expect(xpRequiredForLevel(3)).toBe(250);
  });

  it('should return 625 for level 4', () => {
    // 100 * 2.5^(4-2) = 100 * 6.25 = 625
    expect(xpRequiredForLevel(4)).toBe(625);
  });

  it('should return 1562 for level 5', () => {
    // 100 * 2.5^(5-2) = 100 * 15.625 = 1562 (floored)
    expect(xpRequiredForLevel(5)).toBe(1562);
  });

  it('should follow exponential curve: 100 * 2.5^(level-2)', () => {
    for (let level = 2; level <= 10; level++) {
      const expected = Math.floor(100 * Math.pow(2.5, level - 2));
      expect(xpRequiredForLevel(level)).toBe(expected);
    }
  });

  it('should increase with level', () => {
    let prev = 0;
    for (let level = 2; level <= 15; level++) {
      const xp = xpRequiredForLevel(level);
      expect(xp).toBeGreaterThan(prev);
      prev = xp;
    }
  });

  it('should floor the result', () => {
    for (let level = 2; level <= 10; level++) {
      const xp = xpRequiredForLevel(level);
      expect(Number.isInteger(xp)).toBe(true);
    }
  });
});

// ============================================================
// XP To Next Level Tests
// ============================================================

describe('xpToNextLevel', () => {
  it('should return xpRequiredForLevel(currentLevel + 1)', () => {
    for (let level = 1; level <= 10; level++) {
      expect(xpToNextLevel(level)).toBe(xpRequiredForLevel(level + 1));
    }
  });

  it('should return 100 for level 1 (need to reach level 2)', () => {
    expect(xpToNextLevel(1)).toBe(100);
  });

  it('should return 250 for level 2', () => {
    expect(xpToNextLevel(2)).toBe(250);
  });

  it('should increase with level', () => {
    let prev = 0;
    for (let level = 1; level <= 10; level++) {
      const xp = xpToNextLevel(level);
      expect(xp).toBeGreaterThan(prev);
      prev = xp;
    }
  });
});

// ============================================================
// Cumulative XP For Level Tests
// ============================================================

describe('cumulativeXpForLevel', () => {
  it('should return 0 for level 1', () => {
    expect(cumulativeXpForLevel(1)).toBe(0);
  });

  it('should return 0 for level 0', () => {
    expect(cumulativeXpForLevel(0)).toBe(0);
  });

  it('should return 100 for level 2', () => {
    // Just the level 2 requirement
    expect(cumulativeXpForLevel(2)).toBe(100);
  });

  it('should return 350 for level 3', () => {
    // 100 + 250 = 350
    expect(cumulativeXpForLevel(3)).toBe(350);
  });

  it('should return 975 for level 4', () => {
    // 100 + 250 + 625 = 975
    expect(cumulativeXpForLevel(4)).toBe(975);
  });

  it('should equal sum of individual level requirements', () => {
    for (let targetLevel = 2; targetLevel <= 10; targetLevel++) {
      let manualSum = 0;
      for (let i = 2; i <= targetLevel; i++) {
        manualSum += xpRequiredForLevel(i);
      }
      expect(cumulativeXpForLevel(targetLevel)).toBe(manualSum);
    }
  });

  it('should increase strictly with level', () => {
    let prev = 0;
    for (let level = 2; level <= 15; level++) {
      const cum = cumulativeXpForLevel(level);
      expect(cum).toBeGreaterThan(prev);
      prev = cum;
    }
  });
});

// ============================================================
// Level From XP Tests
// ============================================================

describe('levelFromXp', () => {
  it('should return level 1 for 0 XP', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it('should return level 1 for XP just under level 2 requirement', () => {
    expect(levelFromXp(99)).toBe(1);
  });

  it('should return level 2 for exactly 100 XP', () => {
    expect(levelFromXp(100)).toBe(2);
  });

  it('should return level 3 for exactly 350 XP', () => {
    // cumulative for level 3 = 350
    expect(levelFromXp(350)).toBe(3);
  });

  it('should return level 2 for 349 XP', () => {
    expect(levelFromXp(349)).toBe(2);
  });

  it('should be inverse of cumulativeXpForLevel', () => {
    for (let level = 1; level <= 10; level++) {
      const xp = cumulativeXpForLevel(level);
      expect(levelFromXp(xp)).toBe(level);
    }
  });

  it('should not exceed 255', () => {
    // Very large XP should cap at 255
    expect(levelFromXp(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(255);
  });

  it('should handle negative XP as level 1', () => {
    expect(levelFromXp(-100)).toBe(1);
  });
});

// ============================================================
// Level And Overflow From XP Tests
// ============================================================

describe('levelAndOverflowFromXp', () => {
  it('should return [1, 0] for 0 XP', () => {
    const [level, overflow] = levelAndOverflowFromXp(0);
    expect(level).toBe(1);
    expect(overflow).toBe(0);
  });

  it('should return [2, 0] for exactly 100 XP', () => {
    const [level, overflow] = levelAndOverflowFromXp(100);
    expect(level).toBe(2);
    expect(overflow).toBe(0);
  });

  it('should return [1, 50] for 50 XP', () => {
    const [level, overflow] = levelAndOverflowFromXp(50);
    expect(level).toBe(1);
    expect(overflow).toBe(50);
  });

  it('should return [2, 50] for 150 XP', () => {
    // 100 to reach level 2, 50 leftover
    const [level, overflow] = levelAndOverflowFromXp(150);
    expect(level).toBe(2);
    expect(overflow).toBe(50);
  });

  it('should return [3, 0] for exactly 350 XP', () => {
    const [level, overflow] = levelAndOverflowFromXp(350);
    expect(level).toBe(3);
    expect(overflow).toBe(0);
  });

  it('overflow should always be < xpRequiredForLevel(level + 1)', () => {
    const testXps = [0, 50, 100, 150, 350, 500, 975, 1000, 5000, 50000];
    for (const xp of testXps) {
      const [level, overflow] = levelAndOverflowFromXp(xp);
      const nextLevelXp = xpRequiredForLevel(level + 1);
      expect(overflow).toBeLessThan(nextLevelXp);
      expect(overflow).toBeGreaterThanOrEqual(0);
    }
  });

  it('should be consistent with levelFromXp', () => {
    const testXps = [0, 50, 100, 349, 350, 974, 975, 5000];
    for (const xp of testXps) {
      const [level] = levelAndOverflowFromXp(xp);
      expect(level).toBe(levelFromXp(xp));
    }
  });
});

// ============================================================
// Simulate Grant XP Tests
// ============================================================

describe('simulateGrantXp', () => {
  it('should add XP without leveling up', () => {
    const [level, xp, levelsGained] = simulateGrantXp(1, 0, 50);
    expect(level).toBe(1);
    expect(xp).toBe(50);
    expect(levelsGained).toBe(0);
  });

  it('should level up when XP exceeds requirement', () => {
    // Level 1, 0 XP, grant 100 => level 2
    const [level, xp, levelsGained] = simulateGrantXp(1, 0, 100);
    expect(level).toBe(2);
    expect(xp).toBe(0);
    expect(levelsGained).toBe(1);
  });

  it('should handle overflow XP on level up', () => {
    // Level 1, 0 XP, grant 150 => level 2 with 50 overflow
    const [level, xp, levelsGained] = simulateGrantXp(1, 0, 150);
    expect(level).toBe(2);
    expect(xp).toBe(50);
    expect(levelsGained).toBe(1);
  });

  it('should handle multi-level-up', () => {
    // Level 1, 0 XP, grant 350 (cumulative for level 3) => level 3
    const [level, xp, levelsGained] = simulateGrantXp(1, 0, 350);
    expect(level).toBe(3);
    expect(xp).toBe(0);
    expect(levelsGained).toBe(2);
  });

  it('should handle multi-level-up with overflow', () => {
    // Level 1, 0 XP, grant 400 => level 3 with 50 overflow
    const [level, xp, levelsGained] = simulateGrantXp(1, 0, 400);
    expect(level).toBe(3);
    expect(xp).toBe(50);
    expect(levelsGained).toBe(2);
  });

  it('should account for existing XP', () => {
    // Level 1, 50 XP, grant 50 => level 2
    const [level, xp, levelsGained] = simulateGrantXp(1, 50, 50);
    expect(level).toBe(2);
    expect(xp).toBe(0);
    expect(levelsGained).toBe(1);
  });

  it('should handle 0 XP grant', () => {
    const [level, xp, levelsGained] = simulateGrantXp(5, 100, 0);
    expect(level).toBe(5);
    expect(xp).toBe(100);
    expect(levelsGained).toBe(0);
  });

  it('should not exceed level 255', () => {
    const [level, , levelsGained] = simulateGrantXp(1, 0, Number.MAX_SAFE_INTEGER);
    expect(level).toBeLessThanOrEqual(255);
    expect(levelsGained).toBeLessThanOrEqual(254);
  });
});

// ============================================================
// Calculate XP With Time Bonus Tests
// ============================================================

describe('calculateXpWithTimeBonus', () => {
  it('should return a positive value for positive base XP', () => {
    const xp = calculateXpWithTimeBonus(100, 0, 0);
    expect(xp).toBeGreaterThan(0);
  });

  it('should return 0 for base XP of 0', () => {
    expect(calculateXpWithTimeBonus(0, 0, 0)).toBe(0);
  });

  it('should apply hero XP gain buff', () => {
    // Same timestamp/longitude, with and without hero buff
    const baseXp = calculateXpWithTimeBonus(100, 43200, 0, 0);
    const buffXp = calculateXpWithTimeBonus(100, 43200, 0, 5000); // 50% hero buff
    expect(buffXp).toBeGreaterThan(baseXp);
  });

  it('should floor the result', () => {
    const xp = calculateXpWithTimeBonus(1, 0, 0);
    expect(Number.isInteger(xp)).toBe(true);
  });
});

// ============================================================
// Get XP Bonus Multiplier Tests
// ============================================================

describe('getXpBonusMultiplier', () => {
  it('should return PHI_SQUARED for Dawn', () => {
    expect(getXpBonusMultiplier(TimeOfDay.Dawn)).toBeCloseTo(PHI_SQUARED, 5);
  });

  it('should return PHI_SQUARED for Dusk', () => {
    expect(getXpBonusMultiplier(TimeOfDay.Dusk)).toBeCloseTo(PHI_SQUARED, 5);
  });

  it('should return 1.0 for Afternoon', () => {
    expect(getXpBonusMultiplier(TimeOfDay.Afternoon)).toBe(1.0);
  });

  it('should return a positive value for all time periods', () => {
    const periods = [
      TimeOfDay.DeepNight, TimeOfDay.Dawn, TimeOfDay.Morning,
      TimeOfDay.Midday, TimeOfDay.Afternoon, TimeOfDay.Dusk, TimeOfDay.Evening,
    ];
    for (const period of periods) {
      expect(getXpBonusMultiplier(period)).toBeGreaterThan(0);
    }
  });

  it('Dawn/Dusk should be the best XP periods', () => {
    const dawnMult = getXpBonusMultiplier(TimeOfDay.Dawn);
    const middayMult = getXpBonusMultiplier(TimeOfDay.Midday);
    const afternoonMult = getXpBonusMultiplier(TimeOfDay.Afternoon);
    expect(dawnMult).toBeGreaterThan(middayMult);
    expect(dawnMult).toBeGreaterThan(afternoonMult);
  });
});

// ============================================================
// Level Progress Percent Tests
// ============================================================

describe('levelProgressPercent', () => {
  it('should return 0 at start of level', () => {
    expect(levelProgressPercent(1, 0)).toBe(0);
  });

  it('should return 50 at halfway', () => {
    // Level 1 needs 100 XP for level 2
    expect(levelProgressPercent(1, 50)).toBe(50);
  });

  it('should return 99 at 99/100 XP', () => {
    expect(levelProgressPercent(1, 99)).toBe(99);
  });

  it('should cap at 100', () => {
    // XP exceeds requirement
    expect(levelProgressPercent(1, 200)).toBe(100);
  });

  it('should handle level 2 correctly', () => {
    // Level 2 needs 250 XP for level 3
    const percent = levelProgressPercent(2, 125);
    expect(percent).toBe(50);
  });

  it('should floor the result', () => {
    // 33/100 = 33%
    expect(levelProgressPercent(1, 33)).toBe(33);
  });
});

// ============================================================
// XP Remaining To Next Level Tests
// ============================================================

describe('xpRemainingToNextLevel', () => {
  it('should return full requirement at 0 XP', () => {
    expect(xpRemainingToNextLevel(1, 0)).toBe(100);
  });

  it('should return 0 when XP meets requirement', () => {
    expect(xpRemainingToNextLevel(1, 100)).toBe(0);
  });

  it('should return 0 when XP exceeds requirement', () => {
    expect(xpRemainingToNextLevel(1, 200)).toBe(0);
  });

  it('should return correct remaining for partial XP', () => {
    expect(xpRemainingToNextLevel(1, 30)).toBe(70);
  });

  it('should handle level 2', () => {
    // Level 2 needs 250 for level 3
    expect(xpRemainingToNextLevel(2, 100)).toBe(150);
  });
});

// ============================================================
// Format Level Progress Tests
// ============================================================

describe('formatLevelProgress', () => {
  it('should format progress correctly', () => {
    const result = formatLevelProgress(1, 50);
    expect(result).toContain('50');
    expect(result).toContain('100');
    expect(result).toContain('XP');
    expect(result).toContain('50%');
  });

  it('should format at 0 XP', () => {
    const result = formatLevelProgress(1, 0);
    expect(result).toContain('0%');
    expect(result).toContain('XP');
  });

  it('should use locale formatting for large numbers', () => {
    // Level 5 needs 1562 XP; grant 1000
    const result = formatLevelProgress(5, 1000);
    expect(result).toContain('XP');
    // Percentage should be present
    expect(result).toMatch(/\d+%/);
  });
});

// ============================================================
// Actions To Level Up Tests
// ============================================================

describe('actionsToLevelUp', () => {
  it('should calculate actions needed', () => {
    // Level 1, 0 XP, 10 XP/action => 100/10 = 10 actions
    expect(actionsToLevelUp(1, 0, 10)).toBe(10);
  });

  it('should account for existing XP', () => {
    // Level 1, 50 XP, 10 XP/action => 50/10 = 5 actions
    expect(actionsToLevelUp(1, 50, 10)).toBe(5);
  });

  it('should ceil partial actions', () => {
    // Level 1, 0 XP, 30 XP/action => 100/30 = 3.33 -> 4 actions
    expect(actionsToLevelUp(1, 0, 30)).toBe(4);
  });

  it('should return 0 when XP already meets requirement', () => {
    expect(actionsToLevelUp(1, 100, 10)).toBe(0);
  });

  it('should return Infinity for 0 XP per action', () => {
    expect(actionsToLevelUp(1, 0, 0)).toBe(Infinity);
  });

  it('should return Infinity for negative XP per action', () => {
    expect(actionsToLevelUp(1, 0, -5)).toBe(Infinity);
  });

  it('should return 1 when exactly 1 action away', () => {
    // Level 1, 90 XP, 10 XP/action => 10/10 = 1
    expect(actionsToLevelUp(1, 90, 10)).toBe(1);
  });
});

// ============================================================
// Estimate XP Per Hour Tests
// ============================================================

describe('estimateXpPerHour', () => {
  it('should calculate base XP rate', () => {
    // Rarity 0 = 10 base XP, Afternoon multiplier = 1.0
    const xpPerHour = estimateXpPerHour(10, 0, TimeOfDay.Afternoon);
    expect(xpPerHour).toBe(100); // 10 encounters * 10 XP
  });

  it('should scale with encounters per hour', () => {
    const xp10 = estimateXpPerHour(10, 0, TimeOfDay.Afternoon);
    const xp20 = estimateXpPerHour(20, 0, TimeOfDay.Afternoon);
    expect(xp20).toBe(xp10 * 2);
  });

  it('should scale with rarity', () => {
    // Rarity 0 = 10 base, Rarity 1 = 25 base
    const xpR0 = estimateXpPerHour(10, 0, TimeOfDay.Afternoon);
    const xpR1 = estimateXpPerHour(10, 1, TimeOfDay.Afternoon);
    expect(xpR1).toBeGreaterThan(xpR0);
  });

  it('should apply time bonus', () => {
    // Dawn has PHI_SQUARED (2.618x) bonus for XP
    const xpAfternoon = estimateXpPerHour(10, 0, TimeOfDay.Afternoon);
    const xpDawn = estimateXpPerHour(10, 0, TimeOfDay.Dawn);
    expect(xpDawn).toBeGreaterThan(xpAfternoon);
  });

  it('should handle 0 encounters', () => {
    expect(estimateXpPerHour(0, 0, TimeOfDay.Midday)).toBe(0);
  });

  it('should clamp rarity to max 5', () => {
    // Rarity 100 should use index 5 (clamped)
    const xpHigh = estimateXpPerHour(10, 100, TimeOfDay.Afternoon);
    const xpMax = estimateXpPerHour(10, 5, TimeOfDay.Afternoon);
    expect(xpHigh).toBe(xpMax);
  });
});

// ============================================================
// Mathematical Properties
// ============================================================

describe('Progression Mathematical Properties', () => {
  it('XP curve should be exponential (ratio between levels is constant 2.5)', () => {
    for (let level = 3; level <= 8; level++) {
      const xpCurrent = xpRequiredForLevel(level);
      const xpPrev = xpRequiredForLevel(level - 1);
      // Ratio should be approximately 2.5 (may differ by 1 due to flooring)
      const ratio = xpCurrent / xpPrev;
      expect(ratio).toBeCloseTo(2.5, 1);
    }
  });

  it('levelFromXp should be inverse of cumulativeXpForLevel', () => {
    for (let level = 1; level <= 10; level++) {
      const xp = cumulativeXpForLevel(level);
      expect(levelFromXp(xp)).toBe(level);
    }
  });

  it('simulateGrantXp should be consistent with levelAndOverflowFromXp', () => {
    // Starting from level 1, 0 XP and granting totalXp
    // should be equivalent to levelAndOverflowFromXp(totalXp)
    const testXps = [0, 50, 100, 350, 975, 5000];
    for (const totalXp of testXps) {
      const [simLevel, simXp] = simulateGrantXp(1, 0, totalXp);
      const [lookupLevel, lookupXp] = levelAndOverflowFromXp(totalXp);
      expect(simLevel).toBe(lookupLevel);
      expect(simXp).toBe(lookupXp);
    }
  });

  it('remaining + current should equal requirement', () => {
    for (let xp = 0; xp < 100; xp += 10) {
      const remaining = xpRemainingToNextLevel(1, xp);
      expect(xp + remaining).toBe(100);
    }
  });

  it('progress percent should increase monotonically with XP', () => {
    let prevPercent = -1;
    for (let xp = 0; xp <= 100; xp += 5) {
      const percent = levelProgressPercent(1, xp);
      expect(percent).toBeGreaterThanOrEqual(prevPercent);
      prevPercent = percent;
    }
  });
});
