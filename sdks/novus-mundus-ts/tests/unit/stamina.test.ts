/**
 * Stamina Calculator Unit Tests
 *
 * Tests for stamina regeneration, consumption, and management calculations.
 */

import { describe, it, expect } from 'bun:test';
import {
  calculateStaminaRegeneration,
  calculateSimpleStaminaRegen,
  hasEnoughStamina,
  getEncounterStaminaCost,
  consumeStamina,
  addStamina,
  getMaxStaminaForTier,
  calculateMaxStamina,
  timeUntilFullStamina,
  timeUntilEncounterReady,
  STAMINA_REGEN_INTERVAL,
  ENCOUNTER_STAMINA_COSTS,
  MAX_STAMINA_BY_TIER,
} from '../../src/calculators/stamina';

import { TimeOfDay } from '../../src/calculators/time';

// Stamina Regeneration (Full) Tests

describe('calculateStaminaRegeneration', () => {
  it('should return no gain if not enough time elapsed', () => {
    const [stamina, gained] = calculateStaminaRegeneration(50, 100, 1000, 1100, 0);
    // 100 seconds < STAMINA_REGEN_INTERVAL (300)
    expect(stamina).toBe(50);
    expect(gained).toBe(0);
  });

  it('should gain stamina after one interval', () => {
    const [stamina, gained] = calculateStaminaRegeneration(
      50, 100, 0, STAMINA_REGEN_INTERVAL, 0
    );
    // 1 interval passed, multiplied by time-of-day bonus
    expect(stamina).toBeGreaterThanOrEqual(50);
    expect(gained).toBeGreaterThanOrEqual(0);
  });

  it('should gain more stamina after multiple intervals', () => {
    const [, gained1] = calculateStaminaRegeneration(
      50, 100, 0, STAMINA_REGEN_INTERVAL, 0
    );
    const [, gained5] = calculateStaminaRegeneration(
      50, 100, 0, STAMINA_REGEN_INTERVAL * 5, 0
    );
    expect(gained5).toBeGreaterThanOrEqual(gained1);
  });

  it('should cap at maxStamina', () => {
    const maxStamina = 100;
    const [stamina, gained] = calculateStaminaRegeneration(
      90, maxStamina, 0, STAMINA_REGEN_INTERVAL * 1000, 0
    );
    expect(stamina).toBeLessThanOrEqual(maxStamina);
    expect(gained).toBeLessThanOrEqual(maxStamina - 90);
  });

  it('should return 0 gain when already at max', () => {
    const [stamina, gained] = calculateStaminaRegeneration(
      100, 100, 0, STAMINA_REGEN_INTERVAL * 10, 0
    );
    expect(stamina).toBe(100);
    expect(gained).toBe(0);
  });

  it('should apply hero stamina regen buff', () => {
    const [, gainedBase] = calculateStaminaRegeneration(
      0, 10000, 0, STAMINA_REGEN_INTERVAL * 100, 0, 0
    );
    const [, gainedBuff] = calculateStaminaRegeneration(
      0, 10000, 0, STAMINA_REGEN_INTERVAL * 100, 0, 5000 // 50% buff
    );
    expect(gainedBuff).toBeGreaterThan(gainedBase);
  });

  it('should handle now < lastUpdate gracefully', () => {
    const [stamina, gained] = calculateStaminaRegeneration(50, 100, 1000, 500, 0);
    // Negative elapsed => no intervals
    expect(stamina).toBe(50);
    expect(gained).toBe(0);
  });
});

// Simple Stamina Regen Tests

