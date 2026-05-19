/**
 * Phase 8 — Castles (one per city)
 */

import { type CLIContext } from '../context';
import {
  accountExists,
  createOrSkip,
  newStats,
  type PhaseStats,
} from '../helpers';
import {
  createCreateCastleInstruction,
  deriveCastlePda,
  parseCastle,
} from '../../../src/index';
import { CASTLES } from '../../data/castles';
import {
  section, table, bold, dim, green, red, yellow, formatNum, addr,
  check, statusBadge,
} from '../format';

export async function initCastles(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  for (const castle of CASTLES) {
    const [castlePda] = await deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);

    await createOrSkip(
      ctx,
      `Castle #${castle.castleId} (${castle.name})`,
      castlePda,
      async () => await createCreateCastleInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          cityId: castle.cityId,
          castleId: castle.castleId,
          tier: castle.tier,
          latitude: castle.latitude,
          longitude: castle.longitude,
          minLevel: castle.minLevel,
          minNetworthMillions: castle.minNetworthMillions,
          minTroopsThousands: castle.minTroopsThousands,
          name: castle.name,
        }
      ),
      stats
    );
  }

  return stats;
}

export async function statusCastles(ctx: CLIContext): Promise<string> {
  let count = 0;
  for (const castle of CASTLES) {
    const [pda] = await deriveCastlePda(ctx.gameEngine, castle.cityId, castle.castleId);
    if (await accountExists(ctx.connection, pda)) count++;
  }
  return `${count}`;
}

const TIER_NAMES = ['Outpost', 'Keep', 'Stronghold', 'Fortress', 'Citadel'];
const STATUS_NAMES = ['Vacant', 'Claimed', 'Contested', 'Transitioning'];

export async function detailCastles(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Castles — Kingdom ${ctx.kingdomId}`));

  const rows: string[][] = [];
  for (const c of CASTLES) {
    const [pda] = await deriveCastlePda(ctx.gameEngine, c.cityId, c.castleId);
    const info = await ctx.connection.getAccountInfo(pda);
    if (!info) {
      rows.push([
        String(c.castleId), dim('--'), dim('--'),
        String(c.cityId), dim('--'), red('MISSING'),
        dim('--'), dim('--'), dim('--'),
      ]);
      continue;
    }

    const data = parseCastle(info);
    if (!data) {
      rows.push([
        String(c.castleId), dim('--'), dim('--'),
        String(c.cityId), dim('--'), red('BAD DATA'),
        dim('--'), dim('--'), dim('--'),
      ]);
      continue;
    }

    const king = data.isVacant ? dim('vacant') : addr(data.king);
    const status = data.isVacant ? yellow('Vacant') : STATUS_NAMES[data.status] ?? String(data.status);
    rows.push([
      String(data.castleId),
      data.name || `Castle #${data.castleId}`,
      TIER_NAMES[data.tier] ?? String(data.tier),
      String(data.cityId),
      king,
      status,
      `${data.garrisonCount}/${data.maxGarrison}`,
      `${data.courtCount}/${data.maxCourt}`,
      String(data.minLevel),
    ]);
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 20 },
      { header: 'Tier', width: 11 },
      { header: 'City', align: 'right' },
      { header: 'King' },
      { header: 'Status', width: 13 },
      { header: 'Garrison', align: 'right' },
      { header: 'Court', align: 'right' },
      { header: 'MinLvl', align: 'right' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}
