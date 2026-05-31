/**
 * Phase 2 — Cities (batched)
 */

import { type CLIContext } from '../context';
import { accountExists, newStats, log, sendWithRetry, type PhaseStats } from '../helpers';
import {
  createBatchCitiesInstruction,
  deriveCityPda,
  parseCity,
} from '../../../src/index';
import { CITIES, CityType, dimsFromRadius, seedForCity } from '../../data/cities';
import {
  section, table, bold, dim, green, red, formatNum, check, statusBadge,
} from '../format';

export async function initCities(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  // Group into batches of 8
  const batchSize = 8;
  for (let i = 0; i < CITIES.length; i += batchSize) {
    const batch = CITIES.slice(i, i + batchSize);
    const startId = batch[0].id;

    // Check if first city in batch exists
    const [firstCityPda] = await deriveCityPda(ctx.gameEngine, startId);
    const exists = await accountExists(ctx.connection, firstCityPda);

    if (exists) {
      // Check individually
      let allExist = true;
      for (const city of batch) {
        const [pda] = await deriveCityPda(ctx.gameEngine, city.id);
        if (!(await accountExists(ctx.connection, pda))) {
          allExist = false;
          break;
        }
      }
      if (allExist) {
        log.skip(`Batch: cities ${startId}-${batch[batch.length - 1].id}`);
        stats.skipped += batch.length;
        continue;
      }
    }

    if (ctx.dryRun) {
      log.dryRun(`Would create batch: cities ${startId}-${batch[batch.length - 1].id}`);
      stats.created += batch.length;
      continue;
    }

    // Build city PDAs for the batch
    const cityAccounts = await Promise.all(
      batch.map(async (c) => (await deriveCityPda(ctx.gameEngine, c.id))[0]),
    );

    const ix = createBatchCitiesInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        cityAccounts,
      },
      {
        startCityId: startId,
        cities: batch.map(c => {
          const dim = dimsFromRadius(c.radiusKm);
          return {
            name: c.name,
            lat: c.lat,
            lon: c.lon,
            biomeSeed: seedForCity(c.id),
            cityType: c.type,
            widthGrid: dim,
            heightGrid: dim,
            waterLevelDelta: c.biome.waterLevelDelta,
            tempBias: c.biome.tempBias,
            moistureBias: c.biome.moistureBias,
            coast: c.biome.coast,
            landmassSeed: c.biome.landmassSeed,
          };
        }),
      }
    );

    await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
    log.create(`Batch: cities ${startId}-${batch[batch.length - 1].id} [${batch.length} created]`);
    stats.created += batch.length;
  }

  return stats;
}

export async function statusCities(ctx: CLIContext): Promise<string> {
  let count = 0;
  let misses = 0;
  for (let id = 0; misses < 5; id++) {
    const [pda] = await deriveCityPda(ctx.gameEngine, id);
    if (await accountExists(ctx.connection, pda)) {
      count++;
      misses = 0;
    } else {
      misses++;
    }
  }
  return `${count}`;
}

const CITY_TYPE_NAMES: Record<number, string> = {
  [CityType.Capital]: 'Capital',
  [CityType.Trade]: 'Trade',
  [CityType.Combat]: 'Combat',
  [CityType.Resource]: 'Resource',
};

export async function detailCities(ctx: CLIContext): Promise<string> {
  const lines: string[] = [];
  lines.push(section(`Cities — Kingdom ${ctx.kingdomId}`));

  const rows: string[][] = [];
  let misses = 0;
  for (let id = 0; misses < 5; id++) {
    const [pda] = await deriveCityPda(ctx.gameEngine, id);
    const info = await ctx.connection.getAccountInfo(pda);

    if (!info) {
      misses++;
      continue;
    }
    misses = 0;

    const data = parseCity(info);
    if (!data) {
      rows.push([
        String(id), dim('--'), dim('--'), dim('--'), dim('--'), red('BAD DATA'),
      ]);
      continue;
    }

    rows.push([
      String(data.cityId),
      data.name || `City #${data.cityId}`,
      CITY_TYPE_NAMES[data.cityType] ?? String(data.cityType),
      formatNum(data.playersPresent),
      formatNum(data.activeEncounters),
      `${data.widthGrid}×${data.heightGrid}`,
    ]);
  }

  lines.push(table(
    [
      { header: 'ID', align: 'right', width: 3 },
      { header: 'Name', width: 14 },
      { header: 'Type', width: 9 },
      { header: 'Players', align: 'right' },
      { header: 'Encounters', align: 'right' },
      { header: 'Plot', align: 'right' },
    ],
    rows
  ));

  lines.push('');
  return lines.join('\n');
}
