/**
 * encounters command — Spawn and inspect PvE encounters
 *
 * Usage:
 *   novus encounters spawn --city 0 --count 5
 *   novus encounters spawn --city 0 --count 3 --rarity rare
 *   novus encounters spawn --all --count 2
 *   novus encounters spawn --near <pubkey> --rarity rare
 *   novus encounters status
 *   novus encounters status --city 0
 *   novus encounters cleanup --city 0
 *   novus encounters cleanup --all
 */

import { PublicKey } from '@solana/web3.js';

import type { CLIContext, ParsedArgs } from '../context';
import { sendWithRetry, log } from '../helpers';
import { CITIES } from '../../data/cities';

import {
  createSpawnEncounterInstruction,
  createCleanupEncounterInstruction,
  deriveCityPda,
  deriveEncounterPda,
  deriveLocationPda,
  deserializeCity,
  deserializeLocation,
  derivePlayerPda,
  NovusMundusClient,
} from '../../../src/index';
import { deserializePlayer } from '../../../src/state/player';
import { EncounterRarity } from '../../../src/instructions/encounter';

/** Grace period (seconds) after despawn_at before an encounter can be cleaned up. */
const CLEANUP_GRACE_SECONDS = 3600;

const GRID_PRECISION = 10000;
const CELL_OCCUPIED = 6413;
const CITY_ENCOUNTER_LIMIT = 6412;
const WRONG_TIME = 6514;
const MAX_PLACEMENT_RETRIES = 10;

// Candidate cells for --near spawns, nearest first. One grid cell ≈ 8–11 m, so
// the player's own cell and its immediate neighbours all sit inside the 16 m
// encounter attack range — the player can engage without travelling.
const NEAR_OFFSETS: [number, number][] = [
  [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

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
    case 'cleanup':
      await handleCleanup(ctx, args);
      break;
    default:
      log.error(`Unknown subcommand: ${args.target || '(none)'}`);
      log.info('  Usage: novus encounters <spawn|status|cleanup> [options]');
  }
}

// spawn

async function handleSpawn(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const cityFlag = getFlag(args.flags, '--city');
  const allFlag = args.flags.includes('--all');
  const nearFlag = getFlag(args.flags, '--near');
  const count = parseInt(getFlag(args.flags, '--count') || '1', 10);
  const rarityFlag = (getFlag(args.flags, '--rarity') || 'common').toLowerCase();

  const rarity = RARITY_MAP[rarityFlag];
  if (rarity === undefined) {
    log.error(`Invalid --rarity. Options: ${Object.keys(RARITY_MAP).join(', ')}`);
    return;
  }

  // --near <pubkey>: spawn on the player's own grid cell (or a neighbour) so
  // the encounter lands inside their 16m attack range — no travel needed.
  let nearGrid: { lat: number; long: number } | null = null;
  let nearCityId: number | undefined;
  if (nearFlag !== undefined) {
    let owner: PublicKey;
    try {
      owner = new PublicKey(nearFlag);
    } catch {
      log.error(`Invalid --near pubkey: ${nearFlag}`);
      return;
    }
    const [playerPda] = derivePlayerPda(ctx.gameEngine, owner);
    const info = await ctx.connection.getAccountInfo(playerPda);
    if (!info) {
      log.error(`No player account found for ${nearFlag}`);
      return;
    }
    const player = deserializePlayer(info.data);
    nearCityId = player.currentCity;
    nearGrid = {
      lat: Math.round(player.currentLat * GRID_PRECISION),
      long: Math.round(player.currentLong * GRID_PRECISION),
    };
  }

  if (!allFlag && cityFlag === undefined && nearCityId === undefined) {
    log.error('Specify --city <id>, --all, or --near <pubkey>');
    return;
  }

  const cityIds = nearCityId !== undefined
    ? [nearCityId]
    : allFlag
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
    let citySpawned = 0;

    for (let i = 0; i < count; i++) {
      let placed = false;
      const attemptCount = nearGrid ? NEAR_OFFSETS.length : MAX_PLACEMENT_RETRIES;

      for (let attempt = 0; attempt < attemptCount; attempt++) {
        // --near: walk out from the player's own cell, nearest first;
        // otherwise a random cell within ~50 grid cells of the city centre.
        const gridLat = nearGrid
          ? nearGrid.lat + NEAR_OFFSETS[attempt][0]
          : baseLat + Math.floor(Math.random() * 100) - 50;
        const gridLong = nearGrid
          ? nearGrid.long + NEAR_OFFSETS[attempt][1]
          : baseLong + Math.floor(Math.random() * 100) - 50;

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
          await sendWithRetry(ctx, ix, [ctx.daoAuthority], 1);
          nextIndex++;
          totalSpawned++;
          citySpawned++;
          placed = true;
          break;
        } catch (e: any) {
          const errCode = extractCustomError(e);
          if (errCode === CELL_OCCUPIED) {
            continue; // Retry with different coordinates
          }
          if (errCode === CITY_ENCOUNTER_LIMIT) {
            const limit = 3 + Math.floor((cityAccount.playersPresent ?? 0) / 10);
            log.info(`  ${city.name}: encounter limit reached (${limit} max, need more players)`);
            break;
          }
          if (errCode === WRONG_TIME) {
            log.info(`  ${city.name}: ${rarityFlag} encounters can only spawn at night`);
            break;
          }
          log.error(`Failed to spawn encounter ${nextIndex} in ${city.name}: ${e.message}`);
          break;
        }
      }

      if (!placed) break;
    }

    if (citySpawned > 0) {
      log.create(`${citySpawned} ${rarityFlag} encounter(s) in ${city.name} (city ${cityId})`);
    }
  }

  log.info(`\nDone — ${totalSpawned} encounter(s) spawned.`);
}

