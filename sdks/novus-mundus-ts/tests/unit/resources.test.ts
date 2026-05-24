/**
 * Resource Calculator Unit Tests
 *
 * Tests for networth, resource collection, consumption, generation,
 * transfer calculations, coverage ratios, and display helpers.
 */

import { describe, it, expect } from 'bun:test';
import {
  // Networth
  calculateNetworth,
  calculateNetworthBreakdown,
  // Consumption
  calculateProduceConsumption,
  calculateProduceDeficit,
  calculateWeaponDeficit,
  // Generation (estate/building)
  calculateEstateProduction,
  calculateStorageCapacity,
  // Transfer
  calculateVaultFee,
  calculateAmountAfterFee,
  calculateTransferTax,
  // Coverage ratios
  calculateWeaponCoverage,
  calculateProduceCoverage,
  calculateArmorCoverage,
  // Display helpers
  formatResourceAmount,
  formatCoveragePercent,
  // Types
  type PlayerAssets,
  type AssetValues,
} from '../../src/calculators/resources';

// Test Fixtures

function createEmptyAssets(): PlayerAssets {
  return {
    defensiveUnit1: 0,
    defensiveUnit2: 0,
    defensiveUnit3: 0,
    operativeUnit1: 0,
    operativeUnit2: 0,
    operativeUnit3: 0,
    meleeWeapons: 0,
    rangedWeapons: 0,
    siegeWeapons: 0,
    armorPieces: 0,
    produce: 0,
    vehicles: 0,
    cashOnHand: 0,
    cashInVault: 0,
  };
}

function createSampleAssets(): PlayerAssets {
  return {
    defensiveUnit1: 100,
    defensiveUnit2: 50,
    defensiveUnit3: 25,
    operativeUnit1: 80,
    operativeUnit2: 40,
    operativeUnit3: 10,
    meleeWeapons: 200,
    rangedWeapons: 150,
    siegeWeapons: 50,
    armorPieces: 100,
    produce: 500,
    vehicles: 20,
    cashOnHand: 10000,
    cashInVault: 50000,
  };
}

function createUnitValues(): AssetValues {
  return {
    defensiveUnit1Value: 10,
    defensiveUnit2Value: 25,
    defensiveUnit3Value: 50,
    operativeUnit1Value: 15,
    operativeUnit2Value: 35,
    operativeUnit3Value: 75,
    meleeWeaponValue: 5,
    rangedWeaponValue: 8,
    siegeWeaponValue: 20,
    armorValue: 12,
    produceValue: 2,
    vehicleValue: 100,
  };
}

// Networth Calculation Tests

