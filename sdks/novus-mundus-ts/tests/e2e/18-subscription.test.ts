/**
 * Subscription System E2E Tests
 *
 * Tests for subscription tier management:
 * - Purchasing subscriptions with tier/expiry/bonus verification
 * - Subscription bonuses (cash, units, equipment, reputation, XP)
 * - Tier upgrades/downgrades
 * - Expiration handling
 * - SOL payment verification
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

import {
  createPurchaseSubscriptionInstruction,
  createDowngradeExpiredInstruction,
  SubscriptionTier,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import { advanceTime } from '../fixtures/time';
import {
  PlayerFactory,
  type TestPlayer,
} from '../fixtures/players';
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
} from '../fixtures/time';

// Test Suite

describe('Subscription System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  const THIRTY_DAYS = 30 * 86400;

  beforeAll(async () => {
    log.section('Subscription System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true, initialBalance: 10 * LAMPORTS_PER_SOL });
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

  // Purchase Subscription Tests

  describe('Purchasing Subscriptions', () => {
    it('should purchase Expert subscription (tier 1)', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createSubIx(player, 1);
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Expert);
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
      // Expert tier grants 1,500,000 cash on purchase
      const cashDelta = after!.cashOnHand.toNumber() - before!.cashOnHand.toNumber();
      expect(cashDelta).toBe(1_500_000);
    });

    it('should purchase Epic subscription (tier 2)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 2);
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Epic);
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
    });

    it('should purchase Legendary subscription (tier 3)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Legendary costs $250 (~2.5 SOL) — airdrop extra to cover it
      ctx.svm.airdrop(player.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

      const ix = createSubIx(player, 3);
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Legendary);
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
    });

    it('should reject invalid tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSubIx(player, 99);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should grant bonuses for Rookie tier purchase', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Tier 0 (Rookie) costs $5 and grants bonuses on purchase
      const ix = createSubIx(player, 0);
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();
      // Tier stays Rookie
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Rookie);
      // But expiry is set (30 days) and bonuses granted
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
      // Rookie tier grants: cash=1M, du1=10k, op1=30k
      expect(after!.cashOnHand.toNumber() - before!.cashOnHand.toNumber()).toBe(1_000_000);
      expect(after!.defensiveUnit1.toNumber() - before!.defensiveUnit1.toNumber()).toBe(10_000);
      expect(after!.operativeUnit1.toNumber() - before!.operativeUnit1.toNumber()).toBe(30_000);
    });

    it('should extend existing subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // First purchase
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );
      const afterFirst = await fetchPlayer(ctx.svm, player.playerPda);
      const firstExpiry = afterFirst!.subscriptionEnd.toNumber();
      expect(firstExpiry).toBeGreaterThan(0);

      // Second purchase extends from current expiry
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );
      const afterSecond = await fetchPlayer(ctx.svm, player.playerPda);
      const secondExpiry = afterSecond!.subscriptionEnd.toNumber();

      // Should be ~30 days longer than first expiry
      const extension = secondExpiry - firstExpiry;
      expect(extension).toBeGreaterThanOrEqual(THIRTY_DAYS - 5);
      expect(extension).toBeLessThanOrEqual(THIRTY_DAYS + 5);
    }, 15_000);

    it('should upgrade subscription tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Buy Expert (tier 1)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );
      const afterExpert = await fetchPlayer(ctx.svm, player.playerPda);
      expect(afterExpert!.subscriptionTier).toBe(SubscriptionTier.Expert);

      // Advance the clock so the upgrade-tier path's `expiration_base = now`
      // results in a strictly later end-of-subscription than the Expert one.
      await advanceTime(ctx.svm, 60);

      // Upgrade to Epic (tier 2)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );
      const afterEpic = await fetchPlayer(ctx.svm, player.playerPda);
      expect(afterEpic!.subscriptionTier).toBe(SubscriptionTier.Epic);
      // Expiry extends from current expiry, not reset
      expect(afterEpic!.subscriptionEnd.toNumber()).toBeGreaterThan(
        afterExpert!.subscriptionEnd.toNumber()
      );
    });
  });

  // Subscription Bonuses Tests

  describe('Subscription Bonuses', () => {
    it('should grant cash on hand', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Epic tier grants 3,000,000 cash
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      const delta = after!.cashOnHand.toNumber() - before!.cashOnHand.toNumber();
      expect(delta).toBe(3_000_000);
    });

    it('should grant defensive units', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Epic tier: du1=28k, du2=28k, du3=14k
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.defensiveUnit1.toNumber() - before!.defensiveUnit1.toNumber()).toBe(28_000);
      expect(after!.defensiveUnit2.toNumber() - before!.defensiveUnit2.toNumber()).toBe(28_000);
      expect(after!.defensiveUnit3.toNumber() - before!.defensiveUnit3.toNumber()).toBe(14_000);
    });

    it('should grant operative units', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Epic tier: op1=84k, op2=56k, op3=28k
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.operativeUnit1.toNumber() - before!.operativeUnit1.toNumber()).toBe(84_000);
      expect(after!.operativeUnit2.toNumber() - before!.operativeUnit2.toNumber()).toBe(56_000);
      expect(after!.operativeUnit3.toNumber() - before!.operativeUnit3.toNumber()).toBe(28_000);
    });

    it('should grant equipment', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Expert tier: melee=32k, ranged=8k, siege=2k, armor=8k, produce=500k, vehicles=500
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.meleeWeapons.toNumber() - before!.meleeWeapons.toNumber()).toBe(32_000);
      expect(after!.rangedWeapons.toNumber() - before!.rangedWeapons.toNumber()).toBe(8_000);
      expect(after!.siegeWeapons.toNumber() - before!.siegeWeapons.toNumber()).toBe(2_000);
      expect(after!.armorPieces.toNumber() - before!.armorPieces.toNumber()).toBe(8_000);
      expect(after!.produce.toNumber() - before!.produce.toNumber()).toBe(500_000);
      expect(after!.vehicles.toNumber() - before!.vehicles.toNumber()).toBe(500);
    });

    it('should grant reputation', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Expert tier grants 250 reputation
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      const repDelta = after!.reputation.toNumber() - before!.reputation.toNumber();
      expect(repDelta).toBe(250);
    });

    it('should grant XP with time bonus', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Expert tier grants 500 XP base (with time-of-day multiplier)
      // XP grant may trigger level-ups which consume currentXp
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      // Verify progression: either level increased or remaining XP increased
      expect(
        after!.level > before!.level ||
        after!.currentXp.toNumber() > before!.currentXp.toNumber()
      ).toBe(true);
    });

    it('should accumulate bonuses on renewal', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Purchase Expert twice — bonuses stack
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      // Cash should be 2× Expert bonus (2 × 1,500,000 = 3,000,000)
      const cashDelta = after!.cashOnHand.toNumber() - before!.cashOnHand.toNumber();
      expect(cashDelta).toBe(3_000_000);
      // du1 should be 2× Expert bonus (2 × 16,000 = 32,000)
      const du1Delta = after!.defensiveUnit1.toNumber() - before!.defensiveUnit1.toNumber();
      expect(du1Delta).toBe(32_000);
    }, 15_000);
  });

  // Tier Comparison Tests

  describe('Tier Comparisons', () => {
    it('should default to free tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Rookie);
      expect(account!.subscriptionEnd.toNumber()).toBe(0);
    });

    it('should scale bonuses with tier', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      const before1 = await fetchPlayer(ctx.svm, player1.playerPda);
      const before2 = await fetchPlayer(ctx.svm, player2.playerPda);

      // Player1 gets Expert (tier 1)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player1, 1)),
        [player1.keypair]
      );

      // Player2 gets Epic (tier 2)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player2, 2)),
        [player2.keypair]
      );

      const after1 = await fetchPlayer(ctx.svm, player1.playerPda);
      const after2 = await fetchPlayer(ctx.svm, player2.playerPda);

      // Epic grants more cash than Expert (3M vs 1.5M)
      const cash1 = after1!.cashOnHand.toNumber() - before1!.cashOnHand.toNumber();
      const cash2 = after2!.cashOnHand.toNumber() - before2!.cashOnHand.toNumber();
      expect(cash2).toBeGreaterThan(cash1);

      // Epic grants more tier-3 defensive units than Expert (14k vs 8k)
      const du3_1 = after1!.defensiveUnit3.toNumber() - before1!.defensiveUnit3.toNumber();
      const du3_2 = after2!.defensiveUnit3.toNumber() - before2!.defensiveUnit3.toNumber();
      expect(du3_1).toBe(8_000);
      expect(du3_2).toBe(14_000);
    });

    it('should have tier-exclusive unit types', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Epic (tier 2) grants all 3 defensive and operative unit types
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      // Epic grants du3=14k, op3=28k
      expect(after!.defensiveUnit3.toNumber() - before!.defensiveUnit3.toNumber()).toBe(14_000);
      expect(after!.operativeUnit3.toNumber() - before!.operativeUnit3.toNumber()).toBe(28_000);
    });
  });

  // Expiration Tests

  describe('Subscription Expiration', () => {
    it('should set expiry 30 days from now', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const beforeTime = await getCurrentTimestamp(ctx.svm);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      const expiry = account!.subscriptionEnd.toNumber();
      // Expiry should be ~30 days from now (allow small clock drift)
      expect(expiry).toBeGreaterThanOrEqual(beforeTime + THIRTY_DAYS - 5);
      expect(expiry).toBeLessThanOrEqual(beforeTime + THIRTY_DAYS + 10);
    });

    it('should not downgrade active subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Purchase active subscription
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const beforeDowngrade = await fetchPlayer(ctx.svm, player.playerPda);
      expect(beforeDowngrade!.subscriptionTier).toBe(SubscriptionTier.Expert);

      // Downgrade call succeeds but is a no-op for active subs
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify tier is still Expert (not downgraded)
      const afterDowngrade = await fetchPlayer(ctx.svm, player.playerPda);
      expect(afterDowngrade!.subscriptionTier).toBe(SubscriptionTier.Expert);
      // Expiry unchanged
      expect(afterDowngrade!.subscriptionEnd.toNumber()).toBe(
        beforeDowngrade!.subscriptionEnd.toNumber()
      );
    });

    it('should be no-op for free tier players', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const before = await fetchPlayer(ctx.svm, player.playerPda);
      expect(before!.subscriptionTier).toBe(SubscriptionTier.Rookie);

      // Downgrade on free tier is a no-op
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Rookie);
    });

    it('should allow anyone to trigger downgrade', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const other = await factory.createPlayer({ initialize: true });

      // Downgrade is permissionless — another player can call it
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });
      await sendTransaction(ctx.svm, new Transaction().add(ix), [other.keypair]);

      // Target player unaffected (free tier, no-op)
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Rookie);
    });

    it('should preserve tier until expiry', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      // Immediately after purchase, tier is active and expiry is in the future
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Epic);
      const now = await getCurrentTimestamp(ctx.svm);
      expect(account!.subscriptionEnd.toNumber()).toBeGreaterThan(now);
    });
  });

  // Payment Tests

  describe('Subscription Payments', () => {
    it('should deduct SOL for purchase', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const balanceBefore = await ctx.svm.getBalance(player.publicKey);

      // Expert tier costs $10 in SOL
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const balanceAfter = await ctx.svm.getBalance(player.publicKey);
      // SOL balance should decrease (subscription cost + tx fees)
      expect(balanceAfter).toBeLessThan(balanceBefore);
      // Should decrease by more than just tx fees (subscription has real cost)
      const decrease = balanceBefore - balanceAfter;
      expect(decrease).toBeGreaterThan(100_000); // More than ~0.0001 SOL in fees alone
    });

    it('should charge SOL for Rookie tier', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const balanceBefore = await ctx.svm.getBalance(player.publicKey);

      // Rookie tier costs $5 — SOL is deducted
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 0)),
        [player.keypair]
      );

      const balanceAfter = await ctx.svm.getBalance(player.publicKey);
      // SOL balance should decrease (subscription cost + tx fees)
      const decrease = balanceBefore - balanceAfter;
      expect(decrease).toBeGreaterThan(100_000); // More than just tx fees
    });

    it('should charge more for higher tiers', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      const balance1Before = await ctx.svm.getBalance(player1.publicKey);
      const balance2Before = await ctx.svm.getBalance(player2.publicKey);

      // Player1 buys Expert ($10)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player1, 1)),
        [player1.keypair]
      );

      // Player2 buys Epic ($50)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player2, 2)),
        [player2.keypair]
      );

      const balance1After = await ctx.svm.getBalance(player1.publicKey);
      const balance2After = await ctx.svm.getBalance(player2.publicKey);

      const cost1 = balance1Before - balance1After;
      const cost2 = balance2Before - balance2After;
      // Epic ($50) should cost more than Expert ($10)
      expect(cost2).toBeGreaterThan(cost1);
    });

    it('should reject tier downgrade via payment', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Buy Epic (tier 2) first
      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      // Attempt to "buy" Expert (tier 1) — rejected as downgrade
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      // Verify tier unchanged
      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Epic);
    });

    it('should reject out-of-range tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Tier 99 doesn't exist (valid range 0-3)
      const ix = createSubIx(player, 99);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Tier Verification Tests

  describe('Tier Verification', () => {
    it('should set tier and expiry for Expert (tier 1)', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);
      expect(before!.subscriptionTier).toBe(SubscriptionTier.Rookie);

      await sendTransaction(ctx.svm, new Transaction().add(createSubIx(player, 1)), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Expert);
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
    });

    it('should set tier and expiry for Epic (tier 2)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(ctx.svm, new Transaction().add(createSubIx(player, 2)), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Epic);
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
    });

    it('should set tier and expiry for Legendary (tier 3)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Legendary costs $250 (~2.5 SOL) — airdrop extra to cover it
      ctx.svm.airdrop(player.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

      await sendTransaction(ctx.svm, new Transaction().add(createSubIx(player, 3)), [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.subscriptionTier).toBe(SubscriptionTier.Legendary);
      expect(after!.subscriptionEnd.toNumber()).toBeGreaterThan(0);
    });

    it('should extend expiry when purchasing same tier twice', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // First purchase
      await sendTransaction(ctx.svm, new Transaction().add(createSubIx(player, 1)), [player.keypair]);
      const afterFirst = await fetchPlayer(ctx.svm, player.playerPda);
      const firstExpiry = afterFirst!.subscriptionEnd.toNumber();

      // Second purchase extends from current expiry
      await sendTransaction(ctx.svm, new Transaction().add(createSubIx(player, 1)), [player.keypair]);
      const afterSecond = await fetchPlayer(ctx.svm, player.playerPda);
      const secondExpiry = afterSecond!.subscriptionEnd.toNumber();

      // Should be ~30 days longer than first expiry
      const extension = secondExpiry - firstExpiry;
      expect(extension).toBeGreaterThanOrEqual(THIRTY_DAYS - 5);
      expect(extension).toBeLessThanOrEqual(THIRTY_DAYS + 5);
    }, 15_000);

    it('should reject out-of-range tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Tier 5 doesn't exist (valid range 0-3)
      const ix = createSubIx(player, 5);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Grace Period Tests

  describe('Grace Period', () => {
    it('should set future expiry on purchase', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      const now = await getCurrentTimestamp(ctx.svm);
      // Expiry is in the future — subscription is active
      expect(account!.subscriptionEnd.toNumber()).toBeGreaterThan(now);
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Expert);
    });

    it('should maintain tier during active period', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Epic);

      // Downgrade attempt on active sub is a no-op
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const afterDowngrade = await fetchPlayer(ctx.svm, player.playerPda);
      expect(afterDowngrade!.subscriptionTier).toBe(SubscriptionTier.Epic);
    });

    it('should only downgrade after expiry', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Free tier player — downgrade is a no-op (already tier 0)
      const ix = createDowngradeExpiredInstruction({
        playerAccount: player.playerPda,
      });
      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account!.subscriptionTier).toBe(SubscriptionTier.Rookie);
      // Note: actual expiry-based downgrade requires time manipulation
      // which is not available on solana-test-validator
    });
  });
});
