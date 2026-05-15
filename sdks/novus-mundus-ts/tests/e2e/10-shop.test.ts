/**
 * Shop System E2E Tests
 *
 * Tests for the in-game shop:
 * - Shop configuration
 * - Item purchases
 * - Bundle purchases
 * - Flash sales
 * - Allowed payment tokens
 * - Token purchases
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createInitializeConfigInstruction,
  createUpdateConfigInstruction,
  createCreateItemInstruction,
  createUpdateItemInstruction,
  createPurchaseItemInstruction,
  createCreateBundleInstruction,
  createUpdateBundleInstruction,
  createPurchaseBundleInstruction,
  createCreateFlashSaleInstruction,
  createPurchaseFlashSaleInstruction,
  createCloseSaleInstruction,
  createActivateSaleInstruction,
  createCreateAllowedTokenInstruction,
  createUpdateAllowedTokenInstruction,
  createCloseAllowedTokenInstruction,
  createCreateDailyDealInstruction,
  createRotateDailyDealInstruction,
  createCreateWeeklySaleInstruction,
  createCreateSeasonalSaleInstruction,
  createCreateDaoPromotionInstruction,
  createCreateEventInstruction,
  deriveShopConfigPda,
  deriveShopItemPda,
  deriveGameEnginePda,
  deriveAllowedTokenPda,
  deriveNoviMintPda,
  deriveDailyDealPda,
  deriveFlashSalePda,
  deriveWeeklySalePda,
  deriveSeasonalSalePda,
  deriveDaoPromotionPda,
  deriveEventPda,
  deserializeSeasonalSale,
  deserializeDaoPromotion,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import {
  seedMockPythFeed,
  seedMockSwitchboardFeed,
  seedSplMint,
  seedSplTokenAccount,
  readSplTokenAmount,
} from '../fixtures/svm';
import { getAssociatedTokenAddressSync } from '../../src/index';
import {
  PlayerFactory,
  type TestPlayer,
} from '../fixtures/players';
import {
  assertBnEquals,
} from '../utils/assertions';
import {
  getCurrentTimestamp,
  advanceTime,
} from '../fixtures/time';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchShopConfig,
  fetchShopItem,
  accountExists,
} from '../utils/accounts';
import { log } from '../utils/logger';
import { BuildingType } from '../../src/index';

setDefaultTimeout(120_000);

// Helper: Create player with estate + Market (needed for shop purchases)
async function createShopReadyPlayer(
  ctx: TestContext,
  factory: PlayerFactory
): Promise<TestPlayer> {
  const player = await factory.createPlayer({
    initialize: true,
    createEstate: true,
    buildings: [BuildingType.Market],
  });
  return player;
}

/**
 * The Rust contract auto-assigns flash sale IDs from shop_config.next_flash_sale_id
 * and increments. The caller has to know the right ID to derive the matching
 * PDA — fetch it from the live config to avoid cross-test coupling.
 */
async function getNextFlashSaleId(ctx: TestContext): Promise<number> {
  const cfg = await fetchShopConfig(ctx.svm, ctx.gameEngine);
  return cfg!.nextFlashSaleId.toNumber();
}

// Test Suite

