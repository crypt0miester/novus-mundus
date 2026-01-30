/**
 * Combat Calculators
 *
 * Damage, weapon, and combat resolution calculations matching Rust logic.
 */

import {
  PHI,
  GOLDEN_ROOT,
  PHI_SQUARED,
  PHI_INVERSE,
  PHI_SQUARED_INVERSE,
  BPS_100,
  applyBps,
  applyBpsBonus,
  chainBps,
  mulDiv,
  WEAPON_LOOT_RATE_BPS,
  DAMAGE_PER_SIEGE_WEAPON,
  SIEGE_CAPTURE_RATE_BPS,
  ARMORY_RAID_WITH_OPERATIVES_BPS,
  ARMORY_RAID_UNDEFENDED_BPS,
  DU1_POWER_COST,
  DU2_POWER_COST,
  DU3_POWER_COST,
  OP1_POWER_COST,
  OP2_POWER_COST,
  OP3_POWER_COST,
} from './constants.ts';

// ============================================================
// Weapon Set
// ============================================================

/** A set of weapons (melee, ranged, siege) */
export interface WeaponSet {
  melee: number;
  ranged: number;
  siege: number;
}

/** Create a new weapon set */
export function createWeaponSet(melee: number, ranged: number, siege: number): WeaponSet {
  return { melee, ranged, siege };
}

/** Empty weapon set */
export const EMPTY_WEAPON_SET: WeaponSet = { melee: 0, ranged: 0, siege: 0 };

/** Total weapons across all types */
export function weaponSetTotal(set: WeaponSet): number {
  return set.melee + set.ranged + set.siege;
}

/** Apply a basis point rate to all weapon types */
export function weaponSetApplyRate(set: WeaponSet, rateBps: number): WeaponSet {
  return {
    melee: mulDiv(set.melee, rateBps, BPS_100),
    ranged: mulDiv(set.ranged, rateBps, BPS_100),
    siege: mulDiv(set.siege, rateBps, BPS_100),
  };
}

// ============================================================
// Combat Weapon Result
// ============================================================

/** Result of weapon combat resolution */
export interface CombatWeaponResult {
  /** Weapons the attacker carries home (surviving troops' weapons) */
  attackerWeaponsReturned: WeaponSet;
  /** Weapons the attacker looted from dead defenders */
  attackerWeaponsLooted: WeaponSet;
  /** Weapons the defender looted from dead attackers */
  defenderWeaponsLooted: WeaponSet;
  /** Whether the attacker won the battle */
  attackerWon: boolean;
}

// ============================================================
// Combat Resolution Functions
// ============================================================

/**
 * Resolve weapon outcomes from combat.
 *
 * Determines what happens to weapons after a battle:
 * - Winner loots weapons from dead enemy troops (60%)
 * - Winner recovers own dropped weapons (80%)
 * - Loser loses all dropped weapons (can't recover)
 * - Siege weapons are consumed based on damage dealt
 * - Fallback mode: attacker raids armory directly
 *
 * @param attackerTroops - Total troops committed by attacker
 * @param attackerCasualties - Troops the attacker lost
 * @param attackerWeapons - Weapons committed by attacker
 * @param attackerDamageDealt - Damage the attacker dealt (for siege consumption)
 * @param defenderTroops - Total garrison troops (0 if fallback mode)
 * @param defenderCasualties - Troops the defender lost
 * @param defenderEquippedWeapons - Weapons equipped by defender's garrison
 * @param defenderStoredWeapons - Weapons in defender's storage (for armory raid)
 * @param hasOperatives - Whether defender has operatives (affects raid rate)
 * @returns Combat weapon result with all weapon distributions
 */
