/**
 * Player State Validation
 *
 * Validate player state requirements before actions.
 */

import type { Address } from '@solana/kit';
import { address } from '@solana/kit';
import type { PlayerCore } from '../state/player';
import {
  isTraveling,
  hasArrived,
  isSubscriptionActive,
  hasTeam,
  isHeroMeditating,
  getTotalDefensiveUnits,
  getTotalOperativeUnits,
  getTotalUnits,
  getTotalWeapons,
  getEffectiveTier,
} from '../state/player';
import { SubscriptionTier } from '../types/enums';
import {
  type ValidationResult,
  valid,
  invalid,
  combine,
} from './common';

// Location Validation

/** Validate player is not currently traveling */
export function validateNotTraveling(player: PlayerCore): ValidationResult {
  if (isTraveling(player)) {
    return invalid('Player is currently traveling');
  }
  return valid();
}

/** Validate player has arrived at destination (if traveling) */
export function validateArrived(player: PlayerCore, nowSeconds: number): ValidationResult {
  if (isTraveling(player) && !hasArrived(player, nowSeconds)) {
    const eta = Number(player.arrivalTime);
    const remaining = eta - nowSeconds;
    return invalid(`Player has not arrived yet (${remaining} seconds remaining)`);
  }
  return valid();
}

/** Validate player is in a specific city */
export function validateInCity(player: PlayerCore, cityId: number): ValidationResult {
  if (player.currentCity !== cityId) {
    return invalid(`Player is in city ${player.currentCity}, not city ${cityId}`);
  }
  return valid();
}

/** Validate player is at specific coordinates */
export function validateAtLocation(
  player: PlayerCore,
  lat: number,
  long: number,
  toleranceKm: number = 0.1
): ValidationResult {
  const latDiff = Math.abs(player.currentLat - lat);
  const longDiff = Math.abs(player.currentLong - long);
  // Rough approximation: 0.01 degree ≈ 1.1 km
  const toleranceDeg = toleranceKm / 111;

  if (latDiff > toleranceDeg || longDiff > toleranceDeg) {
    return invalid(
      `Player is at (${player.currentLat}, ${player.currentLong}), ` +
        `not at (${lat}, ${long})`
    );
  }
  return valid();
}

// Subscription Validation

/** Validate player has an active subscription */
export function validateSubscriptionActive(player: PlayerCore, nowSeconds: number): ValidationResult {
  if (!isSubscriptionActive(player, nowSeconds)) {
    return invalid('Subscription has expired');
  }
  return valid();
}

/** Validate player has minimum subscription tier */
export function validateMinimumTier(
  player: PlayerCore,
  minTier: SubscriptionTier,
  nowSeconds: number
): ValidationResult {
  const effectiveTier = getEffectiveTier(player, nowSeconds);
  if (effectiveTier < minTier) {
    return invalid(`Requires subscription tier ${minTier} or higher (currently ${effectiveTier})`);
  }
  return valid();
}

// Team Validation

/** Validate player is in a team */
export function validateInTeam(player: PlayerCore): ValidationResult {
  if (!hasTeam(player)) {
    return invalid('Player is not in a team');
  }
  return valid();
}

/** Validate player is not in a team */
export function validateNotInTeam(player: PlayerCore): ValidationResult {
  if (hasTeam(player)) {
    return invalid('Player is already in a team');
  }
  return valid();
}

/** Validate player is in a specific team (by checking team PDA) */
export function validateInSpecificTeam(player: PlayerCore, teamPubkey: Address): ValidationResult {
  if (!hasTeam(player)) {
    return invalid('Player is not in a team');
  }
  if (player.team !== teamPubkey) {
    return invalid(`Player is in a different team`);
  }
  return valid();
}

// Resource Validation

/** Validate player has enough cash on hand */
export function validateHasCash(player: PlayerCore, amount: bigint): ValidationResult {
  if (player.cashOnHand < amount) {
    return invalid(`Insufficient cash: need ${amount.toString()}, have ${player.cashOnHand.toString()}`);
  }
  return valid();
}

/** Validate player has enough cash in vault */
export function validateHasVaultCash(player: PlayerCore, amount: bigint): ValidationResult {
  if (player.cashInVault < amount) {
    return invalid(`Insufficient vault cash: need ${amount.toString()}, have ${player.cashInVault.toString()}`);
  }
  return valid();
}

/** Validate player has enough locked NOVI */
export function validateHasLockedNovi(player: PlayerCore, amount: bigint): ValidationResult {
  if (player.lockedNovi < amount) {
    return invalid(
      `Insufficient locked NOVI: need ${amount.toString()}, have ${player.lockedNovi.toString()}`
    );
  }
  return valid();
}

