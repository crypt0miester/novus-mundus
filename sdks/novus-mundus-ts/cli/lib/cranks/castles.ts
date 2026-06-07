/**
 * Crank: Castles - status transitions + ownership-transition cleanup pipeline
 *
 * For each castle (enumerated + parsed via the SDK):
 *   1. update_castle_status (Ix 289) - permissionless, but ONLY sent when a
 *      time-based transition is actually due. The processor errors on a no-op,
 *      so `castleStatusUpdateDue` filters client-side first — the difference
 *      between a couple of txs and one-per-castle at 100+ castles. Due updates
 *      are sent in parallel.
 *   2. if TRANSITIONING, run the cleanup pipeline so the new king can take over:
 *      garrison_cleanup (282) + court_cleanup (283) + rewards_cleanup (284),
 *      then finalize_transition (285) once garrison/court counts hit zero.
 *
 * The pipeline logic (member PDA->wallet resolution, hero-template lookup, the
 * vacant-transition path, the due-check) lives in the SDK so the web cron shares
 * it verbatim — no drift.
 */

import { type CLIContext } from '../context';
import { log, newStats, batchSend, crankSend, type PhaseStats } from '../helpers';
import {
  NovusMundusClient,
  castleStatusUpdateDue,
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
  const now = (await client.getBlockTime()) ?? 0;
  log.info(`  Found ${castles.length} castles`);

  // Partition: which castles actually need work this run. Everything else is a
  // skip with zero RPC — that's the whole point at scale.
  const dueStatus = castles.filter((c) => castleStatusUpdateDue(c.account, now));
  const transitioning = castles.filter((c) => c.account.status === CastleStatus.Transitioning);
  stats.skipped += castles.length - dueStatus.length - transitioning.length;

  // Step 1: time-based status nudges, only for castles that will actually flip.
  if (dueStatus.length > 0) {
    log.info(`  ${dueStatus.length} castle(s) need a status update`);
    if (ctx.dryRun) {
      for (const { account: c } of dueStatus) {
        log.dryRun(`Would update status: ${c.name || `castle ${c.castleId}`} (city ${c.cityId})`);
      }
      stats.updated += dueStatus.length;
    } else {
      // Pre-build the (async) instructions, then fire them concurrently.
      const ixs = await Promise.all(
        dueStatus.map(({ account: c }) =>
          createUpdateCastleStatusInstruction({
            caller: dao,
            gameEngine: ctx.gameEngine,
            cityId: c.cityId,
            castleId: c.castleId,
          }),
        ),
      );
      const sent = await batchSend(ctx, ixs, (ix) => ({ ix, signers: [ctx.daoAuthority] }), 8);
      stats.updated += sent;
    }
  }

  // Step 2: ownership-transition pipeline (few castles; inherently sequential
  // per castle — cleanups must confirm before finalize gates on counts == 0).
  for (const { pubkey: castlePda, account: castle } of transitioning) {
    const label = `${castle.name || `castle ${castle.castleId}`} (city ${castle.cityId})`;
    log.info(`  ${label} is TRANSITIONING - running cleanup pipeline`);

    const cleanups = await collectCastleCleanups(client, dao, castle, castlePda);
    for (const c of cleanups) {
      await crankSend(ctx, stats, c.ix, c.label, CLEANUP);
    }

    const fin = await buildCastleFinalize(client, dao, castlePda, now);
    if (fin) {
      await crankSend(ctx, stats, fin.ix, fin.label, FINALIZE);
    } else {
      log.info(`  ${label}: cleanup not complete / finalize not ready`);
      stats.skipped++;
    }
  }

  return stats;
}
