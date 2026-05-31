/**
 * Encounter Cleanup E2E Tests
 *
 * Tests for `cleanup_encounter` (instruction 72):
 * - Rejects cleanup before `despawn_at + grace`
 * - Closes a terminal encounter, reclaims rent, releases the grid cell
 * - Decrements the city's `active_encounters` counter
 */

import { describe, it, expect, beforeAll, setDefaultTimeout } from 'bun:test';
import { Transaction } from '@solana/web3.js';

import {
  createSpawnEncounterInstruction,
  createCleanupEncounterInstruction,
  createAttackEncounterInstruction,
  deriveEncounterPda,
  deriveCityPda,
  deriveLootPda,
  EncounterRarity,
  GameError,
} from '../../src/index';
import { deriveLocationPda } from '../../src/pda';
import { BuildingType } from '../../src/types/enums';

import { type TestContext, beforeAllTests, CITIES } from '../fixtures/setup';
import { PlayerFactory } from '../fixtures/players';
import { sendTransaction, expectTransactionToFail } from '../utils/transactions';
import { fetchEncounter, fetchCity, fetchPlayer, accountExists } from '../utils/accounts';
import { log } from '../utils/logger';
import { advanceTime } from '../fixtures/time';

const GRID_PRECISION = 10000;
/** Common encounter despawn duration (see EncounterType::despawn_duration). */
const COMMON_DESPAWN_SECONDS = 3600;
/** ENCOUNTER_CLEANUP_GRACE — must match the on-chain constant. */
const CLEANUP_GRACE_SECONDS = 3600;

setDefaultTimeout(60_000);

