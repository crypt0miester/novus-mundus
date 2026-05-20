/**
 * Calculator Constants and Helper Functions
 *
 * Re-exports game constants and provides basis point helper functions.
 */

// Re-export constants from main constants module
export {
  PHI,
  GOLDEN_ROOT,
  PHI_SQUARED,
  PHI_INVERSE,
  PHI_SQUARED_INVERSE,
  PHI_CUBED_INVERSE,
  EARTH_RADIUS_KM,
  SECONDS_PER_DAY as CYCLE_LENGTH,
  WEAPON_LOOT_RATE_BPS,
  DAMAGE_PER_SIEGE_WEAPON,
  SIEGE_CAPTURE_RATE_BPS,
  ARMORY_RAID_WITH_OPERATIVES_BPS,
  ARMORY_RAID_UNDEFENDED_BPS,
  DEFENSIVE_UNIT_1_POWER as DU1_POWER_COST,
  DEFENSIVE_UNIT_2_POWER as DU2_POWER_COST,
  DEFENSIVE_UNIT_3_POWER as DU3_POWER_COST,
  OPERATIVE_UNIT_1_POWER as OP1_POWER_COST,
  OPERATIVE_UNIT_2_POWER as OP2_POWER_COST,
  OPERATIVE_UNIT_3_POWER as OP3_POWER_COST,
  DEFENSIVE_UNIT_HEALTH,
} from '../constants';

// Basis Points Helpers

/** 100% in basis points */
export const BPS_100 = 10000;

/** Time precision multiplier (for time calculations) */
export const TIME_PRECISION = 1000;

/** Apply basis points to a value: value * bps / 10000 */
export function applyBps(value: number, bps: number): number {
  return Math.floor((value * bps) / BPS_100);
}

/** Apply basis points bonus: value * (10000 + bps) / 10000 */
export function applyBpsBonus(value: number, bps: number): number {
  return Math.floor((value * (BPS_100 + bps)) / BPS_100);
}

/** Apply basis points penalty: value * (10000 - bps) / 10000 */
export function applyBpsPenalty(value: number, bps: number): number {
  return Math.floor((value * (BPS_100 - bps)) / BPS_100);
}

/** Chain multiple basis point multipliers */
export function chainBps(value: number, multipliers: number[]): number {
  let result = value;
  for (const bps of multipliers) {
    result = applyBps(result, bps);
  }
  return result;
}

/** Safe multiply and divide */
export function mulDiv(value: number, numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.floor((value * numerator) / denominator);
}

// NOVI Consumption Constants

/** Base multiplier for NOVI -> Power conversion (13.75x) */
export const NOVI_BASE_MULTIPLIER = 13.75;

/** NOVI to power with golden ratio: 13.75 × √φ ≈ 17.49 */
// Note: GOLDEN_ROOT is already exported above
export const NOVI_GOLDEN_MULTIPLIER = NOVI_BASE_MULTIPLIER * 1.2720196495140689;