// status

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

// cleanup

/**
 * Close terminal encounters (despawned past the grace window, killed or not),
 * reclaiming rent and decrementing the city's active-encounter counter.
 *
 * An encounter is eligible once `now >= despawn_at + 1h`. Rent for the encounter
 * account is routed on-chain to the spawn payer when its grid cell is still
 * open, otherwise it falls back to the kingdom authority — this CLI inspects the
 * cell and passes the matching recipient.
 */
async function handleCleanup(ctx: CLIContext, args: ParsedArgs): Promise<void> {
  const cityFlag = getFlag(args.flags, '--city');
  const allFlag = args.flags.includes('--all');

  if (!allFlag && cityFlag === undefined) {
    log.error('Specify --city <id> or --all');
    return;
  }

  const cityIds = allFlag ? CITIES.map(c => c.id) : [parseInt(cityFlag!, 10)];
  const now = Math.floor(Date.now() / 1000);

  const client = new NovusMundusClient({
    connection: ctx.connection,
    gameEngine: ctx.gameEngine,
    kingdomId: ctx.kingdomId,
  });

  let totalCleaned = 0;
  let totalPending = 0;

  for (const cityId of cityIds) {
    const city = CITIES.find(c => c.id === cityId);
    if (!city) {
      log.error(`City ${cityId} not found`);
      continue;
    }

    // fetchEncountersInCity returns despawned + dead encounters (no aliveOnly).
    const encounters = await client.fetchEncountersInCity(cityId);
    let cityCleaned = 0;

    for (const { account: enc } of encounters) {
      if (now < enc.despawnAt.toNumber() + CLEANUP_GRACE_SECONDS) {
        totalPending++;
        continue; // still within the grace window
      }

      const encounterIndex = enc.id.toNumber();
      const gridLat = Math.round(enc.locationLat * GRID_PRECISION);
      const gridLong = Math.round(enc.locationLong * GRID_PRECISION);

      const [encounterPda] = deriveEncounterPda(ctx.gameEngine, cityId, encounterIndex);
      const [locationPda] = deriveLocationPda(ctx.gameEngine, cityId, gridLat, gridLong);

      // Route rent: cell still held by this encounter -> its creator; cell
      // closed or reused by a newer encounter -> kingdom (DAO) authority.
      let rentRecipient = ctx.daoAuthority.publicKey;
      const locInfo = await ctx.connection.getAccountInfo(locationPda);
      if (locInfo && locInfo.data.length > 0) {
        const loc = deserializeLocation(locInfo.data);
        if (loc.occupant.equals(encounterPda)) {
          rentRecipient = loc.locationCreator;
        }
      }

      const ix = createCleanupEncounterInstruction({
        gameEngine: ctx.gameEngine,
        cityId,
        encounterIndex,
        gridLat,
        gridLong,
        rentRecipient,
      });

      try {
        await sendWithRetry(ctx, ix, [ctx.daoAuthority], 1);
        cityCleaned++;
        totalCleaned++;
      } catch (e: any) {
        log.error(`Failed to clean encounter #${encounterIndex} in ${city.name}: ${e.message}`);
      }
    }

    if (cityCleaned > 0) {
      log.create(`${cityCleaned} encounter(s) cleaned up in ${city.name} (city ${cityId})`);
    }
  }

  log.info(`\nDone — ${totalCleaned} cleaned, ${totalPending} still within grace window.`);
}

// helpers

function getFlag(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) return undefined;
  return flags[idx + 1];
}

function extractCustomError(e: any): number | null {
  const msg = e?.transactionMessage ?? e?.message ?? '';
  const match = msg.match(/"Custom":(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}
