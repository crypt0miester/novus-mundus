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
} from '../../src/calculators/travel.ts';

import {
  // Combat
  createWeaponSet,
  weaponSetTotal,
  weaponSetApplyRate,
  EMPTY_WEAPON_SET,
} from '../../src/calculators/combat.ts';

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
} from '../../src/calculators/constants.ts';

// ============================================================
// Constants Tests
// ============================================================

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

// ============================================================
// Travel Calculator Tests
// ============================================================

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

// ============================================================
// Combat Calculator Tests
// ============================================================

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

// ============================================================
// Earth Radius Constant Test
// ============================================================

describe('Geographic Constants', () => {
  it('should have correct Earth radius', () => {
    expect(EARTH_RADIUS_KM).toBe(6371);
  });
});
