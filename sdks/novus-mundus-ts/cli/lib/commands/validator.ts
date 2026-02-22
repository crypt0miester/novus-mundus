/**
 * validator command — Start, stop, and check local Solana test validator
 *
 * Usage:
 *   novus validator start             # Start with game programs loaded
 *   novus validator start --reset     # Kill existing + fresh start
 *   novus validator stop              # Stop running validator
 *   novus validator status            # Show validator status + slot info
 */

import { Connection } from '@solana/web3.js';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { ParsedArgs } from '../context';
import { log } from '../helpers';

const SDK_DIR = path.join(__dirname, '../../..');  // cli/lib/commands → sdks/novus-mundus-ts
const ROOT_DIR = path.join(SDK_DIR, '../..');       // sdks/novus-mundus-ts → vig-internal
const LEDGER_DIR = path.join(SDK_DIR, '.validator-ledger');
const BIN_DIR = path.join(SDK_DIR, 'programs/.bin');
const PID_FILE = path.join(SDK_DIR, '.validator.pid');

const NOVUS_MUNDUS_SO = path.join(ROOT_DIR, 'target/deploy/novus_mundus.so');

const NOVUS_MUNDUS_PROGRAM_ID = 'J4DxMg1RfwRzjpZ3N6D1ULNjuwLHuhe6qLNeX9rYNz3V';
const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const TLD_HOUSE_PROGRAM_ID = 'TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S';
const ALT_NAME_SERVICE_PROGRAM_ID = 'ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK';

const TLD_STATE = 'VmmhRjr64KbpTZpgmeiVSWmR8H8RyqgigF1XQf8AvET';
const TLD_HOUSE_SOLANA = '8Y1BpwTwqwFXpLDiTmjQKm1RNR8pdhB7VFfEayaSddVz';

const RPC_URL = 'http://localhost:8899';
const POLL_INTERVAL_MS = 200;
const MAX_WAIT_MS = 30_000;

export async function handleValidator(_ctx: any, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'start':
      await handleStart(args);
      break;
    case 'stop':
      await handleStop();
      break;
    case 'status':
      await handleStatus();
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus validator <start|stop|status> [options]');
  }
}

async function isValidatorReady(): Promise<boolean> {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    await connection.getSlot();
    return true;
  } catch {
    return false;
  }
}

function killExistingValidator(): void {
  // Kill by PID file first
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      log.info(`  Killed validator (pid ${pid})`);
    } catch {
      // Process already dead
    }
    fs.unlinkSync(PID_FILE);
  }

  // Also kill any stray processes
  try {
    execSync('pkill -f solana-test-validator', { stdio: 'ignore' });
    execSync('sleep 1', { stdio: 'ignore' });
  } catch {
    // No validator running
  }
}

function verifyBinaries(): void {
  if (!fs.existsSync(NOVUS_MUNDUS_SO)) {
    throw new Error(
      `novus_mundus.so not found at ${NOVUS_MUNDUS_SO}\n` +
      'Build the program first: cargo build-sbf'
    );
  }

  const required = ['mpl_core.so', 'tld_house.so', 'alt_name_service.so'];
  const missing = required.filter(f => !fs.existsSync(path.join(BIN_DIR, f)));
  if (missing.length > 0) {
    throw new Error(
      `Missing external programs: ${missing.join(', ')}\n` +
      'Run: ./scripts/dump-programs.sh'
    );
  }
}

async function handleStart(args: ParsedArgs): Promise<void> {
  const resetFlag = args.flags.includes('--reset');

  // Check if already running
  if (!resetFlag && await isValidatorReady()) {
    log.info('  Validator already running at ' + RPC_URL);
    return;
  }

  log.info('  Verifying program binaries...');
  verifyBinaries();
  log.info('  All binaries found.');

  log.info('  Killing existing validator...');
  killExistingValidator();

  if (resetFlag && fs.existsSync(LEDGER_DIR)) {
    fs.rmSync(LEDGER_DIR, { recursive: true, force: true });
    log.info('  Cleared old ledger.');
  }

  const spawnArgs = [
    '--ledger', LEDGER_DIR,
    '--reset',
    '--bpf-program', NOVUS_MUNDUS_PROGRAM_ID, NOVUS_MUNDUS_SO,
    '--bpf-program', MPL_CORE_PROGRAM_ID, path.join(BIN_DIR, 'mpl_core.so'),
    '--bpf-program', TLD_HOUSE_PROGRAM_ID, path.join(BIN_DIR, 'tld_house.so'),
    '--bpf-program', ALT_NAME_SERVICE_PROGRAM_ID, path.join(BIN_DIR, 'alt_name_service.so'),
    '--clone', TLD_STATE,
    '--clone', TLD_HOUSE_SOLANA,
    '--url', 'mainnet-beta',
  ];

  log.info('  Starting solana-test-validator ...');
  log.info('  Programs: Novus Mundus, MPL Core, TLD House, ALT Name Service');

  const child = spawn('solana-test-validator', spawnArgs, {
    stdio: 'ignore',
    detached: true,
  });

  child.unref();

  // Save PID
  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid));
    log.info(`  PID: ${child.pid} (saved to .validator.pid)`);
  }

  // Poll until ready
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    if (await isValidatorReady()) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log.info(`  Validator ready in ${elapsed}s`);
      log.info(`  RPC: ${RPC_URL}`);
      log.info(`  Ledger: ${LEDGER_DIR}`);
      return;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Validator did not become ready within ${MAX_WAIT_MS / 1000}s`);
}

async function handleStop(): Promise<void> {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
      process.kill(pid, 'SIGTERM');
      log.info(`  Stopped validator (pid ${pid})`);
    } catch {
      log.info(`  Validator (pid ${pid}) was not running`);
    }
    fs.unlinkSync(PID_FILE);
  } else {
    // Fallback: pkill
    try {
      execSync('pkill -f solana-test-validator', { stdio: 'ignore' });
      log.info('  Stopped validator (via pkill)');
    } catch {
      log.info('  No validator running');
    }
  }
}

async function handleStatus(): Promise<void> {
  const pidRunning = fs.existsSync(PID_FILE);
  let pid: number | null = null;
  if (pidRunning) {
    pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  }

  const ready = await isValidatorReady();

  if (!ready) {
    log.info('  Status: STOPPED');
    if (pid) log.info(`  Stale PID file: ${pid}`);
    return;
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot).catch(() => null);
  const version = await connection.getVersion().catch(() => null);

  log.info('  Status: RUNNING');
  if (pid) log.info(`  PID: ${pid}`);
  log.info(`  RPC: ${RPC_URL}`);
  log.info(`  Slot: ${slot}`);
  if (blockTime) {
    log.info(`  Block time: ${new Date(blockTime * 1000).toISOString()}`);
  }
  if (version) {
    log.info(`  Version: ${version['solana-core']}`);
  }
  log.info(`  Ledger: ${fs.existsSync(LEDGER_DIR) ? LEDGER_DIR : 'not found'}`);
}
