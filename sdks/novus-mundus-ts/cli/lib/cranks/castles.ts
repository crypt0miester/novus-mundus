/**
 * Crank: Castles - status transitions + ownership-transition cleanup pipeline
 *
 * For each castle (enumerated + parsed via the SDK):
 *   1. update_castle_status (Ix 289) - permissionless, no-op if not time
 *   2. if TRANSITIONING, run the cleanup pipeline so the new king can take over:
 *      garrison_cleanup (282) + court_cleanup (283) + rewards_cleanup (284),
 *      then finalize_transition (285) once garrison/court counts hit zero.
 *
 * The pipeline logic (member PDA->wallet resolution, hero-template lookup, the
 * vacant-transition path) lives in the SDK (`collectCastleCleanups` /
 * `buildCastleFinalize`) so the web cron shares it verbatim — no drift.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, crankSend, type PhaseStats } from '../helpers';
import {
  NovusMundusClient,
  collectCastleCleanups,
  buildCastleFinalize,
} from '../../../src/index';
import { createUpdateCastleStatusInstruction } from '../../../src/instructions/castle';
import { CastleStatus } from '../../../src/types/enums';

// crankSend verb/budget presets for this pipeline's two send shapes.
const CLEANUP = { would: 'clean up', done: 'Cleaned up', computeUnits: 15_000 } as const;
const FINALIZE = { would: 'finalize', done: 'Finalized', computeUnits: 15_000 } as const;

export async function crankCastles(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const dao = ctx.daoAuthority.publicKey;
  const client = new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });

  const castles = await client.fetchAllCastles();
  log.info(`  Found ${castles.length} castles`);

  for (const { pubkey: castlePda, account: castle } of castles) {
    const label = `${castle.name || `castle ${castle.castleId}`} (city ${castle.cityId})`;

    // Step 1: nudge time-based status transitions (no-op if not due).
    const statusIx = createUpdateCastleStatusInstruction({
      caller: dao,
      gameEngine: ctx.gameEngine,
      cityId: castle.cityId,
      castleId: castle.castleId,
    });
    if (ctx.dryRun) {
      log.dryRun(`Would update status: ${label}`);
    } else {
      try {
        await sendWithRetry(ctx, statusIx, [ctx.daoAuthority], { computeUnits: 5_000 });
        if (ctx.verbose) log.update(`Status update: ${label}`);
      } catch {
        if (ctx.verbose) log.info(`  Status unchanged: ${label}`);
      }
    }

    if (castle.status !== CastleStatus.Transitioning) {
      stats.skipped++;
      continue;
    }

    log.info(`  ${label} is TRANSITIONING - running cleanup pipeline`);

    // Step 2: cleanup (shared SDK logic), then finalize once counts hit zero.
    const cleanups = await collectCastleCleanups(client, dao, castle, castlePda);
    for (const c of cleanups) {
      await crankSend(ctx, stats, c.ix, c.label, CLEANUP);
    }

    const fin = await buildCastleFinalize(client, dao, castlePda);
    if (fin) {
      await crankSend(ctx, stats, fin.ix, fin.label, FINALIZE);
    } else {
      log.info(`  ${label}: cleanup not complete / finalize not ready`);
      stats.skipped++;
    }
  }

  return stats;
}
