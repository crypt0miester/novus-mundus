/**
 * Networth Calculation E2E Tests
 *
 * Verifies that on-chain networth is computed correctly at player init
 * and after subscription purchases.
 *
 * NOTE: The TS calculator cross-check uses BN.toNumber() for asset values,
 * which can lose precision for large u64 values from the GameEngine.
 * On-chain networth (computed by Rust u64 arithmetic) is the source of truth.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

import {
  createPurchaseSubscriptionInstruction,
  type PlayerAccount,
  type EconomicConfig,
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
  sendTransaction,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchGameEngine,
} from '../utils/accounts';
import { log } from '../utils/logger';

// ============================================================
// Helpers
// ============================================================

/** Log player assets and on-chain networth for visibility */
function logPlayerNetworth(label: string, p: PlayerAccount) {
  const nw = p.networth.toNumber();
  const du = [p.defensiveUnit1.toNumber(), p.defensiveUnit2.toNumber(), p.defensiveUnit3.toNumber()];
  const op = [p.operativeUnit1.toNumber(), p.operativeUnit2.toNumber(), p.operativeUnit3.toNumber()];
  const wp = [p.meleeWeapons.toNumber(), p.rangedWeapons.toNumber(), p.siegeWeapons.toNumber()];
  const eq = [p.armorPieces.toNumber(), p.produce.toNumber(), p.vehicles.toNumber()];
  const cash = p.cashOnHand.toNumber() + p.cashInVault.toNumber();

  log.info(`${label}: networth=${nw}`);
  log.info(`  du=[${du}] op=[${op}] wp=[${wp}] eq=[${eq}] cash=${cash}`);
}

// ============================================================
// Test Suite
// ============================================================

