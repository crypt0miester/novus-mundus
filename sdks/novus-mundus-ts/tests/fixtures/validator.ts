/**
 * Validator Lifecycle Management
 *
 * Automatically starts/resets solana-test-validator before tests.
 * The validator is started with --reset so every test run starts fresh.
 */

import { Connection } from '@solana/web3.js';
import { execSync, spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const SDK_DIR = path.join(__dirname, '../..');
const ROOT_DIR = path.join(SDK_DIR, '../..');
const LEDGER_DIR = path.join(SDK_DIR, '.validator-ledger');
const BIN_DIR = path.join(SDK_DIR, 'programs/.bin');

const NOVUS_MUNDUS_SO = path.join(ROOT_DIR, 'target/deploy/novus_mundus.so');

// Program IDs
const NOVUS_MUNDUS_PROGRAM_ID = 'J4DxMg1RfwRzjpZ3N6D1ULNjuwLHuhe6qLNeX9rYNz3V';
const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const TLD_HOUSE_PROGRAM_ID = 'TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S';
const ALT_NAME_SERVICE_PROGRAM_ID = 'ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK';

// Accounts to clone from mainnet
const TLD_STATE = 'VmmhRjr64KbpTZpgmeiVSWmR8H8RyqgigF1XQf8AvET';
const TLD_HOUSE_SOLANA = '8Y1BpwTwqwFXpLDiTmjQKm1RNR8pdhB7VFfEayaSddVz';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
const POLL_INTERVAL_MS = 200;
const MAX_WAIT_MS = 30_000;

let validatorProcess: ChildProcess | null = null;

/**
 * Check if a validator is reachable at the RPC URL.
 */
async function isValidatorReady(): Promise<boolean> {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    await connection.getSlot();
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill any running solana-test-validator process.
 */
function killExistingValidator(): void {
  try {
    execSync('pkill -f solana-test-validator', { stdio: 'ignore' });
    // Give it a moment to die
    execSync('sleep 1', { stdio: 'ignore' });
  } catch {
    // No validator running, that's fine
  }
}

/**
 * Verify all required program binaries exist.
 */
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

/**
 * Start a fresh solana-test-validator with --reset.
 * Kills any existing validator first.
 */
export async function startValidator(): Promise<void> {
  // If already reachable and we started it this session, skip
  if (validatorProcess && !validatorProcess.killed) {
    if (await isValidatorReady()) {
      console.log('[validator] Already running, reusing existing instance.');
      return;
    }
  }

  console.log('[validator] Verifying program binaries...');
  verifyBinaries();
  console.log('[validator] All binaries found.');

  console.log('[validator] Killing any existing validator...');
  killExistingValidator();

  // Clean ledger for fresh state
  if (fs.existsSync(LEDGER_DIR)) {
    fs.rmSync(LEDGER_DIR, { recursive: true, force: true });
    console.log('[validator] Cleared old ledger.');
  }

  const args = [
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

  console.log('[validator] Starting solana-test-validator --reset ...');
  console.log('[validator] Programs: Novus Mundus, MPL Core, TLD House, ALT Name Service');
  validatorProcess = spawn('solana-test-validator', args, {
    stdio: 'ignore',
  });

  // Kill validator on process exit (Cmd+C, SIGTERM, normal exit)
  const cleanup = () => {
    if (validatorProcess && !validatorProcess.killed) {
      console.log('[validator] Shutting down...');
      validatorProcess.kill('SIGTERM');
      validatorProcess = null;
    }
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('exit', cleanup);

  // Poll until ready
  const start = Date.now();
  let dots = 0;
  while (Date.now() - start < MAX_WAIT_MS) {
    if (await isValidatorReady()) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[validator] Ready in ${elapsed}s.`);
      return;
    }
    dots++;
    if (dots % 5 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[validator] Waiting for RPC... (${elapsed}s)`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Validator did not become ready within ${MAX_WAIT_MS / 1000}s`);
}

/**
 * Stop the validator we started (if any).
 */
export function stopValidator(): void {
  if (validatorProcess && !validatorProcess.killed) {
    console.log('[validator] Stopping validator (pid %d)...', validatorProcess.pid);
    validatorProcess.kill('SIGTERM');
    validatorProcess = null;
  }
}
