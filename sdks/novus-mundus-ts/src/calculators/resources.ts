/**
 * Resource Calculators
 *
 * Networth, resource generation, and consumption calculations.
 */

import { BPS_100, applyBps, applyBpsBonus, mulDiv } from './constants';
import { getActivityMultiplier, TimeOfDay, ActivityType, getCurrentTimeOfDay } from './time';

// ============================================================
// Networth Calculation
// ============================================================

/** Asset values for networth calculation */
export interface AssetValues {
  defensiveUnit1Value: number;
  defensiveUnit2Value: number;
  defensiveUnit3Value: number;
  operativeUnit1Value: number;
  operativeUnit2Value: number;
  operativeUnit3Value: number;
  meleeWeaponValue: number;
  rangedWeaponValue: number;
  siegeWeaponValue: number;
  armorValue: number;
  produceValue: number;
  vehicleValue: number;
}

/** Player assets for networth calculation */
export interface PlayerAssets {
  defensiveUnit1: number;
  defensiveUnit2: number;
  defensiveUnit3: number;
  operativeUnit1: number;
  operativeUnit2: number;
  operativeUnit3: number;
  meleeWeapons: number;
  rangedWeapons: number;
  siegeWeapons: number;
  armorPieces: number;
  produce: number;
  vehicles: number;
  cashOnHand: number;
  cashInVault: number;
}

/**
 * Calculate player's total networth.
 *
 * Includes all assets:
 * - Units (defensive + operative)
 * - Equipment (weapons, armor, produce, vehicles)
 * - Cash (on hand + in vault)
 *
 * @param assets - Player's current assets
 * @param values - Asset value configuration
 * @returns Total networth
 */
export function calculateNetworth(assets: PlayerAssets, values: AssetValues): number {
  // Unit values
  const defensive1Value = assets.defensiveUnit1 * values.defensiveUnit1Value;
  const defensive2Value = assets.defensiveUnit2 * values.defensiveUnit2Value;
  const defensive3Value = assets.defensiveUnit3 * values.defensiveUnit3Value;
  const operative1Value = assets.operativeUnit1 * values.operativeUnit1Value;
  const operative2Value = assets.operativeUnit2 * values.operativeUnit2Value;
  const operative3Value = assets.operativeUnit3 * values.operativeUnit3Value;

  // Weapon values
  const meleeWeaponsValue = assets.meleeWeapons * values.meleeWeaponValue;
  const rangedWeaponsValue = assets.rangedWeapons * values.rangedWeaponValue;
  const siegeWeaponsValue = assets.siegeWeapons * values.siegeWeaponValue;

  // Equipment values
  const armorValue = assets.armorPieces * values.armorValue;
  const produceValue = assets.produce * values.produceValue;
  const vehiclesValue = assets.vehicles * values.vehicleValue;

  // Sum all values
  return (
    defensive1Value +
    defensive2Value +
    defensive3Value +
    operative1Value +
    operative2Value +
    operative3Value +
    meleeWeaponsValue +
    rangedWeaponsValue +
    siegeWeaponsValue +
    armorValue +
    produceValue +
    vehiclesValue +
    assets.cashOnHand +
    assets.cashInVault
  );
}

/**
 * Calculate networth breakdown by category.
 */
export interface NetworthBreakdown {
  units: number;
  weapons: number;
  equipment: number;
  cash: number;
  total: number;
}

export function calculateNetworthBreakdown(
  assets: PlayerAssets,
  values: AssetValues
): NetworthBreakdown {
  const units =
    assets.defensiveUnit1 * values.defensiveUnit1Value +
    assets.defensiveUnit2 * values.defensiveUnit2Value +
    assets.defensiveUnit3 * values.defensiveUnit3Value +
    assets.operativeUnit1 * values.operativeUnit1Value +
    assets.operativeUnit2 * values.operativeUnit2Value +
    assets.operativeUnit3 * values.operativeUnit3Value;

  const weapons =
    assets.meleeWeapons * values.meleeWeaponValue +
    assets.rangedWeapons * values.rangedWeaponValue +
    assets.siegeWeapons * values.siegeWeaponValue;

  const equipment =
    assets.armorPieces * values.armorValue +
    assets.produce * values.produceValue +
    assets.vehicles * values.vehicleValue;

  const cash = assets.cashOnHand + assets.cashInVault;

  return {
    units,
    weapons,
    equipment,
    cash,
    total: units + weapons + equipment + cash,
  };
}

// ============================================================
// Resource Collection
// ============================================================

/**
 * Calculate resource collection amount with time bonus.
 *
 * Golden hours (Dawn/Dusk) provide φ² (2.618x) collection bonus.
 * Midday provides φ (1.618x) bonus.
 * Night provides reduced rates.
 *
 * @param baseAmount - Base resource amount
 * @param timestamp - Current unix timestamp
 * @param longitude - Player longitude for time calculation
 * @param collectionBonusBps - Collection bonus in basis points
 * @returns Resource amount with time bonus applied
 */
export function calculateCollectionWithTimeBonus(
  baseAmount: number,
  timestamp: number,
  longitude: number,
  collectionBonusBps: number = 0
): number {
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const multiplier = getActivityMultiplier(ActivityType.Collecting, timeOfDay);
  let amount = Math.floor(baseAmount * multiplier);

  if (collectionBonusBps > 0) {
    amount = applyBpsBonus(amount, collectionBonusBps);
  }

  return amount;
}

/**
 * Calculate mining output with time bonus.
 *
 * Mining is better at night (cooler, less distraction).
 * DeepNight provides φ (1.618x) bonus.
 * Midday provides penalty.
 */
