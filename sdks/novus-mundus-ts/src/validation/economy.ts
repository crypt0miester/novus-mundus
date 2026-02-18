/**
 * Economy Validation
 *
 * Validate economy-related parameters and requirements.
 */

import BN from 'bn.js';
import type { PlayerCore } from '../state/player';
import {
  type ValidationResult,
  valid,
  invalid,
  combine,
  validateRange,
  validateMinimumBN,
} from './common';
import {
  validateHasCash,
  validateHasGems,
  validateHasFragments,
  validateHasMaterials,
  validateHasLockedNovi,
} from './player';

// ============================================================
// Constants
// ============================================================

/** Maximum transfer amount (u64 max) */
const MAX_TRANSFER_AMOUNT = new BN('18446744073709551615');

/** Minimum transfer amount */
const MIN_TRANSFER_AMOUNT = new BN(1);

/** Maximum units that can be hired at once */
const MAX_HIRE_BATCH = 10000;

// ============================================================
// Transfer Validation
// ============================================================

/** Validate transfer amount is within valid range */
export function validateTransferAmount(amount: BN): ValidationResult {
  if (amount.lt(MIN_TRANSFER_AMOUNT)) {
    return invalid(`Transfer amount must be at least ${MIN_TRANSFER_AMOUNT.toString()}`);
  }
  if (amount.gt(MAX_TRANSFER_AMOUNT)) {
    return invalid(`Transfer amount exceeds maximum`);
  }
  return valid();
}

/** Validate player can transfer cash */
export function validateCanTransferCash(player: PlayerCore, amount: BN): ValidationResult {
  return combine(
    validateTransferAmount(amount),
    validateHasCash(player, amount)
  );
}

// ============================================================
// Hiring Validation
// ============================================================

/** Validate unit type is valid for hiring (0-5) */
export function validateHireableUnitType(unitType: number): ValidationResult {
  if (unitType < 0 || unitType > 5) {
    return invalid(`Invalid unit type: ${unitType}. Must be 0-5.`);
  }
  return valid();
}

/**
 * Get the required building for a unit type.
 *
 * Defensive units (0-2) require Barracks.
 * Operative units (3-5) require Camp.
 */
export function getRequiredBuildingForUnit(unitType: number): 'Barracks' | 'Camp' {
  return unitType <= 2 ? 'Barracks' : 'Camp';
}

/** Validate hire amount is within range */
export function validateHireAmount(amount: number): ValidationResult {
  return validateRange(amount, 1, MAX_HIRE_BATCH, 'Hire amount');
}

/** Validate player has resources to hire units */
export function validateCanHireUnits(
  player: PlayerCore,
  unitType: number,
  amount: number,
  cost: BN
): ValidationResult {
  return combine(
    validateHireableUnitType(unitType),
    validateHireAmount(amount),
    validateHasCash(player, cost)
  );
}

// ============================================================
// Purchase Validation
// ============================================================

/** Validate a shop purchase quantity */
export function validatePurchaseQuantity(quantity: number, maxQuantity: number): ValidationResult {
  return validateRange(quantity, 1, maxQuantity, 'Purchase quantity');
}

/** Validate player can afford a purchase */
export function validateCanAffordPurchase(
  player: PlayerCore,
  priceType: 'cash' | 'gems' | 'fragments' | 'locked',
  price: BN
): ValidationResult {
  switch (priceType) {
    case 'cash':
      return validateHasCash(player, price);
    case 'gems':
      return validateHasGems(player, price);
    case 'fragments':
      return validateHasFragments(player, price);
    case 'locked':
      return validateHasLockedNovi(player, price);
    default:
      return invalid(`Unknown price type: ${priceType}`);
  }
}

// ============================================================
// Speedup Validation
// ============================================================

/** Validate speedup amount */
export function validateSpeedupAmount(speedupSeconds: number): ValidationResult {
  if (speedupSeconds <= 0) {
    return invalid('Speedup duration must be positive');
  }
  if (speedupSeconds > 86400 * 30) {
    // Max 30 days
    return invalid('Speedup duration exceeds maximum');
  }
  return valid();
}

/** Validate player can afford speedup */
export function validateCanAffordSpeedup(
  player: PlayerCore,
  speedupCost: BN
): ValidationResult {
  return validateHasGems(player, speedupCost);
}

// ============================================================
// Stake/Lock Validation
// ============================================================

/** Validate token lock amount */
export function validateLockAmount(amount: BN): ValidationResult {
  return validateMinimumBN(amount, new BN(1), 'Lock amount');
}

/** Validate token unlock amount */
export function validateUnlockAmount(player: PlayerCore, amount: BN): ValidationResult {
  return combine(
    validateMinimumBN(amount, new BN(1), 'Unlock amount'),
    validateHasLockedNovi(player, amount)
  );
}

// ============================================================
// Material Validation
// ============================================================

/** Validate player has required crafting materials */
export function validateHasCraftingMaterials(
  player: PlayerCore,
  requirements: {
    common?: BN;
    uncommon?: BN;
    rare?: BN;
    epic?: BN;
    legendary?: BN;
  }
): ValidationResult {
  const results: ValidationResult[] = [];

  if (requirements.common && !requirements.common.isZero()) {
    results.push(validateHasMaterials(player, 'common', requirements.common));
  }
  if (requirements.uncommon && !requirements.uncommon.isZero()) {
    results.push(validateHasMaterials(player, 'uncommon', requirements.uncommon));
  }
  if (requirements.rare && !requirements.rare.isZero()) {
    results.push(validateHasMaterials(player, 'rare', requirements.rare));
  }
  if (requirements.epic && !requirements.epic.isZero()) {
    results.push(validateHasMaterials(player, 'epic', requirements.epic));
  }
  if (requirements.legendary && !requirements.legendary.isZero()) {
    results.push(validateHasMaterials(player, 'legendary', requirements.legendary));
  }

  return results.length > 0 ? combine(...results) : valid();
}

// ============================================================
// Daily Transfer Limits
// ============================================================

/** Validate player hasn't exceeded daily transfer limit */
export function validateDailyTransferLimit(
  player: PlayerCore,
  amount: BN,
  maxDaily: BN
): ValidationResult {
  const newTotal = player.dailyTransferred.add(amount);
  if (newTotal.gt(maxDaily)) {
    return invalid(
      `Would exceed daily transfer limit: ${newTotal.toString()} > ${maxDaily.toString()}`
    );
  }
  return valid();
}

/** Validate player hasn't exceeded daily transfer count */
export function validateDailyTransferCount(
  player: PlayerCore,
  maxCount: number
): ValidationResult {
  if (player.dailyTransferCount >= maxCount) {
    return invalid(`Daily transfer count exceeded: ${player.dailyTransferCount} >= ${maxCount}`);
  }
  return valid();
}
