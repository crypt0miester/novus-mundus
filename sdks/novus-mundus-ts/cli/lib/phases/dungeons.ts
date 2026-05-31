/**
 * Phase 7 — Dungeon Templates + Leaderboards
 */

import { type CLIContext } from '../context';
import {
  accountExists,
  createOrSkip,
  newStats,
  log,
  type PhaseStats,
} from '../helpers';
import {
  createCreateDungeonTemplateInstruction,
  createCreateLeaderboardInstruction,
  deriveDungeonTemplatePda,
  deriveDungeonLeaderboardPda,
  parseDungeonTemplate,
  parseDungeonLeaderboard,
} from '../../../src/index';
import { DUNGEONS } from '../../data/dungeons';
import {
  section, table, bold, dim, green, red, formatNum, formatDuration,
  check, statusBadge, addr,
} from '../format';

const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;
function getCurrentWeek(): number {
  return Math.floor(Date.now() / 1000 / SECONDS_PER_WEEK);
}

export async function initDungeons(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();
  const currentWeek = getCurrentWeek();

  for (const dungeon of DUNGEONS) {
    // Template
    const [templatePda] = await deriveDungeonTemplatePda(dungeon.templateId);
    await createOrSkip(
      ctx,
      `Dungeon Template #${dungeon.templateId} (${dungeon.name})`,
      templatePda,
      () => createCreateDungeonTemplateInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          templateId: dungeon.templateId,
          name: dungeon.name,
          theme: dungeon.theme,
          totalFloors: dungeon.totalFloors,
          roomsPerFloor: dungeon.roomsPerFloor,
          checkpointInterval: dungeon.checkpointInterval,
          minPlayerLevel: dungeon.minPlayerLevel,
          requiredBuildingLevel: dungeon.requiredBuildingLevel,
          staminaCost: dungeon.staminaCost,
          bossPowerMultiplier: dungeon.bossPowerMultiplier,
          floorPower: dungeon.floorPower,
          combatWeight: dungeon.combatWeight,
          treasureWeight: dungeon.treasureWeight,
          campWeight: dungeon.campWeight,
          restWeight: dungeon.restWeight,
          trapWeight: dungeon.trapWeight,
          darknessBaseBps: dungeon.darknessBaseBps,
          darknessPerFloorBps: dungeon.darknessPerFloorBps,
          timeLimitSeconds: dungeon.timeLimitSeconds,
          baseXpPerRoom: BigInt(dungeon.baseXpPerRoom),
          baseNoviPerFloor: BigInt(dungeon.baseNoviPerFloor),
          completionBonusBps: dungeon.completionBonusBps,
          rewardScalingBps: dungeon.rewardScalingBps,
        }
      ),
      stats
    );
    log.info(`    Template ID ${dungeon.templateId} (${dungeon.name})`);

    // Current week Leaderboard
    const [leaderboardPda] = await deriveDungeonLeaderboardPda(ctx.gameEngine, dungeon.templateId, currentWeek);
    await createOrSkip(
      ctx,
      `Leaderboard: Dungeon #${dungeon.templateId} Week ${currentWeek}`,
      leaderboardPda,
      () => createCreateLeaderboardInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          templateId: dungeon.templateId,
          weekNumber: currentWeek,
          prizePool: BigInt(1_000_000),
        }
      ),
      stats
    );
  }

  return stats;
}

export async function statusDungeons(ctx: CLIContext): Promise<string> {
  let templates = 0;
  let leaderboards = 0;
  const week = getCurrentWeek();

  let misses = 0;
  for (let id = 0; misses < 5; id++) {
    const [tPda] = await deriveDungeonTemplatePda(id);
    if (await accountExists(ctx.connection, tPda)) {
      templates++;
      misses = 0;
    } else {
      misses++;
      continue;
    }
    const [lPda] = await deriveDungeonLeaderboardPda(ctx.gameEngine, id, week);
    if (await accountExists(ctx.connection, lPda)) leaderboards++;
  }

  return `${templates} templates, ${leaderboards} leaderboards`;
}

const THEME_NAMES = ['Crypts', 'Caverns', 'Abyss', 'Forge'];

export async function detailDungeons(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Dungeons — Kingdom ${ctx.kingdomId}`));

  // Scan templates by ID, stop after 5 consecutive misses
  const templateRows: string[][] = [];
  const discoveredTemplates: { templateId: number; name: string }[] = [];
  let misses = 0;
  for (let id = 0; misses < 5; id++) {
    const [tPda] = await deriveDungeonTemplatePda(id);
    const info = await ctx.connection.getAccountInfo(tPda);

    if (!info) {
      misses++;
      continue;
    }
    misses = 0;

    const data = parseDungeonTemplate(info);
    if (!data) {
      templateRows.push([
        String(id), dim('--'), dim('--'), dim('--'), dim('--'),
        dim('--'), dim('--'), dim('--'), red('BAD DATA'),
      ]);
      discoveredTemplates.push({ templateId: id, name: `Dungeon #${id}` });
      continue;
    }

    const templateName = data.name || `Dungeon #${data.dungeonId}`;
    discoveredTemplates.push({ templateId: id, name: templateName });

    templateRows.push([
      String(data.dungeonId),
      templateName,
      THEME_NAMES[data.theme] ?? String(data.theme),
      String(data.totalFloors),
      `${data.roomsPerFloor}/floor`,
      String(data.minPlayerLevel),
      String(data.staminaCost),
      formatDuration(data.timeLimitSeconds),
      formatNum(data.baseXpPerRoom),
    ]);
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 16 },
      { header: 'Theme', width: 8 },
      { header: 'Floors', align: 'right' },
      { header: 'Rooms', align: 'right' },
      { header: 'MinLvl', align: 'right' },
      { header: 'Stam', align: 'right' },
      { header: 'Time', align: 'right' },
      { header: 'XP/Room', align: 'right' },
    ],
    templateRows
  ));

  // Leaderboards — use discovered template IDs
  const week = getCurrentWeek();
  lines.push(section(`Leaderboards (Week ${week})`));
  const lbRows: string[][] = [];
  for (const t of discoveredTemplates) {
    const [lPda] = await deriveDungeonLeaderboardPda(ctx.gameEngine, t.templateId, week);
    const info = await ctx.connection.getAccountInfo(lPda);
    const data = info ? parseDungeonLeaderboard(info) : null;

    if (data) {
      const entryCount = data.entries?.length ?? 0;
      const topScore = entryCount > 0 ? formatNum(data.entries[0].score) : dim('--');
      const topPlayer = entryCount > 0 ? addr(data.entries[0].player) : dim('--');
      lbRows.push([
        String(t.templateId), t.name, String(data.weekNumber),
        String(entryCount), topPlayer, topScore,
      ]);
    } else {
      lbRows.push([
        String(t.templateId), t.name, String(week), '0', dim('--'), red('MISSING'),
      ]);
    }
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Dungeon', width: 16 },
      { header: 'Week', align: 'right' },
      { header: 'Entries', align: 'right' },
      { header: 'Top Player' },
      { header: 'Top Score', align: 'right' },
    ],
    lbRows
  ));

  lines.push('');
  return lines.join('\n');
}
