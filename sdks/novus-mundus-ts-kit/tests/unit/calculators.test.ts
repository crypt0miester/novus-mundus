/**
 * Calculator Unit Tests
 *
 * Tests for game calculation utilities.
 */

import { describe, it, expect } from 'bun:test';
import {
  // Travel
  calculateDistance,
  calculateDistanceMeters,
  calculateTravelTime,
  calculateTravelTimeBetween,
  calculateIntercityTravelTime,
  calculateIntracityTravelTime,
  calculateTeleportCost,
  calculateSpeedupCost,
  calculateTimeReduced,
  isValidLatitude,
  isValidLongitude,
  isWithinCityBounds,
  fixedPointToFloat,
  floatToFixedPoint,
} from '../../src/calculators/travel';

import {
  // Combat
  createWeaponSet,
  weaponSetTotal,
  weaponSetApplyRate,
  EMPTY_WEAPON_SET,
} from '../../src/calculators/combat';

import {
  // Constants
  PHI,
  GOLDEN_ROOT,
  PHI_SQUARED,
  PHI_INVERSE,
  BPS_100,
  applyBps,
  applyBpsBonus,
  chainBps,
  mulDiv,
  EARTH_RADIUS_KM,
} from '../../src/calculators/constants';

// Constants Tests

describe('Golden Ratio Constants', () => {
  it('should have correct PHI value', () => {
    expect(PHI).toBeCloseTo(1.618033988749895, 10);
  });

  it('should have correct GOLDEN_ROOT value', () => {
    expect(GOLDEN_ROOT).toBeCloseTo(Math.sqrt(PHI), 10);
  });

  it('should have correct PHI_SQUARED value', () => {
    expect(PHI_SQUARED).toBeCloseTo(PHI * PHI, 10);
  });

  it('should have correct PHI_INVERSE value', () => {
    expect(PHI_INVERSE).toBeCloseTo(1 / PHI, 10);
  });

  it('should satisfy golden ratio identity: PHI^2 = PHI + 1', () => {
    expect(PHI_SQUARED).toBeCloseTo(PHI + 1, 10);
  });

  it('should satisfy inverse identity: PHI * PHI_INVERSE = 1', () => {
    expect(PHI * PHI_INVERSE).toBeCloseTo(1, 10);
  });
});

describe('Basis Point Helpers', () => {
  describe('applyBps', () => {
    it('should apply 50% (5000 bps)', () => {
      expect(applyBps(100, 5000)).toBe(50);
    });

    it('should apply 100% (10000 bps)', () => {
      expect(applyBps(100, 10000)).toBe(100);
    });

    it('should apply 0%', () => {
      expect(applyBps(100, 0)).toBe(0);
    });

    it('should handle large values', () => {
      expect(applyBps(1000000, 1000)).toBe(100000); // 10%
    });
  });

  describe('applyBpsBonus', () => {
    it('should apply 10% bonus (1000 bps)', () => {
      expect(applyBpsBonus(100, 1000)).toBe(110);
    });

    it('should apply 0% bonus', () => {
      expect(applyBpsBonus(100, 0)).toBe(100);
    });

    it('should apply 100% bonus (10000 bps)', () => {
      expect(applyBpsBonus(100, 10000)).toBe(200);
    });
  });

  describe('chainBps', () => {
    it('should chain two rates', () => {
      // 50% of 50% = 25%
      expect(chainBps(5000, [5000])).toBe(2500);
    });

    it('should chain 100% with any rate', () => {
      expect(chainBps(10000, [5000])).toBe(5000);
      expect(chainBps(5000, [10000])).toBe(5000);
    });
  });

  describe('mulDiv', () => {
    it('should multiply then divide', () => {
      expect(mulDiv(100, 50, 10)).toBe(500);
    });

    it('should handle zero numerator', () => {
      expect(mulDiv(0, 50, 10)).toBe(0);
    });

    it('should handle zero multiplier', () => {
      expect(mulDiv(100, 0, 10)).toBe(0);
    });
  });
});

// Travel Calculator Tests

