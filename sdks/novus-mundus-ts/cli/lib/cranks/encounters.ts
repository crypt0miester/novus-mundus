/**
 * Crank: Encounters - clean up expired PvE encounters (Ix 72)
 *
 * For each enrolled city, fetch its encounters and close any past
 * `despawn_at + 1h` (the cleanup grace window): reclaims rent, decrements
 * `city.activeEncounters`, releases the grid cell. Permissionless.
 *
 * Rent routing mirrors the production cron (apps/web .../cron/encounters) and
 * cleanup.rs: if the encounter still occupies its grid cell, rent goes to the
 * cell's original spawn payer (`location.locationCreator`); otherwise (cell
 * reused or closed) to the game authority. NOTE: the web cron already runs this
 * every 5 minutes in production - this CLI crank is the local/test equivalent.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { CITIES } from '../../data/cities';
import {
  NovusMundusClient,
  buildEncounterCleanupIx,
  isEncounterCleanable,
} from '../../../src/index';

export async function crankEncounters(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);
  const client = new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });

  const cityIds = ctx.enrolledCities ? [...ctx.enrolledCities] : CITIES.map((c) => c.id);
  log.info(`  Scanning ${cityIds.length} cities for expired encounters...`);

  for (const cityId of cityIds) {
    let encounters;
    try {
      encounters = await client.fetchEncountersInCity(cityId);
    } catch {
      continue;
    }

    for (const { account: enc } of encounters) {
      if (!isEncounterCleanable(enc, now)) {
        stats.skipped++;
        continue;
      }
      const encounterIndex = Number(enc.id);

      // Shared with the web cron - rent routing + ix build live in the SDK.
      const ix = await buildEncounterCleanupIx(
        ctx.connection,
        ctx.gameEngine,
        cityId,
        enc,
        ctx.daoAuthority.publicKey,
      );

      if (ctx.dryRun) {
        log.dryRun(`Would clean up: city ${cityId} encounter ${encounterIndex}`);
        stats.updated++;
        continue;
      }
      try {
        await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: 15_000 });
        log.update(`Cleaned up: city ${cityId} encounter ${encounterIndex}`);
        stats.updated++;
      } catch (err: any) {
        log.error(`Failed cleanup city ${cityId} encounter ${encounterIndex}: ${err.message}`);
        stats.skipped++;
      }
    }
  }

  return stats;
}