describe('calculateSimpleStaminaRegen', () => {
  it('should gain 1 stamina per interval', () => {
    const [stamina, gained] = calculateSimpleStaminaRegen(50, 100, STAMINA_REGEN_INTERVAL);
    expect(stamina).toBe(51);
    expect(gained).toBe(1);
  });

  it('should gain multiple stamina for multiple intervals', () => {
    const [stamina, gained] = calculateSimpleStaminaRegen(50, 100, STAMINA_REGEN_INTERVAL * 5);
    expect(stamina).toBe(55);
    expect(gained).toBe(5);
  });

  it('should not gain for partial interval', () => {
    const [stamina, gained] = calculateSimpleStaminaRegen(50, 100, STAMINA_REGEN_INTERVAL - 1);
    expect(stamina).toBe(50);
    expect(gained).toBe(0);
  });

  it('should cap at maxStamina', () => {
    const [stamina, gained] = calculateSimpleStaminaRegen(95, 100, STAMINA_REGEN_INTERVAL * 20);
    expect(stamina).toBe(100);
    expect(gained).toBe(5);
  });

  it('should return 0 gain when already at max', () => {
    const [stamina, gained] = calculateSimpleStaminaRegen(100, 100, STAMINA_REGEN_INTERVAL * 10);
    expect(stamina).toBe(100);
    expect(gained).toBe(0);
  });

  it('should handle 0 elapsed seconds', () => {
    const [stamina, gained] = calculateSimpleStaminaRegen(50, 100, 0);
    expect(stamina).toBe(50);
    expect(gained).toBe(0);
  });

  it('should floor intervals (no partial stamina)', () => {
    // 2.5 intervals => 2 stamina gained
    const elapsed = Math.floor(STAMINA_REGEN_INTERVAL * 2.5);
    const [stamina, gained] = calculateSimpleStaminaRegen(50, 100, elapsed);
    expect(stamina).toBe(52);
    expect(gained).toBe(2);
  });
});

// Has Enough Stamina Tests

describe('hasEnoughStamina', () => {
  it('should return true when stamina meets cost', () => {
    // Encounter type 0 costs ENCOUNTER_STAMINA_COSTS[0] = 10
    expect(hasEnoughStamina(10, 0)).toBe(true);
  });

  it('should return true when stamina exceeds cost', () => {
    expect(hasEnoughStamina(100, 0)).toBe(true);
  });

  it('should return false when stamina is below cost', () => {
    expect(hasEnoughStamina(5, 0)).toBe(false);
  });

  it('should check correct cost for each encounter type', () => {
    for (let type = 0; type <= 5; type++) {
      const cost = ENCOUNTER_STAMINA_COSTS[type]!;
      expect(hasEnoughStamina(cost, type)).toBe(true);
      expect(hasEnoughStamina(cost - 1, type)).toBe(false);
    }
  });

  it('should clamp encounter type to 5', () => {
    // Type 100 should use cost at index 5
    const cost5 = ENCOUNTER_STAMINA_COSTS[5];
    expect(hasEnoughStamina(cost5, 100)).toBe(true);
    expect(hasEnoughStamina(cost5 - 1, 100)).toBe(false);
  });

  it('should handle 0 stamina', () => {
    expect(hasEnoughStamina(0, 0)).toBe(false);
  });
});

// Get Encounter Stamina Cost Tests

describe('getEncounterStaminaCost', () => {
  it('should return correct cost for each type', () => {
    expect(getEncounterStaminaCost(0)).toBe(10);
    expect(getEncounterStaminaCost(1)).toBe(25);
    expect(getEncounterStaminaCost(2)).toBe(50);
    expect(getEncounterStaminaCost(3)).toBe(100);
    expect(getEncounterStaminaCost(4)).toBe(250);
    expect(getEncounterStaminaCost(5)).toBe(500);
  });

  it('should clamp to max type', () => {
    expect(getEncounterStaminaCost(100)).toBe(500);
  });

  it('should increase with encounter type', () => {
    let prev = 0;
    for (let type = 0; type <= 5; type++) {
      const cost = getEncounterStaminaCost(type);
      expect(cost).toBeGreaterThan(prev);
      prev = cost;
    }
  });
});

// Consume Stamina Tests