describe('Networth Calculations', () => {
  describe('calculateNetworth', () => {
    it('should return 0 for empty assets', () => {
      const assets = createEmptyAssets();
      const values = createUnitValues();
      expect(calculateNetworth(assets, values)).toBe(0);
    });

    it('should calculate total networth from all asset categories', () => {
      const assets = createSampleAssets();
      const values = createUnitValues();

      // Units: 100*10 + 50*25 + 25*50 + 80*15 + 40*35 + 10*75
      //      = 1000 + 1250 + 1250 + 1200 + 1400 + 750 = 6850
      // Weapons: 200*5 + 150*8 + 50*20 = 1000 + 1200 + 1000 = 3200
      // Equipment: 100*12 + 500*2 + 20*100 = 1200 + 1000 + 2000 = 4200
      // Cash: 10000 + 50000 = 60000
      const expected = 6850 + 3200 + 4200 + 60000;

      expect(calculateNetworth(assets, values)).toBe(expected);
    });

    it('should include cash on hand and in vault', () => {
      const assets = createEmptyAssets();
      assets.cashOnHand = 5000;
      assets.cashInVault = 15000;
      const values = createUnitValues();

      expect(calculateNetworth(assets, values)).toBe(20000);
    });

    it('should handle very large values', () => {
      const assets = createEmptyAssets();
      assets.defensiveUnit1 = 1_000_000;
      assets.cashOnHand = 100_000_000;
      const values = createUnitValues();

      const expected = 1_000_000 * 10 + 100_000_000;
      expect(calculateNetworth(assets, values)).toBe(expected);
    });
  });

  describe('calculateNetworthBreakdown', () => {
    it('should return all-zero breakdown for empty assets', () => {
      const assets = createEmptyAssets();
      const values = createUnitValues();
      const breakdown = calculateNetworthBreakdown(assets, values);

      expect(breakdown.units).toBe(0);
      expect(breakdown.weapons).toBe(0);
      expect(breakdown.equipment).toBe(0);
      expect(breakdown.cash).toBe(0);
      expect(breakdown.total).toBe(0);
    });

    it('should correctly categorize asset types', () => {
      const assets = createSampleAssets();
      const values = createUnitValues();
      const breakdown = calculateNetworthBreakdown(assets, values);

      // Units: 100*10 + 50*25 + 25*50 + 80*15 + 40*35 + 10*75 = 6850
      expect(breakdown.units).toBe(6850);

      // Weapons: 200*5 + 150*8 + 50*20 = 3200
      expect(breakdown.weapons).toBe(3200);

      // Equipment: 100*12 + 500*2 + 20*100 = 4200
      expect(breakdown.equipment).toBe(4200);

      // Cash: 10000 + 50000 = 60000
      expect(breakdown.cash).toBe(60000);
    });

    it('should have total equal to sum of categories', () => {
      const assets = createSampleAssets();
      const values = createUnitValues();
      const breakdown = calculateNetworthBreakdown(assets, values);

      expect(breakdown.total).toBe(
        breakdown.units + breakdown.weapons + breakdown.equipment + breakdown.cash
      );
    });

    it('should match calculateNetworth total', () => {
      const assets = createSampleAssets();
      const values = createUnitValues();
      const total = calculateNetworth(assets, values);
      const breakdown = calculateNetworthBreakdown(assets, values);

      expect(breakdown.total).toBe(total);
    });
  });
});

// Resource Consumption Tests

describe('Resource Consumption', () => {
  describe('calculateProduceConsumption', () => {
    it('should return 0 when no produce available', () => {
      expect(calculateProduceConsumption(100, 0)).toBe(0);
    });

    it('should consume 1 per unit when surplus', () => {
      // 50 units, 200 produce -> consumes 50
      expect(calculateProduceConsumption(50, 200)).toBe(50);
    });

    it('should consume all produce when deficit', () => {
      // 200 units, 50 produce -> consumes 50 (all available)
      expect(calculateProduceConsumption(200, 50)).toBe(50);
    });

    it('should consume exact amount when balanced', () => {
      expect(calculateProduceConsumption(100, 100)).toBe(100);
    });

    it('should return 0 when no units', () => {
      expect(calculateProduceConsumption(0, 100)).toBe(0);
    });
  });

  describe('calculateProduceDeficit', () => {
    it('should return 0 when surplus', () => {
      expect(calculateProduceDeficit(50, 200)).toBe(0);
    });

    it('should return deficit when shortage', () => {
      expect(calculateProduceDeficit(200, 50)).toBe(150);
    });

    it('should return 0 when balanced', () => {
      expect(calculateProduceDeficit(100, 100)).toBe(0);
    });

    it('should return full count when no produce', () => {
      expect(calculateProduceDeficit(100, 0)).toBe(100);
    });

    it('should return 0 when no units', () => {
      expect(calculateProduceDeficit(0, 100)).toBe(0);
    });
  });

  describe('calculateWeaponDeficit', () => {
    it('should return 0 when surplus', () => {
      expect(calculateWeaponDeficit(50, 200)).toBe(0);
    });

    it('should return deficit when shortage', () => {
      expect(calculateWeaponDeficit(200, 50)).toBe(150);
    });

    it('should return 0 when balanced', () => {
      expect(calculateWeaponDeficit(100, 100)).toBe(0);
    });

    it('should return full count when no weapons', () => {
      expect(calculateWeaponDeficit(100, 0)).toBe(100);
    });

    it('should return 0 when no units', () => {
      expect(calculateWeaponDeficit(0, 50)).toBe(0);
    });
  });
});

