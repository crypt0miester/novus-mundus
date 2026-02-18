/**
 * show expedition — List all active expeditions
 */

import type { NovusMundusClient } from '../../../src/client';
import type { CLIContext } from '../context';
import { log } from '../helpers';
import {
  table, section, addr, formatNum, formatDate, dim,
  type Column,
} from '../format';
import { CITIES } from '../../data/cities';
import { ExpeditionType } from '../../../src/types/enums';
import { getExpeditionTotalOperatives } from '../../../src/state/expedition';

const TYPE_NAMES: Record<number, string> = {
  [ExpeditionType.None]: 'None',
  [ExpeditionType.Mining]: 'Mining',
  [ExpeditionType.Fishing]: 'Fishing',
};

function cityName(id: number): string {
  return CITIES.find(c => c.id === id)?.name ?? `City ${id}`;
}

export async function showExpeditions(client: NovusMundusClient, ctx: CLIContext): Promise<void> {
  const expeditions = await client.fetchAllExpeditions();

  log.info(section(`Expeditions — Kingdom ${ctx.kingdomId} (${expeditions.length} total)`));

  if (expeditions.length === 0) {
    log.info(dim('  No expeditions found.'));
    return;
  }

  const cols: Column[] = [
    { header: 'Player' },
    { header: 'Type', width: 8 },
    { header: 'Tier', align: 'right', width: 4 },
    { header: 'City', width: 12 },
    { header: 'Score', align: 'right', width: 5 },
    { header: 'Strikes', align: 'right', width: 7 },
    { header: 'Operatives', align: 'right', width: 10 },
    { header: 'Started', width: 16 },
  ];

  const rows = expeditions.map(({ account: e }) => [
    addr(e.player),
    TYPE_NAMES[e.expeditionType] ?? `${e.expeditionType}`,
    String(e.tier),
    cityName(e.cityId),
    String(e.score),
    String(e.strikes),
    formatNum(getExpeditionTotalOperatives(e)),
    formatDate(e.startTime),
  ]);

  log.info(table(cols, rows));
}
