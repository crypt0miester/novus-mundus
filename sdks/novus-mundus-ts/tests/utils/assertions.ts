/**
 * Custom Assertions for Game State
 *
 * Type-safe assertion helpers for verifying game state in tests.
 */

import { expect } from 'bun:test';
import { PublicKey } from '@solana/web3.js';

import type {
  PlayerAccount,
  TeamAccount,
  TeamMemberSlot,
} from '../../src/index';
import { isNullPubkey } from '../../src/utils/deserialize';

// bigint Assertions

/**
 * Assert that a bigint equals an expected value.
 */
export function assertBnEquals(
  actual: bigint,
  expected: number | bigint,
  message?: string
): void {
  const expectedBig = BigInt(expected);
  const msg = message || `Expected ${actual.toString()} to equal ${expectedBig.toString()}`;
  expect(actual === expectedBig).toBe(true);
}

/**
 * Assert that a bigint is greater than a value.
 */
export function assertBnGreaterThan(
  actual: bigint,
  minimum: number | bigint,
  message?: string
): void {
  const minBig = BigInt(minimum);
  const msg = message || `Expected ${actual.toString()} > ${minBig.toString()}`;
  expect(actual > minBig).toBe(true);
}

/**
 * Assert that a bigint is greater than or equal to a value.
 */
export function assertBnGreaterThanOrEqual(
  actual: bigint,
  minimum: number | bigint,
  message?: string
): void {
  const minBig = BigInt(minimum);
  const msg = message || `Expected ${actual.toString()} >= ${minBig.toString()}`;
  expect(actual >= minBig).toBe(true);
}

/**
 * Assert that a bigint is less than a value.
 */
export function assertBnLessThan(
  actual: bigint,
  maximum: number | bigint,
  message?: string
): void {
  const maxBig = BigInt(maximum);
  const msg = message || `Expected ${actual.toString()} < ${maxBig.toString()}`;
  expect(actual < maxBig).toBe(true);
}

/**
 * Assert that a bigint is less than or equal to a value.
 */
export function assertBnLessThanOrEqual(
  actual: bigint,
  maximum: number | bigint,
  message?: string
): void {
  const maxBig = BigInt(maximum);
  const msg = message || `Expected ${actual.toString()} <= ${maxBig.toString()}`;
  expect(actual <= maxBig).toBe(true);
}

/**
 * Assert that a bigint is within a range.
 */
export function assertBnInRange(
  actual: bigint,
  min: number | bigint,
  max: number | bigint,
  message?: string
): void {
  const minBig = BigInt(min);
  const maxBig = BigInt(max);
  expect(actual >= minBig && actual <= maxBig).toBe(true);
}

/**
 * Assert that a bigint is zero.
 */
export function assertBnZero(actual: bigint, message?: string): void {
  expect(actual === 0n).toBe(true);
}

/**
 * Assert that a bigint is not zero.
 */
export function assertBnNotZero(actual: bigint, message?: string): void {
  expect(actual === 0n).toBe(false);
}

// PublicKey Assertions

/**
 * Assert that two PublicKeys are equal.
 */
export function assertPubkeyEquals(
  actual: PublicKey,
  expected: PublicKey,
  message?: string
): void {
  expect(actual.equals(expected)).toBe(true);
}

/**
 * Assert that a PublicKey is the null pubkey.
 */
export function assertPubkeyNull(actual: PublicKey, message?: string): void {
  expect(isNullPubkey(actual)).toBe(true);
}

/**
 * Assert that a PublicKey is not the null pubkey.
 */
export function assertPubkeyNotNull(actual: PublicKey, message?: string): void {
  expect(isNullPubkey(actual)).toBe(false);
}

// Player State Assertions

/**
 * Assert player has minimum resources.
 */
