/**
 * `novus init <target>` — create and/or update accounts
 */

import { type CLIContext } from '../context';
import { type ParsedArgs } from '../context';
import { log, type PhaseStats } from '../helpers';
import { initEngine, statusEngine } from '../phases/engine';
import { initCities } from '../phases/cities';
import { initHeroes } from '../phases/heroes';
import { initResearch } from '../phases/research';
import { initBuildings } from '../phases/buildings';
import { initSubscriptions } from '../phases/subscriptions';
import { initShop } from '../phases/shop';
import { initDungeons } from '../phases/dungeons';
import { initCastles } from '../phases/castles';
import { initArena } from '../phases/arena';
import { initEvents } from '../phases/events';

interface Phase {
  name: string;
  key: string;
  fn: (ctx: CLIContext) => Promise<PhaseStats>;
}

const PHASES: Phase[] = [
  { name: 'Engine',        key: 'engine',        fn: initEngine },
  { name: 'Cities',        key: 'cities',        fn: initCities },
  { name: 'Heroes',        key: 'heroes',        fn: initHeroes },
  { name: 'Research',      key: 'research',      fn: initResearch },
  { name: 'Buildings',     key: 'buildings',     fn: initBuildings },
  { name: 'Subscriptions', key: 'subscriptions', fn: initSubscriptions },
  { name: 'Shop',          key: 'shop',          fn: initShop },
  { name: 'Dungeons',      key: 'dungeons',      fn: initDungeons },
  { name: 'Castles',       key: 'castles',       fn: initCastles },
  { name: 'Arena',         key: 'arena',         fn: initArena },
  { name: 'Events',        key: 'events',        fn: initEvents },
];

export async function handleInit(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const target = args.target;
  const start = Date.now();

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  if (target === 'all' || target === '') {
    const fromPhase = args.from;

    for (let i = 0; i < PHASES.length; i++) {
      const phase = PHASES[i];
      const phaseNum = i + 1;

      if (phaseNum < fromPhase) continue;

      log.phase(phaseNum, PHASES.length, phase.name);

      try {
        const stats = await phase.fn(ctx);
        log.summary(stats);
        totalCreated += stats.created;
        totalUpdated += stats.updated;
        totalSkipped += stats.skipped;
      } catch (error: any) {
        log.error(`Phase ${phaseNum} (${phase.name}) failed: ${error.message}`);
        if (ctx.verbose) console.error(error);
        log.info(`\nResume with: novus init all --from ${phaseNum}`);
        break;
      }
    }
  } else {
    const phase = PHASES.find(p => p.key === target);
    if (!phase) {
      log.error(`Unknown target: ${target}`);
      log.info(`Valid targets: ${PHASES.map(p => p.key).join(', ')}, all`);
      return;
    }

    const phaseNum = PHASES.indexOf(phase) + 1;
    log.phase(phaseNum, PHASES.length, phase.name);

    const stats = await phase.fn(ctx);
    log.summary(stats);
    totalCreated += stats.created;
    totalUpdated += stats.updated;
    totalSkipped += stats.skipped;
  }

  const elapsed = Date.now() - start;
  log.totalSummary(totalCreated, totalUpdated, totalSkipped);
  log.done(elapsed);
}
