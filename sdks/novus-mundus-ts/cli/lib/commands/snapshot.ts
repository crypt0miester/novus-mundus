/**
 * snapshot command — Save and restore validator ledger state
 *
 * Usage:
 *   novus snapshot save <name>       # Save current ledger as named snapshot
 *   novus snapshot load <name>       # Stop validator, restore snapshot, restart
 *   novus snapshot list              # List available snapshots
 *   novus snapshot delete <name>     # Delete a snapshot
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { CLIContext, ParsedArgs } from '../context';
import { log } from '../helpers';
import { handleValidator } from './validator';

const SDK_DIR = path.join(__dirname, '../../..');
const LEDGER_DIR = path.join(SDK_DIR, '.validator-ledger');
const SNAPSHOTS_DIR = path.join(SDK_DIR, '.snapshots');

export async function handleSnapshot(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'save':
      await handleSave(args);
      break;
    case 'load':
      await handleLoad(ctx, args);
      break;
    case 'list':
      handleList();
      break;
    case 'delete':
      handleDelete(args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus snapshot <save|load|list|delete> [name]');
  }
}

async function handleSave(args: ParsedArgs): Promise<void> {
  const name = args.extra;
  if (!name) {
    log.error('Specify a snapshot name: novus snapshot save <name>');
    return;
  }

  if (!fs.existsSync(LEDGER_DIR)) {
    log.error('No ledger directory found. Is the validator running?');
    return;
  }

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  const snapshotPath = path.join(SNAPSHOTS_DIR, name);

  if (fs.existsSync(snapshotPath)) {
    fs.rmSync(snapshotPath, { recursive: true, force: true });
    log.info(`  Overwriting existing snapshot: ${name}`);
  }

  log.info(`  Saving ledger to snapshot: ${name} ...`);

  // Copy ledger directory
  execSync(`cp -r "${LEDGER_DIR}" "${snapshotPath}"`, { stdio: 'ignore' });

  const sizeOutput = execSync(`du -sh "${snapshotPath}"`).toString().trim();
  const size = sizeOutput.split('\t')[0];

  log.info(`  Saved: ${snapshotPath} (${size})`);
}

async function handleLoad(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const name = args.extra;
  if (!name) {
    log.error('Specify a snapshot name: novus snapshot load <name>');
    return;
  }

  const snapshotPath = path.join(SNAPSHOTS_DIR, name);
  if (!fs.existsSync(snapshotPath)) {
    log.error(`Snapshot not found: ${name}`);
    handleList();
    return;
  }

  // Stop validator
  log.info('  Stopping validator...');
  await handleValidator(ctx, { ...args, target: 'stop', flags: [] });

  // Replace ledger
  if (fs.existsSync(LEDGER_DIR)) {
    fs.rmSync(LEDGER_DIR, { recursive: true, force: true });
  }

  log.info(`  Restoring snapshot: ${name} ...`);
  execSync(`cp -r "${snapshotPath}" "${LEDGER_DIR}"`, { stdio: 'ignore' });

  // Restart validator without --reset (preserve ledger)
  log.info('  Restarting validator with restored ledger...');
  await handleValidator(ctx, { ...args, target: 'start', flags: [] });

  log.info(`  Snapshot "${name}" loaded.`);
}

function handleList(): void {
  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    log.info('  No snapshots found.');
    return;
  }

  const entries = fs.readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .sort();

  if (entries.length === 0) {
    log.info('  No snapshots found.');
    return;
  }

  log.info(`\n  ${'Name'.padEnd(30)} Size`);
  log.info(`  ${'─'.repeat(30)} ${'─'.repeat(10)}`);

  for (const entry of entries) {
    const snapshotPath = path.join(SNAPSHOTS_DIR, entry.name);
    let size = '?';
    try {
      const sizeOutput = execSync(`du -sh "${snapshotPath}"`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      size = sizeOutput.split('\t')[0];
    } catch {}
    log.info(`  ${entry.name.padEnd(30)} ${size}`);
  }

  log.info(`\n  ${entries.length} snapshot(s) in ${SNAPSHOTS_DIR}`);
}

function handleDelete(args: ParsedArgs): void {
  const name = args.extra;
  if (!name) {
    log.error('Specify a snapshot name: novus snapshot delete <name>');
    return;
  }

  const snapshotPath = path.join(SNAPSHOTS_DIR, name);
  if (!fs.existsSync(snapshotPath)) {
    log.error(`Snapshot not found: ${name}`);
    return;
  }

  fs.rmSync(snapshotPath, { recursive: true, force: true });
  log.info(`  Deleted snapshot: ${name}`);
}