export function resolveWeaponCombat(
  attackerTroops: number,
  attackerCasualties: number,
  attackerWeapons: WeaponSet,
  attackerDamageDealt: number,
  defenderTroops: number,
  defenderCasualties: number,
  defenderEquippedWeapons: WeaponSet,
  defenderStoredWeapons: WeaponSet,
  hasOperatives: boolean
): CombatWeaponResult {
  // Handle edge case: no attacker troops
  if (attackerTroops === 0) {
    return {
      attackerWeaponsReturned: EMPTY_WEAPON_SET,
      attackerWeaponsLooted: EMPTY_WEAPON_SET,
      defenderWeaponsLooted: EMPTY_WEAPON_SET,
      attackerWon: false,
    };
  }

  // Determine winner
  const attackerWiped = attackerCasualties >= attackerTroops;
  const defenderWiped = defenderCasualties >= defenderTroops || defenderTroops === 0;

  // Attacker wins if:
  // 1. Defender is wiped out, OR
  // 2. Attacker not wiped AND took fewer casualties (proportionally)
  const attackerWon =
    defenderWiped ||
    (!attackerWiped &&
      !defenderWiped &&
      mulDiv(attackerCasualties, BPS_100, attackerTroops) <
        mulDiv(defenderCasualties, BPS_100, Math.max(defenderTroops, 1)));

  // Calculate casualty ratios in basis points
  const attackerCasualtyRatioBps =
    attackerTroops > 0
      ? Math.min(mulDiv(attackerCasualties, BPS_100, attackerTroops), BPS_100)
      : BPS_100;

  const defenderCasualtyRatioBps =
    defenderTroops > 0
      ? Math.min(mulDiv(defenderCasualties, BPS_100, defenderTroops), BPS_100)
      : BPS_100;

  // Calculate siege consumption (based on damage dealt, not casualties)
  const siegeConsumed = Math.min(
    attackerWeapons.siege,
    Math.floor(attackerDamageDealt / Math.max(DAMAGE_PER_SIEGE_WEAPON, 1))
  );
  const attackerSiegeAfterFiring = attackerWeapons.siege - siegeConsumed;

  // Calculate weapon drops from attacker casualties
  const attackerDropped: WeaponSet = {
    melee: mulDiv(attackerWeapons.melee, attackerCasualtyRatioBps, BPS_100),
    ranged: mulDiv(attackerWeapons.ranged, attackerCasualtyRatioBps, BPS_100),
    siege: mulDiv(attackerSiegeAfterFiring, attackerCasualtyRatioBps, BPS_100),
  };

  // Calculate weapon drops from defender casualties
  const defenderDropped: WeaponSet =
    defenderTroops > 0
      ? weaponSetApplyRate(defenderEquippedWeapons, defenderCasualtyRatioBps)
      : EMPTY_WEAPON_SET;

  if (attackerWon) {
    // ATTACKER WON
    let lootedFromDefender: WeaponSet;

    if (defenderTroops > 0) {
      // Loot from dead garrison troops (60%)
      lootedFromDefender = weaponSetApplyRate(defenderDropped, WEAPON_LOOT_RATE_BPS);
    } else {
      // Fallback mode: raid armory directly
      const raidRate = hasOperatives
        ? ARMORY_RAID_WITH_OPERATIVES_BPS
        : ARMORY_RAID_UNDEFENDED_BPS;
      lootedFromDefender = weaponSetApplyRate(defenderStoredWeapons, raidRate);
    }

    // Siege capture from storage if defender fully defeated
    const siegeCaptured = defenderWiped
      ? mulDiv(defenderStoredWeapons.siege, SIEGE_CAPTURE_RATE_BPS, BPS_100)
      : 0;

    // Attacker's surviving weapons
    const attackerSurviving: WeaponSet = {
      melee: attackerWeapons.melee - attackerDropped.melee,
      ranged: attackerWeapons.ranged - attackerDropped.ranged,
      siege: attackerSiegeAfterFiring - attackerDropped.siege,
    };

    // Total looted by attacker
    const attackerLooted: WeaponSet = {
      melee: lootedFromDefender.melee,
      ranged: lootedFromDefender.ranged,
      siege: lootedFromDefender.siege + siegeCaptured,
    };

    return {
      attackerWeaponsReturned: attackerSurviving,
      attackerWeaponsLooted: attackerLooted,
      defenderWeaponsLooted: EMPTY_WEAPON_SET,
      attackerWon: true,
    };
  } else {
    // DEFENDER WON
    const lootedFromAttacker = weaponSetApplyRate(attackerDropped, WEAPON_LOOT_RATE_BPS);

    // Attacker keeps only surviving troops' weapons (if any survivors)
    const attackerSurviving = attackerWiped
      ? EMPTY_WEAPON_SET
      : {
          melee: attackerWeapons.melee - attackerDropped.melee,
          ranged: attackerWeapons.ranged - attackerDropped.ranged,
          siege: attackerSiegeAfterFiring - attackerDropped.siege,
        };

    return {
      attackerWeaponsReturned: attackerSurviving,
      attackerWeaponsLooted: EMPTY_WEAPON_SET,
      defenderWeaponsLooted: lootedFromAttacker,
      attackerWon: false,
    };
  }
}