// Estate Production & Storage Tests

describe('Estate Resource Generation', () => {
  describe('calculateEstateProduction', () => {
    it('should return 0 for level 0', () => {
      expect(calculateEstateProduction(0, 100)).toBe(0);
    });

    it('should scale linearly with level', () => {
      expect(calculateEstateProduction(1, 100)).toBe(100);
      expect(calculateEstateProduction(5, 100)).toBe(500);
      expect(calculateEstateProduction(10, 100)).toBe(1000);
    });

    it('should apply production bonus', () => {
      // Level 5 * 100 base = 500, with 10% bonus = 550
      expect(calculateEstateProduction(5, 100, 1000)).toBe(550);
    });

    it('should not apply bonus when 0', () => {
      expect(calculateEstateProduction(5, 100, 0)).toBe(500);
    });

    it('should handle 100% bonus (double production)', () => {
      // Level 3 * 200 base = 600, with 100% bonus = 1200
      expect(calculateEstateProduction(3, 200, 10000)).toBe(1200);
    });
  });

  describe('calculateStorageCapacity', () => {
    it('should return 0 for level 0', () => {
      expect(calculateStorageCapacity(0, 500)).toBe(0);
    });

    it('should scale linearly with warehouse level', () => {
      expect(calculateStorageCapacity(1, 500)).toBe(500);
      expect(calculateStorageCapacity(3, 500)).toBe(1500);
    });

    it('should apply capacity bonus', () => {
      // Level 2 * 500 base = 1000, with 20% bonus = 1200
      expect(calculateStorageCapacity(2, 500, 2000)).toBe(1200);
    });

    it('should not apply bonus when 0', () => {
      expect(calculateStorageCapacity(4, 500, 0)).toBe(2000);
    });
  });
});

// Transfer Calculation Tests

describe('Transfer Calculations', () => {
  describe('calculateVaultFee', () => {
    it('should calculate 10% fee (1000 bps)', () => {
      expect(calculateVaultFee(1000, 1000)).toBe(100);
    });

    it('should calculate 0% fee', () => {
      expect(calculateVaultFee(1000, 0)).toBe(0);
    });

    it('should calculate 100% fee', () => {
      expect(calculateVaultFee(1000, 10000)).toBe(1000);
    });

    it('should floor fractional fees', () => {
      // 333 * 1000 / 10000 = 33.3 -> floor to 33
      expect(calculateVaultFee(333, 1000)).toBe(33);
    });
  });

  describe('calculateAmountAfterFee', () => {
    it('should subtract 10% fee', () => {
      expect(calculateAmountAfterFee(1000, 1000)).toBe(900);
    });

    it('should return full amount with 0% fee', () => {
      expect(calculateAmountAfterFee(1000, 0)).toBe(1000);
    });

    it('should return 0 with 100% fee', () => {
      expect(calculateAmountAfterFee(1000, 10000)).toBe(0);
    });

    it('should be consistent with calculateVaultFee', () => {
      const amount = 5000;
      const feeBps = 500; // 5%
      const fee = calculateVaultFee(amount, feeBps);
      const net = calculateAmountAfterFee(amount, feeBps);
      expect(fee + net).toBe(amount);
    });
  });

  describe('calculateTransferTax', () => {
    it('should calculate 5% tax (500 bps)', () => {
      expect(calculateTransferTax(2000, 500)).toBe(100);
    });

    it('should calculate 0% tax', () => {
      expect(calculateTransferTax(2000, 0)).toBe(0);
    });

    it('should handle large amounts', () => {
      expect(calculateTransferTax(1_000_000, 250)).toBe(25000);
    });
  });
});

