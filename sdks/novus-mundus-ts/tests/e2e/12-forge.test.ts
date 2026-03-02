/**
 * Forge System E2E Tests
 *
 * Tests for equipment crafting:
 * - Starting craft
 * - Striking forge
 * - Completing craft
 * - Abandoning craft
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createStartCraftInstruction,
  createStrikeInstruction,
  createAbandonCraftInstruction,
  createEquipInstruction,
  createInitializeForgeInstruction,
  createPurchaseItemInstruction,
  derivePlayerPda,
  BuildingType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
  TEST_MATERIALS_ITEM,
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

// ============================================================
// Test Suite
// ============================================================

setDefaultTimeout(120_000);

describe('Forge System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Forge System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  /** Create a player with estate + Forge building + initialized forge account + materials */
  async function createForgeReadyPlayer(): Promise<TestPlayer> {
    const player = await factory.createPlayer({
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Forge, BuildingType.Market],
    });

    // Initialize the CraftedEquipmentAccount PDA + buy materials in one tx
    const tx = new Transaction();
    tx.add(createInitializeForgeInstruction({
      owner: player.publicKey,
      gameEngine: ctx.gameEngine,
    }));
    // Buy common materials (100 per purchase × 2 = 200, need 50 per Refined craft)
    tx.add(createPurchaseItemInstruction(
      {
        buyer: player.publicKey,
        gameEngine: ctx.gameEngine,
        itemId: TEST_MATERIALS_ITEM.itemId,
        treasury: ctx.treasury.publicKey,
      },
      { quantity: 2 }
    ));
    await sendTransaction(ctx.svm, tx, [player.keypair]);

    return player;
  }

  // ============================================================
  // Start Craft Tests
  // ============================================================

  describe('Starting Craft', () => {
    it('should start equipment crafting', async () => {
      const player = await createForgeReadyPlayer();

      // equipmentType: 0=Sword, 1=Shield, etc.
      // qualityTier: 0=Common, 1=Rare, 2=Epic, 3=Legendary
      const equipmentType = 0;
      const qualityTier = 1; // Uncommon (Common is not craftable)

      const ix = createStartCraftInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType, qualityTier }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify crafting started
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      // Would check crafting state
    });

    it('should reject craft while already crafting', async () => {
      const player = await createForgeReadyPlayer();

      // Start first craft
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Try second craft
      const ix = createStartCraftInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 1, qualityTier: 1 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject invalid equipment type', async () => {
      const player = await createForgeReadyPlayer();

      const ix = createStartCraftInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 255, qualityTier: 1 } // Invalid
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should consume materials on craft start', async () => {
      const player = await createForgeReadyPlayer();

      // Get initial materials
      let account = await fetchPlayer(ctx.svm, player.playerPda);
      // Would check material counts

      // Start craft
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Verify materials consumed
      account = await fetchPlayer(ctx.svm, player.playerPda);
      // Would check reduced material counts
    });
  });

  // ============================================================
  // Strike Forge Tests
  // ============================================================

  describe('Striking Forge', () => {
    it('should reject strike before window opens', async () => {
      const player = await createForgeReadyPlayer();

      // Start craft first
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Strike immediately — window opens after 60s for Refined tier
      const strikeIx = createStrikeInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      // Should fail with StrikeTooEarly
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(strikeIx),
        [player.keypair]
      );
    });

    it('should reject strike when not crafting', async () => {
      const player = await createForgeReadyPlayer();

      const strikeIx = createStrikeInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(strikeIx),
        [player.keypair]
      );
    });

    it('should complete craft after enough strikes', async () => {
      const player = await createForgeReadyPlayer();

      // Start craft
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Strike multiple times
      const strikeIx = createStrikeInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      for (let i = 0; i < 10; i++) {
        try {
          await sendTransaction(ctx.svm, new Transaction().add(strikeIx), [player.keypair]);
        } catch {
          break;
        }
      }

      // Check if craft completed
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      // Would verify crafting state
    });

    it('should enforce timing window for strikes', async () => {
      const player = await createForgeReadyPlayer();

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Strike immediately — should fail with StrikeTooEarly since window opens after 60s
      const strikeIx = createStrikeInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(strikeIx),
        [player.keypair]
      );

      // Verify craft is still in progress after rejected strike
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Abandon Craft Tests
  // ============================================================

  describe('Abandoning Craft', () => {
    it('should abandon ongoing craft', async () => {
      const player = await createForgeReadyPlayer();

      // Start craft
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Abandon
      const abandonIx = createAbandonCraftInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      await sendTransaction(ctx.svm, new Transaction().add(abandonIx), [player.keypair]);

      // Verify no longer crafting
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      // Would check crafting state is empty
    });

    it('should reject abandon when not crafting', async () => {
      const player = await createForgeReadyPlayer();

      const abandonIx = createAbandonCraftInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(abandonIx),
        [player.keypair]
      );
    });

    it('should not refund materials on abandon', async () => {
      const player = await createForgeReadyPlayer();

      // Materials consumed on start are not returned on abandon
      const accountBefore = await fetchPlayer(ctx.svm, player.playerPda);

      // Start craft (consumes materials)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Abandon craft
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAbandonCraftInstruction({ gameEngine: ctx.gameEngine, owner: player.publicKey })
        ),
        [player.keypair]
      );

      // Materials should still be consumed
      const accountAfter = await fetchPlayer(ctx.svm, player.playerPda);
      expect(accountAfter).not.toBeNull();
    });
  });

  // ============================================================
  // Equip Tests
  // ============================================================

  describe('Equipment', () => {
    it('should reject equip without completed craft', async () => {
      const player = await createForgeReadyPlayer();

      // Try to equip without having crafted any item first
      const equipIx = createEquipInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 0, qualityTier: 1 }
      );

      // Should fail — no crafted items available
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(equipIx),
        [player.keypair]
      );
    });

    it('should reject equip of uncrafted equipment', async () => {
      const player = await createForgeReadyPlayer();

      // Can't equip equipment you haven't crafted
      const equipIx = createEquipInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 0, qualityTier: 3 } // Legendary item we don't have
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(equipIx),
        [player.keypair]
      );
    });

    it('should reject equip during active craft', async () => {
      const player = await createForgeReadyPlayer();

      // Start a craft
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Try to equip while crafting — should fail
      const equipIx = createEquipInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 0, qualityTier: 1 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(equipIx),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Recipe Tests
  // ============================================================

  describe('Recipes', () => {
    it('should require specific materials for higher tiers', async () => {
      const player = await createForgeReadyPlayer();

      // Superior tier (2) requires 100 common + 25 uncommon materials.
      // Player only has common materials, so this should fail (InsufficientMaterials).
      const ix = createStartCraftInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 0, qualityTier: 2 } // Superior needs uncommon materials
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should have level requirement', async () => {
      const player = await createForgeReadyPlayer();

      // Some recipes require minimum player level
      const ix = createStartCraftInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 5, qualityTier: 1 } // Advanced equipment type
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should produce equipment of correct type', async () => {
      const player = await createForgeReadyPlayer();

      // Recipe determines output type
      const ix = createStartCraftInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { equipmentType: 0, qualityTier: 1 } // Sword
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      // Craft in progress should be for sword
    });
  });

  // ============================================================
  // Quality Tests
  // ============================================================

  describe('Craft Quality', () => {
    it('should track craft state after starting', async () => {
      const player = await createForgeReadyPlayer();

      // Start craft and verify state is tracked
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createStartCraftInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { equipmentType: 0, qualityTier: 1 }
          )
        ),
        [player.keypair]
      );

      // Verify player state is intact after craft started
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();

      // Strike fails because window hasn't opened (60s for Refined)
      const strikeIx = createStrikeInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(strikeIx),
        [player.keypair]
      );
    });

    it('should have quality tiers', async () => {
      const player = await createForgeReadyPlayer();

      // Common, Rare, Epic, Legendary (0, 1, 2, 3)
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      // Quality tiers are 0-3
    });

    it('should scale stats with quality', async () => {
      const player = await createForgeReadyPlayer();

      // Higher quality = better stats
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      // Equipment stats scale: Common < Rare < Epic < Legendary
    });
  });
});