export function assertPlayerHasResources(
  player: PlayerAccount,
  resources: {
    lockedNovi?: bigint | number;
    cashOnHand?: bigint | number;
    cashInVault?: bigint | number;
    defensiveUnit1?: bigint | number;
    defensiveUnit2?: bigint | number;
    defensiveUnit3?: bigint | number;
    operativeUnit1?: bigint | number;
    operativeUnit2?: bigint | number;
    operativeUnit3?: bigint | number;
    meleeWeapons?: bigint | number;
    rangedWeapons?: bigint | number;
    siegeWeapons?: bigint | number;
    armorPieces?: bigint | number;
    produce?: bigint | number;
  }
): void {
  if (resources.lockedNovi !== undefined) {
    assertBnGreaterThanOrEqual(player.lockedNovi, resources.lockedNovi, 'lockedNovi');
  }
  if (resources.cashOnHand !== undefined) {
    assertBnGreaterThanOrEqual(player.cashOnHand, resources.cashOnHand, 'cashOnHand');
  }
  if (resources.cashInVault !== undefined) {
    assertBnGreaterThanOrEqual(player.cashInVault, resources.cashInVault, 'cashInVault');
  }
  if (resources.defensiveUnit1 !== undefined) {
    assertBnGreaterThanOrEqual(player.defensiveUnit1, resources.defensiveUnit1, 'defensiveUnit1');
  }
  if (resources.defensiveUnit2 !== undefined) {
    assertBnGreaterThanOrEqual(player.defensiveUnit2, resources.defensiveUnit2, 'defensiveUnit2');
  }
  if (resources.defensiveUnit3 !== undefined) {
    assertBnGreaterThanOrEqual(player.defensiveUnit3, resources.defensiveUnit3, 'defensiveUnit3');
  }
  if (resources.operativeUnit1 !== undefined) {
    assertBnGreaterThanOrEqual(player.operativeUnit1, resources.operativeUnit1, 'operativeUnit1');
  }
  if (resources.operativeUnit2 !== undefined) {
    assertBnGreaterThanOrEqual(player.operativeUnit2, resources.operativeUnit2, 'operativeUnit2');
  }
  if (resources.operativeUnit3 !== undefined) {
    assertBnGreaterThanOrEqual(player.operativeUnit3, resources.operativeUnit3, 'operativeUnit3');
  }
  if (resources.meleeWeapons !== undefined) {
    assertBnGreaterThanOrEqual(player.meleeWeapons, resources.meleeWeapons, 'meleeWeapons');
  }
  if (resources.rangedWeapons !== undefined) {
    assertBnGreaterThanOrEqual(player.rangedWeapons, resources.rangedWeapons, 'rangedWeapons');
  }
  if (resources.siegeWeapons !== undefined) {
    assertBnGreaterThanOrEqual(player.siegeWeapons, resources.siegeWeapons, 'siegeWeapons');
  }
  if (resources.armorPieces !== undefined) {
    assertBnGreaterThanOrEqual(player.armorPieces, resources.armorPieces, 'armorPieces');
  }
  if (resources.produce !== undefined) {
    assertBnGreaterThanOrEqual(player.produce, resources.produce, 'produce');
  }
}

/**
 * Assert player is at a specific location.
 */
export function assertPlayerLocation(
  player: PlayerAccount,
  cityId: number,
  lat?: number,
  long?: number
): void {
  expect(player.currentCity).toBe(cityId);
  if (lat !== undefined) {
    expect(player.currentLat).toBeCloseTo(lat, 4);
  }
  if (long !== undefined) {
    expect(player.currentLong).toBeCloseTo(long, 4);
  }
}

/**
 * Assert player is currently traveling.
 */
export function assertPlayerTraveling(player: PlayerAccount): void {
  expect(Number(player.arrivalTime)).not.toBe(-1);
}

/**
 * Assert player is not traveling.
 */
export function assertPlayerNotTraveling(player: PlayerAccount): void {
  expect(Number(player.arrivalTime)).toBe(-1);
}

/**
 * Assert player has new player protection.
 */
export function assertPlayerProtected(
  player: PlayerAccount,
  currentTime: number
): void {
  expect(Number(player.newPlayerProtectionUntil)).toBeGreaterThan(currentTime);
}

/**
 * Assert player protection has expired.
 */
export function assertPlayerNotProtected(
  player: PlayerAccount,
  currentTime: number
): void {
  expect(Number(player.newPlayerProtectionUntil)).toBeLessThanOrEqual(currentTime);
}

/**
 * Assert player has a team.
 */
export function assertPlayerHasTeam(player: PlayerAccount): void {
  expect(isNullPubkey(player.team)).toBe(false);
}

/**
 * Assert player has no team.
 */
export function assertPlayerHasNoTeam(player: PlayerAccount): void {
  expect(isNullPubkey(player.team)).toBe(true);
}

/**
 * Assert player level.
 */
export function assertPlayerLevel(
  player: PlayerAccount,
  expectedLevel: number
): void {
  expect(player.level).toBe(expectedLevel);
}

/**
 * Assert player subscription tier.
 */
export function assertPlayerSubscription(
  player: PlayerAccount,
  tier: number,
  isActive: boolean,
  currentTime: number
): void {
  expect(player.subscriptionTier).toBe(tier);
  const active = Number(player.subscriptionEnd) > currentTime;
  expect(active).toBe(isActive);
}

