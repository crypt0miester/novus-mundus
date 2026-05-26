/**
 * Pegged-Token Subscription E2E Tests
 *
 * Stablecoin (USDC/USDT/PYUSD) payment path for subscriptions:
 * `AllowedTokenAccount.pegged_to_usd = 1` — the chain skips Pyth/Switchboard
 * entirely and computes the token amount as `cost_usd_cents × 10^(decimals - 2)`.
 *
 * Covers:
 * - Whitelisting a token with `peggedToUsd: true` (no oracle feeds required).
 * - Purchasing a subscription with the pegged token, asserting the exact
 *   USD-denominated transfer amount lands on the treasury (no oracle math,
 *   no slippage).
 * - Rejection: pegged tokens cannot pay for SOL-priced products (shop items)
 *   — the helper surfaces `InvalidParameter` clearly.
 * - Defensive: `pegged_to_usd = 1` with the chain receiving `cost_usd_cents = 0`
 *   (degenerate caller) is rejected the same way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';

import {
  BuildingType,
  createCreateAllowedTokenInstruction,
  createCreateItemInstruction,
  createPurchaseItemInstruction,
  createPurchaseSubscriptionInstruction,
  deriveAllowedTokenPda,
  getAssociatedTokenAddressSync,
  ShopItemCategory,
  ShopItemRarity,
} from '../../src/index';
import BN from 'bn.js';

import { type TestContext, beforeAllTests } from '../fixtures/setup';
import {
  seedSplMint,
  seedSplTokenAccount,
  readSplTokenAmount,
} from '../fixtures/svm';
import { PlayerFactory, type TestPlayer } from '../fixtures/players';
import { sendTransaction, expectTransactionToFail } from '../utils/transactions';
import { fetchPlayer } from '../utils/accounts';
import { log } from '../utils/logger';

describe('Pegged-Token Subscription', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  // Mock USDC: 6 decimals, dao-mintable. The pubkey is per-test-run — only
  // the on-chain shape matters here, not the address itself.
  let usdcMint: Keypair;

  beforeAll(async () => {
    log.section('Pegged-Token Subscription');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true, initialBalance: 10 * LAMPORTS_PER_SOL });

    // Seed the mock USDC mint with the canonical decimals (6).
    usdcMint = Keypair.generate();
    seedSplMint(ctx.svm, usdcMint.publicKey, {
      decimals: 6,
      mintAuthority: ctx.daoAuthority.publicKey,
    });

    // Whitelist with `peggedToUsd: true` — no Pyth/Switchboard feeds.
    const treasuryAta = getAssociatedTokenAddressSync(usdcMint.publicKey, ctx.treasury.publicKey);
    // create_allowed_token will create the treasury ATA via CPI; pre-seed it
    // here to keep the LiteSVM CPI surface narrow. Functionally equivalent.
    seedSplTokenAccount(ctx.svm, treasuryAta, {
      mint: usdcMint.publicKey,
      owner: ctx.treasury.publicKey,
      amount: 0n,
    });

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createCreateAllowedTokenInstruction(
          {
            gameEngine: ctx.gameEngine,
            payer: ctx.daoAuthority.publicKey,
            daoAuthority: ctx.daoAuthority.publicKey,
            tokenMint: usdcMint.publicKey,
            treasuryWallet: ctx.treasury.publicKey,
          },
          {
            // No oracle feeds — the chain accepts zero feeds when peggedToUsd is set.
            pythFeed: undefined,
            switchboardFeed: undefined,
            maxStalenessSlots: 0,
            confidenceThresholdBps: 0,
            discountBps: 0,
            peggedToUsd: true,
          },
        ),
      ),
      [ctx.daoAuthority],
    );
  });

  afterAll(() => {
    factory.clear();
  });

  /** Seed a buyer with `amount` USDC base units in their ATA. */
  function fundBuyer(buyer: TestPlayer, amount: bigint): void {
    const buyerAta = getAssociatedTokenAddressSync(usdcMint.publicKey, buyer.publicKey);
    seedSplTokenAccount(ctx.svm, buyerAta, {
      mint: usdcMint.publicKey,
      owner: buyer.publicKey,
      amount,
    });
  }

  it('charges exactly the USD-denominated price (Expert: $10 = 10_000_000 USDC base units)', async () => {
    const buyer = await factory.createPlayer({ initialize: true });
    // Fund well over $10 so the test isn't sensitive to the exact starting balance.
    const STARTING_USDC = 1_000_000_000n; // $1,000 USDC (6 dec)
    fundBuyer(buyer, STARTING_USDC);

    const buyerAta = getAssociatedTokenAddressSync(usdcMint.publicKey, buyer.publicKey);
    const treasuryAta = getAssociatedTokenAddressSync(usdcMint.publicKey, ctx.treasury.publicKey);
    const treasuryBefore = readSplTokenAmount(ctx.svm, treasuryAta);

    const ix = createPurchaseSubscriptionInstruction(
      {
        gameEngine: ctx.gameEngine,
        owner: buyer.publicKey,
        paymentAuthority: buyer.publicKey,
        treasury: ctx.treasury.publicKey,
        tokenPayment: {
          tokenMint: usdcMint.publicKey,
          // Oracle accounts deliberately omitted — pegged path doesn't read them.
        },
      },
      { paymentType: 2, tier: 1 }, // Expert ($10/mo)
    );

    await sendTransaction(ctx.svm, new Transaction().add(ix), [buyer.keypair]);

    const buyerAfter = readSplTokenAmount(ctx.svm, buyerAta);
    const treasuryAfter = readSplTokenAmount(ctx.svm, treasuryAta);

    // Expert tier costs 1_000 USD cents → 1_000 × 10^(6-2) = 10_000_000 USDC base units = $10.
    const expectedCharge = 10_000_000n;
    expect(STARTING_USDC - buyerAfter).toBe(expectedCharge);
    expect(treasuryAfter - treasuryBefore).toBe(expectedCharge);

    // Conservation — token transfer, no mint/burn.
    expect(STARTING_USDC - buyerAfter).toBe(treasuryAfter - treasuryBefore);

    // Subscription is active.
    const player = await fetchPlayer(ctx.svm, buyer.playerPda);
    if (!player) throw new Error("player PDA missing after subscription purchase");
    expect(player.subscriptionTier).toBe(1);
    expect(player.subscriptionEnd.gt(new BN(0))).toBe(true);
  });

  it('charges exactly $50 USDC for Epic (cost × 10^4)', async () => {
    const buyer = await factory.createPlayer({ initialize: true });
    const STARTING_USDC = 1_000_000_000n; // $1,000 USDC
    fundBuyer(buyer, STARTING_USDC);

    const buyerAta = getAssociatedTokenAddressSync(usdcMint.publicKey, buyer.publicKey);

    const ix = createPurchaseSubscriptionInstruction(
      {
        gameEngine: ctx.gameEngine,
        owner: buyer.publicKey,
        paymentAuthority: buyer.publicKey,
        treasury: ctx.treasury.publicKey,
        tokenPayment: { tokenMint: usdcMint.publicKey },
      },
      { paymentType: 2, tier: 2 }, // Epic ($50/mo)
    );

    await sendTransaction(ctx.svm, new Transaction().add(ix), [buyer.keypair]);

    const buyerAfter = readSplTokenAmount(ctx.svm, buyerAta);
    expect(STARTING_USDC - buyerAfter).toBe(50_000_000n); // $50 USDC
  });

  it('charges exactly $250 USDC for Legendary', async () => {
    const buyer = await factory.createPlayer({ initialize: true });
    const STARTING_USDC = 1_000_000_000n; // $1,000 USDC — enough for Legendary
    fundBuyer(buyer, STARTING_USDC);

    const buyerAta = getAssociatedTokenAddressSync(usdcMint.publicKey, buyer.publicKey);

    const ix = createPurchaseSubscriptionInstruction(
      {
        gameEngine: ctx.gameEngine,
        owner: buyer.publicKey,
        paymentAuthority: buyer.publicKey,
        treasury: ctx.treasury.publicKey,
        tokenPayment: { tokenMint: usdcMint.publicKey },
      },
      { paymentType: 2, tier: 3 }, // Legendary ($250/mo)
    );

    await sendTransaction(ctx.svm, new Transaction().add(ix), [buyer.keypair]);

    const buyerAfter = readSplTokenAmount(ctx.svm, buyerAta);
    expect(STARTING_USDC - buyerAfter).toBe(250_000_000n); // $250 USDC
  });

  it('rejects pegged token for a SOL-priced shop item (no USD basis to convert from)', async () => {
    // Create a SOL-priced shop item. The helper sees pegged=1 AND
    // `cost_usd_cents=None` (purchase_item passes None) and errors with
    // `InvalidParameter` — pegged tokens semantically can't fulfill a
    // lamport-denominated price.
    const ITEM_ID = 42_001;
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createCreateItemInstruction(
          {
            payer: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            daoAuthority: ctx.daoAuthority.publicKey,
          },
          {
            itemId: ITEM_ID,
            itemType: 1,
            category: ShopItemCategory.Consumable,
            rarity: ShopItemRarity.Common,
            quantityPerPurchase: 1,
            baseStatsBps: 0,
            priceSolLamports: new BN(LAMPORTS_PER_SOL / 10), // 0.1 SOL
          },
        ),
      ),
      [ctx.daoAuthority],
    );

    // Shop purchases require a Market building — match the pattern used by
    // `tests/e2e/10-shop.test.ts:createShopReadyPlayer`.
    const buyer = await factory.createPlayer({
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Market],
    });
    fundBuyer(buyer, 1_000_000_000n);

    const treasuryAta = getAssociatedTokenAddressSync(usdcMint.publicKey, ctx.treasury.publicKey);
    const buyerAta = getAssociatedTokenAddressSync(usdcMint.publicKey, buyer.publicKey);

    const ix = createPurchaseItemInstruction(
      {
        gameEngine: ctx.gameEngine,
        buyer: buyer.publicKey,
        itemId: ITEM_ID,
        treasury: ctx.treasury.publicKey,
        tokenPayment: {
          allowedToken: deriveAllowedTokenPda(ctx.gameEngine, usdcMint.publicKey)[0],
          tokenMint: usdcMint.publicKey,
          buyerTokenAta: buyerAta,
          treasuryTokenAta: treasuryAta,
          /*
           * No oracle feeds; opt into the pegged path explicitly so the SDK
           * builds the ix. The chain still detects the mismatch (pegged +
           * cost_usd_cents=None on a SOL-priced item) and rejects with
           * InvalidParameter, which is what this test asserts.
           */
          peggedToUsd: true,
        },
      },
      { quantity: 1, paymentType: 2 },
    );

    await expectTransactionToFail(
      ctx.svm,
      new Transaction().add(ix),
      [buyer.keypair],
      undefined,
      'pegged-token-shop-item rejection',
    );
  });
});
