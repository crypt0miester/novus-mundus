/**
 * Shared encounter-cleanup logic, used by BOTH the production web cron
 * (apps/web .../api/cron/encounters) and the CLI crank
 * (cli/lib/cranks/encounters). Single source of truth so the two can't drift.
 */

import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { deriveLocationPda, deriveEncounterPda } from '../pda';
import { deserializeLocation } from '../state/location';
import { createCleanupEncounterInstruction } from '../instructions/encounter';
import type { EncounterAccount } from '../state/encounter';

/** Grace window after despawn before an encounter may be cleaned up. Mirrors
 *  `ENCOUNTER_CLEANUP_GRACE` on-chain. */
export const ENCOUNTER_CLEANUP_GRACE_SECONDS = 3600;

/** Microdegree grid precision: `lat/long * this` is the integer grid cell. */
export const ENCOUNTER_GRID_PRECISION = 10000;

/** True once an encounter is past `despawn_at + grace` (cleanup is permitted). */
export function isEncounterCleanable(encounter: EncounterAccount, nowSeconds: number): boolean {
  return nowSeconds >= Number(encounter.despawnAt) + ENCOUNTER_CLEANUP_GRACE_SECONDS;
}

/**
 * Build the permissionless cleanup ix for one expired encounter.
 *
 * Rent routing (mirrors cleanup.rs): if the encounter still occupies its grid
 * cell, rent returns to the cell's original spawn payer
 * (`location.locationCreator`); otherwise (cell reused or already closed) to
 * `fallbackRentRecipient` (the game authority). The pubkey-equality check on the
 * occupant is load-bearing — matching only `occupantType` would also match a
 * NEWER encounter that took the same cell and misroute the rent, reverting the
 * whole batched tx.
 */
export async function buildEncounterCleanupIx(
  connection: Connection,
  gameEngine: PublicKey,
  cityId: number,
  encounter: EncounterAccount,
  fallbackRentRecipient: PublicKey,
): Promise<TransactionInstruction> {
  const encounterIndex = Number(encounter.id);
  const gridLat = Math.round(encounter.locationLat * ENCOUNTER_GRID_PRECISION);
  const gridLong = Math.round(encounter.locationLong * ENCOUNTER_GRID_PRECISION);

  let rentRecipient = fallbackRentRecipient;
  try {
    const [locationPda] = await deriveLocationPda(gameEngine, cityId, gridLat, gridLong);
    const [encounterPda] = await deriveEncounterPda(gameEngine, cityId, encounterIndex);
    const locInfo = await connection.getAccountInfo(locationPda);
    if (locInfo && locInfo.data.length > 0) {
      const loc = deserializeLocation(locInfo.data);
      if (loc.occupant.equals(encounterPda)) {
        rentRecipient = loc.locationCreator;
      }
    }
  } catch {
    // best-effort — fall through to fallbackRentRecipient
  }

  return createCleanupEncounterInstruction({
    gameEngine,
    cityId,
    encounterIndex,
    gridLat,
    gridLong,
    rentRecipient,
  });
}
