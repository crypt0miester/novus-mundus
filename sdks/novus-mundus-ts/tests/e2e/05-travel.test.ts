/**
 * Travel System E2E Tests
 *
 * Tests for player movement:
 * - Intracity travel (within city)
 * - Intercity travel (between cities)
 * - Teleportation
 * - Travel cancellation
 * - Speedup mechanics
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  createIntracityCancelInstruction,
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntercityCancelInstruction,
  createIntercityTeleportInstruction,
  createTravelSpeedupInstruction,
  derivePlayerPda,
  deriveLocationPda,
  TravelType,
  BuildingType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
  CITIES,
} from '../fixtures/setup';
import {
  PlayerFactory,
  type TestPlayer,
} from '../fixtures/players';
import {
  assertBnEquals,
  assertBnGreaterThan,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
} from '../utils/accounts';
import { log } from '../utils/logger';
import {
  getCurrentTimestamp,
  advanceTime,
} from '../fixtures/time';

// Grid precision matching on-chain LocationAccount::GRID_PRECISION
const GRID_PRECISION = 10000.0;

/** Convert f64 coordinate to grid i32 (matching on-chain to_grid) */
function toGrid(coord: number): number {
  return Math.round(coord * GRID_PRECISION);
}

/** Helper to get origin location PDA from player account */
function getOriginLocationPda(gameEngine: PublicKey, cityId: number, currentLat: number, currentLong: number) {
  const originGridLat = toGrid(currentLat);
  const originGridLong = toGrid(currentLong);
  return deriveLocationPda(gameEngine, cityId, originGridLat, originGridLong);
}

/** Helper to speedup travel multiple times */
async function speedupTravel(
  connection: any,
  gameEngine: PublicKey,
  player: TestPlayer,
  times: number = 12
) {
  for (let i = 0; i < times; i++) {
    try {
      await sendTransaction(
        connection,
        new Transaction().add(
          createTravelSpeedupInstruction(
            { gameEngine, owner: player.publicKey },
            { speedupTier: 2 }
          )
        ),
        [player.keypair]
      );
    } catch {
      break;
    }
  }
}

// ============================================================
// Test Suite
// ============================================================

