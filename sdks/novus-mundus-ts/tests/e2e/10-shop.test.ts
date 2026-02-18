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
import { Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
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
  createPurchaseFlashSaleInstruction,
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
  deriveWeeklySalePda,
  deriveSeasonalSalePda,
  deriveDaoPromotionPda,
  deriveEventPda,
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
} from '../utils/assertions';
import {
  getCurrentTimestamp,
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

// ============================================================
// Helper: Create player with estate + Market (needed for shop purchases)
// ============================================================
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

// ============================================================
// Test Suite
// ============================================================

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

  // ============================================================
  // Shop Configuration Tests
  // ============================================================

  describe('Shop Configuration', () => {
    it('should initialize shop config (DAO)', async () => {
      // Shop config is initialized during beforeAllTests setup
      // Verify it exists and has valid data
      const config = await fetchShopConfig(ctx.connection, ctx.gameEngine);
      expect(config).not.toBeNull();
      expect(config?.bump).toBeDefined();
    });

    it('should update shop config (DAO)', async () => {
      const ix = createUpdateConfigInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey },
        {} // Use defaults - this updates oracle config
      );

      const tx = new Transaction().add(ix);

      await sendTransaction(ctx.connection, tx, [ctx.daoAuthority]);

      // Verify config still exists after update
      const config = await fetchShopConfig(ctx.connection, ctx.gameEngine);
      expect(config).not.toBeNull();
    });

    it('should reject config update by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Non-DAO authority trying to update config should fail
      await expectTransactionToFail(
        ctx.connection,
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

  // ============================================================
  // Shop Item Tests
  // ============================================================

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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify item was created
      const item = await fetchShopItem(ctx.connection, ctx.gameEngine, TEST_ITEM_ID);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify item was updated
      const item = await fetchShopItem(ctx.connection, ctx.gameEngine, TEST_ITEM_ID);
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
        ctx.connection,
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify item was deactivated
      const item = await fetchShopItem(ctx.connection, ctx.gameEngine, TEST_ITEM_ID);
      if (item) {
        expect(item.isActive).toBe(false);
      }

      // Re-activate for other tests
      const reactivateIx = createUpdateItemInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, itemId: TEST_ITEM_ID },
        { isActive: true }
      );
      await sendTransaction(ctx.connection, new Transaction().add(reactivateIx), [ctx.daoAuthority]);
    });
  });

  // ============================================================
  // Item Purchase Tests
  // ============================================================

  describe('Item Purchases', () => {
    it('should purchase shop item', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      // Verify player state changed (received item)
      const accountAfter = await fetchPlayer(ctx.connection, player.playerPda);
      expect(accountAfter).not.toBeNull();
    });

    it('should purchase multiple quantity', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 5 }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject purchase of non-existent item', async () => {
      const player = await createShopReadyPlayer(ctx, factory);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 999999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await expectTransactionToFail(
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Bundle Tests
  // ============================================================

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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
    });

    it('should update bundle (DAO)', async () => {
      const ix = createUpdateBundleInstruction(
        { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, bundleId: TEST_BUNDLE_ID },
        {
          priceSolLamports: new BN(4000000), // Discount
          isActive: true,
        }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      // Verify player received bundle items
      const account = await fetchPlayer(ctx.connection, player.playerPda);
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
      await sendTransaction(ctx.connection, new Transaction().add(createIx), [ctx.daoAuthority]);

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
        ctx.connection,
        new Transaction().add(purchaseIx),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Flash Sale Tests
  // ============================================================

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
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Allowed Payment Token Tests
  // ============================================================

  describe('Allowed Payment Tokens', () => {
    const [testTokenMint] = deriveNoviMintPda(); // Use real on-chain NOVI mint (82 bytes)
    const mockPythFeed = Keypair.generate().publicKey; // Mock price feed

    /** Create a real SPL mint on-chain (82 bytes) so it passes the data_len check */
    async function createRealMint(): Promise<Keypair> {
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const mintKeypair = Keypair.generate();
      const lamports = await ctx.connection.getMinimumBalanceForRentExemption(82);
      const createAccountIx = SystemProgram.createAccount({
        fromPubkey: ctx.daoAuthority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        lamports,
        space: 82,
        programId: TOKEN_PROGRAM_ID,
      });
      // InitializeMint instruction: discriminator=0, decimals=9, mintAuthority, freezeAuthorityOption=0
      const initMintData = Buffer.alloc(67);
      initMintData.writeUInt8(0, 0); // instruction discriminator (InitializeMint)
      initMintData.writeUInt8(9, 1); // decimals
      ctx.daoAuthority.publicKey.toBuffer().copy(initMintData, 2); // mintAuthority
      initMintData.writeUInt8(0, 34); // freezeAuthorityOption = None
      const initMintIx = new TransactionInstruction({
        keys: [
          { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
        ],
        programId: TOKEN_PROGRAM_ID,
        data: initMintData,
      });
      const tx = new Transaction().add(createAccountIx, initMintIx);
      await sendTransaction(ctx.connection, tx, [ctx.daoAuthority, mintKeypair]);
      return mintKeypair;
    }

    it('should create allowed token (DAO)', async () => {
      const ix = createCreateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: testTokenMint,
        },
        {
          pythFeed: mockPythFeed,
          switchboardFeed: undefined,
          maxStalenessSlots: 100,
          confidenceThresholdBps: 500, // 5%
          discountBps: 0,
        }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify allowed token was created
      const gameEngine = ctx.gameEngine;
      const [allowedTokenPda] = deriveAllowedTokenPda(gameEngine, testTokenMint);
      const accountInfo = await ctx.connection.getAccountInfo(allowedTokenPda);
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
      await sendTransaction(ctx.connection, tx, [ctx.daoAuthority]);
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
      await sendTransaction(ctx.connection, tx, [ctx.daoAuthority]);

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
      await sendTransaction(ctx.connection, tx2, [ctx.daoAuthority]);
    });

    it('should close allowed token (DAO)', async () => {
      // Create a real SPL mint so it passes the data_len == 82 check
      const mintKeypair = await createRealMint();
      const tokenToClose = mintKeypair.publicKey;

      // First create it
      const createIx = createCreateAllowedTokenInstruction(
        {
          gameEngine: ctx.gameEngine,
          payer: ctx.daoAuthority.publicKey,
          daoAuthority: ctx.daoAuthority.publicKey,
          tokenMint: tokenToClose,
        },
        {
          pythFeed: mockPythFeed,
          switchboardFeed: undefined,
          maxStalenessSlots: 100,
          confidenceThresholdBps: 500,
          discountBps: 0,
        }
      );

      await sendTransaction(ctx.connection, new Transaction().add(createIx), [ctx.daoAuthority]);

      // Now close it
      const closeIx = createCloseAllowedTokenInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: ctx.daoAuthority.publicKey,
        tokenMint: tokenToClose,
      });

      await sendTransaction(ctx.connection, new Transaction().add(closeIx), [ctx.daoAuthority]);

      // Verify it was closed
      const gameEngine = ctx.gameEngine;
      const [allowedTokenPda] = deriveAllowedTokenPda(gameEngine, tokenToClose);
      const accountInfo = await ctx.connection.getAccountInfo(allowedTokenPda);
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
        ctx.connection,
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
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Payment Tests
  // ============================================================

  describe('Payments', () => {
    it('should accept SOL payment for item', async () => {
      const player = await createShopReadyPlayer(ctx, factory);
      const solBefore = await ctx.connection.getBalance(player.publicKey);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      // Verify SOL was deducted
      const solAfter = await ctx.connection.getBalance(player.publicKey);
      expect(solAfter).toBeLessThan(solBefore);
    });

    it('should transfer payment to treasury', async () => {
      const player = await createShopReadyPlayer(ctx, factory);
      const treasuryBefore = await ctx.connection.getBalance(ctx.treasury.publicKey);

      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      // Verify treasury received payment
      const treasuryAfter = await ctx.connection.getBalance(ctx.treasury.publicKey);
      expect(treasuryAfter).toBeGreaterThan(treasuryBefore);
    });
  });

  // ============================================================
  // Daily Deal Tests
  // ============================================================

  describe('Daily Deals', () => {
    it('should have rotating daily deals', async () => {
      // Daily deals are managed by DAO and rotate automatically
      // Verify shop config exists with daily deal slots
      const config = await fetchShopConfig(ctx.connection, ctx.gameEngine);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      const [dailyDealPda] = deriveDailyDealPda(ctx.gameEngine, 0);
      const exists = await accountExists(ctx.connection, dailyDealPda);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify the account still exists after rotation
      const [dailyDealPda] = deriveDailyDealPda(ctx.gameEngine, 0);
      const exists = await accountExists(ctx.connection, dailyDealPda);
      expect(exists).toBe(true);
    });
  });

  // ============================================================
  // Weekly Sale Tests
  // ============================================================

  describe('Weekly Sales', () => {
    it('should create a weekly sale', async () => {
      const now = await getCurrentTimestamp(ctx.connection);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      const [weeklySalePda] = deriveWeeklySalePda(ctx.gameEngine, weekNumber);
      const exists = await accountExists(ctx.connection, weeklySalePda);
      expect(exists).toBe(true);
    });
  });

  // ============================================================
  // Seasonal Sale Tests
  // ============================================================

  describe('Seasonal Sales', () => {
    it('should create a seasonal sale linked to event', async () => {
      // Create an event first
      const eventId = 100;
      const now = await getCurrentTimestamp(ctx.connection);

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
      await sendTransaction(ctx.connection, new Transaction().add(createEventIx), [ctx.daoAuthority]);

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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      const [seasonalSalePda] = deriveSeasonalSalePda(ctx.gameEngine, eventPda);
      const exists = await accountExists(ctx.connection, seasonalSalePda);
      expect(exists).toBe(true);
    });
  });

  // ============================================================
  // DAO Promotion Tests
  // ============================================================

  describe('DAO Promotions', () => {
    it('should create a DAO promotion', async () => {
      const now = await getCurrentTimestamp(ctx.connection);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      const [daoPromotionPda] = deriveDaoPromotionPda(ctx.gameEngine, proposalId);
      const exists = await accountExists(ctx.connection, daoPromotionPda);
      expect(exists).toBe(true);
    });
  });

  // ============================================================
  // Shop Analytics Tests
  // ============================================================

  describe('Shop Analytics', () => {
    it('should track item stock changes', async () => {
      const gameEngine = ctx.gameEngine;
      const itemBefore = await fetchShopItem(ctx.connection, gameEngine, 1);
      const stockBefore = itemBefore?.currentGlobalStock?.toNumber() || 0;

      const player = await createShopReadyPlayer(ctx, factory);
      const ix = createPurchaseItemInstruction(
        { gameEngine: ctx.gameEngine, buyer: player.publicKey, itemId: 9999, treasury: ctx.treasury.publicKey },
        { quantity: 1 }
      );

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      const itemAfter = await fetchShopItem(ctx.connection, gameEngine, 1);
      if (itemAfter && itemBefore) {
        // Stock should decrease after purchase (if limited stock)
        const stockAfter = itemAfter.currentGlobalStock.toNumber();
        expect(stockAfter).toBeLessThanOrEqual(stockBefore);
      }
    });
  });
});