// ============================================================
// Damage Calculations
// ============================================================

/**
 * Calculate total damage output (Deterministic System).
 *
 * Fully deterministic - no randomness.
 * - Drive-by bonus uses √φ (1.272x)
 * - Normal attacks use base effectiveness (1.0x)
 * - Time-of-day variance applied at processor layer
 * - Crits are skill-based (threshold), not probabilistic
 *
 * @param sumOfUnits - Total attacking units
 * @param weapon - Total weapons available
 * @param driveBy - Whether this is a drive-by attack
 * @param driveByBonusBase - Drive-by coefficient (in basis points, default 12720 = √φ)
 * @param attackBaseEffectiveness - Normal attack effectiveness (default 10000 = 1.0x)
 * @param researchBuffBps - Research attack buff in basis points
 * @param researchCritChanceBps - Research crit chance in basis points (threshold-based)
 * @param researchCritDamageBps - Research crit damage multiplier in basis points
 * @param heroAttackBps - Hero attack power buff in basis points
 * @param heroWeaponEfficiencyBps - Hero weapon efficiency buff in basis points
 * @param heroCritChanceBps - Hero crit chance buff in basis points
 * @param equippedWeaponBonusBps - Equipped weapon item bonus in basis points
 * @returns Total damage output
 */
export function calculateDamageOutput(
  sumOfUnits: number,
  weapon: number,
  driveBy: boolean,
  driveByBonusBase: number = 12720,
  attackBaseEffectiveness: number = 10000,
  researchBuffBps: number = 0,
  researchCritChanceBps: number = 0,
  researchCritDamageBps: number = 0,
  heroAttackBps: number = 0,
  heroWeaponEfficiencyBps: number = 0,
  heroCritChanceBps: number = 0,
  equippedWeaponBonusBps: number = 0
): number {
  if (sumOfUnits === 0) {
    return 0;
  }

  // Weapon coverage: 10000 (100%) if fully armed, proportional if not
  const weaponCoeff =
    weapon >= sumOfUnits ? BPS_100 : mulDiv(weapon, BPS_100, sumOfUnits);

  // Combat effectiveness coefficient
  let coeff = driveBy && sumOfUnits >= 10000 ? driveByBonusBase : attackBaseEffectiveness;

  // Apply research buff (additive to base coefficient)
  coeff += researchBuffBps;

  // Apply hero attack buff (multiplicative)
  if (heroAttackBps > 0) {
    coeff = applyBpsBonus(coeff, heroAttackBps);
  }

  // Apply hero weapon efficiency buff (multiplicative)
  if (heroWeaponEfficiencyBps > 0) {
    coeff = applyBpsBonus(coeff, heroWeaponEfficiencyBps);
  }

  // Apply equipped weapon bonus (multiplicative)
  if (equippedWeaponBonusBps > 0) {
    coeff = applyBpsBonus(coeff, equippedWeaponBonusBps);
  }

  // Deterministic critical hit: if combined crit_chance >= 5000 bp (50%), always crit
  const totalCritChance = researchCritChanceBps + heroCritChanceBps;
  if (totalCritChance >= 5000) {
    coeff = applyBpsBonus(coeff, researchCritDamageBps);
  }

  // Calculate damage using chained multipliers
  return chainBps(sumOfUnits, [weaponCoeff, coeff]);
}

