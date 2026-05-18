/**
 * reset command — Wipe validator state and reinitialize everything
 *
 * Usage:
 *   novus reset                      # Kill validator → start fresh → init all
 *   novus reset --skip-init          # Kill + restart only, don't init
 */

import type { CLIContext, ParsedArgs } from '../context';
import { buildContext } from '../context';
import { log } from '../helpers';
import { handleValidator } from './validator';
import { handleInit } from './init';

export async function handleReset(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const skipInit = args.flags.includes('--skip-init');

  log.info('  [1/3] Stopping validator...');
  await handleValidator(ctx, { ...args, target: 'stop', flags: [] });

  log.info('  [2/3] Starting fresh validator...');
  await handleValidator(ctx, { ...args, target: 'start', flags: ['--reset'] });

  if (skipInit) {
    log.info('\n  Validator restarted (--skip-init, skipping initialization)');
    return;
  }

  // Rebuild context after validator restart (new connection)
  const freshCtx = await buildContext(args);

  log.info('  [3/3] Initializing all game systems...');
  await handleInit(freshCtx, { ...args, target: 'all' });

  log.info('\nReset complete — fresh validator with all systems initialized.');
}