describe('Travel Calculators', () => {
  describe('calculateDistance', () => {
    it('should calculate zero distance for same point', () => {
      const distance = calculateDistance(40.7128, -74.0060, 40.7128, -74.0060);
      expect(distance).toBeCloseTo(0, 5);
    });

    it('should calculate NYC to London distance', () => {
      // NYC: 40.7128, -74.0060
      // London: 51.5074, -0.1278
      const distance = calculateDistance(40.7128, -74.0060, 51.5074, -0.1278);
      // Expected: ~5570 km
      expect(distance).toBeGreaterThan(5500);
      expect(distance).toBeLessThan(5600);
    });

    it('should calculate short distance', () => {
      // Two nearby points
      const distance = calculateDistance(40.7128, -74.0060, 40.7228, -74.0160);
      // Should be a few km
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(5);
    });

    it('should be symmetric', () => {
      const d1 = calculateDistance(40.7128, -74.0060, 51.5074, -0.1278);
      const d2 = calculateDistance(51.5074, -0.1278, 40.7128, -74.0060);
      expect(d1).toBeCloseTo(d2, 5);
    });
  });

  describe('calculateDistanceMeters', () => {
    it('should return distance in meters', () => {
      const km = calculateDistance(40.7128, -74.0060, 40.7228, -74.0160);
      const meters = calculateDistanceMeters(40.7128, -74.0060, 40.7228, -74.0160);
      expect(meters).toBeCloseTo(km * 1000, 2);
    });
  });

  describe('calculateTravelTime', () => {
    it('should calculate travel time for known distance/speed', () => {
      // 100 km at 50 km/h = 2 hours = 7200 seconds
      const time = calculateTravelTime(100, 50);
      expect(time).toBe(7200);
    });

    it('should handle zero speed', () => {
      expect(calculateTravelTime(100, 0)).toBe(0);
    });

    it('should handle zero distance', () => {
      expect(calculateTravelTime(0, 50)).toBe(0);
    });

    it('should ceil to whole seconds', () => {
      // 10 km at 60 km/h = 600 seconds exactly
      const time = calculateTravelTime(10, 60);
      expect(time).toBe(600);

      // Fractional result should be ceiled
      const time2 = calculateTravelTime(11, 60);
      expect(time2).toBe(660); // 11/60 * 3600 = 660
    });
  });

  describe('calculateTravelTimeBetween', () => {
    it('should combine distance and time calculation', () => {
      const distance = calculateDistance(40.7128, -74.0060, 40.7228, -74.0160);
      const time1 = calculateTravelTime(distance, 50);
      const time2 = calculateTravelTimeBetween(40.7128, -74.0060, 40.7228, -74.0160, 50);
      expect(time1).toBe(time2);
    });
  });

  describe('calculateIntercityTravelTime', () => {
    it('should apply speed bonus', () => {
      const baseTime = calculateIntercityTravelTime(100, 50, 0);
      const bonusTime = calculateIntercityTravelTime(100, 50, 1000); // 10% bonus
      expect(bonusTime).toBeLessThan(baseTime);
    });

    it('should match base time with no bonus', () => {
      const time = calculateIntercityTravelTime(100, 50, 0);
      expect(time).toBe(7200); // 100 km at 50 km/h
    });
  });

  describe('calculateIntracityTravelTime', () => {
    it('should use walking speed', () => {
      // 1000 meters at 5 km/h = 12 minutes = 720 seconds
      const time = calculateIntracityTravelTime(1000, 5);
      expect(time).toBe(720);
    });

    it('should default to 5 km/h', () => {
      const time = calculateIntracityTravelTime(1000);
      expect(time).toBe(720);
    });
  });

  describe('calculateTeleportCost', () => {
    it('should calculate base cost for short distance', () => {
      // < 100km should add 1 block cost
      const cost = calculateTeleportCost(50, 100, 10);
      expect(cost).toBe(110); // 100 + 1*10
    });

    it('should scale with distance', () => {
      // 500 km = 5 blocks
      const cost = calculateTeleportCost(500, 100, 10);
      expect(cost).toBe(150); // 100 + 5*10
    });
  });

  describe('calculateSpeedupCost', () => {
    it('should calculate cost based on remaining time', () => {
      // 60 seconds remaining at 1 gem/minute = 1 gem
      const cost = calculateSpeedupCost(60, 1);
      expect(cost).toBe(1);
    });

    it('should ceil partial minutes', () => {
      // 61 seconds = 2 minutes (ceiled)
      const cost = calculateSpeedupCost(61, 1);
      expect(cost).toBe(2);
    });
  });

  describe('calculateTimeReduced', () => {
    it('should calculate time from gems spent', () => {
      // 5 gems at 1 gem/minute = 5 minutes = 300 seconds
      const time = calculateTimeReduced(5, 1);
      expect(time).toBe(300);
    });

    it('should handle zero cost per minute', () => {
      expect(calculateTimeReduced(5, 0)).toBe(0);
    });

    it('should floor partial minutes', () => {
      // 7 gems at 3 gems/minute = 2 minutes (7/3 = 2.33, floored)
      const time = calculateTimeReduced(7, 3);
      expect(time).toBe(120);
    });
  });

  describe('coordinate validation', () => {
    it('should validate latitude range', () => {
      expect(isValidLatitude(0)).toBe(true);
      expect(isValidLatitude(90)).toBe(true);
      expect(isValidLatitude(-90)).toBe(true);
      expect(isValidLatitude(90.1)).toBe(false);
      expect(isValidLatitude(-90.1)).toBe(false);
    });

    it('should validate longitude range', () => {
      expect(isValidLongitude(0)).toBe(true);
      expect(isValidLongitude(180)).toBe(true);
      expect(isValidLongitude(-180)).toBe(true);
      expect(isValidLongitude(180.1)).toBe(false);
      expect(isValidLongitude(-180.1)).toBe(false);
    });
  });

  describe('isWithinCityBounds', () => {
    it('should return true for point at city center', () => {
      expect(isWithinCityBounds(40.7128, -74.0060, 40.7128, -74.0060, 10)).toBe(true);
    });

    it('should return true for point within radius', () => {
      // Point ~1km from center, radius 10km
      expect(isWithinCityBounds(40.7228, -74.0060, 40.7128, -74.0060, 10)).toBe(true);
    });

    it('should return false for point outside radius', () => {
      // NYC and London, radius 100km
      expect(isWithinCityBounds(51.5074, -0.1278, 40.7128, -74.0060, 100)).toBe(false);
    });
  });

  describe('fixed-point conversions', () => {
    it('should convert fixed-point to float', () => {
      expect(fixedPointToFloat(40712800)).toBeCloseTo(40.7128, 4);
      expect(fixedPointToFloat(-74006000)).toBeCloseTo(-74.006, 3);
    });

    it('should convert float to fixed-point', () => {
      expect(floatToFixedPoint(40.7128)).toBe(40712800);
      expect(floatToFixedPoint(-74.006)).toBe(-74006000);
    });

    it('should roundtrip correctly', () => {
      const original = 40.7128;
      const fixed = floatToFixedPoint(original);
      const back = fixedPointToFloat(fixed);
      expect(back).toBeCloseTo(original, 4);
    });
  });
});