export function calculateMiningWithTimeBonus(
  baseAmount: number,
  timestamp: number,
  longitude: number,
  miningBonusBps: number = 0
): number {
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const multiplier = getActivityMultiplier(ActivityType.Mining, timeOfDay);
  let amount = Math.floor(baseAmount * multiplier);

  if (miningBonusBps > 0) {
    amount = applyBpsBonus(amount, miningBonusBps);
  }

  return amount;
}

/**
 * Calculate fishing output with time bonus.
 *
 * Fishing is best at dawn/dusk (feeding times).
 * Dawn/Dusk provide φ² (2.618x) bonus.
 */
export function calculateFishingWithTimeBonus(
  baseAmount: number,
  timestamp: number,
  longitude: number,
  fishingBonusBps: number = 0
): number {
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const multiplier = getActivityMultiplier(ActivityType.Fishing, timeOfDay);
  let amount = Math.floor(baseAmount * multiplier);

  if (fishingBonusBps > 0) {
    amount = applyBpsBonus(amount, fishingBonusBps);
  }

  return amount;
}

/**
 * Calculate farming output with time bonus.
 *
 * Farming uses defensive units (not operatives).
 * Farm building provides produce bonus (50 bps/level).
 *
 * Note: On-chain, farming uses the Fishing activity multiplier
 * (CollectionType::Fishing | CollectionType::Farming => ActivityType::Fishing).
 */
export function calculateFarmingWithTimeBonus(
  baseAmount: number,
  timestamp: number,
  longitude: number,
  farmingBonusBps: number = 0
): number {
  const timeOfDay = getCurrentTimeOfDay(timestamp, longitude);
  const multiplier = getActivityMultiplier(ActivityType.Fishing, timeOfDay);
  let amount = Math.floor(baseAmount * multiplier);

  if (farmingBonusBps > 0) {
    amount = applyBpsBonus(amount, farmingBonusBps);
  }

  return amount;
}

// ============================================================
// Resource Consumption
// ============================================================

/**
 * Calculate produce consumption based on unit count.
 *
 * @param sumOfUnits - Total units consuming produce
 * @param produce - Available produce
 * @returns Amount of produce consumed
 */
export function calculateProduceConsumption(sumOfUnits: number, produce: number): number {
  if (produce === 0) {
    return 0;
  }
  // Each unit consumes 1 produce per cycle
  return Math.min(sumOfUnits, produce);
}

/**
 * Calculate produce deficit (units without food).
 *
 * @param sumOfUnits - Total units needing produce
 * @param produce - Available produce
 * @returns Number of units without produce
 */
export function calculateProduceDeficit(sumOfUnits: number, produce: number): number {
  return Math.max(0, sumOfUnits - produce);
}

/**
 * Calculate weapon deficit (units without weapons).
 *
 * @param sumOfUnits - Total units needing weapons
 * @param weapons - Available weapons
 * @returns Number of units without weapons
 */
export function calculateWeaponDeficit(sumOfUnits: number, weapons: number): number {
  return Math.max(0, sumOfUnits - weapons);
}

// ============================================================
// Resource Generation (Estates/Buildings)
// ============================================================

/**
 * Calculate estate resource generation per cycle.
 *
 * @param buildingLevel - Level of the resource building
 * @param baseProduction - Base production per level
 * @param productionBonusBps - Production bonus in basis points
 * @returns Resources generated per cycle
 */
export function calculateEstateProduction(
  buildingLevel: number,
  baseProduction: number,
  productionBonusBps: number = 0
): number {
  const levelProduction = buildingLevel * baseProduction;

  if (productionBonusBps > 0) {
    return applyBpsBonus(levelProduction, productionBonusBps);
  }

  return levelProduction;
}

/**
 * Calculate storage capacity.
 *
 * @param warehouseLevel - Level of the warehouse
 * @param baseCapacity - Base capacity per level
 * @param capacityBonusBps - Capacity bonus in basis points
 * @returns Total storage capacity
 */
export function calculateStorageCapacity(
  warehouseLevel: number,
  baseCapacity: number,
  capacityBonusBps: number = 0
): number {
  const levelCapacity = warehouseLevel * baseCapacity;

  if (capacityBonusBps > 0) {
    return applyBpsBonus(levelCapacity, capacityBonusBps);
  }

  return levelCapacity;
}

// ============================================================
// Resource Transfer Calculations
// ============================================================

// ============================================================
// Resource Ratio Calculations
// ============================================================

/**
 * Calculate weapon coverage ratio.
 *
 * @param weapons - Total weapons
 * @param units - Total units
 * @returns Coverage ratio (0.0 - 1.0+)
 */
export function calculateWeaponCoverage(weapons: number, units: number): number {
  if (units === 0) return 0;
  return weapons / units;
}

/**
 * Calculate produce coverage ratio.
 *
 * @param produce - Total produce
 * @param units - Total units
 * @returns Coverage ratio (0.0 - 1.0+)
 */
export function calculateProduceCoverage(produce: number, units: number): number {
  if (units === 0) return 0;
  return produce / units;
}

/**
 * Calculate armor coverage ratio.
 *
 * @param armor - Total armor pieces
 * @param units - Total units
 * @returns Coverage ratio (0.0 - 1.0+)
 */
export function calculateArmorCoverage(armor: number, units: number): number {
  if (units === 0) return 0;
  return armor / units;
}

// ============================================================
// Resource Display Helpers
// ============================================================

/**
 * Format large numbers with abbreviations.
 *
 * @param value - Number to format
 * @returns Formatted string (e.g., "1.5M", "250K")
 */
export function formatResourceAmount(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Format coverage ratio as percentage.
 *
 * @param ratio - Coverage ratio (0.0 - 1.0+)
 * @returns Formatted percentage string
 */
export function formatCoveragePercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