/** Validate player has enough gems */
export function validateHasGems(player: PlayerCore, amount: bigint): ValidationResult {
  if (player.gems < amount) {
    return invalid(`Insufficient gems: need ${amount.toString()}, have ${player.gems.toString()}`);
  }
  return valid();
}

/** Validate player has enough fragments */
export function validateHasFragments(player: PlayerCore, amount: bigint): ValidationResult {
  if (player.fragments < amount) {
    return invalid(`Insufficient fragments: need ${amount.toString()}, have ${player.fragments.toString()}`);
  }
  return valid();
}

/** Validate player has enough materials */
export function validateHasMaterials(
  player: PlayerCore,
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
  amount: bigint
): ValidationResult {
  let available: bigint;
  switch (rarity) {
    case 'common':
      available = player.commonMaterials;
      break;
    case 'uncommon':
      available = player.uncommonMaterials;
      break;
    case 'rare':
      available = player.rareMaterials;
      break;
    case 'epic':
      available = player.epicMaterials;
      break;
    case 'legendary':
      available = player.legendaryMaterials;
      break;
  }

  if (available < amount) {
    return invalid(`Insufficient ${rarity} materials: need ${amount.toString()}, have ${available.toString()}`);
  }
  return valid();
}

// Units Validation

/** Validate player has minimum defensive units */
export function validateMinDefensiveUnits(player: PlayerCore, minUnits: bigint): ValidationResult {
  const total = getTotalDefensiveUnits(player);
  if (total < minUnits) {
    return invalid(
      `Insufficient defensive units: need ${minUnits.toString()}, have ${total.toString()}`
    );
  }
  return valid();
}

/** Validate player has minimum operative units */
export function validateMinOperativeUnits(player: PlayerCore, minUnits: bigint): ValidationResult {
  const total = getTotalOperativeUnits(player);
  if (total < minUnits) {
    return invalid(
      `Insufficient operative units: need ${minUnits.toString()}, have ${total.toString()}`
    );
  }
  return valid();
}

/** Validate player has minimum total units */
export function validateMinTotalUnits(player: PlayerCore, minUnits: bigint): ValidationResult {
  const total = getTotalUnits(player);
  if (total < minUnits) {
    return invalid(`Insufficient units: need ${minUnits.toString()}, have ${total.toString()}`);
  }
  return valid();
}

/** Validate player has minimum weapons */
export function validateMinWeapons(player: PlayerCore, minWeapons: bigint): ValidationResult {
  const total = getTotalWeapons(player);
  if (total < minWeapons) {
    return invalid(
      `Insufficient weapons: need ${minWeapons.toString()}, have ${total.toString()}`
    );
  }
  return valid();
}

/** Validate player has specific defensive unit type in sufficient quantity */
export function validateHasDefensiveUnit(
  player: PlayerCore,
  unitIndex: 1 | 2 | 3,
  amount: bigint
): ValidationResult {
  let available: bigint;
  switch (unitIndex) {
    case 1:
      available = player.defensiveUnit1;
      break;
    case 2:
      available = player.defensiveUnit2;
      break;
    case 3:
      available = player.defensiveUnit3;
      break;
  }

  if (available < amount) {
    return invalid(
      `Insufficient defensive unit ${unitIndex}: need ${amount.toString()}, have ${available.toString()}`
    );
  }
  return valid();
}

/** Validate player has specific operative unit type in sufficient quantity */
export function validateHasOperativeUnit(
  player: PlayerCore,
  unitIndex: 1 | 2 | 3,
  amount: bigint
): ValidationResult {
  let available: bigint;
  switch (unitIndex) {
    case 1:
      available = player.operativeUnit1;
      break;
    case 2:
      available = player.operativeUnit2;
      break;
    case 3:
      available = player.operativeUnit3;
      break;
  }

  if (available < amount) {
    return invalid(
      `Insufficient operative unit ${unitIndex}: need ${amount.toString()}, have ${available.toString()}`
    );
  }
  return valid();
}

// Stamina Validation

/** Validate player has enough stamina */
export function validateHasStamina(player: PlayerCore, amount: bigint): ValidationResult {
  if (player.encounterStamina < amount) {
    return invalid(`Insufficient stamina: need ${amount.toString()}, have ${player.encounterStamina.toString()}`);
  }
  return valid();
}

// Hero Validation

