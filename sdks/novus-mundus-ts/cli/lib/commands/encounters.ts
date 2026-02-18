/**
 * encounters command — Spawn and inspect PvE encounters
 *
 * Usage:
 *   novus encounters spawn --city 0 --count 5
 *   novus encounters spawn --city 0 --count 3 --rarity rare
 *   novus encounters spawn --all --count 2
 *   novus encounters status
 *   novus encounters status --city 0
 */

import type { CLIContext, ParsedArgs } from '../context';
import { sendWithRetry, log } from '../helpers';
import { CITIES } from '../../data/cities';

import {
  createSpawnEncounterInstruction,
  deriveCityPda,
  deserializeCity,
} from '../../../src/index';
import { EncounterRarity } from '../../../src/instructions/encounter';

const GRID_PRECISION = 10000;

const RARITY_MAP: Record<string, EncounterRarity> = {
  common: EncounterRarity.Common,
  uncommon: EncounterRarity.Uncommon,
  rare: EncounterRarity.Rare,
  epic: EncounterRarity.Epic,
  legendary: EncounterRarity.Legendary,
};

export async function handleEncounters(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  switch (args.target) {
    case 'spawn':
      await handleSpawn(ctx, args);
      break;
    case 'status':
      await handleStatus(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus encounters <spawn|status> [options]');
  }
}

// ============================================================
// spawn
// ============================================================

async function handleSpawn(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const cityFlag = getFlag(args.flags, '--city');
  const allFlag = args.flags.includes('--all');
  const count = parseInt(getFlag(args.flags, '--count') || '1', 10);
  const rarityFlag = (getFlag(args.flags, '--rarity') || 'common').toLowerCase();

  const rarity = RARITY_MAP[rarityFlag];
  if (rarity === undefined) {
    log.error(`Invalid --rarity. Options: ${Object.keys(RARITY_MAP).join(', ')}`);
    return;
  }

  if (!allFlag && cityFlag === undefined) {
    log.error('Specify --city <id> or --all');
    return;
  }

  const cityIds = allFlag
    ? CITIES.map(c => c.id)
    : [parseInt(cityFlag!, 10)];

  let totalSpawned = 0;

  for (const cityId of cityIds) {
    const city = CITIES.find(c => c.id === cityId);
    if (!city) {
      log.error(`City ${cityId} not found`);
      continue;
    }

    const [cityPda] = deriveCityPda(ctx.gameEngine, cityId);
    const cityInfo = await ctx.connection.getAccountInfo(cityPda);
    if (!cityInfo) {
      log.error(`City ${cityId} not initialized on-chain`);
      continue;
    }

    const cityAccount = deserializeCity(cityInfo.data);
    let nextIndex = cityAccount.totalEncountersSpawned.toNumber();

    const baseLat = Math.round(city.lat * GRID_PRECISION);
    const baseLong = Math.round(city.lon * GRID_PRECISION);

    for (let i = 0; i < count; i++) {
      const gridLat = baseLat + Math.floor(i / 10);
      const gridLong = baseLong + (i % 10) + 1;

      const ix = createSpawnEncounterInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          playerOwner: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          cityId,
          encounterIndex: nextIndex,
          gridLat,
          gridLong,
        },
        { encounterType: rarity }
      );

      try {
        await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
        nextIndex++;
        totalSpawned++;
      } catch (e: any) {
        log.error(`Failed to spawn encounter ${nextIndex} in ${city.name}: ${e.message}`);
        break;
      }
    }

    log.create(`${count} ${rarityFlag} encounter(s) in ${city.name} (city ${cityId})`);
  }

  log.info(`\nDone — ${totalSpawned} encounter(s) spawned.`);
}

// ============================================================
// status
// ============================================================

async function handleStatus(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const cityFlag = getFlag(args.flags, '--city');

  const cityIds = cityFlag !== undefined
    ? [parseInt(cityFlag, 10)]
    : CITIES.map(c => c.id);

  log.info(`\n  ${'City'.padEnd(20)} ${'ID'.padStart(4)}  ${'Spawned'.padStart(8)}  ${'Active'.padStart(8)}  Players`);
  log.info(`  ${'─'.repeat(20)} ${'─'.repeat(4)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}  ${'─'.repeat(7)}`);

  let totalSpawned = 0;
  let totalActive = 0;
  let citiesChecked = 0;

  for (const cityId of cityIds) {
    const city = CITIES.find(c => c.id === cityId);
    if (!city) continue;

    const [cityPda] = deriveCityPda(ctx.gameEngine, cityId);
    const cityInfo = await ctx.connection.getAccountInfo(cityPda);
    if (!cityInfo) continue;

    const account = deserializeCity(cityInfo.data);
    const spawned = account.totalEncountersSpawned.toNumber();
    const active = account.activeEncounters.toNumber();

    totalSpawned += spawned;
    totalActive += active;
    citiesChecked++;

    // In --all mode, skip cities with no encounters to keep output clean
    if (cityFlag === undefined && spawned === 0 && active === 0) continue;

    log.info(
      `  ${city.name.padEnd(20)} ${String(cityId).padStart(4)}  ${String(spawned).padStart(8)}  ${String(active).padStart(8)}  ${account.playersPresent}`
    );
  }

  log.info(`\n  Total: ${totalSpawned} spawned, ${totalActive} active across ${citiesChecked} cities`);
}

// ============================================================
// helpers
// ============================================================

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}