// Combat Calculator Tests

describe('Combat Calculators', () => {
  describe('WeaponSet', () => {
    describe('createWeaponSet', () => {
      it('should create weapon set with values', () => {
        const set = createWeaponSet(10, 20, 30);
        expect(set.melee).toBe(10);
        expect(set.ranged).toBe(20);
        expect(set.siege).toBe(30);
      });
    });

    describe('EMPTY_WEAPON_SET', () => {
      it('should have all zeros', () => {
        expect(EMPTY_WEAPON_SET.melee).toBe(0);
        expect(EMPTY_WEAPON_SET.ranged).toBe(0);
        expect(EMPTY_WEAPON_SET.siege).toBe(0);
      });
    });

    describe('weaponSetTotal', () => {
      it('should sum all weapon types', () => {
        const set = createWeaponSet(10, 20, 30);
        expect(weaponSetTotal(set)).toBe(60);
      });

      it('should return 0 for empty set', () => {
        expect(weaponSetTotal(EMPTY_WEAPON_SET)).toBe(0);
      });
    });

    describe('weaponSetApplyRate', () => {
      it('should apply 50% rate to all types', () => {
        const set = createWeaponSet(100, 200, 300);
        const result = weaponSetApplyRate(set, 5000);
        expect(result.melee).toBe(50);
        expect(result.ranged).toBe(100);
        expect(result.siege).toBe(150);
      });

      it('should apply 100% rate', () => {
        const set = createWeaponSet(100, 200, 300);
        const result = weaponSetApplyRate(set, 10000);
        expect(result.melee).toBe(100);
        expect(result.ranged).toBe(200);
        expect(result.siege).toBe(300);
      });

      it('should apply 0% rate', () => {
        const set = createWeaponSet(100, 200, 300);
        const result = weaponSetApplyRate(set, 0);
        expect(result.melee).toBe(0);
        expect(result.ranged).toBe(0);
        expect(result.siege).toBe(0);
      });
    });
  });
});

// Earth Radius Constant Test

describe('Geographic Constants', () => {
  it('should have correct Earth radius', () => {
    expect(EARTH_RADIUS_KM).toBe(6371);
  });
});

// applyBpsPenalty Tests

import { applyBpsPenalty } from '../../src/calculators/constants';

describe('applyBpsPenalty', () => {
  it('should apply 5% penalty (500 bps): 1000 => 950', () => {
    expect(applyBpsPenalty(1000, 500)).toBe(950);
  });

  it('should apply 100% penalty (10000 bps): 10000 => 0', () => {
    expect(applyBpsPenalty(10000, 10000)).toBe(0);
  });

  it('should apply 0% penalty: value unchanged', () => {
    expect(applyBpsPenalty(100, 0)).toBe(100);
  });

  it('should apply 50% penalty (5000 bps): 200 => 100', () => {
    expect(applyBpsPenalty(200, 5000)).toBe(100);
  });

  it('should floor the result', () => {
    // 101 * (10000 - 500) / 10000 = 101 * 9500 / 10000 = 95.95 => 95
    expect(applyBpsPenalty(101, 500)).toBe(95);
  });
});

// applyStablesTravelReduction Tests

import { applyStablesTravelReduction } from '../../src/calculators/travel';

