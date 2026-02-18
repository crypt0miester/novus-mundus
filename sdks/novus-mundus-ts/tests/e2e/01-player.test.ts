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
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

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

// ============================================================
// Test Suite
// ============================================================

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

  // ============================================================
  // Initialization Tests
  // ============================================================

  describe('Initialization', () => {
    it('should initialize a new player in city 1', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      // Verify player now exists
      const postFetch = await fetchPlayer(ctx.connection, player.playerPda);
      expect(postFetch).not.toBeNull();

      // Verify basic state
      expect(postFetch!.owner.equals(player.publicKey)).toBe(true);
      assertPlayerLocation(postFetch!, 1);
      assertPlayerLevel(postFetch!, 1);
    });

    it('should initialize a new player in city 2', async () => {
      const player = await factory.createPlayer({
        cityId: 2,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerLocation(account!, 2);
    });

    it('should initialize a new player in city 3', async () => {
      const player = await factory.createPlayer({
        cityId: 3,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerLocation(account!, 3);
    });

    it('should reject duplicate player initialization', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      // Try to initialize again
      const ix = createInitPlayerInstruction({
        owner: player.publicKey,
        gameEngine: ctx.gameEngine,
        startingCityId: 1,
        cityLatitude: CITIES[0]!.lat,
        cityLongitude: CITIES[0]!.lon,
      });

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [player.keypair]);
    });

    it('should reject initialization with invalid city', async () => {
      const keypair = Keypair.generate();
      const [playerPda] = derivePlayerPda(ctx.gameEngine, keypair.publicKey);

      // Airdrop some SOL
      const sig = await ctx.connection.requestAirdrop(
        keypair.publicKey,
        1_000_000_000
      );
      await ctx.connection.confirmTransaction(sig, 'confirmed');

      // Try to initialize with non-existent city (999)
      const ix = createInitPlayerInstruction({
        owner: keypair.publicKey,
        gameEngine: ctx.gameEngine,
        startingCityId: 999,
        cityLatitude: 0,
        cityLongitude: 0,
      });

      const tx = new Transaction().add(ix);
      await expectTransactionToFail(ctx.connection, tx, [keypair]);
    });
  });

  // ============================================================
  // Starter Resources Tests
  // ============================================================

  describe('Starter Resources', () => {
    it('should grant starter locked NOVI', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Rookie tier starts with 100 locked NOVI (stored as 1000 with 1 decimal)
      assertBnGreaterThan(account!.lockedNovi, 0, 'Should have starter NOVI');
    });

    it('should grant starter defensive units', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Should have starter defensive units
      assertBnGreaterThan(account!.defensiveUnit1, 0, 'Should have defensive unit 1');
    });

    it('should grant starter operative units', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Should have starter operative units
      assertBnGreaterThan(account!.operativeUnit1, 0, 'Should have operative unit 1');
    });

    it('should grant starter equipment', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
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

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.produce, 0, 'Should have produce');
    });

    it('should grant starter cash', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      assertBnGreaterThan(account!.cashOnHand, 0, 'Should have cash on hand');
    });

    it('should start at level 1', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerLevel(account!, 1);
    });

    it('should start with Rookie subscription tier', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Rookie);
    });

    it('should start with no team', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      assertPlayerHasNoTeam(account!);
    });

    it('should start not traveling', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.travelType).toBe(TravelType.None);
    });
  });

  // ============================================================
  // New Player Protection Tests
  // ============================================================

  describe('New Player Protection', () => {
    it('should have 24-hour protection', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      const currentTime = await getCurrentTimestamp(ctx.connection);
      assertPlayerProtected(account!, currentTime);

      // Protection should be set for ~24 hours in the future
      const protectionEnd = account!.newPlayerProtectionUntil.toNumber();
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

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Check with a future timestamp (after protection expires)
      const futureTime = await getCurrentTimestamp(ctx.connection) + SECONDS_PER_DAY * 2;
      assertPlayerNotProtected(account!, futureTime);
    });
  });

  // ============================================================
  // Player State Tests
  // ============================================================

  describe('Player State', () => {
    it('should have correct owner set', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.owner.equals(player.publicKey)).toBe(true);
    });

    it('should have valid creation timestamp', async () => {
      const beforeTime = await getCurrentTimestamp(ctx.connection);

      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const afterTime = await getCurrentTimestamp(ctx.connection);
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      const createdAt = account!.createdAt.toNumber();
      expect(createdAt).toBeGreaterThanOrEqual(beforeTime - 10);
      expect(createdAt).toBeLessThanOrEqual(afterTime + 10);
    });

    it('should have initial stamina', async () => {
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
      });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
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

      const account = await fetchPlayer(ctx.connection, player.playerPda);
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

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      // Version should be set (usually 1 for new accounts)
      expect(account!.version).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // PDA Derivation Tests
  // ============================================================

  describe('PDA Derivation', () => {
    it('should derive correct player PDA', async () => {
      const keypair = Keypair.generate();
      const [derivedPda, bump] = derivePlayerPda(ctx.gameEngine, keypair.publicKey);

      // PDA should be valid (off-curve)
      expect(PublicKey.isOnCurve(derivedPda.toBytes())).toBe(false);

      // Same owner should always derive same PDA
      const [derivedPda2] = derivePlayerPda(ctx.gameEngine, keypair.publicKey);
      expect(derivedPda.equals(derivedPda2)).toBe(true);
    });

    it('should derive different PDAs for different owners', async () => {
      const keypair1 = Keypair.generate();
      const keypair2 = Keypair.generate();

      const [pda1] = derivePlayerPda(ctx.gameEngine, keypair1.publicKey);
      const [pda2] = derivePlayerPda(ctx.gameEngine, keypair2.publicKey);

      expect(pda1.equals(pda2)).toBe(false);
    });

    it('should derive correct city PDA', async () => {
      for (const city of CITIES) {
        const [cityPda] = deriveCityPda(ctx.gameEngine, city.id);
        expect(PublicKey.isOnCurve(cityPda.toBytes())).toBe(false);

        // Verify it matches what we stored in context
        const storedPda = ctx.cities.get(city.id);
        expect(storedPda).toBeDefined();
        expect(cityPda.equals(storedPda!)).toBe(true);
      }
    });
  });
});
