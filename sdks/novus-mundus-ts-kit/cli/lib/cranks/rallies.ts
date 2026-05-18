/**
 * Crank: Rallies — close completed rallies (Ix 67)
 *
 * Fetches RallyAccounts via getProgramAccounts, filters for
 * completed/cancelled rallies where all participants have returned,
 * and sends close instructions.
 */

import { PublicKey } from '@solana/web3.js';
import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createRallyCloseInstruction } from '../../../src/instructions/rally';

/** RallyAccount status enum values */
const RALLY_STATUS = {
  GATHERING: 0,
  MARCHING: 1,
  EXECUTING: 2,
  RETURNING: 3,
  COMPLETED: 4,
  CANCELLED: 5,
} as const;

/** Approximate RallyAccount data size */
const RALLY_ACCOUNT_DATA_SIZE = 400;

export async function crankRallies(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  log.info('  Fetching rally accounts...');

  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [
      { dataSize: RALLY_ACCOUNT_DATA_SIZE },
    ],
  });

  log.info(`  Found ${accounts.length} rally accounts`);

  if (accounts.length === 0) {
    return stats;
  }

  for (const account of accounts) {
    const data = account.account.data;

    // RallyAccount layout (approximate):
    //   0-7: discriminator (8)
    //   8-39: game_engine (32)
    //   40-71: creator (32) — leader wallet
    //   72-79: rally_id (u64)
    //   80: status (u8)
    //   81: participant_count (u8)
    //   82: returned_count (u8)
    const STATUS_OFFSET = 80;
    const PARTICIPANT_COUNT_OFFSET = 81;
    const RETURNED_COUNT_OFFSET = 82;
    const CREATOR_OFFSET = 40;

    if (data.length < RETURNED_COUNT_OFFSET + 1) {
      stats.skipped++;
      continue;
    }

    const status = data[STATUS_OFFSET];
    const participantCount = data[PARTICIPANT_COUNT_OFFSET];
    const returnedCount = data[RETURNED_COUNT_OFFSET];
    const leaderOwner = new PublicKey(data.subarray(CREATOR_OFFSET, CREATOR_OFFSET + 32));

    // Only close if completed/cancelled AND all participants returned
    const isCloseable = (status === RALLY_STATUS.COMPLETED || status === RALLY_STATUS.CANCELLED)
      && returnedCount >= participantCount;

    if (!isCloseable) {
      stats.skipped++;
      continue;
    }

    const ix = createRallyCloseInstruction({
      rally: account.pubkey,
      leaderOwner,
    });

    if (ctx.dryRun) {
      log.dryRun(`Would close: Rally ${account.pubkey.toBase58().slice(0, 8)}...`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.update(`Closed: Rally ${account.pubkey.toBase58().slice(0, 8)}...`);
      stats.updated++;
    } catch (err: any) {
      log.error(`Failed to close rally ${account.pubkey.toBase58().slice(0, 8)}...: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}