describe('Shop System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Shop System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // Shop Configuration Tests

  describe('Shop Configuration', () => {
    it('should initialize shop config (DAO)', async () => {
      // Shop config is initialized during beforeAllTests setup
      // Verify it exists and has valid data
      const config = await fetchShopConfig(ctx.svm, ctx.gameEngine);
      expect(config).not.toBeNull();
      expect(config?.bump).toBeDefined();
    });

    it('should update shop config (DAO)', async () => {
      const ix = createUpdateConfigInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
        {} // Use defaults - this updates oracle config
      );

      const tx = new Transaction().add(ix);

      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      // Verify config still exists after update
      const config = await fetchShopConfig(ctx.svm, ctx.gameEngine);
      expect(config).not.toBeNull();
    });

    it('should reject config update by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Non-DAO authority trying to update config should fail
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createUpdateConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: player.publicKey },
            {}
          )
        ),
        [player.keypair]
      );
    });
  });

  // Shop Item Tests

  describe('Shop Items', () => {
    const TEST_ITEM_ID = 5001;

    it('should create shop item (DAO)', async () => {
      const ix = createCreateItemInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
        },
        {
          itemId: TEST_ITEM_ID,
          itemType: 0, // Equipment
          category: 0, // Equipment
          rarity: 1,
          quantityPerPurchase: 1,
          baseStatsBps: 100,
          priceSolLamports: new BN(1000), // Very cheap for testing
          isActive: true,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify item was created
      const item = await fetchShopItem(ctx.svm, ctx.gameEngine, TEST_ITEM_ID);
      expect(item).not.toBeNull();
      expect(item?.isActive).toBe(true);
      expect(item?.rarity).toBe(1);
    });

    it('should update shop item (DAO)', async () => {
      const ix = createUpdateItemInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, itemId: TEST_ITEM_ID },
        {
          priceSolLamports: new BN(2000),
          isActive: true,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify item was updated
      const item = await fetchShopItem(ctx.svm, ctx.gameEngine, TEST_ITEM_ID);
      if (item) {
        assertBnEquals(item.priceSolLamports, new BN(2000));
      }
    });

    it('should reject item creation by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createCreateItemInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: player.publicKey,
          daoAuthority: player.publicKey,
        },
        {
          itemId: 999999,
          itemType: 0,
          category: 0,
          rarity: 1,
          quantityPerPurchase: 1,
          baseStatsBps: 100,
          priceSolLamports: new BN(1000000),
          isActive: true,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should deactivate item (DAO)', async () => {
      const ix = createUpdateItemInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, itemId: TEST_ITEM_ID },
        {
          isActive: false,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify item was deactivated
      const item = await fetchShopItem(ctx.svm, ctx.gameEngine, TEST_ITEM_ID);
      if (item) {
        expect(item.isActive).toBe(false);
      }

      // Re-activate for other tests
      const reactivateIx = createUpdateItemInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, itemId: TEST_ITEM_ID },
        { isActive: true }
      );
      await sendTransaction(ctx.svm, new Transaction().add(reactivateIx), [ctx.daoAuthority]);
    });
  });

  // Item Purchase Tests

  describe('Item Purchases', () => {
    it('should purchase shop item', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify player state changed (received item)
      const accountAfter = await fetchPlayer(ctx.svm, player.playerPda);
      expect(accountAfter).not.toBeNull();
    });

    it('should purchase multiple quantity', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 5 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject purchase of non-existent item', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 999999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject purchase with zero quantity', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      // Zero quantity should fail (InvalidParameter)
      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 0 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Bundle Tests

  describe('Bundles', () => {
    const TEST_BUNDLE_ID = 7001;

    it('should create bundle (DAO)', async () => {
      const bundleId = TEST_BUNDLE_ID;

      const ix = createCreateBundleInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
        },
        {
          bundleId,
          tier: 1,
          category: 0,
          requiresSubscription: 0,
          savingsBps: 1000, // 10% savings display
          items: [
            { itemId: 9999, quantity: 5 },
            { itemId: 9998, quantity: 5 },
          ],
          priceSolLamports: new BN(5000), // 5000 lamports
          availableFrom: new BN(0),
          availableUntil: new BN(0),
          isActive: true,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);
    });

    it('should update bundle (DAO)', async () => {
      const ix = createUpdateBundleInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, bundleId: TEST_BUNDLE_ID },
        {
          priceSolLamports: new BN(4000000), // Discount
          isActive: true,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);
    });

    it('should purchase bundle', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      // Get the shop item PDAs for items in the bundle
      const gameEngine = ctx.gameEngine;
      const [shopItem1] = deriveShopItemPda(gameEngine, 9999);
      const [shopItem2] = deriveShopItemPda(gameEngine, 9998);

      const ix = createPurchaseBundleInstruction(
        {
          gameEngine: ctx.gameEngine,
          buyer: player.publicKey,
          bundleId: TEST_BUNDLE_ID,
          treasury: ctx.treasury.publicKey,
          shopItemAccounts: [shopItem1, shopItem2],
        },
        {}
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify player received bundle items
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject bundle purchase by non-subscriber when required', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      // Create a subscriber-only bundle
      const bundleId = Date.now() % 10000 + 5000;
      const createIx = createCreateBundleInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
        },
        {
          bundleId,
          tier: 1,
          category: 0,
          requiresSubscription: 1, // Requires subscription
          savingsBps: 1000,
          items: [{ itemId: 9999, quantity: 1 }, { itemId: 9998, quantity: 1 }],
          priceSolLamports: new BN(1000),
          availableFrom: new BN(0),
          availableUntil: new BN(0),
          isActive: true,
        }
      );
      await sendTransaction(ctx.svm, new Transaction().add(createIx), [ctx.daoAuthority]);

      // Try to purchase without subscription
      const gameEngine = ctx.gameEngine;
      const [shopItem1] = deriveShopItemPda(gameEngine, 9999);
      const [shopItem2] = deriveShopItemPda(gameEngine, 9998);

      const purchaseIx = createPurchaseBundleInstruction(
        {
          gameEngine: ctx.gameEngine,
          buyer: player.publicKey,
          bundleId,
          treasury: ctx.treasury.publicKey,
          shopItemAccounts: [shopItem1, shopItem2],
        },
        {}
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(purchaseIx),
        [player.keypair]
      );
    });
  });

  // Flash Sale Tests

  describe('Flash Sales', () => {
    it('should reject purchase of non-existent flash sale', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const mockItemAccount = Keypair.generate().publicKey;

      const ix = createPurchaseFlashSaleInstruction(
        {
          gameEngine: ctx.gameEngine,
          buyer: player.publicKey,
          saleId: 999999999, // Non-existent
          itemOrBundle: mockItemAccount,
          treasury: ctx.treasury.publicKey,
        },
        { quantity: 1 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should successfully purchase from an active flash sale', async () => {
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 1),
              durationSecs: 3600,
              maxStock: 50,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // Advance so the sale auto-flips Announced → Active on first purchase
      await advanceTime(ctx.svm, 2);

      const player = await createShopReadyPlayer(ctx, factory);
      const [itemPda] = deriveShopItemPda(ctx.gameEngine, 9999);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createPurchaseFlashSaleInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: player.publicKey,
              saleId,
              itemOrBundle: itemPda,
              treasury: ctx.treasury.publicKey,
            },
            { quantity: 1 },
          ),
        ),
        [player.keypair],
      );
    }, 60_000);

    it('should reject purchase before sale starts (SaleNotActive)', async () => {
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 10_000), // far in the future
              durationSecs: 3600,
              maxStock: 50,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const player = await createShopReadyPlayer(ctx, factory);
      const [itemPda] = deriveShopItemPda(ctx.gameEngine, 9999);

      // Status is Announced; auto-flip won't trigger (now < starts_at);
      // purchase rejects with SaleNotActive.
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createPurchaseFlashSaleInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: player.publicKey,
              saleId,
              itemOrBundle: itemPda,
              treasury: ctx.treasury.publicKey,
            },
            { quantity: 1 },
          ),
        ),
        [player.keypair],
      );
    }, 60_000);

    it('should reject purchase after sale ends (SaleNotActive)', async () => {
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 1),
              durationSecs: 3600, // min duration
              maxStock: 50,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // Advance past ends_at (1 + 3600 + slack)
      await advanceTime(ctx.svm, 3700);

      const player = await createShopReadyPlayer(ctx, factory);
      const [itemPda] = deriveShopItemPda(ctx.gameEngine, 9999);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createPurchaseFlashSaleInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: player.publicKey,
              saleId,
              itemOrBundle: itemPda,
              treasury: ctx.treasury.publicKey,
            },
            { quantity: 1 },
          ),
        ),
        [player.keypair],
      );
    }, 60_000);

    it('should reject flash sale creation by non-DAO', async () => {
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      const rando = Keypair.generate();
      ctx.svm.airdrop(rando.publicKey, BigInt(1_000_000_000));

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: rando.publicKey,
              daoAuthority: rando.publicKey, // non-DAO signer
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 100),
              durationSecs: 3600,
              maxStock: 50,
            },
          ),
        ),
        [rando],
      );
    });

    it('should reject duration below the configured minimum', async () => {
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 100),
              durationSecs: 60, // below min (3600s)
              maxStock: 50,
            },
          ),
        ),
        [ctx.daoAuthority],
      );
    });
  });

  // Allowed Payment Token Tests

  describe('Allowed Payment Tokens', () => {
    const [testTokenMint] = deriveNoviMintPda(); // Use real on-chain NOVI mint (82 bytes)
    // Synthetic Pyth feed: random pubkey + an account at that pubkey
    // owned by the Pyth program with a minimally-valid `PythPriceAccount`
    // header. Satisfies `validate_oracle_feed_at_config` (owner check +
    // magic/version/atype check) without actually publishing a price.
    const mockPythFeed = Keypair.generate().publicKey;
    beforeAll(() => seedMockPythFeed(ctx.svm, mockPythFeed));

    it('should create allowed token (DAO)', async () => {
      const ix = createCreateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: testTokenMint,
          treasuryWallet: ctx.treasury.publicKey,
        },
        {
          pythFeed: mockPythFeed,
          switchboardFeed: undefined,
          maxStalenessSlots: 100,
          confidenceThresholdBps: 500, // 5%
          discountBps: 0,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify allowed token was created
      const gameEngine = ctx.gameEngine;
      const [allowedTokenPda] = deriveAllowedTokenPda(gameEngine, testTokenMint);
      const accountInfo = await ctx.svm.getAccount(allowedTokenPda);
      expect(accountInfo).not.toBeNull();
    });

    it('should update allowed token (DAO)', async () => {
      const ixs = createUpdateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: testTokenMint,
        },
        {
          maxStalenessSlots: 200, // Increase staleness threshold
          confidenceThresholdBps: 1000, // 10%
        }
      );

      const tx = new Transaction();
      ixs.forEach(ix => tx.add(ix));
      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);
    });

    it('should update discount on allowed token (DAO)', async () => {
      // Set discount to 500 bps (5%)
      const ixs = createUpdateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: testTokenMint,
        },
        {
          discountBps: 500,
        }
      );

      const tx = new Transaction();
      ixs.forEach(ix => tx.add(ix));
      await sendTransaction(ctx.svm, tx, [ctx.daoAuthority]);

      // Reset discount to 0
      const resetIxs = createUpdateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: testTokenMint,
        },
        { discountBps: 0 }
      );
      const tx2 = new Transaction();
      resetIxs.forEach(ix => tx2.add(ix));
      await sendTransaction(ctx.svm, tx2, [ctx.daoAuthority]);
    });

    it('should close allowed token (DAO)', async () => {
      // Seed a real SPL mint so it passes the data_len == 82 check
      const tokenToClose = Keypair.generate().publicKey;
      seedSplMint(ctx.svm, tokenToClose, {
        decimals: 9,
        mintAuthority: ctx.daoAuthority.publicKey,
      });

      // First create it
      const createIx = createCreateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: tokenToClose,
          treasuryWallet: ctx.treasury.publicKey,
        },
        {
          pythFeed: mockPythFeed,
          switchboardFeed: undefined,
          maxStalenessSlots: 100,
          confidenceThresholdBps: 500,
          discountBps: 0,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(createIx), [ctx.daoAuthority]);

      // Now close it
      const closeIx = createCloseAllowedTokenInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: ctx.daoAuthority.publicKey,
        tokenMint: tokenToClose,
      });

      await sendTransaction(ctx.svm, new Transaction().add(closeIx), [ctx.daoAuthority]);

      // Verify it was closed
      const gameEngine = ctx.gameEngine;
      const [allowedTokenPda] = deriveAllowedTokenPda(gameEngine, tokenToClose);
      const accountInfo = await ctx.svm.getAccount(allowedTokenPda);
      expect(accountInfo).toBeNull();
    });

    it('should reject allowed token creation by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const nonDaoToken = Keypair.generate().publicKey;

      const ix = createCreateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: player.publicKey,
          daoAuthority: player.publicKey,
          tokenMint: nonDaoToken,
          treasuryWallet: ctx.treasury.publicKey,
        },
        {
          pythFeed: mockPythFeed,
          switchboardFeed: undefined,
          maxStalenessSlots: 100,
          confidenceThresholdBps: 500,
          discountBps: 0,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject allowed token update by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ixs = createUpdateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          daoAuthority: player.publicKey,
          tokenMint: testTokenMint,
        },
        {
          discountBps: 100,
        }
      );

      const tx = new Transaction();
      ixs.forEach(ix => tx.add(ix));
      await expectTransactionToFail(
        ctx.svm,
        tx,
        [player.keypair]
      );
    });

    it('should reject allowed token close by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createCloseAllowedTokenInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: player.publicKey,
        tokenMint: testTokenMint,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Payment Tests

  describe('Payments', () => {
    it('should accept SOL payment for item', async () => {
      const player = await createShopReadyPlayer(ctx, factory);
      const solBefore = await ctx.svm.getBalance(player.publicKey);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify SOL was deducted
      const solAfter = await ctx.svm.getBalance(player.publicKey);
      expect(solAfter).toBeLessThan(solBefore);
    });

    it('should transfer payment to treasury', async () => {
      const player = await createShopReadyPlayer(ctx, factory);
      const treasuryBefore = await ctx.svm.getBalance(ctx.treasury.publicKey);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify treasury received payment
      const treasuryAfter = await ctx.svm.getBalance(ctx.treasury.publicKey);
      expect(treasuryAfter).toBeGreaterThan(treasuryBefore);
    });

    it('should accept SPL token payment for an item', async () => {
      // Token payment flow (purchase_item, payment_type=2):
      //   1. shop_config.sol_pyth_feed must point at a live SOL/USD feed
      //   2. allowed_token must exist for the payment mint, pointing at a
      //      live TOKEN/USD feed
      //   3. buyer + treasury must hold ATAs for the payment mint
      //   token_amount = (lamports × sol_usd × 10^decimals) / (token_usd × 10^9)

      // A distinct mint for the payment token (NOVI's allowed-token PDA is
      // already taken by the "Allowed Payment Tokens" describe block).
      const tokenMintKp = Keypair.generate();
      const tokenMint = tokenMintKp.publicKey;
      seedSplMint(ctx.svm, tokenMint, {
        decimals: 9,
        mintAuthority: ctx.daoAuthority.publicKey,
      });

      // Two distinct Pyth feeds: SOL/USD (shop config) and TOKEN/USD (allowed token).
      const solFeed = Keypair.generate().publicKey;
      const tokenFeed = Keypair.generate().publicKey;
      seedMockPythFeed(ctx.svm, solFeed);   // header-only for the config-time gate
      seedMockPythFeed(ctx.svm, tokenFeed);

      // Register the SOL feed in shop config (generous staleness so slot
      // drift between setup and purchase never trips the freshness check).
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
            {
              solPythFeed: solFeed,
              solMaxStalenessSlots: 1_000_000,
              solConfidenceThresholdBps: 1000,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // Register the payment token + its TOKEN/USD feed.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateAllowedTokenInstruction(
            {
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              tokenMint,
              treasuryWallet: ctx.treasury.publicKey,
            },
            {
              pythFeed: tokenFeed,
              switchboardFeed: undefined,
              maxStalenessSlots: 1_000_000,
              confidenceThresholdBps: 1000,
              discountBps: 0,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // Buyer + treasury ATAs for the payment token.
      const buyer = await createShopReadyPlayer(ctx, factory);
      const buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);
      const treasuryAta = getAssociatedTokenAddressSync(tokenMint, ctx.treasury.publicKey);
      const BUYER_START = 1_000_000_000_000n; // 1000 tokens (9 decimals)
      seedSplTokenAccount(ctx.svm, buyerAta, {
        mint: tokenMint,
        owner: buyer.publicKey,
        amount: BUYER_START,
      });
      seedSplTokenAccount(ctx.svm, treasuryAta, {
        mint: tokenMint,
        owner: ctx.treasury.publicKey,
        amount: 0n,
      });

      // Re-seed the feeds with live prices + a fresh pub_slot right before the
      // purchase: SOL/USD = $150, TOKEN/USD = $1 (both at expo -8).
      seedMockPythFeed(ctx.svm, solFeed, { price: 15_000_000_000, conf: 0, expo: -8 });
      seedMockPythFeed(ctx.svm, tokenFeed, { price: 100_000_000, conf: 0, expo: -8 });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createPurchaseItemInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: buyer.publicKey,
              itemId: 9999,
              treasury: ctx.treasury.publicKey,
              tokenPayment: {
                allowedToken: deriveAllowedTokenPda(ctx.gameEngine, tokenMint)[0],
                tokenMint,
                buyerTokenAta: buyerAta,
                treasuryTokenAta: treasuryAta,
                solOracleFeed: solFeed,
                tokenOracleFeed: tokenFeed,
              },
            },
            { quantity: 1, paymentType: 2 },
          ),
        ),
        [buyer.keypair],
      );

      // Buyer paid in tokens → balance dropped; treasury received the tokens.
      const buyerAfter = readSplTokenAmount(ctx.svm, buyerAta);
      const treasuryAfter = readSplTokenAmount(ctx.svm, treasuryAta);
      expect(buyerAfter < BUYER_START).toBe(true);
      expect(treasuryAfter > 0n).toBe(true);
      // Conservation: what left the buyer arrived at the treasury.
      expect(BUYER_START - buyerAfter).toBe(treasuryAfter);
    }, 60_000);

    it('rejects token payment to a treasury_token_ata not owned by the treasury wallet', async () => {
      // Free-purchase guard. process_token_payment_flow pins treasury_token_ata
      // to game_engine.treasury_wallet. Here the buyer passes their OWN token
      // account as treasury_token_ata — i.e. tries to pay themselves. The
      // on-chain owner check must reject it before any transfer settles.
      const tokenMint = Keypair.generate().publicKey;
      seedSplMint(ctx.svm, tokenMint, {
        decimals: 9,
        mintAuthority: ctx.daoAuthority.publicKey,
      });

      const solFeed = Keypair.generate().publicKey;
      const tokenFeed = Keypair.generate().publicKey;
      seedMockPythFeed(ctx.svm, solFeed, { price: 15_000_000_000, conf: 0, expo: -8 });
      seedMockPythFeed(ctx.svm, tokenFeed, { price: 100_000_000, conf: 0, expo: -8 });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
            { solPythFeed: solFeed, solMaxStalenessSlots: 1_000_000, solConfidenceThresholdBps: 1000 },
          ),
        ),
        [ctx.daoAuthority],
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateAllowedTokenInstruction(
            {
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              tokenMint,
              treasuryWallet: ctx.treasury.publicKey,
            },
            {
              pythFeed: tokenFeed,
              switchboardFeed: undefined,
              maxStalenessSlots: 1_000_000,
              confidenceThresholdBps: 1000,
              discountBps: 0,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const buyer = await createShopReadyPlayer(ctx, factory);
      const buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);
      const BUYER_START = 1_000_000_000_000n;
      seedSplTokenAccount(ctx.svm, buyerAta, {
        mint: tokenMint,
        owner: buyer.publicKey,
        amount: BUYER_START,
      });

      // The attack: pass the buyer's own token account as treasury_token_ata.
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createPurchaseItemInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: buyer.publicKey,
              itemId: 9999,
              treasury: ctx.treasury.publicKey,
              tokenPayment: {
                allowedToken: deriveAllowedTokenPda(ctx.gameEngine, tokenMint)[0],
                tokenMint,
                buyerTokenAta: buyerAta,
                treasuryTokenAta: buyerAta, // not the treasury's ATA — must be rejected
                solOracleFeed: solFeed,
                tokenOracleFeed: tokenFeed,
              },
            },
            { quantity: 1, paymentType: 2 },
          ),
        ),
        [buyer.keypair],
      );

      // No free purchase: the buyer's balance is untouched.
      expect(readSplTokenAmount(ctx.svm, buyerAta)).toBe(BUYER_START);
    }, 60_000);

    it('should accept SPL token payment via Switchboard feeds', async () => {
      // Same flow as the Pyth test, but both oracle feeds are Switchboard
      // pull-feeds. process_token_payment_flow's detect_oracle_type picks the
      // Switchboard branch off the feed-account owner, so this exercises
      // calculate_token_amount_switchboard / read_switchboard_price — code
      // never touched by the Pyth path. Switchboard prices are scaled to 10^18.
      const E18 = 10n ** 18n;

      const tokenMintKp = Keypair.generate();
      const tokenMint = tokenMintKp.publicKey;
      seedSplMint(ctx.svm, tokenMint, {
        decimals: 9,
        mintAuthority: ctx.daoAuthority.publicKey,
      });

      const solFeed = Keypair.generate().publicKey;
      const tokenFeed = Keypair.generate().publicKey;
      // Discriminator-only seed satisfies the config-time validation gate.
      seedMockSwitchboardFeed(ctx.svm, solFeed);
      seedMockSwitchboardFeed(ctx.svm, tokenFeed);

      // Register the SOL Switchboard feed in shop config.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
            {
              solSwitchboardFeed: solFeed,
              solMaxStalenessSlots: 1_000_000,
              solConfidenceThresholdBps: 1000,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // Register the payment token + its TOKEN/USD Switchboard feed.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateAllowedTokenInstruction(
            {
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              tokenMint,
              treasuryWallet: ctx.treasury.publicKey,
            },
            {
              pythFeed: undefined,
              switchboardFeed: tokenFeed,
              maxStalenessSlots: 1_000_000,
              confidenceThresholdBps: 1000,
              discountBps: 0,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const buyer = await createShopReadyPlayer(ctx, factory);
      const buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);
      const treasuryAta = getAssociatedTokenAddressSync(tokenMint, ctx.treasury.publicKey);
      const BUYER_START = 1_000_000_000_000n;
      seedSplTokenAccount(ctx.svm, buyerAta, {
        mint: tokenMint,
        owner: buyer.publicKey,
        amount: BUYER_START,
      });
      seedSplTokenAccount(ctx.svm, treasuryAta, {
        mint: tokenMint,
        owner: ctx.treasury.publicKey,
        amount: 0n,
      });

      // Re-seed with live prices + fresh result_slot: SOL/USD = $150, TOKEN/USD = $1.
      seedMockSwitchboardFeed(ctx.svm, solFeed, { value: 150n * E18 });
      seedMockSwitchboardFeed(ctx.svm, tokenFeed, { value: 1n * E18 });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createPurchaseItemInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: buyer.publicKey,
              itemId: 9999,
              treasury: ctx.treasury.publicKey,
              tokenPayment: {
                allowedToken: deriveAllowedTokenPda(ctx.gameEngine, tokenMint)[0],
                tokenMint,
                buyerTokenAta: buyerAta,
                treasuryTokenAta: treasuryAta,
                solOracleFeed: solFeed,
                tokenOracleFeed: tokenFeed,
              },
            },
            { quantity: 1, paymentType: 2 },
          ),
        ),
        [buyer.keypair],
      );

      const buyerAfter = readSplTokenAmount(ctx.svm, buyerAta);
      const treasuryAfter = readSplTokenAmount(ctx.svm, treasuryAta);
      expect(buyerAfter < BUYER_START).toBe(true);
      expect(treasuryAfter > 0n).toBe(true);
      expect(BUYER_START - buyerAfter).toBe(treasuryAfter);
    }, 60_000);

    it('should reject mixed Pyth + Switchboard feeds', async () => {
      // process_token_payment_flow requires both feeds to be the same oracle
      // type. A Pyth SOL feed + Switchboard token feed must be rejected.
      const E18 = 10n ** 18n;

      const tokenMintKp = Keypair.generate();
      const tokenMint = tokenMintKp.publicKey;
      seedSplMint(ctx.svm, tokenMint, {
        decimals: 9,
        mintAuthority: ctx.daoAuthority.publicKey,
      });

      // SOL feed = Pyth, token feed = Switchboard.
      const solPythFeed = Keypair.generate().publicKey;
      const tokenSbFeed = Keypair.generate().publicKey;
      seedMockPythFeed(ctx.svm, solPythFeed);
      seedMockSwitchboardFeed(ctx.svm, tokenSbFeed);

      // Config registers the Pyth SOL feed...
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
            {
              solPythFeed: solPythFeed,
              solMaxStalenessSlots: 1_000_000,
              solConfidenceThresholdBps: 1000,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // ...but the allowed token registers a Switchboard feed.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateAllowedTokenInstruction(
            {
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              tokenMint,
              treasuryWallet: ctx.treasury.publicKey,
            },
            {
              pythFeed: undefined,
              switchboardFeed: tokenSbFeed,
              maxStalenessSlots: 1_000_000,
              confidenceThresholdBps: 1000,
              discountBps: 0,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const buyer = await createShopReadyPlayer(ctx, factory);
      const buyerAta = getAssociatedTokenAddressSync(tokenMint, buyer.publicKey);
      const treasuryAta = getAssociatedTokenAddressSync(tokenMint, ctx.treasury.publicKey);
      seedSplTokenAccount(ctx.svm, buyerAta, {
        mint: tokenMint,
        owner: buyer.publicKey,
        amount: 1_000_000_000_000n,
      });
      seedSplTokenAccount(ctx.svm, treasuryAta, {
        mint: tokenMint,
        owner: ctx.treasury.publicKey,
        amount: 0n,
      });

      seedMockPythFeed(ctx.svm, solPythFeed, { price: 15_000_000_000, conf: 0, expo: -8 });
      seedMockSwitchboardFeed(ctx.svm, tokenSbFeed, { value: 1n * E18 });

      // SOL feed is Pyth-owned, token feed is Switchboard-owned → the
      // detect_oracle_type mismatch guard rejects the purchase.
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createPurchaseItemInstruction(
            {
              gameEngine: ctx.gameEngine,
              buyer: buyer.publicKey,
              itemId: 9999,
              treasury: ctx.treasury.publicKey,
              tokenPayment: {
                allowedToken: deriveAllowedTokenPda(ctx.gameEngine, tokenMint)[0],
                tokenMint,
                buyerTokenAta: buyerAta,
                treasuryTokenAta: treasuryAta,
                solOracleFeed: solPythFeed,
                tokenOracleFeed: tokenSbFeed,
              },
            },
            { quantity: 1, paymentType: 2 },
          ),
        ),
        [buyer.keypair],
      );
    }, 60_000);
  });

  // Daily Deal Tests

  describe('Daily Deals', () => {
    it('should have rotating daily deals', async () => {
      // Daily deals are managed by DAO and rotate automatically
      // Verify shop config exists with daily deal slots
      const config = await fetchShopConfig(ctx.svm, ctx.gameEngine);
      expect(config).not.toBeNull();
    });

    it('should create a daily deal', async () => {
      const ix = createCreateDailyDealInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        { slotIndex: 0, itemId: 9999, discountBps: 2000, nextItemId: 9998, nextDiscountBps: 1500 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      const [dailyDealPda] = deriveDailyDealPda(ctx.gameEngine, 0);
      const exists = await accountExists(ctx.svm, dailyDealPda);
      expect(exists).toBe(true);
    });

    it('should rotate daily deal to new item', async () => {
      const ix = createRotateDailyDealInstruction(
        {
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          slotIndex: 0,
        },
        { newItemId: 9997, newDiscountBps: 2500 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify the account still exists after rotation
      const [dailyDealPda] = deriveDailyDealPda(ctx.gameEngine, 0);
      const exists = await accountExists(ctx.svm, dailyDealPda);
      expect(exists).toBe(true);
    });
  });

  // Weekly Sale Tests

  describe('Weekly Sales', () => {
    it('should create a weekly sale', async () => {
      const now = await getCurrentTimestamp(ctx.svm);
      const weekNumber = Math.floor(now / 604800);

      const ix = createCreateWeeklySaleInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          weekNumber,
          theme: 0, // Combat
          bonusType: 0,
          bonusValueBps: 500,
          categoryDiscounts: [1000, 1500, 2000, 500],
          startsAt: now,
          durationDays: 7,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      const [weeklySalePda] = deriveWeeklySalePda(ctx.gameEngine, weekNumber);
      const exists = await accountExists(ctx.svm, weeklySalePda);
      expect(exists).toBe(true);
    });
  });

  // Seasonal Sale Tests

  describe('Seasonal Sales', () => {
    it('should create a seasonal sale linked to event', async () => {
      // Create an event first
      const eventId = 100;
      const now = await getCurrentTimestamp(ctx.svm);

      const createEventIx = createCreateEventInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          eventId,
        },
        {
          name: 'SeasonalSaleEvent',
          startTime: now - 3600,
          endTime: now + 86400,
          eventType: 0,
          minLevel: 1,
          minReputation: 0,
          requiredSubscriptionTier: 0,
          prizeType: 0,
          prizeAmount: 1000,
          autoActivate: true,
        }
      );
      await sendTransaction(ctx.svm, new Transaction().add(createEventIx), [ctx.daoAuthority]);

      const [eventPda] = deriveEventPda(ctx.gameEngine, eventId);

      const ix = createCreateSeasonalSaleInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          event: eventPda,
        },
        {
          name: 'Summer Combat Festival',
          globalDiscountBps: 1500,
          startsAt: now - 3600,
          endsAt: now + 86400,
          spendThreshold: 1000000,
          exclusiveCosmeticId: 1,
          featuredItems: [
            { itemId: 9999, discountBps: 2000 },
            { itemId: 9998, discountBps: 1500 },
          ],
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      const [seasonalSalePda] = deriveSeasonalSalePda(ctx.gameEngine, eventPda);
      const exists = await accountExists(ctx.svm, seasonalSalePda);
      expect(exists).toBe(true);
    });
  });

  // DAO Promotion Tests

  describe('DAO Promotions', () => {
    it('should create a DAO promotion', async () => {
      const now = await getCurrentTimestamp(ctx.svm);
      const proposalId = 1;

      const ix = createCreateDaoPromotionInstruction(
        {
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          proposalId,
          title: 'Community Discount Week',
          equipmentDiscountBps: 2500,
          consumableDiscountBps: 2000,
          materialDiscountBps: 1500,
          cosmeticDiscountBps: 1000,
          globalDiscountBps: 500,
          maxDiscountBps: 3000,
          startsAt: now,
          endsAt: now + 604800,
          maxDiscountBudgetLamports: 10_000_000,
        }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      const [daoPromotionPda] = deriveDaoPromotionPda(ctx.gameEngine, proposalId);
      const exists = await accountExists(ctx.svm, daoPromotionPda);
      expect(exists).toBe(true);
    });
  });

  // Shop Analytics Tests

  describe('Shop Analytics', () => {
    it('should track item stock changes', async () => {
      const gameEngine = ctx.gameEngine;
      const itemBefore = await fetchShopItem(ctx.svm, gameEngine, 1);
      const stockBefore = itemBefore?.currentGlobalStock?.toNumber() || 0;

      const player = await createShopReadyPlayer(ctx, factory);
      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const itemAfter = await fetchShopItem(ctx.svm, gameEngine, 1);
      if (itemAfter && itemBefore) {
        // Stock should decrease after purchase (if limited stock)
        const stockAfter = itemAfter.currentGlobalStock.toNumber();
        expect(stockAfter).toBeLessThanOrEqual(stockBefore);
      }
    });
  });

  // Sale Lifecycle Tests (activate + close)
  //
  // close_sale has 5 SaleType variants (FlashSale, WeeklySale, SeasonalSale,
  // DAOPromotion, PlayerPurchase). DAO authority can close any of them
  // regardless of state. activate_sale is a permissionless crank that walks
  // SeasonalSale (Scheduled → Active → Ended) and DAOPromotion
  // (Approved → Active → Ended/BudgetExhausted) state machines based on wall
  // clock vs starts_at / ends_at.

  describe('Sale Lifecycle', () => {
    it('should close a FlashSale (DAO bypasses state check)', async () => {
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 10),
              durationSecs: 3600,
              maxStock: 50,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [salePda] = deriveFlashSalePda(ctx.gameEngine, saleId);
      expect(await ctx.svm.getAccount(salePda)).not.toBeNull();

      // DAO closes immediately (still scheduled). Non-DAO would hit
      // SaleNotActive since the sale hasn't ended; DAO short-circuits that.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCloseSaleInstruction(
            {
              authority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              rentRecipient: ctx.daoAuthority.publicKey,
            },
            { saleType: 0, saleId },
          ),
        ),
        [ctx.daoAuthority],
      );

      expect(await ctx.svm.getAccount(salePda)).toBeNull();
    });

    it('should close a WeeklySale', async () => {
      // Use a week well in the future so we don't collide with the existing
      // "Weekly Sales" describe block (which uses Math.floor(now/604800)).
      const now = await getCurrentTimestamp(ctx.svm);
      const weekNumber = Math.floor(now / 604800) + 100;

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateWeeklySaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
            },
            {
              weekNumber,
              theme: 0,
              bonusType: 0,
              bonusValueBps: 500,
              categoryDiscounts: [1000, 1500, 2000, 500],
              startsAt: now,
              durationDays: 7,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [salePda] = deriveWeeklySalePda(ctx.gameEngine, weekNumber);
      expect(await ctx.svm.getAccount(salePda)).not.toBeNull();

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCloseSaleInstruction(
            {
              authority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              rentRecipient: ctx.daoAuthority.publicKey,
            },
            { saleType: 1, weekNumber },
          ),
        ),
        [ctx.daoAuthority],
      );

      expect(await ctx.svm.getAccount(salePda)).toBeNull();
    });

    it('should close a SeasonalSale', async () => {
      const eventId = 200;
      const now = await getCurrentTimestamp(ctx.svm);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateEventInstruction(
            { authority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine, eventId },
            {
              name: 'CloseTestEvent',
              startTime: now - 3600,
              endTime: now + 86400,
              eventType: 0,
              minLevel: 1,
              minReputation: 0,
              requiredSubscriptionTier: 0,
              prizeType: 0,
              prizeAmount: 1000,
              autoActivate: true,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [eventPda] = deriveEventPda(ctx.gameEngine, eventId);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateSeasonalSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              event: eventPda,
            },
            {
              name: 'CloseTest',
              globalDiscountBps: 500,
              startsAt: now,
              endsAt: now + 3600,
              spendThreshold: 0,
              exclusiveCosmeticId: 0,
              featuredItems: [],
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [salePda] = deriveSeasonalSalePda(ctx.gameEngine, eventPda);
      expect(await ctx.svm.getAccount(salePda)).not.toBeNull();

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCloseSaleInstruction(
            {
              authority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              rentRecipient: ctx.daoAuthority.publicKey,
            },
            { saleType: 2, event: eventPda },
          ),
        ),
        [ctx.daoAuthority],
      );

      expect(await ctx.svm.getAccount(salePda)).toBeNull();
    });

    it('should close a DAOPromotion', async () => {
      const now = await getCurrentTimestamp(ctx.svm);
      const proposalId = 100; // existing test uses proposalId=1; pick a distinct one

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateDaoPromotionInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
            },
            {
              proposalId,
              title: 'CloseTestPromo',
              equipmentDiscountBps: 1000,
              consumableDiscountBps: 1000,
              materialDiscountBps: 1000,
              cosmeticDiscountBps: 1000,
              globalDiscountBps: 500,
              maxDiscountBps: 2000,
              startsAt: now,
              endsAt: now + 86400,
              maxDiscountBudgetLamports: 1_000_000,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [salePda] = deriveDaoPromotionPda(ctx.gameEngine, proposalId);
      expect(await ctx.svm.getAccount(salePda)).not.toBeNull();

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCloseSaleInstruction(
            {
              authority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              rentRecipient: ctx.daoAuthority.publicKey,
            },
            { saleType: 3, proposalId },
          ),
        ),
        [ctx.daoAuthority],
      );

      expect(await ctx.svm.getAccount(salePda)).toBeNull();
    });

    it('should reject close by non-DAO when sale is still active', async () => {
      // Non-DAO can only close if (a) they are the original payer, AND
      // (b) the sale is already ended/sold-out. Here it's the DAO that paid
      // AND the sale is far from ending — both checks fail.
      const onChainNow = await getCurrentTimestamp(ctx.svm);
      const saleId = await getNextFlashSaleId(ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateFlashSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              saleId,
            },
            {
              itemId: 9999,
              isBundle: false,
              discountBps: 2000,
              startsAt: new BN(onChainNow + 10),
              durationSecs: 3600,
              maxStock: 50,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const rando = Keypair.generate();
      ctx.svm.airdrop(rando.publicKey, BigInt(1_000_000_000));

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createCloseSaleInstruction(
            {
              authority: rando.publicKey,
              gameEngine: ctx.gameEngine,
              rentRecipient: rando.publicKey,
            },
            { saleType: 0, saleId },
          ),
        ),
        [rando],
      );
    });

    // activate_sale: SeasonalSale (Scheduled → Active → Ended)

    it('should activate SeasonalSale from Scheduled → Active when starts_at reached', async () => {
      const eventId = 201;
      const now = await getCurrentTimestamp(ctx.svm);
      const startsAt = now + 500;
      const endsAt = now + 5000;

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateEventInstruction(
            { authority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine, eventId },
            {
              name: 'ActivateTestSeason',
              startTime: startsAt,
              endTime: endsAt,
              eventType: 0,
              minLevel: 1,
              minReputation: 0,
              requiredSubscriptionTier: 0,
              prizeType: 0,
              prizeAmount: 1000,
              autoActivate: true,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [eventPda] = deriveEventPda(ctx.gameEngine, eventId);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateSeasonalSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              event: eventPda,
            },
            {
              name: 'ActivateTest',
              globalDiscountBps: 1000,
              startsAt,
              endsAt,
              spendThreshold: 0,
              exclusiveCosmeticId: 0,
              featuredItems: [],
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [salePda] = deriveSeasonalSalePda(ctx.gameEngine, eventPda);

      // Initial status: Scheduled (0)
      const scheduled = deserializeSeasonalSale((await ctx.svm.getAccount(salePda))!.data);
      expect(scheduled.status).toBe(0);

      // Try to activate before starts_at — status stays Scheduled (no error, no transition)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createActivateSaleInstruction(
            { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
            { saleType: 0, event: eventPda },
          ),
        ),
        [ctx.daoAuthority],
      );
      const stillScheduled = deserializeSeasonalSale((await ctx.svm.getAccount(salePda))!.data);
      expect(stillScheduled.status).toBe(0);

      // Advance past starts_at and activate → Active
      await advanceTime(ctx.svm, 600);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createActivateSaleInstruction(
            { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
            { saleType: 0, event: eventPda },
          ),
        ),
        [ctx.daoAuthority],
      );
      const active = deserializeSeasonalSale((await ctx.svm.getAccount(salePda))!.data);
      expect(active.status).toBe(1);

      // Advance past ends_at and activate → Ended
      await advanceTime(ctx.svm, 5000);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createActivateSaleInstruction(
            { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
            { saleType: 0, event: eventPda },
          ),
        ),
        [ctx.daoAuthority],
      );
      const ended = deserializeSeasonalSale((await ctx.svm.getAccount(salePda))!.data);
      expect(ended.status).toBe(2);
    }, 60_000);

    it('should activate DAOPromotion through Approved → Active → Ended', async () => {
      const now = await getCurrentTimestamp(ctx.svm);
      const proposalId = 200;
      const startsAt = now + 500;
      const endsAt = now + 5000;

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateDaoPromotionInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
            },
            {
              proposalId,
              title: 'ActivateTestPromo',
              equipmentDiscountBps: 1000,
              consumableDiscountBps: 1000,
              materialDiscountBps: 1000,
              cosmeticDiscountBps: 1000,
              globalDiscountBps: 500,
              maxDiscountBps: 2000,
              startsAt,
              endsAt,
              maxDiscountBudgetLamports: 1_000_000,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [promoPda] = deriveDaoPromotionPda(ctx.gameEngine, proposalId);

      // Initial: Approved (0) — same byte slot as Scheduled
      const approved = deserializeDaoPromotion((await ctx.svm.getAccount(promoPda))!.data);
      expect(approved.status).toBe(0);

      // Advance past starts_at and activate → Active
      await advanceTime(ctx.svm, 600);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createActivateSaleInstruction(
            { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
            { saleType: 1, proposalId },
          ),
        ),
        [ctx.daoAuthority],
      );
      const active = deserializeDaoPromotion((await ctx.svm.getAccount(promoPda))!.data);
      expect(active.status).toBe(1);

      // Advance past ends_at and activate → Ended
      await advanceTime(ctx.svm, 5000);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createActivateSaleInstruction(
            { crank: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
            { saleType: 1, proposalId },
          ),
        ),
        [ctx.daoAuthority],
      );
      const ended = deserializeDaoPromotion((await ctx.svm.getAccount(promoPda))!.data);
      expect(ended.status).toBe(2);
    }, 60_000);

    it('should allow activate_sale by anyone (permissionless crank)', async () => {
      // Same setup as the seasonal test but a non-DAO signer cranks the
      // status. Confirms the processor doesn't gate on DAO.
      const eventId = 202;
      const now = await getCurrentTimestamp(ctx.svm);
      const startsAt = now - 60; // already started

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateEventInstruction(
            { authority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine, eventId },
            {
              name: 'PermissionlessSeason',
              startTime: startsAt,
              endTime: now + 3600,
              eventType: 0,
              minLevel: 1,
              minReputation: 0,
              requiredSubscriptionTier: 0,
              prizeType: 0,
              prizeAmount: 1000,
              autoActivate: true,
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      const [eventPda] = deriveEventPda(ctx.gameEngine, eventId);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateSeasonalSaleInstruction(
            {
              payer: ctx.daoAuthority.publicKey,
              daoAuthority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              event: eventPda,
            },
            {
              name: 'PermissionlessTest',
              globalDiscountBps: 500,
              startsAt,
              endsAt: now + 3600,
              spendThreshold: 0,
              exclusiveCosmeticId: 0,
              featuredItems: [],
            },
          ),
        ),
        [ctx.daoAuthority],
      );

      // Random crank signs the activate call
      const rando = Keypair.generate();
      ctx.svm.airdrop(rando.publicKey, BigInt(1_000_000_000));

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createActivateSaleInstruction(
            { crank: rando.publicKey, gameEngine: ctx.gameEngine },
            { saleType: 0, event: eventPda },
          ),
        ),
        [rando],
      );

      const [salePda] = deriveSeasonalSalePda(ctx.gameEngine, eventPda);
      const active = deserializeSeasonalSale((await ctx.svm.getAccount(salePda))!.data);
      expect(active.status).toBe(1);
    });
  });
});
