/**
 * Player Lifecycle E2E Tests
 *
 * Tests for player initialization and lifecycle:
 * - Initialize new player
 * - Starter resources
 * - New player protection
 * - Duplicate initialization rejection
 * - Invalid city rejection
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { generateKeyPairSigner, isAddress, lamports } from '@solana/kit';

import {
  createInitPlayerInstruction,
  derivePlayerPda,
  deriveCityPda,
  deserializePlayer,
  TravelType,
  SubscriptionTier,
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
  assertPlayerLocation,
  assertPlayerProtected,
  assertPlayerNotProtected,
  assertPlayerHasNoTeam,
  assertPlayerLevel,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import { log } from '../utils/logger';
import {
  fetchPlayer,
} from '../utils/accounts';
import {
  getCurrentTimestamp,
  SECONDS_PER_DAY,
} from '../fixtures/time';

// Test Suite

describe('Player Lifecycle', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Player Lifecycle');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: false });
  });

  afterAll(() => {
    factory.clear();
  });

  // Initialization Tests

  describe('Initialization', () => {
    it('should initialize a new player in city 1', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      // Verify player now exists
      const postFetch = await fetchPlayer(ctx.svm, player.playerPda);
      expect(postFetch).not.toBeNull();

      // Verify basic state
      expect(postFetch!.owner === player.publicKey).toBe(true);
      assertPlayerLocation(postFetch!, 1);
      assertPlayerLevel(postFetch!, 1);
    });

    it('should initialize a new player in city 2', async () => {
      const player = await factory.createPlayer({
        cityId: 2,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerLocation(account!, 2);
    });

    it('should initialize a new player in city 3', async () => {
      const player = await factory.createPlayer({
        cityId: 3,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerLocation(account!, 3);
    });

    it('should reject duplicate player initialization', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      // Try to initialize again
      const ix = await createInitPlayerInstruction({
        owner: player.publicKey,
        gameEngine: ctx.gameEngine,
        startingCityId: 1,
        cityLatitude: CITIES[0]!.lat,
        cityLongitude: CITIES[0]!.lon,
      });

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [player.keypair]);
    });

    it('should reject initialization with invalid city', async () => {
      const keypair = await generateKeyPairSigner();
      const [playerPda] = await derivePlayerPda(ctx.gameEngine, keypair.address);

      // Airdrop some SOL
      ctx.svm.airdrop(keypair.address, lamports(BigInt(1_000_000_000)));

      // Try to initialize with non-existent city (999)
      const ix = await createInitPlayerInstruction({
        owner: keypair.address,
        gameEngine: ctx.gameEngine,
        startingCityId: 999,
        cityLatitude: 0,
        cityLongitude: 0,
      });

      const tx = [ix];
      await expectTransactionToFail(ctx.svm, tx, [keypair]);
    });
  });

  // Starter Resources Tests

  describe('Starter Resources', () => {
    it('should grant starter locked NOVI', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Rookie tier starts with 100 locked NOVI (stored as 1000 with 1 decimal)
      assertBnGreaterThan(account!.lockedNovi, 0, 'Should have starter NOVI');
    });

    it('should grant starter defensive units', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Should have starter defensive units
      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have defensive unit 1');
    });

    it('should grant starter operative units', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Should have starter operative units
      assertBnGreaterThan(account!.operativeUnit1, 0, 'Should have operative unit 1');
    });

    it('should grant starter equipment', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Should have starter melee weapons
      assertBnGreaterThan(account!.meleeWeapons, 0, 'Should have melee weapons');
      // Should have starter ranged weapons
      assertBnGreaterThan(account!.rangedWeapons, 0, 'Should have ranged weapons');
      // Should have starter armor
      assertBnGreaterThan(account!.armorPieces, 0, 'Should have armor');
    });

    it('should grant starter produce', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.produce, 0, 'Should have produce');
    });

    it('should grant starter cash', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.cashOnHand, 0, 'Should have cash on hand');
    });

    it('should start at level 1', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerLevel(account!, 1);
    });

    it('should start with Rookie subscription tier', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Rookie);
    });

    it('should start with no team', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerHasNoTeam(account!);
    });

    it('should start not traveling', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.None);
    });
  });

  // New Player Protection Tests

  describe('New Player Protection', () => {
    it('should have 24-hour protection', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      const currentTime = await getCurrentTimestamp(ctx.svm);
      assertPlayerProtected(account!, currentTime);

      // Protection should be set for ~24 hours in the future
      const protectionEnd = Number(account!.newPlayerProtectionUntil);
      const expectedEnd = currentTime + SECONDS_PER_DAY;

      // Allow some tolerance (within 1 hour)
      expect(protectionEnd).toBeGreaterThan(currentTime);
      expect(protectionEnd).toBeLessThanOrEqual(expectedEnd + 3600);
    });

    it('should identify expired protection', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Check with a future timestamp (after protection expires)
      const futureTime = await getCurrentTimestamp(ctx.svm) + SECONDS_PER_DAY * 2;
      assertPlayerNotProtected(account!, futureTime);
    });
  });

  // Player State Tests

  describe('Player State', () => {
    it('should have correct owner set', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.owner === player.publicKey).toBe(true);
    });

    it('should have valid creation timestamp', async () => {
      const beforeTime = await getCurrentTimestamp(ctx.svm);

      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const afterTime = await getCurrentTimestamp(ctx.svm);
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      const createdAt = Number(account!.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(beforeTime - 10);
      expect(createdAt).toBeLessThanOrEqual(afterTime + 10);
    });

    it('should have initial stamina', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Should have some initial stamina
      assertBnGreaterThan(account!.encounterStamina, 0, 'Should have initial stamina');
      // Should have max stamina set
      assertBnGreaterThan(account!.maxEncounterStamina, 0, 'Should have max stamina');
    });

    it('should have bump stored', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Bump should be a valid value (usually 250-255)
      expect(account!.bump).toBeGreaterThan(0);
      expect(account!.bump).toBeLessThanOrEqual(255);
    });

    it('should have version set', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Version should be set (usually 1 for new accounts)
      expect(account!.version).toBeGreaterThanOrEqual(1);
    });
  });

  // PDA Derivation Tests

  describe('PDA Derivation', () => {
    it('should derive correct player PDA', async () => {
      const keypair = await generateKeyPairSigner();
      const [derivedPda, bump] = await derivePlayerPda(ctx.gameEngine, keypair.address);

      // PDA should be a well-formed address
      expect(isAddress(derivedPda)).toBe(true);
      expect(bump).toBeGreaterThanOrEqual(0);

      // Same owner should always derive same PDA
      const [derivedPda2] = await derivePlayerPda(ctx.gameEngine, keypair.address);
      expect(derivedPda === derivedPda2).toBe(true);
    });

    it('should derive different PDAs for different owners', async () => {
      const keypair1 = await generateKeyPairSigner();
      const keypair2 = await generateKeyPairSigner();

      const [pda1] = await derivePlayerPda(ctx.gameEngine, keypair1.address);
      const [pda2] = await derivePlayerPda(ctx.gameEngine, keypair2.address);

      expect(pda1 === pda2).toBe(false);
    });

    it('should derive correct city PDA', async () => {
      for (const city of CITIES) {
        const [cityPda] = await deriveCityPda(ctx.gameEngine, city.id);
        expect(isAddress(cityPda)).toBe(true);

        // Verify it matches what we stored in context
        const storedPda = ctx.cities.get(city.id);
        expect(storedPda).toBeDefined();
        expect(cityPda === storedPda!).toBe(true);
      }
    });
  });
});