// Coverage Ratio Tests

describe('Coverage Ratios', () => {
  describe('calculateWeaponCoverage', () => {
    it('should return 0 when no units', () => {
      expect(calculateWeaponCoverage(100, 0)).toBe(0);
    });

    it('should return 1.0 when balanced', () => {
      expect(calculateWeaponCoverage(100, 100)).toBe(1.0);
    });

    it('should return 0.5 for half coverage', () => {
      expect(calculateWeaponCoverage(50, 100)).toBe(0.5);
    });

    it('should return > 1.0 for surplus', () => {
      expect(calculateWeaponCoverage(200, 100)).toBe(2.0);
    });

    it('should return 0 when no weapons and no units', () => {
      expect(calculateWeaponCoverage(0, 0)).toBe(0);
    });
  });

  describe('calculateProduceCoverage', () => {
    it('should return 0 when no units', () => {
      expect(calculateProduceCoverage(100, 0)).toBe(0);
    });

    it('should return 1.0 when balanced', () => {
      expect(calculateProduceCoverage(100, 100)).toBe(1.0);
    });

    it('should return > 1.0 for surplus', () => {
      expect(calculateProduceCoverage(300, 100)).toBe(3.0);
    });

    it('should return fraction for deficit', () => {
      expect(calculateProduceCoverage(25, 100)).toBe(0.25);
    });
  });

  describe('calculateArmorCoverage', () => {
    it('should return 0 when no units', () => {
      expect(calculateArmorCoverage(100, 0)).toBe(0);
    });

    it('should return 1.0 when balanced', () => {
      expect(calculateArmorCoverage(100, 100)).toBe(1.0);
    });

    it('should handle partial coverage', () => {
      expect(calculateArmorCoverage(75, 100)).toBe(0.75);
    });

    it('should allow over 100% coverage', () => {
      expect(calculateArmorCoverage(150, 100)).toBe(1.5);
    });
  });
});

// Display Helper Tests

describe('Display Helpers', () => {
  describe('formatResourceAmount', () => {
    it('should format small numbers as-is', () => {
      expect(formatResourceAmount(0)).toBe('0');
      expect(formatResourceAmount(1)).toBe('1');
      expect(formatResourceAmount(999)).toBe('999');
    });

    it('should format thousands with K suffix', () => {
      expect(formatResourceAmount(1000)).toBe('1.0K');
      expect(formatResourceAmount(1500)).toBe('1.5K');
      expect(formatResourceAmount(999999)).toBe('1000.0K');
    });

    it('should format millions with M suffix', () => {
      expect(formatResourceAmount(1_000_000)).toBe('1.0M');
      expect(formatResourceAmount(2_500_000)).toBe('2.5M');
    });

    it('should format billions with B suffix', () => {
      expect(formatResourceAmount(1_000_000_000)).toBe('1.0B');
      expect(formatResourceAmount(5_500_000_000)).toBe('5.5B');
    });
  });

  describe('formatCoveragePercent', () => {
    it('should format 0% coverage', () => {
      expect(formatCoveragePercent(0)).toBe('0%');
    });

    it('should format 100% coverage', () => {
      expect(formatCoveragePercent(1.0)).toBe('100%');
    });

    it('should format partial coverage', () => {
      expect(formatCoveragePercent(0.5)).toBe('50%');
      expect(formatCoveragePercent(0.75)).toBe('75%');
    });

    it('should format over 100% coverage', () => {
      expect(formatCoveragePercent(1.5)).toBe('150%');
      expect(formatCoveragePercent(2.0)).toBe('200%');
    });

    it('should round to nearest integer', () => {
      expect(formatCoveragePercent(0.333)).toBe('33%');
      expect(formatCoveragePercent(0.667)).toBe('67%');
    });
  });
});
