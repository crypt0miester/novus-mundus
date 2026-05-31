/**
 * Phase 9 — Arena Season
 */

import { type CLIContext } from '../context';
import { createOrSkip, newStats, accountExists, type PhaseStats } from '../helpers';
import {
  createCreateSeasonInstruction,
  deriveArenaSeasonPda,
  parseArenaSeason,
} from '../../../src/index';
import { ARENA_SEASON } from '../../data/arena';
import {
  section, table, bold, dim, green, red, yellow, formatNum, formatDate,
  addr, check, statusBadge,
} from '../format';

export async function initArena(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  const [seasonPda] = await deriveArenaSeasonPda(ctx.gameEngine, ARENA_SEASON.seasonId);

  await createOrSkip(
    ctx,
    `Arena Season ${ARENA_SEASON.seasonId}`,
    seasonPda,
    () => createCreateSeasonInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        seasonId: ARENA_SEASON.seasonId,
      },
      {
        masterPrizePool: BigInt(ARENA_SEASON.masterPrizePool),
        dailyPrizePool: BigInt(ARENA_SEASON.dailyPrizePool),
        dailyDistributionCap: BigInt(ARENA_SEASON.dailyDistributionCap),
        minLevelRequired: ARENA_SEASON.minLevelRequired,
      }
    ),
    stats
  );

  return stats;
}

export async function statusArena(ctx: CLIContext): Promise<string> {
  let count = 0;
  let consecutiveMisses = 0;
  for (let id = 0; consecutiveMisses < 5; id++) {
    const [pda] = await deriveArenaSeasonPda(ctx.gameEngine, id);
    if (await accountExists(ctx.connection, pda)) {
      count++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
    }
  }
  return `${count} seasons`;
}

const SEASON_STATUS = ['Created', 'Active', 'Ended', 'Finalized'];

export async function detailArena(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Arena — Kingdom ${ctx.kingdomId}`));

  let found = 0;
  let consecutiveMisses = 0;
  for (let id = 0; consecutiveMisses < 5; id++) {
    const [seasonPda] = await deriveArenaSeasonPda(ctx.gameEngine, id);
    const info = await ctx.connection.getAccountInfo(seasonPda);

    if (!info) {
      consecutiveMisses++;
      continue;
    }
    consecutiveMisses = 0;
    found++;

    const season = parseArenaSeason(info);
    if (!season) {
      lines.push(red(`  Season ${id}: Failed to deserialize\n`));
      continue;
    }

    lines.push(table(
      [
        { header: 'Field', width: 22 },
        { header: 'Value' },
      ],
      [
        ['Season ID',           String(season.seasonId)],
        ['Status',              SEASON_STATUS[season.status] ?? String(season.status)],
        ['Start',               formatDate(season.startTime)],
        ['End',                 formatDate(season.endTime)],
        ['Claim Deadline',      formatDate(season.claimDeadline)],
        ['Master Prize Pool',   formatNum(season.masterPrizePool)],
        ['Daily Prize Pool',    formatNum(season.dailyPrizePool)],
        ['Daily Cap',           formatNum(season.dailyDistributionCap)],
        ['Distributed Today',   formatNum(season.distributedToday)],
        ['Prize Remaining',     formatNum(season.prizeRemaining)],
        ['Min Level',           String(season.minLevelRequired)],
        ['Total Battles',       formatNum(season.totalBattles)],
        ['Leaderboard Count',   String(season.leaderboardCount)],
      ]
    ));

    // Leaderboard
    if (season.leaderboardCount > 0) {
      lines.push(section('Leaderboard'));
      const lbRows: string[][] = [];
      for (let i = 0; i < season.leaderboardCount; i++) {
        const entry = season.leaderboard[i];
        if (!entry) continue;
        const claimed = season.leaderboardClaimed?.[i] ? green('claimed') : dim('unclaimed');
        lbRows.push([
          String(i + 1),
          addr(entry.player),
          formatNum(entry.totalPoints),
          claimed,
        ]);
      }
      lines.push(table(
        [
          { header: '#', align: 'right', width: 3 },
          { header: 'Player' },
          { header: 'Points', align: 'right' },
          { header: 'Prize' },
        ],
        lbRows
      ));
    }
  }

  if (found === 0) {
    lines.push(red('  No Arena Seasons found\n'));
  }

  lines.push('');
  return lines.join('\n');
}