describe('applyStablesTravelReduction', () => {
  it('should not reduce travel time when bps is 0', () => {
    expect(applyStablesTravelReduction(1000, 0)).toBe(1000);
  });

  it('should reduce travel time proportionally', () => {
    // 1000 seconds, 500 bps (5%) => reduction = floor(1000 * 500 / 10000) = 50
    // result = 1000 - 50 = 950
    expect(applyStablesTravelReduction(1000, 500)).toBe(950);
  });

  it('should reduce by 50 bps per level', () => {
    // Level 1 = 50 bps, level 5 = 250 bps
    const level1 = applyStablesTravelReduction(10000, 50);
    const level5 = applyStablesTravelReduction(10000, 250);
    expect(level1).toBe(9950); // 10000 - 50
    expect(level5).toBe(9750); // 10000 - 250
    expect(level5).toBeLessThan(level1);
  });

  it('should enforce minimum of 1 second', () => {
    // Near-total reduction
    expect(applyStablesTravelReduction(10, 9900)).toBe(1);
  });

  it('should not reduce below 1 even with high bps', () => {
    expect(applyStablesTravelReduction(100, 9999)).toBeGreaterThanOrEqual(1);
  });

  it('should handle negative bps as no reduction', () => {
    expect(applyStablesTravelReduction(1000, -100)).toBe(1000);
  });
});

// Combat Calculator Extended Tests

import {
  resolveWeaponCombat,
  calculateDamageOutput,
  inflictDamage,
  calculateInfirmaryRecovery,
  calculateAbandonment,
  updateHappinessDefensive,
  updateHappinessOperative,
  calculatePower,
  calculateDefensivePower,
  calculateOperativePower,
  type WeaponSet,
} from '../../src/calculators/combat';

import {
  DU1_POWER_COST,
  DU2_POWER_COST,
  DU3_POWER_COST,
  OP1_POWER_COST,
  OP2_POWER_COST,
  OP3_POWER_COST,
} from '../../src/calculators/constants';

// Power Calculation Tests

describe('Power Calculations', () => {
  describe('calculatePower', () => {
    it('should return 0 for no units', () => {
      expect(calculatePower(0, 0, 0, 0, 0, 0)).toBe(0);
    });

    it('should compute power as sum of (units * cost) for each type', () => {
      const du1 = 10, du2 = 5, du3 = 2;
      const op1 = 8, op2 = 4, op3 = 1;
      const expected =
        du1 * DU1_POWER_COST +
        du2 * DU2_POWER_COST +
        du3 * DU3_POWER_COST +
        op1 * OP1_POWER_COST +
        op2 * OP2_POWER_COST +
        op3 * OP3_POWER_COST;
      expect(calculatePower(du1, du2, du3, op1, op2, op3)).toBe(expected);
    });

    it('should use correct power cost constants', () => {
      expect(DU1_POWER_COST).toBe(10);
      expect(DU2_POWER_COST).toBe(25);
      expect(DU3_POWER_COST).toBe(60);
      expect(OP1_POWER_COST).toBe(15);
      expect(OP2_POWER_COST).toBe(35);
      expect(OP3_POWER_COST).toBe(80);
    });

    it('should handle single unit type', () => {
      expect(calculatePower(100, 0, 0, 0, 0, 0)).toBe(100 * DU1_POWER_COST);
      expect(calculatePower(0, 0, 0, 0, 0, 50)).toBe(50 * OP3_POWER_COST);
    });
  });

  describe('calculateDefensivePower', () => {
    it('should return 0 for no units', () => {
      expect(calculateDefensivePower(0, 0, 0)).toBe(0);
    });

    it('should compute only defensive unit power', () => {
      const du1 = 10, du2 = 5, du3 = 2;
      const expected = du1 * DU1_POWER_COST + du2 * DU2_POWER_COST + du3 * DU3_POWER_COST;
      expect(calculateDefensivePower(du1, du2, du3)).toBe(expected);
    });

    it('should match calculatePower with zero operatives', () => {
      expect(calculateDefensivePower(10, 20, 30)).toBe(calculatePower(10, 20, 30, 0, 0, 0));
    });
  });

  describe('calculateOperativePower', () => {
    it('should return 0 for no units', () => {
      expect(calculateOperativePower(0, 0, 0)).toBe(0);
    });

    it('should compute only operative unit power', () => {
      const op1 = 8, op2 = 4, op3 = 1;
      const expected = op1 * OP1_POWER_COST + op2 * OP2_POWER_COST + op3 * OP3_POWER_COST;
      expect(calculateOperativePower(op1, op2, op3)).toBe(expected);
    });

    it('should match calculatePower with zero defensives', () => {
      expect(calculateOperativePower(10, 20, 30)).toBe(calculatePower(0, 0, 0, 10, 20, 30));
    });
  });

  describe('total power = defensive + operative', () => {
    it('should add up correctly', () => {
      const du1 = 10, du2 = 5, du3 = 3;
      const op1 = 7, op2 = 2, op3 = 1;
      const total = calculatePower(du1, du2, du3, op1, op2, op3);
      const defensive = calculateDefensivePower(du1, du2, du3);
      const operative = calculateOperativePower(op1, op2, op3);
      expect(total).toBe(defensive + operative);
    });
  });
});