describe('Travel System', () => {
  setDefaultTimeout(120_000);

  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Travel System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // ============================================================
  // Intracity Travel Tests
  // ============================================================

  describe('Intracity Travel', () => {
    it('should start intracity travel', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;
      const destLat = city.lat + 0.005;
      const destLong = city.lon + 0.005;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(destLat), toGrid(destLong));

      const ix = createIntracityStartInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          cityId,
          originLocation,
          destinationLocation,
          originCreatorRefund: player.publicKey,
        },
        { destinationLat: destLat, destinationLong: destLong }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.Intracity);
    });

    it('should complete intracity travel after speedup', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;
      // Use very short distance for quick travel time
      const destLat = city.lat + 0.0002;
      const destLong = city.lon + 0.0002;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(destLat), toGrid(destLong));

      // Start travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: destLat, destinationLong: destLong }
          )
        ),
        [player.keypair]
      );

      // Speedup to reduce travel time (use as many as gems allow)
      await speedupTravel(ctx.svm, ctx.gameEngine, player, 12);

      // Advance LiteSVM clock past arrival time
      await advanceTime(ctx.svm, 5);

      // Complete travel
      const completeIx = createIntracityCompleteInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        cityId,
        destinationLocation,
      });
      await sendTransaction(ctx.svm, new Transaction().add(completeIx), [player.keypair]);

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.None);
    });

    it('should reject travel while already traveling', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const dest1Lat = city.lat + 0.008;
      const dest1Long = city.lon + 0.008;
      const dest2Lat = city.lat - 0.008;
      const dest2Long = city.lon - 0.008;
      const [destinationLocation1] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(dest1Lat), toGrid(dest1Long));
      const [destinationLocation2] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(dest2Lat), toGrid(dest2Long));

      // Start first travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation: destinationLocation1,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: dest1Lat, destinationLong: dest1Long }
          )
        ),
        [player.keypair]
      );

      // Try to start second travel — should fail (AlreadyTraveling)
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation: destinationLocation2,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: dest2Lat, destinationLong: dest2Long }
          )
        ),
        [player.keypair]
      );
    });

    it('should reject complete before travel finishes', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;
      const destLat = city.lat + 0.05;
      const destLong = city.lon + 0.05;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(destLat), toGrid(destLong));

      // Start travel to far location
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: destLat, destinationLong: destLong }
          )
        ),
        [player.keypair]
      );

      // Immediately try to complete — should fail (TravelNotComplete)
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntracityCompleteInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            cityId,
            destinationLocation,
          })
        ),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Intercity Travel Tests
  // ============================================================

  describe('Intercity Travel', () => {
    it('should start intercity travel', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const targetCityId = 2;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[targetCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, targetCityId, destGridLat, destGridLong);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.Intercity);
      expect(account!.destinationCity).toBe(targetCityId);
    });

    it('should complete intercity travel after speedup', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const targetCityId = 3;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[targetCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, targetCityId, destGridLat, destGridLong);

      // Start travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Speedup travel repeatedly
      await speedupTravel(ctx.svm, ctx.gameEngine, player, 12);

      // Advance LiteSVM clock past arrival time
      await advanceTime(ctx.svm, 5);

      // Complete
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityCompleteInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            destinationLocation,
          })
        ),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.None);
      expect(account!.currentCity).toBe(targetCityId);
    });

    it('should cancel intercity travel and reverse direction', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const destinationCityId = 4;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[destinationCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, destinationCityId, destGridLat, destGridLong);

      // Return location is at origin city CENTER (not player's original position)
      const originCity = CITIES[originCityId]!;
      const [returnLocation] = deriveLocationPda(ctx.gameEngine, originCityId, toGrid(originCity.lat), toGrid(originCity.lon));

      // Start travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Verify traveling to destination
      let account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.Intercity);
      expect(account!.destinationCity).toBe(destinationCityId);

      // Cancel intercity travel — player enters return journey to origin city
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityCancelInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId,
            originLocation: returnLocation,
            destinationLocation,
            destinationCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // After cancel, player is on return journey — destination_city is now origin_city
      account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.destinationCity).toBe(originCityId);
    });

    it('should reject intercity travel to same city', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[cityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, destGridLat, destGridLong);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId: cityId,
            destinationCityId: cityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );
    });

    it('should reject intercity travel to invalid city', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const invalidCityId = 999;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, invalidCityId, 0, 0);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: invalidCityId,
            destGridLat: 0,
            destGridLong: 0,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Teleportation Tests
  // ============================================================

  describe('Teleportation', () => {
    it('should teleport between cities instantly', async () => {
      // Teleport requires EXT_INVENTORY (unlocked via estate/shop) + Stables Lv 10
      // Stables is Tier 2 (50k base), upgrade cost scales as base×2.618^level → ~467M NOVI total for Lv 10
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      await factory.fundNovi(player, 500_000_000); // Fund 500M NOVI for expensive upgrades
      await factory.upgradeAndCompleteBuilding(player, BuildingType.Stables, 10);
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const targetCityId = 5;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[targetCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, targetCityId, destGridLat, destGridLong);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityTeleportInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            originLocation,
            destinationLocation,
          })
        ),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.None);
      expect(account!.currentCity).toBe(targetCityId);
    });

    it('should fail teleport without required extension', async () => {
      // Player without estate/shop — no EXT_INVENTORY
      const player = await factory.createPlayer({ cityId: 1, initialize: true });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const targetCityId = 2;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[targetCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, targetCityId, destGridLat, destGridLong);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntercityTeleportInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            originLocation,
            destinationLocation,
          })
        ),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Speedup Tests
  // ============================================================

  describe('Travel Speedup', () => {
    it('should speedup ongoing intercity travel', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const destinationCityId = 6;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[destinationCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, destinationCityId, destGridLat, destGridLong);

      // Start intercity travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Verify traveling
      let account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.Intercity);

      // Apply speedup
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createTravelSpeedupInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { speedupTier: 2 }
          )
        ),
        [player.keypair]
      );

      // Verify still traveling (speedup reduces time, doesn't complete)
      account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.Intercity);
    });

    it('should reject speedup when not traveling', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createTravelSpeedupInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { speedupTier: 2 }
          )
        ),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Travel State Tests
  // ============================================================

  describe('Travel State', () => {
    it('should track travel departure time', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;
      const destLat = city.lat + 0.015;
      const destLong = city.lon + 0.015;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(destLat), toGrid(destLong));

      const beforeTime = await getCurrentTimestamp(ctx.svm);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: destLat, destinationLong: destLong }
          )
        ),
        [player.keypair]
      );

      const afterTime = await getCurrentTimestamp(ctx.svm);
      const account = await fetchPlayer(ctx.svm, player.playerPda);

      expect(account).not.toBeNull();
      const departureTime = account!.departureTime.toNumber();
      expect(departureTime).toBeGreaterThanOrEqual(beforeTime - 10);
      expect(departureTime).toBeLessThanOrEqual(afterTime + 10);
    });

    it('should store destination info during intracity travel', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;
      const destLat = city.lat + 0.006;
      const destLong = city.lon - 0.003;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(destLat), toGrid(destLong));

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: destLat, destinationLong: destLong }
          )
        ),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.Intracity);
      // Departure and arrival should be set
      expect(account!.departureTime.toNumber()).toBeGreaterThan(0);
      expect(account!.arrivalTime.toNumber()).toBeGreaterThan(account!.departureTime.toNumber());
    });
  });

  // ============================================================
  // Intracity Cancel Tests
  // ============================================================

  describe('Intracity Cancel', () => {
    it('should cancel intracity travel and return to origin', async () => {
      // Use city 11 to avoid collision with other tests
      const player = await factory.createPlayer({ cityId: 11, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 11;
      const city = CITIES[cityId]!;

      const originLat = playerAccount!.currentLat;
      const originLong = playerAccount!.currentLong;
      const originGridLat = toGrid(originLat);
      const originGridLong = toGrid(originLong);
      const [originLocation] = deriveLocationPda(ctx.gameEngine, cityId, originGridLat, originGridLong);

      const destLat = city.lat + 0.02;
      const destLong = city.lon + 0.02;
      const destGridLat = toGrid(destLat);
      const destGridLong = toGrid(destLong);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, destGridLat, destGridLong);

      // Start intracity travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: destLat, destinationLong: destLong }
          )
        ),
        [player.keypair]
      );

      // Verify player is traveling
      let account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.Intracity);

      // Return location is the origin location PDA (re-reserved on cancel)
      const [returnLocation] = deriveLocationPda(ctx.gameEngine, cityId, originGridLat, originGridLong);

      // Cancel travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityCancelInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            cityId,
            originLocation: returnLocation,
            destinationLocation,
            destinationCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Speedup the return journey
      await speedupTravel(ctx.svm, ctx.gameEngine, player, 10);

      // Advance LiteSVM clock past arrival time
      await advanceTime(ctx.svm, 5);

      // Complete the return (intracity complete at origin)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityCompleteInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            cityId,
            destinationLocation: returnLocation,
          })
        ),
        [player.keypair]
      );

      // Verify player is back at origin, not traveling
      account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.None);
      expect(account!.currentCity).toBe(cityId);
    });
  });

  // ============================================================
  // Travel Restrictions Tests
  // ============================================================

  describe('Travel Restrictions', () => {
    it('should prevent starting second travel while already traveling', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const cityId = 1;
      const city = CITIES[cityId]!;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, cityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destLat = city.lat + 0.012;
      const destLong = city.lon + 0.012;
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, cityId, toGrid(destLat), toGrid(destLong));

      // Start intracity travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntracityStartInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              cityId,
              originLocation,
              destinationLocation,
              originCreatorRefund: player.publicKey,
            },
            { destinationLat: destLat, destinationLong: destLong }
          )
        ),
        [player.keypair]
      );

      // Verify traveling
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).not.toBe(TravelType.None);

      // Try to start intercity travel while already traveling — should fail
      const destCity2 = CITIES[2]!;
      const destGridLat2 = toGrid(destCity2.lat);
      const destGridLong2 = toGrid(destCity2.lon);
      const [originLocation2] = getOriginLocationPda(ctx.gameEngine, cityId, account!.currentLat, account!.currentLong);
      const [destinationLocation2] = deriveLocationPda(ctx.gameEngine, 2, destGridLat2, destGridLong2);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId: cityId,
            destinationCityId: 2,
            destGridLat: destGridLat2,
            destGridLong: destGridLong2,
            originLocation: originLocation2,
            destinationLocation: destinationLocation2,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );
    });

    it('should require Stables building for intercity travel', async () => {
      // Player without Stables should fail intercity travel
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const targetCityId = 2;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[targetCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, targetCityId, destGridLat, destGridLong);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );
    });

    it('should allow intercity travel with Stables', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const targetCityId = 13; // Use city 13 to avoid CellOccupied collision with other tests using city 2

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[targetCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, targetCityId, destGridLat, destGridLong);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: targetCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.Intercity);
    });

    it('should verify new player has encounter stamina', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true });
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertBnGreaterThan(account!.encounterStamina, 0, 'New player should have encounter stamina');
    });
  });

  // ============================================================
  // Multi-city Tests
  // ============================================================

  describe('Multi-city Travel', () => {
    it('should travel between cities with start cancel complete start pattern', async () => {
      // Use city 10 as origin to avoid return-location collision with other tests
      const player = await factory.createPlayer({ cityId: 10, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 10;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);

      const destCity7 = CITIES[7]!;
      const destGridLat7 = toGrid(destCity7.lat);
      const destGridLong7 = toGrid(destCity7.lon);
      const [destinationLocation7] = deriveLocationPda(ctx.gameEngine, 7, destGridLat7, destGridLong7);

      // Return location is at origin city CENTER
      const originCity = CITIES[originCityId]!;
      const [returnLocation] = deriveLocationPda(ctx.gameEngine, originCityId, toGrid(originCity.lat), toGrid(originCity.lon));

      const destCity8 = CITIES[8]!;
      const destGridLat8 = toGrid(destCity8.lat);
      const destGridLong8 = toGrid(destCity8.lon);
      const [destinationLocation8] = deriveLocationPda(ctx.gameEngine, 8, destGridLat8, destGridLong8);

      // Start travel to city 7
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: 7,
            destGridLat: destGridLat7,
            destGridLong: destGridLong7,
            originLocation,
            destinationLocation: destinationLocation7,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Cancel — player enters return journey to origin
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityCancelInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: 7,
            originLocation: returnLocation,
            destinationLocation: destinationLocation7,
            destinationCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Speedup return journey to ensure it completes quickly
      await speedupTravel(ctx.svm, ctx.gameEngine, player, 10);

      // Advance LiteSVM clock past arrival time
      await advanceTime(ctx.svm, 5);

      // Complete the return journey
      // After cancel: origin_city=1, destination_city=1 (set by cancel to origin)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityCompleteInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: originCityId,
            destinationLocation: returnLocation,
          })
        ),
        [player.keypair]
      );

      // Verify back in origin city, not traveling
      let account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.travelType).toBe(TravelType.None);
      expect(account!.currentCity).toBe(originCityId);

      // Now start travel to city 8
      // After completing return, player is at origin city center
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId: 8,
            destGridLat: destGridLat8,
            destGridLong: destGridLong8,
            originLocation: returnLocation,
            destinationLocation: destinationLocation8,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.destinationCity).toBe(8);
      expect(account!.travelType).toBe(TravelType.Intercity);
    });

    it('should arrive in destination city with correct position', async () => {
      const player = await factory.createPlayer({ cityId: 1, initialize: true, createEstate: true, buildings: [BuildingType.Stables] });
      const playerAccount = await fetchPlayer(ctx.svm, player.playerPda);
      const originCityId = 1;
      const destinationCityId = 9;

      const [originLocation] = getOriginLocationPda(ctx.gameEngine, originCityId, playerAccount!.currentLat, playerAccount!.currentLong);
      const destCity = CITIES[destinationCityId]!;
      const destGridLat = toGrid(destCity.lat);
      const destGridLong = toGrid(destCity.lon);
      const [destinationLocation] = deriveLocationPda(ctx.gameEngine, destinationCityId, destGridLat, destGridLong);

      // Start intercity travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityStartInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId,
            destGridLat,
            destGridLong,
            originLocation,
            destinationLocation,
            originCreatorRefund: player.publicKey,
          })
        ),
        [player.keypair]
      );

      // Speedup travel
      await speedupTravel(ctx.svm, ctx.gameEngine, player, 12);

      // Advance LiteSVM clock past arrival time
      await advanceTime(ctx.svm, 5);

      // Complete travel
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createIntercityCompleteInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            originCityId,
            destinationCityId,
            destinationLocation,
          })
        ),
        [player.keypair]
      );

      // Verify position in new city
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.currentCity).toBe(destinationCityId);
      expect(account!.travelType).toBe(TravelType.None);
    });
  });
});