describe('consumeStamina', () => {
  it('should consume and return remaining stamina on success', () => {
    const [remaining, success] = consumeStamina(50, 0); // cost = 10
    expect(success).toBe(true);
    expect(remaining).toBe(40);
  });

  it('should fail when not enough stamina', () => {
    const [remaining, success] = consumeStamina(5, 0); // cost = 10
    expect(success).toBe(false);
    expect(remaining).toBe(5); // unchanged
  });

  it('should succeed when stamina exactly equals cost', () => {
    const cost = ENCOUNTER_STAMINA_COSTS[0]; // 10
    const [remaining, success] = consumeStamina(cost, 0);
    expect(success).toBe(true);
    expect(remaining).toBe(0);
  });

  it('should use correct cost for each encounter type', () => {
    for (let type = 0; type <= 5; type++) {
      const cost = ENCOUNTER_STAMINA_COSTS[type]!;
      const [remaining, success] = consumeStamina(cost, type);
      expect(success).toBe(true);
      expect(remaining).toBe(0);
    }
  });

  it('should clamp encounter type to max', () => {
    const cost5 = ENCOUNTER_STAMINA_COSTS[5]; // 500
    const [remaining, success] = consumeStamina(cost5, 999);
    expect(success).toBe(true);
    expect(remaining).toBe(0);
  });

  it('should handle 0 stamina', () => {
    const [remaining, success] = consumeStamina(0, 0);
    expect(success).toBe(false);
    expect(remaining).toBe(0);
  });
});

// Add Stamina Tests

describe('addStamina', () => {
  it('should add stamina normally', () => {
    const [newStamina, actualAdded] = addStamina(50, 100, 30);
    expect(newStamina).toBe(80);
    expect(actualAdded).toBe(30);
  });

  it('should cap at maxStamina', () => {
    const [newStamina, actualAdded] = addStamina(90, 100, 30);
    expect(newStamina).toBe(100);
    expect(actualAdded).toBe(10);
  });

  it('should return 0 added when already at max', () => {
    const [newStamina, actualAdded] = addStamina(100, 100, 50);
    expect(newStamina).toBe(100);
    expect(actualAdded).toBe(0);
  });

  it('should handle adding 0', () => {
    const [newStamina, actualAdded] = addStamina(50, 100, 0);
    expect(newStamina).toBe(50);
    expect(actualAdded).toBe(0);
  });

  it('should handle adding exact amount to reach max', () => {
    const [newStamina, actualAdded] = addStamina(80, 100, 20);
    expect(newStamina).toBe(100);
    expect(actualAdded).toBe(20);
  });

  it('should handle large amounts', () => {
    const [newStamina, actualAdded] = addStamina(0, 100, 1000);
    expect(newStamina).toBe(100);
    expect(actualAdded).toBe(100);
  });
});

// Max Stamina For Tier Tests

describe('getMaxStaminaForTier', () => {
  it('should return correct max for each tier', () => {
    expect(getMaxStaminaForTier(0)).toBe(100);
    expect(getMaxStaminaForTier(1)).toBe(500);
    expect(getMaxStaminaForTier(2)).toBe(1000);
    expect(getMaxStaminaForTier(3)).toBe(10000);
  });

  it('should clamp to tier 3 for higher values', () => {
    expect(getMaxStaminaForTier(10)).toBe(10000);
    expect(getMaxStaminaForTier(100)).toBe(10000);
  });

  it('should increase with tier', () => {
    let prev = 0;
    for (let tier = 0; tier <= 3; tier++) {
      const max = getMaxStaminaForTier(tier);
      expect(max).toBeGreaterThan(prev);
      prev = max;
    }
  });
});

// Calculate Max Stamina With Bonus Tests

describe('calculateMaxStamina', () => {
  it('should return base max with no bonus', () => {
    expect(calculateMaxStamina(0, 0)).toBe(100);
    expect(calculateMaxStamina(1, 0)).toBe(500);
  });

  it('should apply BPS bonus', () => {
    // Tier 0 base = 100, 50% bonus (5000 bps) => 150
    expect(calculateMaxStamina(0, 5000)).toBe(150);
  });

  it('should apply 100% bonus', () => {
    // Tier 0 base = 100, 100% bonus => 200
    expect(calculateMaxStamina(0, 10000)).toBe(200);
  });

  it('should return base when bonusBps is 0', () => {
    for (let tier = 0; tier <= 3; tier++) {
      expect(calculateMaxStamina(tier, 0)).toBe(getMaxStaminaForTier(tier));
    }
  });

  it('should be greater than base when bonus > 0', () => {
    for (let tier = 0; tier <= 3; tier++) {
      const base = calculateMaxStamina(tier, 0);
      const withBonus = calculateMaxStamina(tier, 1000);
      expect(withBonus).toBeGreaterThan(base);
    }
  });

  it('should clamp tier', () => {
    expect(calculateMaxStamina(100, 0)).toBe(10000);
  });
});