// Damage Output Tests

describe('calculateDamageOutput', () => {
  it('should return 0 for 0 units', () => {
    expect(calculateDamageOutput(0, 100, false)).toBe(0);
  });

  it('should apply base effectiveness (1.0x) for normal attacks', () => {
    // 100 units, 100 weapons (full coverage), not driveBy
    // weaponCoeff = 10000 (100%), coeff = 10000 (1.0x)
    // damage = chainBps(100, [10000, 10000]) = applyBps(applyBps(100, 10000), 10000) = 100
    const damage = calculateDamageOutput(100, 100, false);
    expect(damage).toBe(100);
  });

  it('should reduce damage when weapons < units', () => {
    // 100 units, 50 weapons => weaponCoeff = 50 * 10000 / 100 = 5000
    // damage = chainBps(100, [5000, 10000]) = applyBps(50, 10000) = 50
    const damage = calculateDamageOutput(100, 50, false);
    expect(damage).toBe(50);
  });

  it('should cap weapon coverage at 100%', () => {
    // 100 units, 200 weapons => weaponCoeff capped at 10000
    const damage = calculateDamageOutput(100, 200, false);
    expect(damage).toBe(100);
  });

  it('should apply research buff additively', () => {
    // 100 units, 100 weapons, no driveBy, researchBuffBps=1000
    // coeff = 10000 + 1000 = 11000
    // damage = chainBps(100, [10000, 11000]) = applyBps(100, 11000) = 110
    const damage = calculateDamageOutput(100, 100, false, 12720, 10000, 1000);
    expect(damage).toBe(110);
  });

  it('should apply hero attack buff multiplicatively', () => {
    // 100 units, 100 weapons, heroAttackBps = 1000 (10%)
    // coeff = applyBpsBonus(10000, 1000) = floor(10000 * 11000 / 10000) = 11000
    // damage = chainBps(100, [10000, 11000]) = 110
    const damage = calculateDamageOutput(100, 100, false, 12720, 10000, 0, 0, 0, 1000);
    expect(damage).toBe(110);
  });

  it('should trigger deterministic crit when crit chance >= 5000 bps', () => {
    // researchCritChanceBps = 3000, heroCritChanceBps = 2000 => total = 5000 >= 5000
    // researchCritDamageBps = 5000 (50% bonus)
    // coeff = applyBpsBonus(10000, 5000) = 15000
    // damage = chainBps(100, [10000, 15000]) = 150
    const damage = calculateDamageOutput(100, 100, false, 12720, 10000, 0, 3000, 5000, 0, 0, 2000);
    expect(damage).toBe(150);
  });

  it('should NOT trigger crit when crit chance < 5000 bps', () => {
    // researchCritChanceBps = 2000, heroCritChanceBps = 2000 => total = 4000 < 5000
    // Even with high crit damage, should not apply
    const damage = calculateDamageOutput(100, 100, false, 12720, 10000, 0, 2000, 5000, 0, 0, 2000);
    expect(damage).toBe(100);
  });

  it('should not apply driveBy bonus for < 10000 units', () => {
    // Even with driveBy=true, if units < 10000, use attackBaseEffectiveness
    const normalDamage = calculateDamageOutput(100, 100, false);
    const driveByDamage = calculateDamageOutput(100, 100, true);
    expect(driveByDamage).toBe(normalDamage);
  });

  it('should apply driveBy bonus for >= 10000 units', () => {
    // driveByBonusBase default = 12720 (~1.272x, sqrt(PHI))
    const normalDamage = calculateDamageOutput(10000, 10000, false);
    const driveByDamage = calculateDamageOutput(10000, 10000, true);
    expect(driveByDamage).toBeGreaterThan(normalDamage);
  });
});

// inflictDamage Tests

