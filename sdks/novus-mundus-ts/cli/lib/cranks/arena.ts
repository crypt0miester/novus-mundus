/**
 * Crank: Arena — close old arena seasons (Ix 236)
 *
 * Fetches ArenaSeasonAccounts via getProgramAccounts,
 * filters for seasons past claim deadline, and sends close instructions.
 */

import { PublicKey } from '@solana/web3.js';
import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createCloseSeasonInstruction } from '../../../src/instructions/arena';
import { deriveArenaSeasonPda } from '../../../src/pda';

/** ArenaSeasonAccount data size — adjust if struct changes */
const ARENA_SEASON_DATA_SIZE = 256;

export async function crankArena(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info('  Fetching arena season accounts...');

  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [
      { dataSize: ARENA_SEASON_DATA_SIZE },
    ],
  });

  log.info(`  Found ${accounts.length} arena season accounts`);

  if (accounts.length === 0) {
    return stats;
  }

  for (const account of accounts) {
    const data = Buffer.from(account.account.data);

    // ArenaSeasonAccount layout (approximate):
    //   0-7: discriminator (8)
    //   8-39: game_engine (32)
    //   40-43: season_id (u32)
    //   44-47: city_id (u16) + padding
    //   48-79: authority (32)
    //   80-87: end_time (i64)
    //   88-95: claim_deadline (i64)
    const SEASON_ID_OFFSET = 40;
    const CITY_ID_OFFSET = 44;
    const AUTHORITY_OFFSET = 48;
    const CLAIM_DEADLINE_OFFSET = 88;

    if (data.length < CLAIM_DEADLINE_OFFSET + 8) {
      stats.skipped++;
      continue;
    }

    const seasonId = data.readUInt32LE(SEASON_ID_OFFSET);
    const cityId = data.readUInt16LE(CITY_ID_OFFSET);
    const authority = new PublicKey(data.subarray(AUTHORITY_OFFSET, AUTHORITY_OFFSET + 32));
    const claimDeadline = Number(data.readBigInt64LE(CLAIM_DEADLINE_OFFSET));

    // Close if past claim deadline
    if (claimDeadline > now) {
      log.skip(`Season ${seasonId} [claim deadline not reached]`);
      stats.skipped++;
      continue;
    }

    const ix = createCloseSeasonInstruction({
      seasonAuthority: authority,
      gameEngine: ctx.gameEngine,
      seasonId,
      cityId,
    });

    if (ctx.dryRun) {
      log.dryRun(`Would close: Season ${seasonId} (city ${cityId})`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.update(`Closed: Season ${seasonId} (city ${cityId})`);
      stats.updated++;
    } catch (err: any) {
      log.error(`Failed to close Season ${seasonId}: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}