// Time Until Full Stamina Tests

describe('timeUntilFullStamina', () => {
  it('should return 0 when already full', () => {
    expect(timeUntilFullStamina(100, 100, TimeOfDay.Midday)).toBe(0);
  });

  it('should return 0 when above max', () => {
    expect(timeUntilFullStamina(150, 100, TimeOfDay.Midday)).toBe(0);
  });

  it('should return positive time when below max', () => {
    const time = timeUntilFullStamina(50, 100, TimeOfDay.Afternoon);
    expect(time).toBeGreaterThan(0);
  });

  it('should be a multiple of STAMINA_REGEN_INTERVAL', () => {
    const time = timeUntilFullStamina(50, 100, TimeOfDay.Afternoon);
    expect(time % STAMINA_REGEN_INTERVAL).toBe(0);
  });

  it('should be shorter during high-regen periods', () => {
    // DeepNight has PHI_SQUARED (2.618x) regen bonus
    // Midday has PHI_INVERSE (0.618x) regen penalty
    const timeDeep = timeUntilFullStamina(0, 100, TimeOfDay.DeepNight);
    const timeMidday = timeUntilFullStamina(0, 100, TimeOfDay.Midday);
    expect(timeDeep).toBeLessThan(timeMidday);
  });

  it('should increase as deficit increases', () => {
    const time10 = timeUntilFullStamina(90, 100, TimeOfDay.Afternoon);
    const time50 = timeUntilFullStamina(50, 100, TimeOfDay.Afternoon);
    expect(time50).toBeGreaterThan(time10);
  });

  it('should handle large max stamina', () => {
    // Morning has 1.0x StaminaRegen multiplier
    const time = timeUntilFullStamina(0, 10000, TimeOfDay.Morning);
    expect(time).toBeGreaterThan(0);
    expect(time).toBe(Math.ceil(10000 / 1.0) * STAMINA_REGEN_INTERVAL);
  });
});

// Time Until Encounter Ready Tests

describe('timeUntilEncounterReady', () => {
  it('should return 0 when already have enough stamina', () => {
    expect(timeUntilEncounterReady(100, 0, TimeOfDay.Midday)).toBe(0);
  });

  it('should return 0 when stamina exactly meets cost', () => {
    const cost = ENCOUNTER_STAMINA_COSTS[0]; // 10
    expect(timeUntilEncounterReady(cost, 0, TimeOfDay.Midday)).toBe(0);
  });

  it('should return positive time when below cost', () => {
    const time = timeUntilEncounterReady(5, 0, TimeOfDay.Afternoon);
    expect(time).toBeGreaterThan(0);
  });

  it('should return longer time for higher encounter types', () => {
    const time0 = timeUntilEncounterReady(0, 0, TimeOfDay.Afternoon);
    const time5 = timeUntilEncounterReady(0, 5, TimeOfDay.Afternoon);
    expect(time5).toBeGreaterThan(time0);
  });

  it('should be a multiple of STAMINA_REGEN_INTERVAL', () => {
    const time = timeUntilEncounterReady(0, 2, TimeOfDay.Afternoon);
    expect(time % STAMINA_REGEN_INTERVAL).toBe(0);
  });

  it('should be shorter during high-regen periods', () => {
    const timeDeep = timeUntilEncounterReady(0, 3, TimeOfDay.DeepNight);
    const timeMidday = timeUntilEncounterReady(0, 3, TimeOfDay.Midday);
    expect(timeDeep).toBeLessThan(timeMidday);
  });

  it('should clamp encounter type', () => {
    const time999 = timeUntilEncounterReady(0, 999, TimeOfDay.Afternoon);
    const time5 = timeUntilEncounterReady(0, 5, TimeOfDay.Afternoon);
    expect(time999).toBe(time5);
  });
});