describe('inflictDamage', () => {
  it('should distribute damage across 3 unit types', () => {
    // 100 of each unit, 0 armor, 300 total damage
    // Default distribution: 50% unit1, 30% unit2, 20% unit3
    const [r1, r2, r3] = inflictDamage(100, 100, 100, 0, 300);
    // damage1 = 300 * 5000 / 10000 = 150, but unit3=100 means redistribution
    // unit3 damage: 300 * 2000/10000 = 60 => remaining unit3 = 100 - 60 = 40
    // But also unit3 > 0, so redistribution adds to unit1 and unit2
    // Let's just verify units don't go below 0 and total units decreased
    expect(r1).toBeGreaterThanOrEqual(0);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r3).toBeGreaterThanOrEqual(0);
    expect(r1 + r2 + r3).toBeLessThan(300);
  });

  it('should not reduce units below 0', () => {
    // 10 units each, 0 armor, massive damage
    const [r1, r2, r3] = inflictDamage(10, 10, 10, 0, 100000);
    expect(r1).toBe(0);
    expect(r2).toBe(0);
    expect(r3).toBe(0);
  });

  it('should return original units when damage is 0', () => {
    const [r1, r2, r3] = inflictDamage(100, 200, 300, 0, 0);
    expect(r1).toBe(100);
    expect(r2).toBe(200);
    expect(r3).toBe(300);
  });

  it('should reduce damage with armor', () => {
    // With armor, effective damage should be lower
    const [noArmor1, noArmor2, noArmor3] = inflictDamage(100, 100, 100, 0, 300);
    const [armor1, armor2, armor3] = inflictDamage(100, 100, 100, 300, 300);
    const totalNoArmor = noArmor1 + noArmor2 + noArmor3;
    const totalArmor = armor1 + armor2 + armor3;
    expect(totalArmor).toBeGreaterThanOrEqual(totalNoArmor);
  });

  it('should redistribute damage when a unit type is 0', () => {
    // unit1 = 0, all its damage goes to unit2 and unit3
    const [r1, r2, r3] = inflictDamage(0, 100, 100, 0, 100);
    expect(r1).toBe(0);
    // unit2 and unit3 should absorb all damage
    expect(r2 + r3).toBeLessThan(200);
  });

  it('should concentrate damage on unit1 when unit2 and unit3 are 0', () => {
    // When unit2=0 and unit3=0, damage1 = effectiveDamage = 50
    // Then unit3===0 block also fires: damage1 += 50*2000*0.5/10000 = 5
    // So total damage1 = 55, r1 = 100 - 55 = 45
    const [r1, r2, r3] = inflictDamage(100, 0, 0, 0, 50);
    expect(r1).toBe(45);
    expect(r2).toBe(0);
    expect(r3).toBe(0);
  });

  it('should respect default damage distribution (50/30/20)', () => {
    // Large numbers, no armor, verify approximate split
    const [r1, r2, r3] = inflictDamage(10000, 10000, 10000, 0, 10000);
    // Damage to unit1: 10000 * 0.5 = 5000 (but unit3 redistribution adds more)
    // With redistribution from unit3 present: unit1 gets +10% of total, unit2 gets +10%
    // Total actual damage per unit (with redistribution adjustments):
    // damage1 = 10000*5000/10000 + 10000*2000*0.5/10000 = 5000 + 1000 = 6000
    // damage2 = 10000*3000/10000 + 10000*2000*0.5/10000 = 3000 + 1000 = 4000
    // damage3 = 10000*2000/10000 = 2000
    // But wait - redistribution only happens when unit is 0
    // All units present, so no redistribution
    // damage1 = floor(10000*5000/10000) = 5000 => r1 = 10000 - 5000 = 5000
    // damage2 = floor(10000*3000/10000) = 3000 => r2 = 10000 - 3000 = 7000
    // damage3 = floor(10000*2000/10000) = 2000 => r3 = 10000 - 2000 = 8000
    // BUT unit3 > 0 triggers redistribution line too...
    // Looking at code: "if (unit3 === 0)" adds redistribution. Since unit3 != 0, no extra.
    // However both unit3>0 and unit1>0 blocks execute regardless of condition
    // Actually re-reading the code: the redistribution blocks always execute if the condition is true
    // unit1 !== 0, so first block skipped
    // unit3 !== 0, so last block executes: damage1 += 10000*2000*0.5/10000 = 1000
    // Wait: "if (unit3 === 0)" - unit3 is 10000, NOT 0, so this block is SKIPPED
    // So no redistribution at all:
    expect(r1).toBe(5000);
    expect(r2).toBe(7000);
    expect(r3).toBe(8000);
  });
});

// Infirmary Recovery Tests

describe('calculateInfirmaryRecovery', () => {
  it('should return 0 when no units lost', () => {
    expect(calculateInfirmaryRecovery(0, 250)).toBe(0);
  });

  it('should return 0 when no recovery rate', () => {
    expect(calculateInfirmaryRecovery(100, 0)).toBe(0);
  });

  it('should recover proportional to losses', () => {
    // 100 units lost, 250 bps (2.5%) => floor(100 * 250 / 10000) = 2
    expect(calculateInfirmaryRecovery(100, 250)).toBe(2);
  });

  it('should scale with 25 bps per level', () => {
    // Level 1 = 25 bps, level 10 = 250 bps
    const level1 = calculateInfirmaryRecovery(1000, 25);
    const level10 = calculateInfirmaryRecovery(1000, 250);
    expect(level1).toBe(2);   // floor(1000 * 25 / 10000)
    expect(level10).toBe(25); // floor(1000 * 250 / 10000)
    expect(level10).toBeGreaterThan(level1);
  });

  it('should floor the result', () => {
    // 7 units lost, 1000 bps => floor(7 * 1000 / 10000) = floor(0.7) = 0
    expect(calculateInfirmaryRecovery(7, 1000)).toBe(0);
  });

  it('should handle negative recovery bps as 0', () => {
    expect(calculateInfirmaryRecovery(100, -100)).toBe(0);
  });
});

