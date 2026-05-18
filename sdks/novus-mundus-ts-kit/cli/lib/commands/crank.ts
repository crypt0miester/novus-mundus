/**
 * `novus crank <target|all>` — run permissionless crank operations
 */

import { type CLIContext, type ParsedArgs } from '../context';
import { log, type PhaseStats } from '../helpers';
import { crankSubscriptions } from '../cranks/subscriptions';
import { crankEvents } from '../cranks/events';
import { crankArena } from '../cranks/arena';
import { crankDungeons } from '../cranks/dungeons';
import { crankCastles } from '../cranks/castles';
import { crankRallies } from '../cranks/rallies';

interface CrankTarget {
  name: string;
  key: string;
  fn: (ctx: CLIContext) => Promise<PhaseStats>;
}

const CRANK_TARGETS: CrankTarget[] = [
  { name: 'Subscriptions',  key: 'subscriptions',  fn: crankSubscriptions },
  { name: 'Events',         key: 'events',         fn: crankEvents },
  { name: 'Arena',          key: 'arena',           fn: crankArena },
  { name: 'Dungeons',       key: 'dungeons',        fn: crankDungeons },
  { name: 'Castles',        key: 'castles',         fn: crankCastles },
  { name: 'Rallies',        key: 'rallies',         fn: crankRallies },
];

export async function handleCrank(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const target = args.target;
  const start = Date.now();

  if (!target) {
    log.error('Usage: novus crank <target|all>');
    log.info(`Valid targets: ${CRANK_TARGETS.map(t => t.key).join(', ')}, all`);
    return;
  }

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  if (target === 'all') {
    for (let i = 0; i < CRANK_TARGETS.length; i++) {
      const crank = CRANK_TARGETS[i];
      log.phase(i + 1, CRANK_TARGETS.length, `Crank: ${crank.name}`);

      try {
        const stats = await crank.fn(ctx);
        log.summary(stats);
        totalCreated += stats.created;
        totalUpdated += stats.updated;
        totalSkipped += stats.skipped;
      } catch (error: any) {
        log.error(`Crank ${crank.name} failed: ${error.message}`);
        if (ctx.verbose) console.error(error);
      }
    }
  } else {
    const crank = CRANK_TARGETS.find(t => t.key === target);
    if (!crank) {
      log.error(`Unknown crank target: ${target}`);
      log.info(`Valid targets: ${CRANK_TARGETS.map(t => t.key).join(', ')}, all`);
      return;
    }

    log.header(`Crank: ${crank.name}`);
    const stats = await crank.fn(ctx);
    log.summary(stats);
    totalCreated += stats.created;
    totalUpdated += stats.updated;
    totalSkipped += stats.skipped;
  }

  const elapsed = Date.now() - start;
  log.totalSummary(totalCreated, totalUpdated, totalSkipped);
  log.done(elapsed);
}
