/**
 * 23 - Terrain Tests
 *
 * Tests for set_terrain (instruction 7) and append_terrain (instruction 8).
 * Verifies terrain data is written to city accounts and that
 * multi-transaction terrain building works via append.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair } from '@solana/web3.js';

import {
  createSetTerrainInstruction,
  createAppendTerrainInstruction,
  type CityTerrain,
  type Anchor,
  isPassable,
} from '../../src/index';
import { type TestContext, beforeAllTests, afterAllTests } from '../fixtures/setup';
import { sendInstruction, buildTransaction, sendTransaction, expectTransactionToFail } from '../utils/transactions';
import { fetchCity } from '../utils/accounts';

describe('Terrain', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await beforeAllTests();
  });

  afterAll(async () => {
    await afterAllTests();
  });

  // ============================================================
  // set_terrain (instruction 7)
  // ============================================================

  describe('set_terrain', () => {
    const TEST_CITY_ID = 0; // New York — already initialized by setup

    const NYC_TERRAIN: CityTerrain = {
      seed: 3045891723,
      waterLine: 88,
      peakLine: 240,
      anchorCount: 5,
      version: 1,
      anchors: [
        { x: -200, y: 150, mass: 78, lift: 180, pushX: 0, pushY: 0 },
        { x: -2000, y: 1500, mass: 82, lift: 180, pushX: 0, pushY: 0 },
        { x: 1500, y: 1200, mass: 85, lift: 175, pushX: 0, pushY: 0 },
        { x: 2000, y: -2500, mass: 210, lift: 50, pushX: 0, pushY: 2 },
        { x: 0, y: -3500, mass: 220, lift: 40, pushX: 0, pushY: 1 },
      ],
    };

    it('should set terrain on a city', async () => {
      const ix = createSetTerrainInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { cityId: TEST_CITY_ID, terrain: NYC_TERRAIN },
      );

      await sendInstruction(ctx.svm, ix, [ctx.daoAuthority], { _label: 'set_terrain' });

      // Verify the terrain was written
      const city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city).not.toBeNull();
      expect(city!.terrainSeed).toBe(NYC_TERRAIN.seed);
      expect(city!.waterLine).toBe(NYC_TERRAIN.waterLine);
      expect(city!.peakLine).toBe(NYC_TERRAIN.peakLine);
      expect(city!.anchorCount).toBe(NYC_TERRAIN.anchors.length);
      expect(city!.terrainVersion).toBe(1);
      expect(city!.anchors.length).toBe(NYC_TERRAIN.anchors.length);

      // Verify individual anchors
      for (let i = 0; i < NYC_TERRAIN.anchors.length; i++) {
        expect(city!.anchors[i].x).toBe(NYC_TERRAIN.anchors[i].x);
        expect(city!.anchors[i].y).toBe(NYC_TERRAIN.anchors[i].y);
        expect(city!.anchors[i].mass).toBe(NYC_TERRAIN.anchors[i].mass);
        expect(city!.anchors[i].lift).toBe(NYC_TERRAIN.anchors[i].lift);
        expect(city!.anchors[i].pushX).toBe(NYC_TERRAIN.anchors[i].pushX);
        expect(city!.anchors[i].pushY).toBe(NYC_TERRAIN.anchors[i].pushY);
      }
    });

    it('should verify city center is passable land', async () => {
      const city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city).not.toBeNull();

      const terrain: CityTerrain = {
        seed: city!.terrainSeed,
        waterLine: city!.waterLine,
        peakLine: city!.peakLine,
        anchorCount: city!.anchorCount,
        version: city!.terrainVersion,
        anchors: city!.anchors,
      };

      expect(isPassable(terrain, 0, 0)).toBe(true);
    });

    it('should verify ocean coordinates are impassable', async () => {
      const city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city).not.toBeNull();

      const terrain: CityTerrain = {
        seed: city!.terrainSeed,
        waterLine: city!.waterLine,
        peakLine: city!.peakLine,
        anchorCount: city!.anchorCount,
        version: city!.terrainVersion,
        anchors: city!.anchors,
      };

      // Far south — Atlantic Ocean (near heavy ocean anchor at (0, -3500))
      expect(isPassable(terrain, 0, -3500)).toBe(false);
    });

    it('should replace terrain with fewer anchors (shrink)', async () => {
      const smallerTerrain: CityTerrain = {
        seed: 42,
        waterLine: 90,
        peakLine: 245,
        anchorCount: 2,
        version: 1,
        anchors: [
          { x: -500, y: 0, mass: 80, lift: 180, pushX: 0, pushY: 0 },
          { x: 500, y: 0, mass: 220, lift: 40, pushX: 0, pushY: 0 },
        ],
      };

      const ix = createSetTerrainInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { cityId: TEST_CITY_ID, terrain: smallerTerrain },
      );

      await sendInstruction(ctx.svm, ix, [ctx.daoAuthority], { _label: 'set_terrain (shrink)' });

      const city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city!.anchorCount).toBe(2);
      expect(city!.terrainSeed).toBe(42);
      expect(city!.anchors.length).toBe(2);
    });

    it('should reject non-DAO signer', async () => {
      const fake = Keypair.generate();

      // Airdrop to fake signer so it can pay fees
      ctx.svm.airdrop(fake.publicKey, BigInt(1_000_000_000));

      const ix = createSetTerrainInstruction(
        { daoAuthority: fake.publicKey, gameEngine: ctx.gameEngine },
        { cityId: TEST_CITY_ID, terrain: NYC_TERRAIN },
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [fake], undefined, 'set_terrain (unauthorized)');
    });
  });

  // ============================================================
  // append_terrain (instruction 8)
  // ============================================================

  describe('append_terrain', () => {
    const TEST_CITY_ID = 1; // Los Angeles

    const BASE_TERRAIN: CityTerrain = {
      seed: 1234567890,
      waterLine: 85,
      peakLine: 240,
      anchorCount: 3,
      version: 1,
      anchors: [
        { x: 0, y: 0, mass: 80, lift: 180, pushX: 0, pushY: 0, moisture: 128 },
        { x: -2000, y: 1000, mass: 75, lift: 185, pushX: 0, pushY: 0, moisture: 128 },
        { x: 2000, y: -1000, mass: 200, lift: 55, pushX: 0, pushY: 0, moisture: 128 },
      ],
    };

    const EXTRA_ANCHORS: Anchor[] = [
      { x: -3000, y: -2000, mass: 210, lift: 45, pushX: 1, pushY: 1, moisture: 128 },
      { x: 3000, y: 2000, mass: 70, lift: 195, pushX: -1, pushY: -1, moisture: 128 },
    ];

    it('should set initial terrain, then append anchors', async () => {
      // Step 1: Set base terrain
      const setIx = createSetTerrainInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { cityId: TEST_CITY_ID, terrain: BASE_TERRAIN },
      );
      await sendInstruction(ctx.svm, setIx, [ctx.daoAuthority], { _label: 'set_terrain (base)' });

      // Verify base terrain
      let city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city!.anchorCount).toBe(3);

      // Step 2: Append additional anchors
      const appendIx = createAppendTerrainInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { cityId: TEST_CITY_ID, anchors: EXTRA_ANCHORS },
      );
      await sendInstruction(ctx.svm, appendIx, [ctx.daoAuthority], { _label: 'append_terrain' });

      // Verify all anchors are present
      city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city!.anchorCount).toBe(5); // 3 + 2
      expect(city!.anchors.length).toBe(5);

      // Original anchors are unchanged
      expect(city!.anchors[0].x).toBe(0);
      expect(city!.anchors[0].y).toBe(0);
      expect(city!.anchors[1].x).toBe(-2000);
      expect(city!.anchors[2].x).toBe(2000);

      // New anchors are appended
      expect(city!.anchors[3].x).toBe(-3000);
      expect(city!.anchors[3].y).toBe(-2000);
      expect(city!.anchors[3].mass).toBe(210);
      expect(city!.anchors[3].pushX).toBe(1);
      expect(city!.anchors[4].x).toBe(3000);
      expect(city!.anchors[4].y).toBe(2000);
      expect(city!.anchors[4].pushY).toBe(-1);

      // Header fields are unchanged
      expect(city!.terrainSeed).toBe(BASE_TERRAIN.seed);
      expect(city!.waterLine).toBe(BASE_TERRAIN.waterLine);
      expect(city!.peakLine).toBe(BASE_TERRAIN.peakLine);
      expect(city!.terrainVersion).toBe(1);
    });

    it('should allow multiple appends', async () => {
      const moreAnchors: Anchor[] = [
        { x: 1500, y: 1500, mass: 90, lift: 165, pushX: 0, pushY: 0, moisture: 128 },
      ];

      const ix = createAppendTerrainInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { cityId: TEST_CITY_ID, anchors: moreAnchors },
      );
      await sendInstruction(ctx.svm, ix, [ctx.daoAuthority], { _label: 'append_terrain (second)' });

      const city = await fetchCity(ctx.svm, ctx.gameEngine, TEST_CITY_ID);
      expect(city!.anchorCount).toBe(6); // 5 + 1
      expect(city!.anchors[5].x).toBe(1500);
      expect(city!.anchors[5].y).toBe(1500);
    });

    it('should reject append on city without terrain', async () => {
      // City 2 (Chicago) has no terrain set
      const ix = createAppendTerrainInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { cityId: 2, anchors: EXTRA_ANCHORS },
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [ctx.daoAuthority], undefined, 'append_terrain (no terrain)');
    });
  });
});