// Happiness Tests

describe('updateHappinessDefensive', () => {
  it('should return 0.0 when no units', () => {
    expect(updateHappinessDefensive(0, 100, 100, 100)).toBe(0.0);
  });

  it('should return 1.0 when fully supplied', () => {
    // 100 units, 100 weapons, 100 produce, 100 armor
    // weaponCoeff=1, foodCoeff=1, baseCoeff=1
    // armorCoeff=1, armorBonus=0.1, totalCoeff=1.1 => capped to 1.0
    expect(updateHappinessDefensive(100, 100, 100, 100)).toBe(1.0);
  });

  it('should be in range 0.0-1.0', () => {
    // Various inputs
    const h1 = updateHappinessDefensive(100, 50, 50, 50);
    const h2 = updateHappinessDefensive(100, 0, 0, 0);
    const h3 = updateHappinessDefensive(100, 200, 200, 200);
    expect(h1).toBeGreaterThanOrEqual(0.0);
    expect(h1).toBeLessThanOrEqual(1.0);
    expect(h2).toBeGreaterThanOrEqual(0.0);
    expect(h2).toBeLessThanOrEqual(1.0);
    expect(h3).toBeGreaterThanOrEqual(0.0);
    expect(h3).toBeLessThanOrEqual(1.0);
  });

  it('should decrease when weapons are scarce', () => {
    const fullyArmed = updateHappinessDefensive(100, 100, 100, 100);
    const halfArmed = updateHappinessDefensive(100, 50, 100, 100);
    expect(halfArmed).toBeLessThan(fullyArmed);
  });

  it('should decrease when produce is scarce', () => {
    const fullyFed = updateHappinessDefensive(100, 100, 100, 100);
    const halfFed = updateHappinessDefensive(100, 100, 50, 100);
    expect(halfFed).toBeLessThan(fullyFed);
  });

  it('should be 0.0 when produce is 0', () => {
    // foodCoeff = 0, baseCoeff = min(1,1) * min(1,0) = 0
    expect(updateHappinessDefensive(100, 100, 0, 100)).toBe(0.0);
  });
});

describe('updateHappinessOperative', () => {
  it('should return 0.0 when no units', () => {
    expect(updateHappinessOperative(0, 100)).toBe(0.0);
  });

  it('should return 1.0 when fully fed', () => {
    expect(updateHappinessOperative(100, 100)).toBe(1.0);
  });

  it('should return 0.0 when no produce', () => {
    expect(updateHappinessOperative(100, 0)).toBe(0.0);
  });

  it('should cap at 1.0 with excess produce', () => {
    expect(updateHappinessOperative(100, 200)).toBe(1.0);
  });

  it('should be in range 0.0-1.0', () => {
    const h = updateHappinessOperative(100, 50);
    expect(h).toBeGreaterThanOrEqual(0.0);
    expect(h).toBeLessThanOrEqual(1.0);
  });
});

// Abandonment Tests

describe('calculateAbandonment', () => {
  it('should return 0 for 0 units', () => {
    expect(calculateAbandonment(0, 0.5)).toBe(0);
  });

  it('should have lowest abandonment when happiness >= 0.75', () => {
    // Default happy rate = 100 bps (1%)
    const happy = calculateAbandonment(1000, 0.8);
    expect(happy).toBe(10); // floor(1000 * 100 / 10000)
  });

  it('should have moderate abandonment when happiness >= 0.5', () => {
    // Default content rate = 300 bps (3%)
    const content = calculateAbandonment(1000, 0.6);
    expect(content).toBe(30); // floor(1000 * 300 / 10000)
  });

  it('should have higher abandonment when happiness >= 0.25', () => {
    // Default unhappy rate = 800 bps (8%)
    const unhappy = calculateAbandonment(1000, 0.3);
    expect(unhappy).toBe(80); // floor(1000 * 800 / 10000)
  });

  it('should have highest abandonment when happiness < 0.25', () => {
    // Default miserable rate = 1500 bps (15%)
    const miserable = calculateAbandonment(1000, 0.1);
    expect(miserable).toBe(150); // floor(1000 * 1500 / 10000)
  });

  it('should increase abandonment with lower happiness', () => {
    const happy = calculateAbandonment(1000, 0.8);
    const content = calculateAbandonment(1000, 0.6);
    const unhappy = calculateAbandonment(1000, 0.3);
    const miserable = calculateAbandonment(1000, 0.1);
    expect(happy).toBeLessThan(content);
    expect(content).toBeLessThan(unhappy);
    expect(unhappy).toBeLessThan(miserable);
  });

  it('should accept custom abandonment rates', () => {
    const result = calculateAbandonment(1000, 0.8, 200);
    expect(result).toBe(20); // floor(1000 * 200 / 10000)
  });
});

// resolveWeaponCombat Tests

