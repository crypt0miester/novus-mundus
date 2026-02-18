/**
 * Crank: Dungeons — create weekly leaderboards (Ix 260)
 *
 * For each dungeon template, calculates the current week number,
 * checks if the leaderboard PDA exists, and creates it if missing.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, accountExists, type PhaseStats } from '../helpers';
import { DUNGEONS } from '../../data/dungeons';
import { deriveDungeonLeaderboardPda } from '../../../src/pda';
import { createCreateLeaderboardInstruction } from '../../../src/instructions/dungeon';

/** Week 0 epoch — use a fixed reference point for week calculation */
const WEEK_ZERO_EPOCH = 1704067200; // 2024-01-01T00:00:00Z (Monday)
const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;

function getCurrentWeekNumber(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor((now - WEEK_ZERO_EPOCH) / SECONDS_PER_WEEK);
}

export async function crankDungeons(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const weekNumber = getCurrentWeekNumber();

  log.info(`  Current week number: ${weekNumber}`);
  log.info(`  Checking ${DUNGEONS.length} dungeon templates...`);

  for (const dungeon of DUNGEONS) {
    const [leaderboardPda] = deriveDungeonLeaderboardPda(
      ctx.gameEngine,
      dungeon.templateId,
      weekNumber
    );

    const exists = await accountExists(ctx.connection, leaderboardPda);
    if (exists) {
      log.skip(`Leaderboard: ${dungeon.name} week ${weekNumber} [exists]`);
      stats.skipped++;
      continue;
    }

    const ix = createCreateLeaderboardInstruction(
      {
        payer: ctx.daoAuthority.publicKey,
        daoAuthority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
      },
      {
        templateId: dungeon.templateId,
        weekNumber,
        prizePool: 0,
      }
    );

    if (ctx.dryRun) {
      log.dryRun(`Would create: Leaderboard ${dungeon.name} week ${weekNumber}`);
      stats.created++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.create(`Leaderboard: ${dungeon.name} week ${weekNumber}`);
      stats.created++;
    } catch (err: any) {
      log.error(`Failed to create leaderboard for ${dungeon.name}: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}
