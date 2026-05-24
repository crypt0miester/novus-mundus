/**
 * logs command — Tail Solana program logs in real-time
 *
 * Usage:
 *   novus logs                       # Tail all Novus Mundus program logs
 *   novus logs --all                 # Tail all program logs (unfiltered)
 */

import { Connection, PublicKey } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { log } from '../helpers';

const NOVUS_MUNDUS_PROGRAM_ID = new PublicKey('6kFKaG8DEMC5mVMi4VbD3AYxxmz2gQc3o2fuW4q4rYNk');

export async function handleLogs(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const allFlag = args.flags.includes('--all');
  const wsUrl = ctx.connection.rpcEndpoint.replace('http', 'ws');

  log.info(`  Connecting to ${ctx.connection.rpcEndpoint}...`);

  const connection = new Connection(ctx.connection.rpcEndpoint, {
    wsEndpoint: wsUrl,
    commitment: 'confirmed',
  });

  if (allFlag) {
    log.info('  Tailing ALL program logs (Ctrl+C to stop)\n');
    const subId = connection.onLogs(
      'all',
      (logInfo) => {
        printLogEntry(logInfo);
      },
      'confirmed'
    );

    await waitForInterrupt();
    connection.removeOnLogsListener(subId);
  } else {
    log.info(`  Tailing Novus Mundus logs (Ctrl+C to stop)`);
    log.info(`  Program: ${NOVUS_MUNDUS_PROGRAM_ID.toBase58()}\n`);

    const subId = connection.onLogs(
      NOVUS_MUNDUS_PROGRAM_ID,
      (logInfo) => {
        printLogEntry(logInfo);
      },
      'confirmed'
    );

    await waitForInterrupt();
    connection.removeOnLogsListener(subId);
  }
}

function printLogEntry(logInfo: { signature: string; err: any; logs: string[] }): void {
  const time = new Date().toISOString().slice(11, 23);
  const status = logInfo.err ? 'ERR' : 'OK';
  console.log(`\n[${time}] ${logInfo.signature.slice(0, 20)}... (${status})`);
  for (const line of logInfo.logs) {
    // Skip noise lines
    if (line.includes('invoke [1]') || line.includes('success')) continue;
    console.log(`  ${line}`);
  }
}

function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    process.on('SIGINT', () => {
      console.log('\n  Stopped.');
      resolve();
    });
  });
}