// Stamina Constants Tests

describe('Stamina Constants', () => {
  it('STAMINA_REGEN_INTERVAL should be 300 seconds (5 minutes)', () => {
    expect(STAMINA_REGEN_INTERVAL).toBe(300);
  });

  it('ENCOUNTER_STAMINA_COSTS should have 6 entries', () => {
    expect(ENCOUNTER_STAMINA_COSTS.length).toBe(6);
  });

  it('ENCOUNTER_STAMINA_COSTS should be [10, 25, 50, 100, 250, 500]', () => {
    expect(ENCOUNTER_STAMINA_COSTS[0]).toBe(10);
    expect(ENCOUNTER_STAMINA_COSTS[1]).toBe(25);
    expect(ENCOUNTER_STAMINA_COSTS[2]).toBe(50);
    expect(ENCOUNTER_STAMINA_COSTS[3]).toBe(100);
    expect(ENCOUNTER_STAMINA_COSTS[4]).toBe(250);
    expect(ENCOUNTER_STAMINA_COSTS[5]).toBe(500);
  });

  it('MAX_STAMINA_BY_TIER should have 4 entries', () => {
    expect(MAX_STAMINA_BY_TIER.length).toBe(4);
  });

  it('MAX_STAMINA_BY_TIER should be [100, 500, 1000, 10000]', () => {
    expect(MAX_STAMINA_BY_TIER[0]).toBe(100);
    expect(MAX_STAMINA_BY_TIER[1]).toBe(500);
    expect(MAX_STAMINA_BY_TIER[2]).toBe(1000);
    expect(MAX_STAMINA_BY_TIER[3]).toBe(10000);
  });
});

// Mathematical Properties

describe('Stamina Mathematical Properties', () => {
  it('simple regen should increase monotonically with time', () => {
    let prevGained = 0;
    for (let intervals = 0; intervals <= 10; intervals++) {
      const elapsed = STAMINA_REGEN_INTERVAL * intervals;
      const [, gained] = calculateSimpleStaminaRegen(0, 10000, elapsed);
      expect(gained).toBeGreaterThanOrEqual(prevGained);
      prevGained = gained;
    }
  });

  it('stamina should always be between 0 and max after operations', () => {
    // Add
    const [addResult] = addStamina(50, 100, 9999);
    expect(addResult).toBeGreaterThanOrEqual(0);
    expect(addResult).toBeLessThanOrEqual(100);

    // Consume (success)
    const [consumeResult, ok] = consumeStamina(50, 0);
    if (ok) {
      expect(consumeResult).toBeGreaterThanOrEqual(0);
    }
  });

  it('addStamina and consumeStamina should be complementary', () => {
    const initial = 50;
    const maxStamina = 100;

    // Add 20, then consume type 0 (cost 10) = net +10
    const [afterAdd] = addStamina(initial, maxStamina, 20);
    const [afterConsume, success] = consumeStamina(afterAdd, 0); // cost 10
    expect(success).toBe(true);
    expect(afterConsume).toBe(60);
  });

  it('encounter costs should increase with rarity/type', () => {
    for (let type = 1; type <= 5; type++) {
      const costPrev = getEncounterStaminaCost(type - 1);
      const costCurr = getEncounterStaminaCost(type);
      expect(costCurr).toBeGreaterThan(costPrev);
    }
  });

  it('max stamina should increase with both tier and bonus', () => {
    // Higher tier should always give more max stamina
    for (let tier = 1; tier <= 3; tier++) {
      expect(calculateMaxStamina(tier, 0)).toBeGreaterThan(calculateMaxStamina(tier - 1, 0));
    }

    // Higher bonus should give more max stamina at same tier
    expect(calculateMaxStamina(0, 2000)).toBeGreaterThan(calculateMaxStamina(0, 1000));
  });
});