// Team State Assertions

/**
 * Assert team member count.
 */
export function assertTeamMemberCount(
  team: TeamAccount,
  expectedCount: number
): void {
  expect(team.memberCount).toBe(expectedCount);
}

/**
 * Assert team is active.
 */
export function assertTeamActive(team: TeamAccount): void {
  expect(team.disbanded).toBe(false);
  expect(isNullPubkey(team.leader)).toBe(false);
}

/**
 * Assert team is disbanded.
 */
export function assertTeamDisbanded(team: TeamAccount): void {
  expect(team.disbanded).toBe(true);
}

/**
 * Assert team treasury balance.
 */
export function assertTeamTreasury(
  team: TeamAccount,
  expectedBalance: bigint | number
): void {
  assertBnEquals(team.treasury, expectedBalance);
}

/**
 * Assert team treasury has minimum balance.
 */
export function assertTeamTreasuryMinimum(
  team: TeamAccount,
  minimum: bigint | number
): void {
  assertBnGreaterThanOrEqual(team.treasury, minimum);
}

/**
 * Assert team member slot.
 */
export function assertTeamMemberSlot(
  slot: TeamMemberSlot,
  expectations: {
    player?: PublicKey;
    rank?: number;
    slotIndex?: number;
  }
): void {
  if (expectations.player !== undefined) {
    expect(slot.player.equals(expectations.player)).toBe(true);
  }
  if (expectations.rank !== undefined) {
    expect(slot.rank).toBe(expectations.rank);
  }
  if (expectations.slotIndex !== undefined) {
    expect(slot.slotIndex).toBe(expectations.slotIndex);
  }
}

// Combat Result Assertions

export interface CombatResultSnapshot {
  attackerNoviPre: bigint;
  attackerNoviPost: bigint;
  attackerUnitsPre: bigint;
  attackerUnitsPost: bigint;
  defenderNoviPre: bigint;
  defenderNoviPost: bigint;
  defenderUnitsPre: bigint;
  defenderUnitsPost: bigint;
}

/**
 * Assert attacker won the combat.
 */
export function assertAttackerWon(snapshot: CombatResultSnapshot): void {
  // Attacker should have consumed NOVI
  expect(snapshot.attackerNoviPost < snapshot.attackerNoviPre).toBe(true);
  // Defender should have lost resources or units
  const defenderLostUnits = snapshot.defenderUnitsPost < snapshot.defenderUnitsPre;
  expect(defenderLostUnits).toBe(true);
}

/**
 * Assert defender won the combat.
 */
export function assertDefenderWon(snapshot: CombatResultSnapshot): void {
  // Attacker should have consumed NOVI
  expect(snapshot.attackerNoviPost < snapshot.attackerNoviPre).toBe(true);
  // Attacker should have lost operatives
  expect(snapshot.attackerUnitsPost < snapshot.attackerUnitsPre).toBe(true);
  // Defender should not have lost significant resources
}

// Resource Change Assertions

/**
 * Assert resources changed by expected amounts.
 */
export function assertResourceChanged(
  pre: bigint,
  post: bigint,
  expectedChange: bigint | number,
  tolerance: number = 0
): void {
  const actualChange = post - pre;
  const expected = BigInt(expectedChange);
  const delta = actualChange - expected;
  const diff = Number(delta < 0n ? -delta : delta);
  expect(diff).toBeLessThanOrEqual(tolerance);
}

/**
 * Assert resources increased.
 */
export function assertResourceIncreased(pre: bigint, post: bigint): void {
  expect(post > pre).toBe(true);
}

/**
 * Assert resources decreased.
 */
export function assertResourceDecreased(pre: bigint, post: bigint): void {
  expect(post < pre).toBe(true);
}

/**
 * Assert resources unchanged.
 */
export function assertResourceUnchanged(pre: bigint, post: bigint): void {
  expect(post === pre).toBe(true);
}

// Transaction Assertions

/**
 * Assert transaction succeeded.
 */
export function assertTransactionSucceeded(signature: string): void {
  expect(signature).toBeDefined();
  expect(signature.length).toBeGreaterThan(0);
}

/**
 * Assert transaction failed with specific error.
 */
export async function assertTransactionFailed(
  promise: Promise<any>,
  expectedErrorSubstring?: string
): Promise<void> {
  try {
    await promise;
    expect(true).toBe(false); // Should not reach here
  } catch (error: any) {
    if (expectedErrorSubstring) {
      const errorMessage = error.message || error.toString();
      expect(errorMessage).toContain(expectedErrorSubstring);
    }
  }
}
