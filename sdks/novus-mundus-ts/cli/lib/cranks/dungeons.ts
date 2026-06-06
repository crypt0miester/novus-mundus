/**
 * Crank: Dungeons — create the current week's leaderboard per dungeon (Ix 260).
 *
 * Enumerates dungeon templates on chain, derives this week's leaderboard PDA,
 * and creates it if missing. Permissionless.
 *
 * Prior version subtracted a `WEEK_ZERO_EPOCH` from the timestamp, but the chain
 * uses raw `timestamp / SECONDS_PER_WEEK` — so its week number was ~2800 weeks
 * too low and `create_leaderboard` rejected every call (`week_number <
 * current_week`). Use the shared `currentDungeonWeek` helper, which mirrors the
 * on-chain formula exactly.
 */

import { type CLIContext } from '../context';
import { log, newStats, sendWithRetry, accountExists, type PhaseStats } from '../helpers';
import {
  NovusMundusClient,
  currentDungeonWeek,
  deriveDungeonLeaderboardPda,
} from '../../../src/index';
import { createCreateLeaderboardInstruction } from '../../../src/instructions/dungeon';

export async function crankDungeons(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const dao = ctx.daoAuthority.publicKey;
  const weekNumber = currentDungeonWeek(Math.floor(Date.now() / 1000));

  const client = new NovusMundusClient({
    connection: ctx.connection,
    kingdomId: ctx.kingdomId,
    gameEngine: ctx.gameEngine,
  });
  const templates = await client.fetchAllDungeonTemplates();
  log.info(`  Week ${weekNumber} — checking ${templates.length} dungeon templates...`);

  for (const { account: t } of templates) {
    const [leaderboardPda] = await deriveDungeonLeaderboardPda(ctx.gameEngine, t.dungeonId, weekNumber);
    if (await accountExists(ctx.connection, leaderboardPda)) {
      log.skip(`Leaderboard: ${t.name} week ${weekNumber} [exists]`);
      stats.skipped++;
      continue;
    }

    const ix = createCreateLeaderboardInstruction(
      { payer: dao, daoAuthority: dao, gameEngine: ctx.gameEngine },
      { templateId: t.dungeonId, weekNumber, prizePool: 0 },
    );

    if (ctx.dryRun) {
      log.dryRun(`Would create: Leaderboard ${t.name} week ${weekNumber}`);
      stats.created++;
      continue;
    }

    try {
      await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
      log.create(`Leaderboard: ${t.name} week ${weekNumber}`);
      stats.created++;
    } catch (err: any) {
      log.error(`Failed to create leaderboard for ${t.name}: ${err.message}`);
      stats.skipped++;
    }
  }

  return stats;
}