/**
 * Inflict damage on units with armor damage reduction.
 *
 * @param unit1 - Current unit_1 count
 * @param unit2 - Current unit_2 count
 * @param unit3 - Current unit_3 count
 * @param armorPieces - Total armor pieces protecting defenders
 * @param totalDamage - Total damage to distribute
 * @param damageUnit1Percent - Damage distribution to unit 1 (basis points)
 * @param damageUnit2Percent - Damage distribution to unit 2 (basis points)
 * @param damageUnit3Percent - Damage distribution to unit 3 (basis points)
 * @param armorDamageReductionBps - Armor reduction per coverage point (basis points)
 * @param armorDamageReductionCapBps - Maximum armor reduction (basis points)
 * @param heroArmorEfficiencyBps - Hero armor efficiency buff (basis points)
 * @param equippedArmorBonusBps - Equipped armor item bonus (basis points)
 * @returns [remaining_unit_1, remaining_unit_2, remaining_unit_3]
 */
export function inflictDamage(
  unit1: number,
  unit2: number,
  unit3: number,
  armorPieces: number,
  totalDamage: number,
  damageUnit1Percent: number = 5000,
  damageUnit2Percent: number = 3000,
  damageUnit3Percent: number = 2000,
  armorDamageReductionBps: number = 1000,
  armorDamageReductionCapBps: number = 5000,
  heroArmorEfficiencyBps: number = 0,
  equippedArmorBonusBps: number = 0
): [number, number, number] {
  const totalUnits = unit1 + unit2 + unit3;

  // Calculate armor damage reduction
  let effectiveDamage = totalDamage;
  if (totalUnits > 0 && armorPieces > 0) {
    // Calculate base armor coverage in basis points
    let armorCoverageBp = mulDiv(armorPieces, BPS_100, totalUnits);

    // Apply hero armor efficiency buff
    if (heroArmorEfficiencyBps > 0) {
      armorCoverageBp = applyBpsBonus(armorCoverageBp, heroArmorEfficiencyBps);
    }

    // Apply equipped armor bonus
    if (equippedArmorBonusBps > 0) {
      armorCoverageBp = applyBpsBonus(armorCoverageBp, equippedArmorBonusBps);
    }

    // Calculate reduction
    let reductionBp = applyBps(armorCoverageBp, armorDamageReductionBps);
    const cappedReductionBp = Math.min(reductionBp, armorDamageReductionCapBps);

    // Apply reduction
    effectiveDamage = (totalDamage * (BPS_100 - cappedReductionBp)) / BPS_100;
  }

  // Calculate damage distribution
  let damage1 = unit1 > 0 ? (effectiveDamage * damageUnit1Percent) / BPS_100 : 0;
  let damage2 = unit2 > 0 ? (effectiveDamage * damageUnit2Percent) / BPS_100 : 0;
  let damage3 = unit3 > 0 ? (effectiveDamage * damageUnit3Percent) / BPS_100 : 0;

  // Redistribute damage if certain unit types are missing
  if (unit1 === 0) {
    damage2 += (effectiveDamage * damageUnit1Percent * 0.5) / BPS_100;
    damage3 += (effectiveDamage * damageUnit1Percent * 0.5) / BPS_100;
  }
  if (unit1 === 0 && unit2 === 0) {
    damage3 = effectiveDamage;
  }
  if (unit2 === 0 && unit3 === 0) {
    damage1 = effectiveDamage;
  }
  if (unit3 === 0) {
    damage1 += (effectiveDamage * damageUnit3Percent * 0.5) / BPS_100;
    damage2 += (effectiveDamage * damageUnit3Percent * 0.5) / BPS_100;
  }

  // Apply damage with floor and prevent negative
  return [
    Math.max(0, unit1 - Math.floor(damage1)),
    Math.max(0, unit2 - Math.floor(damage2)),
    Math.max(0, unit3 - Math.floor(damage3)),
  ];
}

// ============================================================
// Happiness and Abandonment
// ============================================================