/** Validate player is not meditating */
export function validateNotMeditating(player: PlayerCore): ValidationResult {
  if (isHeroMeditating(player)) {
    return invalid('Cannot perform action while hero is meditating');
  }
  return valid();
}

/** Validate player has at least one active hero */
export function validateHasActiveHero(player: PlayerCore): ValidationResult {
  const hasHero = player.activeHeroes.some(
    (h) => h !== address('11111111111111111111111111111111')
  );
  if (!hasHero) {
    return invalid('No active hero assigned');
  }
  return valid();
}

/** Validate defensive hero is assigned */
export function validateDefensiveHeroAssigned(player: PlayerCore): ValidationResult {
  if (player.defensiveHeroSlot === 255) {
    return invalid('No defensive hero assigned');
  }
  return valid();
}

// Level Validation

/** Validate player has minimum level */
export function validateMinLevel(player: PlayerCore, minLevel: number): ValidationResult {
  if (player.level < minLevel) {
    return invalid(`Requires level ${minLevel} (currently level ${player.level})`);
  }
  return valid();
}

// Protection Validation

/** Validate player's new player protection has expired */
export function validateProtectionExpired(player: PlayerCore, nowSeconds: number): ValidationResult {
  if (Number(player.newPlayerProtectionUntil) > nowSeconds) {
    const remaining = Number(player.newPlayerProtectionUntil) - nowSeconds;
    return invalid(`New player protection still active (${remaining} seconds remaining)`);
  }
  return valid();
}

/** Validate target player is not under new player protection */
export function validateTargetNotProtected(target: PlayerCore, nowSeconds: number): ValidationResult {
  if (Number(target.newPlayerProtectionUntil) > nowSeconds) {
    return invalid('Target is under new player protection');
  }
  return valid();
}

/** Validate player is not flagged by governance */
export function validateNotFlagged(player: PlayerCore): ValidationResult {
  if (player.flaggedByGovernance) {
    return invalid('Player is flagged by governance');
  }
  return valid();
}

// Consumable Validation

/** Validate player has stamina potions */
export function validateHasStaminaPotions(player: PlayerCore, amount: number): ValidationResult {
  if (player.staminaPotions < amount) {
    return invalid(`Insufficient stamina potions: need ${amount}, have ${player.staminaPotions}`);
  }
  return valid();
}

/** Validate player has teleport scrolls */
export function validateHasTeleportScrolls(player: PlayerCore, amount: number): ValidationResult {
  if (player.teleportScrolls < amount) {
    return invalid(`Insufficient teleport scrolls: need ${amount}, have ${player.teleportScrolls}`);
  }
  return valid();
}

/** Validate player has speed elixirs */
export function validateHasSpeedElixirs(player: PlayerCore, amount: number): ValidationResult {
  if (player.speedElixirs < amount) {
    return invalid(`Insufficient speed elixirs: need ${amount}, have ${player.speedElixirs}`);
  }
  return valid();
}

/** Validate player has rally horns */
export function validateHasRallyHorns(player: PlayerCore, amount: number): ValidationResult {
  if (player.rallyHorns < amount) {
    return invalid(`Insufficient rally horns: need ${amount}, have ${player.rallyHorns}`);
  }
  return valid();
}

// Combined Validations

/** Validate player can perform basic actions (not traveling) */
export function validateCanAct(player: PlayerCore, nowSeconds: number): ValidationResult {
  return combine(
    validateNotTraveling(player),
    validateArrived(player, nowSeconds)
  );
}

/** Validate player can engage in combat */
export function validateCanCombat(
  player: PlayerCore,
  requiredStamina: bigint,
  nowSeconds: number
): ValidationResult {
  return combine(
    validateCanAct(player, nowSeconds),
    validateHasStamina(player, requiredStamina),
    validateMinDefensiveUnits(player, 1n),
    validateNotFlagged(player)
  );
}

/** Validate player can travel */
export function validateCanTravel(player: PlayerCore): ValidationResult {
  return combine(
    validateNotTraveling(player),
    validateNotFlagged(player)
  );
}

/** Validate player can join a rally */
export function validateCanJoinRally(player: PlayerCore, nowSeconds: number): ValidationResult {
  return combine(
    validateCanAct(player, nowSeconds),
    validateInTeam(player),
    validateNotFlagged(player)
  );
}

/** Validate player can start an expedition */
export function validateCanStartExpedition(player: PlayerCore, nowSeconds: number): ValidationResult {
  return combine(
    validateCanAct(player, nowSeconds),
    validateMinOperativeUnits(player, 1n),
    validateNotFlagged(player)
  );
}
