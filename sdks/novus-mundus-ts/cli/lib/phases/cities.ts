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
import { CITIES, CityType, dimsFromRadius, seedForCity, type CityData } from '../../data/cities';
import {
  section, table, bold, dim, green, red, formatNum, check, statusBadge,
} from '../format';

// batch_init_cities assigns ids sequentially from startCityId, so a single
// instruction must cover a contiguous id run, capped by the on-chain
// MAX_CITIES_PER_BATCH.
const MAX_CITIES_PER_BATCH = 8;

export async function initCities(ctx: CLIContext): Promise<PhaseStats> {
  const stats = newStats();

  // Resolve the cities to create: the enrolled subset (or all), sorted by id.
  // Enrolling a subset lets a kingdom open with fewer cities and add more
  // later; later runs with a wider --cities create-or-skip the new ones.
  const enrolled = ctx.enrolledCities;
  let target: CityData[];
  if (enrolled) {
    const unknown = [...enrolled].filter((id) => !CITIES.some((c) => c.id === id));
    if (unknown.length) {
      throw new Error(`--cities references unknown city id(s): ${unknown.join(', ')}`);
    }
    target = CITIES.filter((c) => enrolled.has(c.id));
    log.info(`Enrolling ${target.length} of ${CITIES.length} cities: ${target.map((c) => c.id).join(', ')}`);
  } else {
    target = [...CITIES];
  }
  target.sort((a, b) => a.id - b.id);

  // Skip cities already on chain; collect the rest.
  const missing: CityData[] = [];
  for (const c of target) {
    const [pda] = await deriveCityPda(ctx.gameEngine, c.id);
    if (await accountExists(ctx.connection, pda)) {
      stats.skipped++;
    } else {
      missing.push(c);
    }
  }
  if (missing.length === 0) {
    log.skip(`All ${target.length} enrolled cities already exist`);
    return stats;
  }

  // Group the missing cities into contiguous id-runs, each capped at the batch
  // size. Non-contiguous enrollments (e.g. 5,9,13) become one batch per id.
  const runs: CityData[][] = [];
  for (const c of missing) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev && c.id === prev.id + 1 && run.length < MAX_CITIES_PER_BATCH) {
      run.push(c);
    } else {
      runs.push([c]);
    }
  }

  for (const batch of runs) {
    const startId = batch[0].id;
    const endId = batch[batch.length - 1].id;

    if (ctx.dryRun) {
      log.dryRun(`Would create cities ${startId}-${endId} [${batch.length}]`);
      stats.created += batch.length;
      continue;
    }

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
    log.create(`Cities ${startId}-${endId} [${batch.length} created]`);
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
