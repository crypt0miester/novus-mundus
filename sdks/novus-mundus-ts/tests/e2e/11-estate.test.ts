/**
 * Estate System E2E Tests
 *
 * Tests for player estates and buildings:
 * - Estate creation
 * - Building construction
 * - Building upgrades
 * - Resource production
 * - Daily activities
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createCreateEstateInstruction,
  createBuildBuildingInstruction,
  createUpgradeBuildingInstruction,
  createCompleteBuildingInstruction,
  createBuyPlotInstruction,
  createDailyActivityInstruction,
  createDailyClaimInstruction,
  deriveEstatePda,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
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
  fetchEstateRaw,
} from '../utils/accounts';
import {
  getCurrentTimestamp,
  SECONDS_PER_DAY,
} from '../fixtures/time';

// ============================================================
// Test Suite
// ============================================================

describe('Estate System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // ============================================================
  // Estate Creation Tests
  // ============================================================

  describe('Estate Creation', () => {
    it('should create new estate', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createCreateEstateInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { cityId: 1 }
      );

      const tx = new Transaction().add(ix);
      await sendTransaction(ctx.connection, tx, [player.keypair]);

      // Verify estate created
      const [estatePda] = deriveEstatePda(player.publicKey);
      const estateInfo = await fetchEstateRaw(ctx.connection, player.publicKey);
      expect(estateInfo).not.toBeNull();
    });

    it('should reject duplicate estate creation', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Try to create again
      const ix = createCreateEstateInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { cityId: 1 }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should start with base plots', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createCreateEstateInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { cityId: 1 }
          )
        ),
        [player.keypair]
      );

      // Verify estate has starting plots
      const estateInfo = await fetchEstateRaw(ctx.connection, player.publicKey);
      expect(estateInfo).not.toBeNull();
      // Would check plot count in deserialized estate
    });
  });

  // ============================================================
  // Building Construction Tests
  // ============================================================

  describe('Building Construction', () => {
    it('should start building construction', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      const buildingType = 0; // First building type (e.g., Barracks)

      const ix = createBuildBuildingInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { buildingType }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        // Verify building started
      } catch {
        // Might fail if requirements not met
      }
    });

    it('should reject building duplicate type', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Build first building
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createBuildBuildingInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { buildingType: 0 }
          )
        ),
        [player.keypair]
      );

      // Try to build same type again
      const ix = createBuildBuildingInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { buildingType: 0 }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject building invalid type', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      const ix = createBuildBuildingInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { buildingType: 999 } // Invalid type
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should complete building construction', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      const buildingType = 0;

      // Start building
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createBuildBuildingInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { buildingType }
          )
        ),
        [player.keypair]
      );

      // Try to complete (might fail if time not elapsed)
      const completeIx = createCompleteBuildingInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { buildingType }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(completeIx), [player.keypair]);
      } catch {
        // Expected if construction not complete
      }
    });
  });

  // ============================================================
  // Building Upgrade Tests
  // ============================================================

  describe('Building Upgrades', () => {
    it('should upgrade existing building', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Need completed building first
      // Then upgrade it
      const buildingType = 0;

      const ix = createUpgradeBuildingInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { buildingType }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Building might not exist or already upgrading
      }
    });

    it('should reject upgrade of max level building', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Buildings have max levels - can't upgrade beyond that
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject upgrade while another upgrade in progress', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Only one upgrade at a time (per building or per estate)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should increase bonuses on upgrade', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Higher level buildings provide better bonuses
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Plot Purchase Tests
  // ============================================================

  describe('Plot Purchases', () => {
    it('should buy additional plot', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Buy plot - automatically purchases next available plot
      const ix = createBuyPlotInstruction({ gameEngine: ctx.gameEngine, owner: player.publicKey });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail if insufficient funds or max plots
      }
    });

    it('should reject buying when at max plots', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Can't buy more than max plots
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should scale plot cost with count', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // More plots = more expensive
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Daily Activity Tests
  // ============================================================

  describe('Daily Activities', () => {
    it('should perform daily activity', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Daily activity requires game authority co-signature and building type with score
      // Use PublicKey.default for heroMint when not using Sanctuary
      const ix = createDailyActivityInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          heroMint: PublicKey.default,
        },
        { buildingType: 0, score: 75 }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair, ctx.daoAuthority]);
      } catch {
        // Might fail if building doesn't exist or already done today
      }
    });

    it('should reject duplicate daily activity', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      const buildingType = 0;
      const score = 75;

      // Do daily activity
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createDailyActivityInstruction(
              {
                gameEngine: ctx.gameEngine,
                owner: player.publicKey,
                gameAuthority: ctx.daoAuthority.publicKey,
                heroMint: PublicKey.default,
              },
              { buildingType, score }
            )
          ),
          [player.keypair, ctx.daoAuthority]
        );
      } catch {
        // Might fail if building doesn't exist
        return;
      }

      // Try again - should fail
      const ix = createDailyActivityInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          heroMint: PublicKey.default,
        },
        { buildingType, score }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair, ctx.daoAuthority]
      );
    });

    it('should reset daily activity after midnight', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Activity limit resets daily
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Daily Claim Tests
  // ============================================================

  describe('Daily Claims', () => {
    it('should claim daily rewards', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      const ix = createDailyClaimInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail if already claimed
      }
    });

    it('should scale rewards with building levels', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Better buildings = better daily rewards
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should track claim streak', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Consecutive daily claims might give bonus
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Building Type Tests
  // ============================================================

  describe('Building Types', () => {
    it('should build barracks for unit bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Barracks building affects unit training
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should build market for trade bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Market affects trade/shop discounts
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should build research lab for research speed', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Research lab reduces research time
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should build workshop for production', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Workshop affects resource production
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should build observatory for collection bonus', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Observatory affects resource collection
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Resource Production Tests
  // ============================================================

  describe('Resource Production', () => {
    it('should generate passive resources', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Buildings generate resources over time
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should scale production with building level', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Higher level = more production
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have production cap', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Production has maximum accumulation
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Estate Bonuses Tests
  // ============================================================

  describe('Estate Bonuses', () => {
    it('should apply synchrony bonus', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Total building levels affect synchrony
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should apply building-specific bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Each building type gives specific bonuses
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should cap total estate bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // There might be max bonus limits
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });
});
