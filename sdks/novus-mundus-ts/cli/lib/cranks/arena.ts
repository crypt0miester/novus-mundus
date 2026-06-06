/**
 * Crank: Arena - automate the weekly season cadence (Ix 236 close / Ix 230 create)
 *
 * Two jobs, both permissionless from the crank's perspective:
 *
 * 1. Close arena seasons past their claim deadline. Rent returns to each
 *    season's authority.
 * 2. Roll the season cadence forward: when the latest season has passed its
 *    end_time, create the NEXT season (latest season_id + 1), mirroring the
 *    latest season's prize-pool / cap / min-level so the new week looks like
 *    the old one. Idempotent — does nothing if the next id already exists or
 *    the latest season is still inside its window.
 *
 * Fetches ArenaSeasonAccounts via getProgramAccounts (filtered by the SDK size
 * constant), parses them with the SDK deserializer. Prior versions filtered by
 * a hand-typed `dataSize: 256` and read fields at guessed byte offsets - the
 * real account is 608 bytes, so the filter matched nothing and the crank
 * silently did no work. Always size/parse via the SDK.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, type PhaseStats } from '../helpers';
import { PROGRAM_ID } from '../../../src/program';
import { createCloseSeasonInstruction, createCreateSeasonInstruction } from '../../../src/instructions/arena';
import { deriveArenaSeasonPda } from '../../../src/pda';
import { parseArenaSeason, ARENA_SEASON_ACCOUNT_SIZE, type ArenaSeasonAccount } from '../../../src/state/arena';

export async function crankArena(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const now = Math.floor(Date.now() / 1000);

  log.info('  Fetching arena season accounts...');
  const accounts = await ctx.connection.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: ARENA_SEASON_ACCOUNT_SIZE }],
  });
  log.info(`  Found ${accounts.length} arena season accounts`);

  // Track the latest (highest season_id) season for rollover after the close pass.
  let latest: ArenaSeasonAccount | null = null;

  for (const { account, pubkey } of accounts) {
    const season = parseArenaSeason(account);
    if (!season) {
      stats.skipped++;
      continue;
    }

    if (latest === null || season.seasonId > latest.seasonId) {
      latest = season;
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

  await rolloverSeason(ctx, stats, latest, now);

  return stats;
}

/**
 * Create the next arena season once the latest one has run its course.
 *
 * Idempotent: returns early if there is no season at all (nothing to roll), if
 * the latest season is still inside its window (now <= end_time), or if the
 * next season id already exists on chain. Prize-pool / cap / min-level are
 * copied off the latest season so the new week mirrors it. Signed by the DAO
 * authority, same as the close path above.
 */
async function rolloverSeason(
  ctx: CLIContext,
  stats: PhaseStats,
  latest: ArenaSeasonAccount | null,
  now: number,
): Promise<void> {
  if (latest === null) {
    if (ctx.verbose) log.info('  Rollover: no seasons exist [nothing to do]');
    return;
  }

  if (Number(latest.endTime) > now) {
    if (ctx.verbose) log.skip(`Rollover: Season ${latest.seasonId} still active [nothing to do]`);
    stats.skipped++;
    return;
  }

  const nextSeasonId = latest.seasonId + 1;
  const [nextPda] = await deriveArenaSeasonPda(ctx.gameEngine, nextSeasonId);
  const existing = await ctx.connection.getAccountInfo(nextPda);
  if (existing !== null) {
    if (ctx.verbose) log.skip(`Rollover: Season ${nextSeasonId} already exists [nothing to do]`);
    stats.skipped++;
    return;
  }

  const buildIx = () => createCreateSeasonInstruction(
    {
      authority: ctx.daoAuthority.publicKey,
      gameEngine: ctx.gameEngine,
      seasonId: nextSeasonId,
    },
    {
      masterPrizePool: latest.masterPrizePool,
      dailyPrizePool: latest.dailyPrizePool,
      dailyDistributionCap: latest.dailyDistributionCap,
      minLevelRequired: latest.minLevelRequired,
    },
  );

  if (ctx.dryRun) {
    log.dryRun(`Would create: Season ${nextSeasonId} (mirrors Season ${latest.seasonId})`);
    stats.created++;
    return;
  }

  try {
    await sendWithRetry(ctx, buildIx(), [ctx.daoAuthority]);
    log.create(`Season ${nextSeasonId} (mirrors Season ${latest.seasonId})`);
    stats.created++;
  } catch (err: any) {
    log.error(`Failed to create Season ${nextSeasonId}: ${err.message}`);
    stats.skipped++;
  }
}
