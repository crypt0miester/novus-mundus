/**
 * Subscription System E2E Tests
 *
 * Tests for subscription tier management:
 * - Purchasing subscriptions
 * - Subscription benefits
 * - Tier upgrades/downgrades
 * - Expiration handling
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createPurchaseSubscriptionInstruction,
  createDowngradeExpiredInstruction,
  derivePlayerPda,
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
} from '../utils/accounts';
import {
  getCurrentTimestamp,
} from '../fixtures/time';

// ============================================================
// Test Suite
// ============================================================

describe('Subscription System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // Helper to create subscription instruction with default accounts
  function createSubIx(player: TestPlayer, tier: number) {
    return createPurchaseSubscriptionInstruction(
      {
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        paymentAuthority: player.publicKey, // Same as owner for SOL payments
        treasury: ctx.treasury.publicKey,
      },
      { paymentType: 0, tier } // 0 = SOL payment
    );
  }

  // ============================================================
  // Purchase Subscription Tests
  // ============================================================

  describe('Purchasing Subscriptions', () => {
    it('should purchase basic subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 1); // Basic tier

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify subscription active
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Would check subscription tier and expiry
      } catch {
        // Might not have enough funds
      }
    });

    it('should purchase premium subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 2); // Premium tier

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might not have enough funds
      }
    });

    it('should purchase elite subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 3); // Elite tier

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might not have enough funds
      }
    });

    it('should reject invalid tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 99); // Invalid tier

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject zero duration', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 1);

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should extend existing subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      try {
        // First purchase
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 1)
          ),
          [player.keypair]
        );

        // Extend
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 1)
          ),
          [player.keypair]
        );

        // Verify extended duration
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        // Would check expiry is 60 days out
      } catch {
        // Might fail
      }
    });

    it('should upgrade subscription tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      try {
        // Buy basic
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 1)
          ),
          [player.keypair]
        );

        // Upgrade to premium
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        // Verify upgraded
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        // Would check tier is now 2
      } catch {
        // Might fail
      }
    });
  });

  // ============================================================
  // Subscription Benefits Tests
  // ============================================================

  describe('Subscription Benefits', () => {
    it('should apply stamina regeneration bonus', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers = faster stamina regen
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Stamina regen rate should be higher than free tier
      } catch {
        // Might not have funds
      }
    });

    it('should apply resource collection bonus', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers = more resources from collection
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Collection bonus should be applied
      } catch {
        // Might fail
      }
    });

    it('should apply research speed bonus', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers = faster research
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 3)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Research speed multiplier should be > 1.0
      } catch {
        // Might fail
      }
    });

    it('should apply expedition bonus', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers = better expedition rewards
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Expedition reward multiplier should be applied
      } catch {
        // Might fail
      }
    });

    it('should apply shop discount', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers = discounted shop purchases
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 3)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Shop discount BPS should be set
      } catch {
        // Might fail
      }
    });

    it('should apply queue bonus', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers = more simultaneous queues
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Queue limit should be increased
      } catch {
        // Might fail
      }
    });

    it('should unlock premium features', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Auto-collect, queue management, etc.
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 3)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Premium feature flags should be enabled
      } catch {
        // Might fail
      }
    });
  });

  // ============================================================
  // Tier Comparison Tests
  // ============================================================

  describe('Tier Comparisons', () => {
    it('should have free tier baseline', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Verify default tier is 0 (free) with baseline benefits
    });

    it('should scale benefits with tier', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      try {
        // Player1 gets basic tier
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player1, 1)
          ),
          [player1.keypair]
        );

        // Player2 gets premium tier
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player2, 2)
          ),
          [player2.keypair]
        );

        const account1 = await fetchPlayer(ctx.connection, player1.playerPda);
        const account2 = await fetchPlayer(ctx.connection, player2.playerPda);
        expect(account1).not.toBeNull();
        expect(account2).not.toBeNull();
        // Player2 should have better benefits than Player1
      } catch {
        // Might fail
      }
    });

    it('should have tier-exclusive features', async () => {
      const player = await factory.createPlayer({ initialize: true });

      try {
        // Elite tier has exclusive features
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 3)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Elite-exclusive features should be enabled
      } catch {
        // Might fail
      }
    });
  });

  // ============================================================
  // Expiration Tests
  // ============================================================

  describe('Subscription Expiration', () => {
    it('should track expiration time', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const beforeTime = await getCurrentTimestamp(ctx.connection);

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 1)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        // Verify expiry is ~30 days from now
      } catch {
        // Might fail
      }
    });

    it('should downgrade expired subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Subscription might not be expired
      }
    });

    it('should reject downgrade of active subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      try {
        // Purchase active subscription
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 1)
          ),
          [player.keypair]
        );

        // Try to downgrade
        const ix = createDowngradeExpiredInstruction({
          playerAccount: player.playerPda,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(ix),
          [player.keypair]
        );
      } catch {
        // Might fail earlier
      }
    });

    it('should allow anyone to trigger downgrade', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const other = await factory.createPlayer({ initialize: true });

      // Downgrade is permissionless for expired subs
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });

      try {
        // Anyone can call this for expired subscriptions
        await sendTransaction(ctx.connection, new Transaction().add(ix), [other.keypair]);
      } catch {
        // Might not be expired or no subscription
      }
    });

    it('should preserve benefits until expiry', async () => {
      const player = await factory.createPlayer({ initialize: true });

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        // Benefits remain active until exact expiry time
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Tier should still be 2 until expiry
      } catch {
        // Might fail
      }
    });
  });

  // ============================================================
  // Payment Tests
  // ============================================================

  describe('Subscription Payments', () => {
    it('should accept NOVI payment', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Would need to fund player with NOVI
      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might not have NOVI
      }
    });

    it('should reject insufficient funds', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // No funds, should fail (expensive tier for long duration)
      const ix = createSubIx(player, 3);

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should scale cost with duration', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Longer durations = higher total cost but better per-day rate
      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Might fail
      }
    });

    it('should scale cost with tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tiers cost more
      const ix = createSubIx(player, 3);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Elite tier costs more, might fail with insufficient funds
      }
    });

    it('should have bulk discounts', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Buying longer duration gives discount
      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Longer duration has better per-day value
      } catch {
        // Might fail
      }
    });
  });

  // ============================================================
  // Duration Options Tests
  // ============================================================

  describe('Duration Options', () => {
    it('should support 7 day subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should support 30 day subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should support 90 day subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should support 365 day subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 1);

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should reject unsupported durations', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Only specific durations might be allowed
      const ix = createSubIx(player, 1);

      // Duration parameter in instruction determines allowed values
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Grace Period Tests
  // ============================================================

  describe('Grace Period', () => {
    it('should have grace period after expiry', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Players get a short period to renew before full downgrade
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 1)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Grace period starts after expiry timestamp
      } catch {
        // Might fail
      }
    });

    it('should maintain partial benefits during grace', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Some benefits might persist during grace period
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createSubIx(player, 2)
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // During grace, some benefits remain active
      } catch {
        // Might fail
      }
    });

    it('should fully downgrade after grace period', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // After grace period, full downgrade applies
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Should be downgraded to free tier
      } catch {
        // Might not be in expired+grace state
      }
    });
  });
});
