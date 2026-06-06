/**
 * Crank: Arena - close arena seasons past their claim deadline (Ix 236)
 *
 * Fetches ArenaSeasonAccounts via getProgramAccounts (filtered by the SDK size
 * constant), parses them with the SDK deserializer, and closes any whose claim
 * deadline has passed. Rent returns to each season's authority.
 *
 * Prior versions filtered by a hand-typed `dataSize: 256` and read fields at
 * guessed byte offsets - the real account is 608 bytes, so the filter matched
 * nothing and the crank silently did no work. Always size/parse via the SDK.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createCloseSeasonInstruction } from '../../../src/instructions/arena';
import { parseArenaSeason, ARENA_SEASON_ACCOUNT_SIZE } from '../../../src/state/arena';

export async function crankArena(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info('  Fetching arena season accounts...');
  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: ARENA_SEASON_ACCOUNT_SIZE }],
  });
  log.info(`  Found ${accounts.length} arena season accounts`);

  for (const { account, pubkey } of accounts) {
    const season = parseArenaSeason(account);
    if (!season) {
      stats.skipped++;
      continue;
    }

    if (Number(season.claimDeadline) > now) {
      if (ctx.verbose) log.skip(`Season ${season.seasonId} [claim deadline not reached]`);
      stats.skipped++;
      continue;
    }

    const ix = createCloseSeasonInstruction({
      seasonAuthority: season.authority,
      gameEngine: ctx.gameEngine,
      seasonId: season.seasonId,
      cityId: season.cityId,
    });

    if (ctx.dryRun) {
      log.dryRun(`Would close: Season ${season.seasonId} (city ${season.cityId})`);
      stats.updated++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.update(`Closed: Season ${season.seasonId} (city ${season.cityId}) [${pubkey.toBase58().slice(0, 8)}..]`);
      stats.updated++;
    } catch (err: any) {
      log.error(`Failed to close Season ${season.seasonId}: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}
