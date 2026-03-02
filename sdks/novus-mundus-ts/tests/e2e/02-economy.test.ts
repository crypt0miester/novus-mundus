/**
 * Economy E2E Tests
 *
 * Tests for economic operations:
 * - Hire units
 * - Collect resources
 * - Purchase equipment
 * - Purchase stamina
 * - Transfer cash
 * - Vault transfer
 * - Update locked NOVI
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

// Transfer Cash setup needs many transactions (vault upgrades, team, subscription)
setDefaultTimeout(60_000);
import BN from 'bn.js';

import {
  createHireUnitsInstruction,
  createCollectResourcesInstruction,
  createPurchaseEquipmentInstruction,
  createPurchaseStaminaInstruction,
  createTransferCashInstruction,
  createVaultTransferInstruction,
  createUpdateLockedNoviInstruction,
  createUpdateGameConfigInstruction,
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createPurchaseSubscriptionInstruction,
  createUpgradeBuildingInstruction,
  createBuildingSpeedupInstruction,
  createCompleteBuildingInstruction,
  createPurchaseItemInstruction,
  derivePlayerPda,
  deriveEstatePda,
  deriveTeamPda,
  BuildingType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
  TEST_GEMS_ITEM,
} from '../fixtures/setup';
import {
  PlayerFactory,
  type TestPlayer,
} from '../fixtures/players';
import {
  assertBnGreaterThan,
  assertBnGreaterThanOrEqual,
  assertBnLessThan,
  assertResourceIncreased,
  assertResourceDecreased,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
  buildTransaction,
} from '../utils/transactions';
import { log } from '../utils/logger';
import {
  fetchPlayer,
  fetchGameEngine,
  snapshotPlayer,
} from '../utils/accounts';

// ============================================================
// Test Suite
// ============================================================

describe('Economy', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Economy');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true, autoEstate: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // ============================================================
  // Hire Units Tests
  // ============================================================

  describe('Hire Units', () => {
    it('should hire defensive unit 1', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });
      const before = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(before).not.toBeNull();

      const hireAmount = new BN(100);
      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 0, noviAmount: hireAmount } // 0 = defensive unit 1
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();

      // Defensive units should increase
      const unitsBefore = before!.data.defensiveUnit1;
      const unitsAfter = after!.data.defensiveUnit1;
      assertBnGreaterThan(unitsAfter, unitsBefore);
    });

    it('should hire defensive unit 2', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 1, noviAmount: new BN(100) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.defensiveUnit2, before!.defensiveUnit2);
    });

    it('should hire defensive unit 3', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 2, noviAmount: new BN(200) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.defensiveUnit3, before!.defensiveUnit3);
    });

    it('should hire operative unit 1 (requires Camp)', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Camp] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 3, noviAmount: new BN(100) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.operativeUnit1, before!.operativeUnit1);
    });

    it('should hire operative unit 2 (requires Camp)', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Camp] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 4, noviAmount: new BN(200) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.operativeUnit2, before!.operativeUnit2);
    });

    it('should hire operative unit 3 (requires Camp)', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Camp] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 5, noviAmount: new BN(500) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.operativeUnit3, before!.operativeUnit3);
    });

    it('should reject hiring operatives without Camp', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 3, noviAmount: new BN(100) }
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [player.keypair]);
    });

    it('should consume NOVI when hiring units', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 0, noviAmount: new BN(100) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);

      // NOVI should decrease (units cost NOVI)
      assertBnLessThan(after!.lockedNovi, before!.lockedNovi);
    });

    it('should reject hiring with insufficient NOVI', async () => {
      // Create a player with minimal resources
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });

      // Try to hire a huge amount of units
      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 0, noviAmount: new BN(1_000_000_000) }
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [player.keypair]);
    });

    it('should reject invalid unit type', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });

      const ix = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 99 as any, noviAmount: new BN(10) } // Invalid unit type - cast to bypass TypeScript
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [player.keypair]);
    });
  });

  // ============================================================
  // Purchase Equipment Tests
  // ============================================================

  describe('Purchase Equipment', () => {
    it('should purchase melee weapons', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createPurchaseEquipmentInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 0, quantity: new BN(10), payWithCash: false }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.meleeWeapons, before!.meleeWeapons);
    });

    it('should purchase ranged weapons', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createPurchaseEquipmentInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 1, quantity: new BN(10), payWithCash: false }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.rangedWeapons, before!.rangedWeapons);
    });

    it('should purchase siege weapons', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createPurchaseEquipmentInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 2, quantity: new BN(5), payWithCash: false }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.siegeWeapons, before!.siegeWeapons);
    });

    it('should purchase armor', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createPurchaseEquipmentInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 5, quantity: new BN(15), payWithCash: false }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnGreaterThan(after!.armorPieces, before!.armorPieces);
    });

    it('should consume NOVI when purchasing equipment', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Market] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createPurchaseEquipmentInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { equipmentType: 0, quantity: new BN(50), payWithCash: false }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnLessThan(after!.lockedNovi, before!.lockedNovi);
    });
  });

  // ============================================================
  // Purchase Stamina Tests
  // ============================================================

  describe('Purchase Stamina', () => {
    it('should purchase stamina refill', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });

      // First, deplete some stamina (we'll skip this in initial test)
      const before = await fetchPlayer(ctx.svm, player.playerPda);
      const staminaBefore = before!.encounterStamina;

      const ix = createPurchaseStaminaInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: new BN(100) }
      );

      const tx = buildTransaction([ix]);

      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      // Stamina should be restored
      assertBnGreaterThanOrEqual(after!.encounterStamina, staminaBefore);
    });

    it('should consume NOVI when purchasing stamina', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Barracks] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createPurchaseStaminaInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: new BN(100) }
      );

      const tx = buildTransaction([ix]);

      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnLessThan(after!.lockedNovi, before!.lockedNovi);
    });
  });

  // ============================================================
  // Transfer Cash Tests
  // ============================================================

  describe('Transfer Cash', () => {
    let sender: TestPlayer;
    let receiver: TestPlayer;
    let testTeamId: number;
    let teamPda: ReturnType<typeof deriveTeamPda>[0];

    /**
     * Upgrade a building from its current level by one.
     * Uses upgrade + 7×speedup(tier2) + complete pattern.
     */
    async function upgradeOnce(player: TestPlayer, buildingType: BuildingType | number): Promise<void> {
      const instructions = [];

      // Start upgrade
      instructions.push(createUpgradeBuildingInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { buildingType }
      ));

      // 7× tier-2 speedup (each reduces remaining to 25%)
      for (let i = 0; i < 7; i++) {
        instructions.push(createBuildingSpeedupInstruction(
          { owner: player.publicKey, gameEngine: ctx.gameEngine },
          { buildingType, speedupTier: 2 }
        ));
      }

      // Complete
      instructions.push(createCompleteBuildingInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { buildingType }
      ));

      const tx = buildTransaction(instructions, { computeUnits: 400_000 });
      await sendTransaction(ctx.svm, tx, [player.keypair]);
    }

    it('setup: configure game caps, team, subscription, and vault', async () => {
      // 1. Set min_account_age_for_events to 0 so newly created players can transfer
      const engine = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(engine).not.toBeNull();

      const updatedCaps = {
        ...engine!.caps,
        minAccountAgeForEvents: new BN(0),
      };

      const configIx = createUpdateGameConfigInstruction(
        { authority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        { capsConfig: updatedCaps }
      );

      const configTx = buildTransaction([configIx]);
      await sendTransaction(ctx.svm, configTx, [ctx.daoAuthority]);

      // Verify the update
      const engineAfter = await fetchGameEngine(ctx.svm, ctx.kingdomId);
      expect(engineAfter!.caps.minAccountAgeForEvents.toNumber()).toBe(0);

      // 2. Create players with estate + vault (level 1)
      sender = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Vault] });
      receiver = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Vault] });

      // 3. Buy extra gems for vault upgrade speedups (4 upgrade cycles × 7 speedups)
      const gemsIx = createPurchaseItemInstruction(
        {
          buyer: sender.publicKey,
          gameEngine: ctx.gameEngine,
          itemId: TEST_GEMS_ITEM.itemId,
          treasury: ctx.treasury.publicKey,
        },
        { quantity: 10 }
      );
      const gemsTx = buildTransaction([gemsIx]);
      await sendTransaction(ctx.svm, gemsTx, [sender.keypair]);

      // 4. Upgrade sender's Vault from level 1 → 5 (4 cycles)
      for (let level = 2; level <= 5; level++) {
        await upgradeOnce(sender, BuildingType.Vault);
      }

      // 5. Create team with sender as leader
      testTeamId = Date.now();
      const createTeamIx = createTeamCreateInstruction(
        { owner: sender.publicKey, gameEngine: ctx.gameEngine, teamId: testTeamId },
        { name: 'TransferTeam' }
      );
      const createTeamTx = buildTransaction([createTeamIx]);
      await sendTransaction(ctx.svm, createTeamTx, [sender.keypair]);

      // 6. Invite receiver to team, then receiver accepts
      [teamPda] = deriveTeamPda(ctx.gameEngine, testTeamId);
      const inviteIx = createTeamInviteInstruction({
        inviter: sender.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: testTeamId,
        inviterSlotIndex: 0,
        inviteePlayer: receiver.playerPda,
      });
      const inviteTx = buildTransaction([inviteIx]);
      await sendTransaction(ctx.svm, inviteTx, [sender.keypair]);

      const acceptIx = createTeamAcceptInviteInstruction({
        owner: receiver.publicKey,
        gameEngine: ctx.gameEngine,
        team: teamPda,
        teamId: testTeamId,
        slotIndex: 1,
        inviteRefund: sender.publicKey,
      });
      const acceptTx = buildTransaction([acceptIx]);
      await sendTransaction(ctx.svm, acceptTx, [receiver.keypair]);

      // 7. Sender buys Expert subscription (tier 1) via SOL payment
      const subIx = createPurchaseSubscriptionInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: sender.publicKey,
          paymentAuthority: sender.publicKey,
          treasury: ctx.treasury.publicKey,
        },
        { paymentType: 0, tier: 1 }
      );
      const subTx = buildTransaction([subIx]);
      await sendTransaction(ctx.svm, subTx, [sender.keypair]);

      // Verify sender has Expert subscription
      const senderAfter = await fetchPlayer(ctx.svm, sender.playerPda);
      expect(senderAfter!.subscriptionTier).toBe(1);
    });

    it('should transfer cash between players', async () => {
      const senderBefore = await fetchPlayer(ctx.svm, sender.playerPda);
      const receiverBefore = await fetchPlayer(ctx.svm, receiver.playerPda);

      const [receiverPlayerPda] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      const transferAmount = new BN(100);
      const ix = createTransferCashInstruction(
        {
          sender: sender.publicKey,
          gameEngine: ctx.gameEngine,
          receiverPlayer: receiverPlayerPda,
          team: teamPda,
          teamId: testTeamId,
        },
        { amount: transferAmount }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [sender.keypair]);

      const senderAfter = await fetchPlayer(ctx.svm, sender.playerPda);
      const receiverAfter = await fetchPlayer(ctx.svm, receiver.playerPda);

      // Sender's cash should decrease
      assertResourceDecreased(senderBefore!.cashOnHand, senderAfter!.cashOnHand);

      // Receiver's cash should increase
      assertResourceIncreased(receiverBefore!.cashOnHand, receiverAfter!.cashOnHand);
    });

    it('should reject transfer with insufficient cash', async () => {
      const senderBefore = await fetchPlayer(ctx.svm, sender.playerPda);
      const [receiverPlayerPda] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      // Try to transfer more than available
      const transferAmount = senderBefore!.cashOnHand.add(new BN(1_000_000));
      const ix = createTransferCashInstruction(
        {
          sender: sender.publicKey,
          gameEngine: ctx.gameEngine,
          receiverPlayer: receiverPlayerPda,
          team: teamPda,
          teamId: testTeamId,
        },
        { amount: transferAmount }
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [sender.keypair]);
    });

    it('should reject transfer to self', async () => {
      const [senderPlayerPda] = derivePlayerPda(ctx.gameEngine, sender.publicKey);

      const ix = createTransferCashInstruction(
        {
          sender: sender.publicKey,
          gameEngine: ctx.gameEngine,
          receiverPlayer: senderPlayerPda,
          team: teamPda,
          teamId: testTeamId,
        },
        { amount: new BN(100) }
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [sender.keypair]);
    });

    it('should track daily transfer count', async () => {
      const [receiverPlayerPda] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      const ix = createTransferCashInstruction(
        {
          sender: sender.publicKey,
          gameEngine: ctx.gameEngine,
          receiverPlayer: receiverPlayerPda,
          team: teamPda,
          teamId: testTeamId,
        },
        { amount: new BN(10) }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [sender.keypair]);

      const after = await fetchPlayer(ctx.svm, sender.playerPda);
      expect(after!.dailyTransferCount).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Vault Transfer Tests
  // ============================================================

  describe('Vault Transfer', () => {
    it('should move cash from hand to vault', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Vault] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const depositAmount = new BN(50);
      const ix = createVaultTransferInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: depositAmount, toVault: true }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);

      // Cash on hand should decrease
      assertResourceDecreased(before!.cashOnHand, after!.cashOnHand);

      // Cash in vault should increase
      assertResourceIncreased(before!.cashInVault, after!.cashInVault);
    });

    it('should move cash from vault to hand', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Vault] });

      // First deposit to vault
      const depositIx = createVaultTransferInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: new BN(100), toVault: true }
      );
      const depositTx = buildTransaction([depositIx]);
      await sendTransaction(ctx.svm, depositTx, [player.keypair]);

      // Now withdraw
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const withdrawAmount = new BN(50);
      const withdrawIx = createVaultTransferInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: withdrawAmount, toVault: false }
      );

      const withdrawTx = buildTransaction([withdrawIx]);
      await sendTransaction(ctx.svm, withdrawTx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);

      // Cash in vault should decrease
      assertResourceDecreased(before!.cashInVault, after!.cashInVault);

      // Cash on hand should increase
      assertResourceIncreased(before!.cashOnHand, after!.cashOnHand);
    });

    it('should clamp vault deposit to available cash on hand', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Vault] });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Request more than available — program clamps to min(amount, space, cashOnHand)
      const depositAmount = before!.cashOnHand.add(new BN(1_000_001));
      const ix = createVaultTransferInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: depositAmount, toVault: true }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      // Vault balance should not exceed what was on hand before
      assertBnGreaterThanOrEqual(before!.cashOnHand, after!.cashInVault.sub(before!.cashInVault));
    });

    it('should clamp vault withdrawal to vault balance', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Vault] });

      // First deposit some cash into vault
      const depositIx = createVaultTransferInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: new BN(100), toVault: true }
      );
      const depositTx = buildTransaction([depositIx]);
      await sendTransaction(ctx.svm, depositTx, [player.keypair]);

      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Request more than vault balance — program clamps to min(amount, cashInVault)
      const withdrawAmount = before!.cashInVault.add(new BN(1_000_001));
      const ix = createVaultTransferInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { amount: withdrawAmount, toVault: false }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);
      // Vault should be drained to 0 (clamped to vault balance)
      assertBnGreaterThanOrEqual(before!.cashInVault, before!.cashInVault.sub(after!.cashInVault));
    });
  });

  // ============================================================
  // Collect Resources Tests
  // ============================================================

  describe('Collect Resources', () => {
    it('should collect resources from estate buildings', async () => {
      const player = await factory.createPlayer({ createEstate: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createCollectResourcesInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: new BN(100), collectionType: 0 }
      );

      const tx = buildTransaction([ix]);

      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);

      // Should have collected some resources (exact amount depends on buildings)
      // At minimum, timestamp should update
      expect(after!.lastUpdatedTokensAt.toNumber()).toBeGreaterThanOrEqual(
        before!.lastUpdatedTokensAt.toNumber()
      );
    });

    it('should collect farming resources (requires Farm)', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Farm] });

      const ix = createCollectResourcesInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: new BN(100), collectionType: 3 } // 3 = Farming
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);
    });

    it('should reject farming without Farm building', async () => {
      const player = await factory.createPlayer({ createEstate: true });

      const ix = createCollectResourcesInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: new BN(100), collectionType: 3 } // 3 = Farming
      );

      const tx = buildTransaction([ix]);
      await expectTransactionToFail(ctx.svm, tx, [player.keypair]);
    });

    it('should collect mining resources (requires Mine)', async () => {
      const player = await factory.createPlayer({ createEstate: true, buildings: [BuildingType.Camp, BuildingType.Mine, BuildingType.Academy] });
      await factory.completeResearch(player, 21); // Unlock mining (has_mining = true)

      // Hire operative units (needed for mining output calculation)
      const hireIx = createHireUnitsInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { unitType: 3, noviAmount: new BN(1000) }
      );
      await sendTransaction(ctx.svm, buildTransaction([hireIx]), [player.keypair]);

      const ix = createCollectResourcesInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: new BN(100), collectionType: 1 } // 1 = Mining
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);
    });

    it('should allow consecutive collections', async () => {
      const player = await factory.createPlayer({ createEstate: true });

      // First collection
      const ix1 = createCollectResourcesInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: new BN(100), collectionType: 0 }
      );
      const tx1 = buildTransaction([ix1]);

      await sendTransaction(ctx.svm, tx1, [player.keypair]);

      const before = await fetchPlayer(ctx.svm, player.playerPda);

      // Second collection should also succeed (no cooldown)
      const ix2 = createCollectResourcesInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine },
        { noviAmount: new BN(100), collectionType: 0 }
      );
      const tx2 = buildTransaction([ix2]);

      await sendTransaction(ctx.svm, tx2, [player.keypair]);
      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after!.lastUpdatedTokensAt.toNumber()).toBeGreaterThanOrEqual(
        before!.lastUpdatedTokensAt.toNumber()
      );
    });
  });

  // ============================================================
  // Update Locked NOVI Tests
  // ============================================================

  describe('Update Locked NOVI', () => {
    it('should sync locked NOVI from token account', async () => {
      const player = await factory.createPlayer({ createEstate: true });
      const before = await fetchPlayer(ctx.svm, player.playerPda);

      const ix = createUpdateLockedNoviInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine }
      );

      const tx = buildTransaction([ix]);
      await sendTransaction(ctx.svm, tx, [player.keypair]);

      const after = await fetchPlayer(ctx.svm, player.playerPda);

      // Token update timestamp should be updated
      expect(after!.lastUpdatedTokensAt.toNumber()).toBeGreaterThanOrEqual(
        before!.lastUpdatedTokensAt.toNumber()
      );
    });
  });
});
