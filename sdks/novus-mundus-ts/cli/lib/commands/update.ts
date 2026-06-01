/**
 * `novus update <target>` — update-only mode (no creates)
 */

import { type CLIContext, type ParsedArgs } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { updateResearch } from '../phases/research';
import { updateSubscriptions } from '../phases/subscriptions';
import { updateShop } from '../phases/shop';
import { updateHeroSupplyCaps } from '../phases/heroes';
import { CASTLES } from '../../data/castles';
import { assertSeedDataValid } from '../validate-data';
import {
  createUpdateCastleConfigInstruction,
  deriveCastlePda,
} from '../../../src/index';

interface UpdateTarget {
  name: string;
  key: string;
  fn: (ctx: CLIContext) => Promise<PhaseStats>;
  flags?: string[];
}

async function updateCastleConfig(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const castle of CASTLES) {
    const [castlePda] = await deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);

    // Update castle name from data file
    const ix = createUpdateCastleConfigInstruction(
      {
        daoAuthority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityId: castle.cityId,
        castleId: castle.castleId,
      },
      { configType: 3, name: castle.name }
    );

    if (ctx.dryRun) {
      log.dryRun(`Would update config: Castle #${castle.castleId} (${castle.name})`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.update(`Castle #${castle.castleId} (${castle.name})`);
      stats.updated++;
    } catch (err: any) {
      log.error(`Failed to update Castle #${castle.castleId}: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}

const UPDATE_TARGETS: UpdateTarget[] = [
  { name: 'Research Templates', key: 'research',       fn: updateResearch },
  { name: 'Subscriptions',     key: 'subscriptions',   fn: updateSubscriptions },
  { name: 'Shop',              key: 'shop',            fn: updateShop },
  { name: 'Hero Supply Caps',  key: 'heroes',          fn: updateHeroSupplyCaps, flags: ['--supply-caps'] },
  { name: 'Castle Config',     key: 'castle-config',   fn: updateCastleConfig },
];

export async function handleUpdate(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const target = args.target;
  const start = Date.now();

  if (!target) {
    log.error('Usage: novus update <target>');
    log.info(`Valid targets: ${UPDATE_TARGETS.map(t => t.key).join(', ')}`);
    return;
  }

  const entry = UPDATE_TARGETS.find(t => t.key === target);
  if (!entry) {
    log.error(`Unknown update target: ${target}`);
    log.info(`Valid targets: ${UPDATE_TARGETS.map(t => t.key).join(', ')}`);
    return;
  }

  // Preflight: reject internally-inconsistent seed data before any chain write.
  try {
    assertSeedDataValid();
  } catch (error: any) {
    log.error(error.message);
    return;
  }

  // Check for required flags
  if (entry.flags && entry.flags.length > 0) {
    const hasRequiredFlag = entry.flags.some(f => args.flags.includes(f));
    if (!hasRequiredFlag) {
      log.error(`Target '${target}' requires one of: ${entry.flags.join(', ')}`);
      return;
    }
  }

  log.header(`Updating ${entry.name}`);
  const stats = await entry.fn(ctx);
  log.summary(stats);

  const elapsed = Date.now() - start;
  log.done(elapsed);
}