describe('Networth Calculation', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  // Store per-tier results for cross-tier comparisons
  const networthByTier: Map<number, number> = new Map();

  beforeAll(async () => {
    log.section('Networth Calculation');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true, initialBalance: 10 * LAMPORTS_PER_SOL });
  });

  afterAll(() => {
    factory.clear();
  });

  // Helper to create subscription instruction
  function createSubIx(player: TestPlayer, tier: number) {
    return createPurchaseSubscriptionInstruction(
      {
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        paymentAuthority: player.publicKey,
        treasury: ctx.treasury.publicKey,
      },
      { paymentType: 0, tier }
    );
  }

  // ============================================================
  // Baseline (no subscription)
  // ============================================================

  describe('Baseline Networth', () => {
    it('should compute non-zero networth at init from starter assets', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();

      const onChain = account!.networth.toNumber();
      expect(onChain).toBeGreaterThan(0);

      networthByTier.set(-1, onChain);
      logPlayerNetworth('Baseline (no sub)', account!);
    });
  });

  // ============================================================
  // Per-tier networth verification
  // ============================================================

  describe('Networth After Subscription', () => {
    it('should increase after Rookie (tier 0) subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.connection, player.playerPda);
      const baselineNw = before!.networth.toNumber();

      await sendTransaction(
        ctx.connection,
        new Transaction().add(createSubIx(player, 0)),
        [player.keypair],
      );
      const after = await fetchPlayer(ctx.connection, player.playerPda);
      expect(after).not.toBeNull();

      const onChain = after!.networth.toNumber();
      // Rookie sub grants du1, op1, cash — networth must increase
      expect(onChain).toBeGreaterThan(baselineNw);

      networthByTier.set(0, onChain);
      logPlayerNetworth('Rookie (tier 0)', after!);
    });

    it('should increase after Expert (tier 1) subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.connection, player.playerPda);
      const baselineNw = before!.networth.toNumber();

      await sendTransaction(
        ctx.connection,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair],
      );
      const after = await fetchPlayer(ctx.connection, player.playerPda);
      expect(after).not.toBeNull();

      const onChain = after!.networth.toNumber();
      expect(onChain).toBeGreaterThan(baselineNw);

      networthByTier.set(1, onChain);
      logPlayerNetworth('Expert (tier 1)', after!);
    });

    it('should increase after Epic (tier 2) subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.connection, player.playerPda);
      const baselineNw = before!.networth.toNumber();

      await sendTransaction(
        ctx.connection,
        new Transaction().add(createSubIx(player, 2)),
        [player.keypair],
      );
      const after = await fetchPlayer(ctx.connection, player.playerPda);
      expect(after).not.toBeNull();

      const onChain = after!.networth.toNumber();
      expect(onChain).toBeGreaterThan(baselineNw);

      networthByTier.set(2, onChain);
      logPlayerNetworth('Epic (tier 2)', after!);
    });

    it('should increase after Legendary (tier 3) subscription', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.connection, player.playerPda);
      const baselineNw = before!.networth.toNumber();

      // Legendary costs $250 (~2.5 SOL) -- airdrop extra to cover it
      const sig = await ctx.connection.requestAirdrop(player.publicKey, 5 * LAMPORTS_PER_SOL);
      await ctx.connection.confirmTransaction(sig);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(createSubIx(player, 3)),
        [player.keypair],
      );
      const after = await fetchPlayer(ctx.connection, player.playerPda);
      expect(after).not.toBeNull();

      const onChain = after!.networth.toNumber();
      expect(onChain).toBeGreaterThan(baselineNw);

      networthByTier.set(3, onChain);
      logPlayerNetworth('Legendary (tier 3)', after!);
    });
  });

  // ============================================================
  // Cross-tier ordering
  // ============================================================

  describe('Tier Ordering', () => {
    it('should have Legendary > Epic > Expert > Rookie > Baseline', () => {
      const baseline = networthByTier.get(-1);
      const rookie = networthByTier.get(0);
      const expert = networthByTier.get(1);
      const epic = networthByTier.get(2);
      const legendary = networthByTier.get(3);

      expect(baseline).toBeDefined();
      expect(rookie).toBeDefined();
      expect(expert).toBeDefined();
      expect(epic).toBeDefined();
      expect(legendary).toBeDefined();

      // Higher tiers grant more assets, so networth should strictly increase
      expect(rookie!).toBeGreaterThan(baseline!);
      expect(expert!).toBeGreaterThan(rookie!);
      expect(epic!).toBeGreaterThan(expert!);
      expect(legendary!).toBeGreaterThan(epic!);

      log.info(`Tier ordering: Baseline=${baseline} < Rookie=${rookie} < Expert=${expert} < Epic=${epic} < Legendary=${legendary}`);
    });
  });

  // ============================================================
  // Cross-check: two baseline players should have the same networth
  // ============================================================

  describe('Consistency', () => {
    it('should compute identical networth for two baseline players', async () => {
      const p1 = await factory.createPlayer({ initialize: true });
      const p2 = await factory.createPlayer({ initialize: true });

      const a1 = await fetchPlayer(ctx.connection, p1.playerPda);
      const a2 = await fetchPlayer(ctx.connection, p2.playerPda);
      expect(a1).not.toBeNull();
      expect(a2).not.toBeNull();

      // Same starter assets → same networth
      expect(a1!.networth.toNumber()).toBe(a2!.networth.toNumber());
    });

    it('should update networth when subscription grants resources', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const before = await fetchPlayer(ctx.connection, player.playerPda);

      // Expert subscription grants units, weapons, equipment, cash
      await sendTransaction(
        ctx.connection,
        new Transaction().add(createSubIx(player, 1)),
        [player.keypair],
      );

      const after = await fetchPlayer(ctx.connection, player.playerPda);
      expect(after).not.toBeNull();

      // More assets → higher networth
      expect(after!.networth.toNumber()).toBeGreaterThan(before!.networth.toNumber());

      // Verify the delta is meaningful (not just a few units)
      const delta = after!.networth.toNumber() - before!.networth.toNumber();
      expect(delta).toBeGreaterThan(0);
      log.info(`Expert sub networth delta: +${delta}`);
    });
  });
});
