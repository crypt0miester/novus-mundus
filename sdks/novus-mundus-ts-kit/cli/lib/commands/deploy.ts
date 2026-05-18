/**
 * deploy command — Build and deploy Novus Mundus program
 *
 * Usage:
 *   novus deploy                     # Build + deploy to localnet
 *   novus deploy --skip-build        # Deploy existing .so only
 *   novus deploy --env devnet        # Deploy to devnet
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { CLIContext, ParsedArgs } from '../context';
import { log } from '../helpers';

const ROOT_DIR = path.join(__dirname, '../../../../..');  // cli/lib/commands → vig-internal
const PROGRAM_SO = path.join(ROOT_DIR, 'target/deploy/novus_mundus.so');
const PROGRAM_KEYPAIR = path.join(ROOT_DIR, 'target/deploy/novus_mundus-keypair.json');

export async function handleDeploy(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const skipBuild = args.flags.includes('--skip-build');

  // Step 1: Build
  if (!skipBuild) {
    log.info('  [1/2] Building program...');
    try {
      execSync('cargo build-sbf', {
        cwd: path.join(ROOT_DIR, '../..'),
        stdio: 'inherit',
      });
    } catch {
      log.error('Build failed');
      return;
    }
    log.info('  Build complete.');
  } else {
    log.info('  [1/2] Skipping build (--skip-build)');
  }

  // Verify .so exists
  if (!fs.existsSync(PROGRAM_SO)) {
    log.error(`Program not found: ${PROGRAM_SO}`);
    log.info('  Run without --skip-build to compile first.');
    return;
  }

  const soSize = (fs.statSync(PROGRAM_SO).size / 1024).toFixed(0);
  log.info(`  Program: ${PROGRAM_SO} (${soSize} KB)`);

  // Step 2: Deploy
  log.info(`  [2/2] Deploying to ${ctx.env}...`);

  const rpcUrl = ctx.connection.rpcEndpoint;
  const deployArgs = [
    'solana', 'program', 'deploy',
    PROGRAM_SO,
    '--url', rpcUrl,
  ];

  if (fs.existsSync(PROGRAM_KEYPAIR)) {
    deployArgs.push('--program-id', PROGRAM_KEYPAIR);
  }

  if (ctx.dryRun) {
    log.dryRun(`Would deploy: ${deployArgs.join(' ')}`);
    return;
  }

  try {
    execSync(deployArgs.join(' '), { stdio: 'inherit' });
    log.info('  Deploy complete.');
  } catch {
    log.error('Deploy failed. Check solana CLI output above.');
  }
}