describe('Encounter Cleanup', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Encounter Cleanup');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  /** Auto-spawn a Common encounter (authority = game engine authority, no NOVI). */
  async function spawnCommon(cityId: number, encounterIndex: number) {
    const city = CITIES[cityId]!;
    const gridLat = Math.round(city.lat * GRID_PRECISION);
    const gridLong = Math.round(city.lon * GRID_PRECISION) + 1;

    const spawnIx = await createSpawnEncounterInstruction(
      {
        gameEngine: ctx.gameEngine,
        payer: ctx.daoAuthority.publicKey,
        playerOwner: ctx.daoAuthority.publicKey,
        cityId,
        gridLat,
        gridLong,
        encounterIndex,
      },
      { encounterType: EncounterRarity.Common }
    );
    await sendTransaction(ctx.svm, new Transaction().add(spawnIx), [ctx.daoAuthority]);

    const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, encounterIndex);
    const [locationPda] = await deriveLocationPda(ctx.gameEngine, cityId, gridLat, gridLong);
    return { gridLat, gridLong, encounterPda, locationPda };
  }

  async function cleanupIx(
    cityId: number,
    encounterIndex: number,
    gridLat: number,
    gridLong: number
  ) {
    return createCleanupEncounterInstruction({
      gameEngine: ctx.gameEngine,
      cityId,
      encounterIndex,
      gridLat,
      gridLong,
      // Cell is still open (never killed) -> rent routes to the spawn payer.
      rentRecipient: ctx.daoAuthority.publicKey,
    });
  }

  it('rejects cleanup before the encounter despawns', async () => {
    const cityId = 5;
    const { gridLat, gridLong } = await spawnCommon(cityId, 0);

    // No time advanced — encounter is still live and attackable.
    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(await cleanupIx(cityId, 0, gridLat, gridLong)),
      [ctx.daoAuthority],
      GameError.EncounterStillActive,
      'cleanup before despawn'
    );

    // Encounter must still exist.
    expect(await fetchEncounter(ctx.svm, (await deriveEncounterPda(ctx.gameEngine, cityId, 0))[0]))
      .not.toBeNull();
  });

  it('rejects cleanup after despawn but within the grace window', async () => {
    const cityId = 9;
    const { gridLat, gridLong } = await spawnCommon(cityId, 0);

    // Past despawn_at (encounter unattackable) but inside the cleanup grace window.
    await advanceTime(ctx.svm, COMMON_DESPAWN_SECONDS + 60);

    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(await cleanupIx(cityId, 0, gridLat, gridLong)),
      [ctx.daoAuthority],
      GameError.EncounterStillActive,
      'cleanup within grace window'
    );

    expect(await fetchEncounter(ctx.svm, (await deriveEncounterPda(ctx.gameEngine, cityId, 0))[0]))
      .not.toBeNull();
  });

  it('cleans up a despawned encounter: closes accounts and decrements the city counter', async () => {
    const cityId = 13;
    const { gridLat, gridLong, encounterPda, locationPda } = await spawnCommon(cityId, 0);

    // Both the encounter and its grid cell exist after spawn.
    expect(await fetchEncounter(ctx.svm, encounterPda)).not.toBeNull();
    expect(await accountExists(ctx.svm, locationPda)).toBe(true);

    const cityAfterSpawn = await fetchCity(ctx.svm, ctx.gameEngine, cityId);
    expect(cityAfterSpawn).not.toBeNull();
    const activeAfterSpawn = Number(cityAfterSpawn!.activeEncounters);
    expect(activeAfterSpawn).toBeGreaterThan(0);

    // Advance past despawn_at + grace so the encounter becomes eligible.
    await advanceTime(ctx.svm, COMMON_DESPAWN_SECONDS + CLEANUP_GRACE_SECONDS + 60);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(await cleanupIx(cityId, 0, gridLat, gridLong)),
      [ctx.daoAuthority]
    );

    // Encounter account closed.
    expect(await fetchEncounter(ctx.svm, encounterPda)).toBeNull();
    expect(await accountExists(ctx.svm, encounterPda)).toBe(false);

    // Grid cell released.
    expect(await accountExists(ctx.svm, locationPda)).toBe(false);

    // City active-encounter counter decremented.
    const cityAfterCleanup = await fetchCity(ctx.svm, ctx.gameEngine, cityId);
    expect(Number(cityAfterCleanup!.activeEncounters)).toBe(activeAfterSpawn - 1);
  });

  it('cleans up a killed encounter (grid cell already closed by combat)', async () => {
    // High-latitude city so a 1-cell longitude offset is within attack range.
    const cityId = 15;
    const player = await factory.createPlayer({
      cityId,
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks, BuildingType.Market],
    });
    // Enough units + weapons to one-shot a Common encounter.
    await factory.hireUnits(player, 0, 50000);
    await factory.purchaseEquipment(player, 0, 50);

    const city = CITIES[cityId]!;
    const gridLat = Math.round(city.lat * GRID_PRECISION);
    const gridLong = Math.round(city.lon * GRID_PRECISION) + 1;

    const spawnIx = await createSpawnEncounterInstruction(
      {
        gameEngine: ctx.gameEngine,
        payer: ctx.daoAuthority.publicKey,
        playerOwner: ctx.daoAuthority.publicKey,
        cityId,
        gridLat,
        gridLong,
        encounterIndex: 0,
      },
      { encounterType: EncounterRarity.Common }
    );
    await sendTransaction(ctx.svm, new Transaction().add(spawnIx), [ctx.daoAuthority]);

    const [encounterPda] = await deriveEncounterPda(ctx.gameEngine, cityId, 0);
    const [locationPda] = await deriveLocationPda(ctx.gameEngine, cityId, gridLat, gridLong);

    const cityAfterSpawn = await fetchCity(ctx.svm, ctx.gameEngine, cityId);
    const activeAfterSpawn = Number(cityAfterSpawn!.activeEncounters);

    // Kill the encounter — combat closes its grid cell on death.
    const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
    const [lootPda] = await deriveLootPda(player.playerPda, Number(playerBefore!.lootCounter));
    const attackIx = await createAttackEncounterInstruction(
      {
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        encounter: encounterPda,
        loot: lootPda,
        encounterLocation: locationPda,
        locationCreatorRefund: ctx.daoAuthority.publicKey,
      },
      { encounterId: 0 }
    );
    await sendTransaction(ctx.svm, new Transaction().add(attackIx), [player.keypair]);

    // Encounter is dead (account still present) and its grid cell is closed.
    const killed = await fetchEncounter(ctx.svm, encounterPda);
    expect(killed).not.toBeNull();
    expect(Number(killed!.health)).toBe(0);
    expect(await accountExists(ctx.svm, locationPda)).toBe(false);

    // Advance past despawn_at + grace, then clean up. The cell is already
    // closed, so rent falls back to the kingdom authority.
    await advanceTime(ctx.svm, COMMON_DESPAWN_SECONDS + CLEANUP_GRACE_SECONDS + 60);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createCleanupEncounterInstruction({
          gameEngine: ctx.gameEngine,
          cityId,
          encounterIndex: 0,
          gridLat,
          gridLong,
          rentRecipient: ctx.daoAuthority.publicKey, // game engine authority
        })
      ),
      [ctx.daoAuthority]
    );

    // Encounter account closed, city counter decremented.
    expect(await fetchEncounter(ctx.svm, encounterPda)).toBeNull();
    const cityAfterCleanup = await fetchCity(ctx.svm, ctx.gameEngine, cityId);
    expect(Number(cityAfterCleanup!.activeEncounters)).toBe(activeAfterSpawn - 1);
  });

  it('rejects a second cleanup of an already-closed encounter', async () => {
    // Reuse city 13's now-closed encounter from the previous test.
    const cityId = 13;
    const city = CITIES[cityId]!;
    const gridLat = Math.round(city.lat * GRID_PRECISION);
    const gridLong = Math.round(city.lon * GRID_PRECISION) + 1;

    // The encounter PDA no longer holds an account — cleanup must fail, not
    // silently succeed or double-decrement the city counter.
    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(await cleanupIx(cityId, 0, gridLat, gridLong)),
      [ctx.daoAuthority],
      undefined,
      'double cleanup'
    );
  });
});
