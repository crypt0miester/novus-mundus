/**
 * Colored Test Logger
 *
 * Minimal colored console output for test visibility.
 */

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
