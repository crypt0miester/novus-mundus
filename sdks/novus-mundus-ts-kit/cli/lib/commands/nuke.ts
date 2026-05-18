/**
 * nuke command — Full environment reset + init + populate
 *
 * Usage:
 *   novus nuke                       # Reset everything, init, create 10 advanced players, spawn encounters
 *   novus nuke --tier epic           # Use epic tier instead of advanced
 *   novus nuke --count 5             # Create 5 players instead of 10
 *   novus nuke --skip-players        # Skip player creation
 *   novus nuke --skip-encounters     # Skip encounter spawning
 */

import type { CLIContext, ParsedArgs } from '../context';
import { buildContext } from '../context';
import { log } from '../helpers';
import { handleValidator } from './validator';
import { handleInit } from './init';
import { handleCreatePlayer } from './create-player';
import { handleEncounters } from './encounters';

export async function handleNuke(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const tier = getFlag(args.flags, '--tier') || 'advanced';
  const count = getFlag(args.flags, '--count') || '10';
  const skipPlayers = args.flags.includes('--skip-players');
  const skipEncounters = args.flags.includes('--skip-encounters');

  const start = Date.now();

  // Step 1: Stop + restart validator
  log.info('  [1/4] Stopping validator...');
  await handleValidator(ctx, { ...args, target: 'stop', flags: [] });

  log.info('  [2/4] Starting fresh validator...');
  await handleValidator(ctx, { ...args, target: 'start', flags: ['--reset'] });

  // Rebuild context after validator restart
  const freshCtx = await buildContext(args);

  // Step 2: Initialize all game systems
  log.info('  [3/4] Initializing all game systems...');
  await handleInit(freshCtx, { ...args, target: 'all' });

  // Step 3: Create players
  if (!skipPlayers) {
    log.info(`  [4/4] Creating ${count} ${tier} players + encounters...`);
    await handleCreatePlayer(freshCtx, {
      ...args,
      target: '',
      flags: ['--tier', tier, '--count', count],
    });
  } else {
    log.info('  [4/4] Skipping player creation (--skip-players)');
  }

  // Step 4: Spawn encounters in all initialized cities
  if (!skipEncounters) {
    await handleEncounters(freshCtx, {
      ...args,
      target: 'spawn',
      flags: ['--all', '--count', '3'],
    });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log.info(`\nNuke complete in ${elapsed}s — fresh environment ready.`);
}

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}
