/**
 * Colored Test Logger
 *
 * Minimal colored console output for test visibility.
 */

import type { Connection } from '@solana/web3.js';
import type { PublicKey } from '@solana/web3.js';
import { parseEventsFromLogs } from '../../src/events/parser';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  white: '\x1b[37m',
};

export const log = {
  /** Log a test section header */
  section: (name: string) => {
    console.log(`\n${c.bold}${c.blue}━━━ ${name} ━━━${c.reset}`);
  },

  /** Log a test step */
  step: (msg: string) => {
    console.log(`${c.cyan}  ▸ ${msg}${c.reset}`);
  },

  /** Log transaction success */
  txSuccess: (label: string, sig?: string) => {
    const short = sig ? ` ${c.dim}${sig.slice(0, 12)}..${c.reset}` : '';
    console.log(`${c.green}  ✓ ${label}${short}${c.reset}`);
  },

  /** Log transaction failure with logs */
  txFail: (label: string, error: Error, txLogs?: string[]) => {
    console.log(`${c.red}  ✗ ${label}${c.reset}`);
    console.log(`${c.red}    ${error.message.split('\n')[0]}${c.reset}`);
    if (txLogs?.length) {
      console.log(`${c.gray}    ── Transaction Logs ──${c.reset}`);
      for (const line of txLogs) {
        if (line.includes('failed') || line.includes('Error') || line.includes('error')) {
          console.log(`${c.red}    ${line}${c.reset}`);
        } else if (line.includes('Program log:') || line.includes('invoke')) {
          console.log(`${c.gray}    ${line}${c.reset}`);
        }
      }
    }
  },

  /** Log expected failure (test intentionally expects error) */
  txExpectedFail: (label: string) => {
    console.log(`${c.yellow}  ⊘ ${label} ${c.dim}(expected failure)${c.reset}`);
  },

  /** Log a warning */
  warn: (msg: string) => {
    console.log(`${c.yellow}  ⚠ ${msg}${c.reset}`);
  },

  /** Log info */
  info: (msg: string) => {
    console.log(`${c.dim}  ℹ ${msg}${c.reset}`);
  },

  /** Print raw transaction logs (for debugging) */
  txLogs: (logs: string[]) => {
    if (!logs.length) return;
    console.log(`${c.gray}    ── Logs ──${c.reset}`);
    for (const line of logs) {
      console.log(`${c.gray}    ${line}${c.reset}`);
    }
  },

  /** Log a caught error with context and optional tx logs */
  caught: (context: string, err: unknown) => {
    const error = err as any;
    const msg = error?.message?.split('\n')[0] ?? String(err);
    console.log(`${c.yellow}  ⚠ ${context}${c.reset}`);
    console.log(`${c.gray}    ${msg}${c.reset}`);
    const txLogs: string[] | undefined = error?.transactionLogs ?? error?.logs;
    if (txLogs?.length) {
      for (const line of txLogs) {
        if (line.includes('failed') || line.includes('Error') || line.includes('error')) {
          console.log(`${c.red}    ${line}${c.reset}`);
        }
      }
    }
  },
};

// ============================================================
// Real-time Program Log Listener
// ============================================================

let _logListenerId: number | null = null;

/** Format event data fields into a compact readable string */
function formatEventData(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val == null) continue;
    let str: string;
    if (typeof val === 'object' && 'toBase58' in (val as any)) {
      str = (val as any).toBase58().slice(0, 8) + '..';
    } else if (typeof val === 'object' && 'toString' in (val as any) && (val as any).constructor?.name === 'BN') {
      str = (val as any).toString();
    } else if (typeof val === 'boolean') {
      str = val ? 'true' : 'false';
    } else if (typeof val === 'number') {
      str = String(val);
    } else if (typeof val === 'string') {
      str = val.length > 20 ? val.slice(0, 20) + '..' : val;
    } else {
      continue;
    }
    parts.push(`${key}=${str}`);
  }
  return parts.join(' ');
}

/**
 * Start listening to on-chain program logs via WebSocket.
 * Each log line is colored by type for quick scanning.
 */
export function startProgramLogListener(
  connection: Connection,
  programId: PublicKey,
): void {
  if (_logListenerId !== null) return;

  const prefix = `${c.dim}[onchain]${c.reset}`;

  _logListenerId = connection.onLogs(
    programId,
    (logInfo) => {
      const sig = logInfo.signature.slice(0, 10);
      const sigTag = `${c.dim}${sig}..${c.reset}`;

      if (logInfo.err) {
        console.log(`${prefix} ${sigTag} ${c.red}✗ tx failed${c.reset}`);
      }

      // Parse events from Program data: lines
      const events = parseEventsFromLogs(logInfo.logs);
      for (const evt of events) {
        const fields = formatEventData(evt.data as any);
        console.log(`${prefix} ${sigTag} ${c.cyan}⚡ ${evt.name}${c.reset} ${c.dim}${fields}${c.reset}`);
      }

      // Find the last "consumed" line (outermost program invocation)
      let lastConsumedLine: string | null = null;
      for (const line of logInfo.logs) {
        if (line.includes('consumed') && line.includes('compute units')) {
          lastConsumedLine = line;
        }
      }

      for (const line of logInfo.logs) {
        if (line.includes('failed') || line.includes('Error') || line.includes('error') || line.includes('panicked')) {
          console.log(`${prefix} ${sigTag} ${c.red}${line}${c.reset}`);
        } else if (line.includes('Program log:')) {
          const msg = line.replace(/^.*Program log:\s*/, '');
          console.log(`${prefix} ${sigTag} ${c.magenta}${msg}${c.reset}`);
        } else if (line.includes('consumed') && line.includes('compute units')) {
          // Print CU total only for the last (outermost) consumed line
          if (line === lastConsumedLine) {
            const cuMatch = line.match(/consumed (\d+) of (\d+) compute units/);
            if (cuMatch) {
              console.log(`${prefix} ${sigTag} ${c.yellow}Total ${Number(cuMatch[1]).toLocaleString()} / ${Number(cuMatch[2]).toLocaleString()} CU${c.reset}`);
            }
          }
        } else if (line.includes('Program data:') || line.includes('invoke') || line.includes('success')) {
          // handled elsewhere — skip
        } else {
          console.log(`${prefix} ${sigTag} ${c.gray}${line}${c.reset}`);
        }
      }
    },
    'confirmed',
  );
}

/** Stop the program log listener */
export function stopProgramLogListener(connection: Connection): void {
  if (_logListenerId !== null) {
    connection.removeOnLogsListener(_logListenerId);
    _logListenerId = null;
  }
}