/**
 * Calculate unit abandonment based on happiness (Deterministic).
 *
 * @param sumOfUnits - Total units that could abandon
 * @param happiness - Happiness level (0.0-1.0)
 * @param abandonRateHappy - Rate when happiness >= 0.75 (basis points)
 * @param abandonRateContent - Rate when happiness >= 0.5 (basis points)
 * @param abandonRateUnhappy - Rate when happiness >= 0.25 (basis points)
 * @param abandonRateMiserable - Rate when happiness < 0.25 (basis points)
 * @returns Number of units that will abandon
 */
export function calculateAbandonment(
  sumOfUnits: number,
  happiness: number,
  abandonRateHappy: number = 100,
  abandonRateContent: number = 300,
  abandonRateUnhappy: number = 800,
  abandonRateMiserable: number = 1500
): number {
  let baseRate: number;
  if (happiness >= 0.75) {
    baseRate = abandonRateHappy;
  } else if (happiness >= 0.5) {
    baseRate = abandonRateContent;
  } else if (happiness >= 0.25) {
    baseRate = abandonRateUnhappy;
  } else {
    baseRate = abandonRateMiserable;
  }

  return applyBps(sumOfUnits, baseRate);
}

/**
 * Update happiness for defensive units.
 * Based on weapon, produce, and armor availability.
 *
 * @param sumOfUnits - Total defensive units
 * @param weapon - Total weapons available
 * @param produce - Total produce available
 * @param armor - Total armor available
 * @returns Happiness value (0.0-1.0)
 */
export function updateHappinessDefensive(
  sumOfUnits: number,
  weapon: number,
  produce: number,
  armor: number
): number {
  if (sumOfUnits === 0) {
    return 0.0;
  }

  const weaponCoeff = weapon / sumOfUnits;
  const foodCoeff = produce / sumOfUnits;
  const armorCoeff = armor / sumOfUnits;

  // Base happiness from weapons and food
  const baseCoeff = Math.min(1.0, weaponCoeff) * Math.min(1.0, foodCoeff);

  // Armor provides a morale boost (+10% per coverage point, up to 50% bonus)
  const armorBonus = Math.min(0.5, armorCoeff * 0.1);
  const totalCoeff = baseCoeff * (1.0 + armorBonus);

  return Math.min(1.0, Math.round(totalCoeff * 100) / 100);
}

/**
 * Update happiness for operative units.
 * Based on produce availability.
 */
export function updateHappinessOperative(sumOfUnits: number, produce: number): number {
  if (sumOfUnits === 0) {
    return 0.0;
  }

  const foodCoeff = produce / sumOfUnits;
  return Math.min(1.0, Math.round(foodCoeff));
}

// ============================================================
// Power Calculations
// ============================================================

/**
 * Calculate total power from units.
 */
export function calculatePower(
  defensiveUnit1: number,
  defensiveUnit2: number,
  defensiveUnit3: number,
  operativeUnit1: number,
  operativeUnit2: number,
  operativeUnit3: number
): number {
  return (
    defensiveUnit1 * DU1_POWER_COST +
    defensiveUnit2 * DU2_POWER_COST +
    defensiveUnit3 * DU3_POWER_COST +
    operativeUnit1 * OP1_POWER_COST +
    operativeUnit2 * OP2_POWER_COST +
    operativeUnit3 * OP3_POWER_COST
  );
}

/**
 * Calculate defensive power only.
 */
export function calculateDefensivePower(
  defensiveUnit1: number,
  defensiveUnit2: number,
  defensiveUnit3: number
): number {
  return (
    defensiveUnit1 * DU1_POWER_COST +
    defensiveUnit2 * DU2_POWER_COST +
    defensiveUnit3 * DU3_POWER_COST
  );
}

/**
 * Calculate operative power only.
 */
export function calculateOperativePower(
  operativeUnit1: number,
  operativeUnit2: number,
  operativeUnit3: number
): number {
  return (
    operativeUnit1 * OP1_POWER_COST +
    operativeUnit2 * OP2_POWER_COST +
    operativeUnit3 * OP3_POWER_COST
  );
}