describe('resolveWeaponCombat', () => {
  it('should return empty result when attacker has 0 troops', () => {
    const result = resolveWeaponCombat(
      0, 0,
      createWeaponSet(100, 100, 100),
      0,
      100, 0,
      createWeaponSet(50, 50, 50),
      EMPTY_WEAPON_SET,
      false,
    );
    expect(result.attackerWon).toBe(false);
    expect(weaponSetTotal(result.attackerWeaponsReturned)).toBe(0);
    expect(weaponSetTotal(result.attackerWeaponsLooted)).toBe(0);
    expect(weaponSetTotal(result.defenderWeaponsLooted)).toBe(0);
  });

  it('should declare attacker winner when defender is wiped', () => {
    const result = resolveWeaponCombat(
      100, 10,                           // attacker: 100 troops, 10 casualties
      createWeaponSet(100, 50, 10),      // attacker weapons
      500,                                // attacker damage dealt
      50, 50,                             // defender: 50 troops, 50 casualties (wiped)
      createWeaponSet(30, 30, 5),        // defender equipped
      createWeaponSet(20, 20, 10),       // defender stored
      false,                              // no operatives
    );
    expect(result.attackerWon).toBe(true);
    expect(weaponSetTotal(result.defenderWeaponsLooted)).toBe(0);
  });

  it('should declare defender winner when attacker is wiped', () => {
    const result = resolveWeaponCombat(
      100, 100,                          // attacker: 100 troops, all dead
      createWeaponSet(100, 50, 0),       // attacker weapons
      100,                                // attacker damage dealt
      100, 20,                            // defender: 100 troops, 20 casualties
      createWeaponSet(50, 50, 10),       // defender equipped
      EMPTY_WEAPON_SET,
      false,
    );
    expect(result.attackerWon).toBe(false);
    expect(weaponSetTotal(result.attackerWeaponsReturned)).toBe(0); // wiped
    expect(weaponSetTotal(result.attackerWeaponsLooted)).toBe(0);
    expect(weaponSetTotal(result.defenderWeaponsLooted)).toBeGreaterThan(0);
  });

  it('should give attacker looted weapons when attacker wins', () => {
    const result = resolveWeaponCombat(
      200, 20,                           // attacker: 200 troops, 20 casualties
      createWeaponSet(200, 100, 0),      // attacker weapons
      0,                                  // no siege damage
      100, 100,                           // defender wiped
      createWeaponSet(100, 50, 0),       // defender equipped
      EMPTY_WEAPON_SET,
      false,
    );
    expect(result.attackerWon).toBe(true);
    expect(weaponSetTotal(result.attackerWeaponsLooted)).toBeGreaterThan(0);
  });

  it('should give defender looted weapons when defender wins', () => {
    const result = resolveWeaponCombat(
      100, 60,                           // attacker: 100 troops, 60 casualties
      createWeaponSet(100, 50, 0),       // attacker weapons
      0,
      200, 10,                            // defender: 200 troops, 10 casualties
      createWeaponSet(200, 100, 0),      // defender equipped
      EMPTY_WEAPON_SET,
      false,
    );
    expect(result.attackerWon).toBe(false);
    expect(weaponSetTotal(result.defenderWeaponsLooted)).toBeGreaterThan(0);
  });

  it('should raid armory when defender has 0 garrison troops', () => {
    // Fallback mode: no garrison, attacker raids storage
    const result = resolveWeaponCombat(
      100, 0,                            // attacker: 100 troops, 0 casualties
      createWeaponSet(100, 50, 0),
      0,
      0, 0,                              // no garrison
      EMPTY_WEAPON_SET,                   // no equipped
      createWeaponSet(200, 200, 50),     // stored weapons to raid
      false,                              // no operatives => 50% raid rate
    );
    expect(result.attackerWon).toBe(true);
    // Should loot 50% of stored weapons (ARMORY_RAID_UNDEFENDED_BPS = 5000)
    expect(result.attackerWeaponsLooted.melee).toBe(100);  // 200 * 5000 / 10000
    expect(result.attackerWeaponsLooted.ranged).toBe(100); // 200 * 5000 / 10000
  });

  it('should reduce armory raid rate when operatives present', () => {
    const withoutOps = resolveWeaponCombat(
      100, 0, createWeaponSet(100, 50, 0), 0,
      0, 0, EMPTY_WEAPON_SET, createWeaponSet(200, 200, 50), false,
    );
    const withOps = resolveWeaponCombat(
      100, 0, createWeaponSet(100, 50, 0), 0,
      0, 0, EMPTY_WEAPON_SET, createWeaponSet(200, 200, 50), true,
    );
    // ARMORY_RAID_UNDEFENDED_BPS = 5000, ARMORY_RAID_WITH_OPERATIVES_BPS = 2500
    expect(weaponSetTotal(withOps.attackerWeaponsLooted)).toBeLessThan(
      weaponSetTotal(withoutOps.attackerWeaponsLooted)
    );
  });
});
