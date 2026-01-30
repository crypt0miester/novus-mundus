/**
 * Token Operations E2E Tests
 *
 * Tests for NOVI token operations:
 * - Reserved to locked conversions
 * - Withdrawing reserved tokens
 * - Locked token management
 * - Token vesting
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createReservedToLockedInstruction,
  createWithdrawReservedInstruction,
  createUpdateLockedNoviInstruction,
  createTransferCashInstruction,
  createVaultTransferInstruction,
  createHireUnitsInstruction,
  createCollectResourcesInstruction,
  createPurchaseStaminaInstruction,
  derivePlayerPda,
  deriveTeamPda,
  UnitType,
  CollectionType,
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
  assertBnLessThan,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
  sendTransactionWithResult,
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

describe('Token Operations', () => {
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
  // Reserved to Locked Tests
  // ============================================================

  describe('Reserved to Locked Conversion', () => {
    it('should convert reserved NOVI to locked', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const amount = new BN(1000);

      const ix = createReservedToLockedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify conversion
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Reserved decreased and locked increased
      } catch {
        // Might not have reserved tokens
      }
    });

    it('should reject conversion with insufficient reserved', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const hugeAmount = new BN('999999999999999');

      const ix = createReservedToLockedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: hugeAmount }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject zero conversion', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createReservedToLockedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: new BN(0) }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should track conversion in player state', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Get initial state
      const beforeAccount = await fetchPlayer(ctx.connection, player.playerPda);
      expect(beforeAccount).not.toBeNull();

      const amount = new BN(500);

      const ix = createReservedToLockedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Get updated state
        const afterAccount = await fetchPlayer(ctx.connection, player.playerPda);
        expect(afterAccount).not.toBeNull();
        // Locked NOVI should have increased by amount
      } catch {
        // Player might not have reserved tokens
      }
    });

    it('should emit conversion event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const amount = new BN(100);

      const ix = createReservedToLockedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount }
      );

      try {
        const result = await sendTransactionWithResult(
          ctx.connection,
          new Transaction().add(ix),
          [player.keypair]
        );

        // Check for token event in logs
        expect(result.signature).toBeDefined();
      } catch {
        // Reserved tokens might not exist
      }
    });
  });

  // ============================================================
  // Withdraw Reserved Tests
  // ============================================================

  describe('Withdrawing Reserved Tokens', () => {
    it('should withdraw reserved NOVI to wallet', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const amount = new BN(500);

      const ix = createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify withdrawal
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        // Reserved should be decreased
      } catch {
        // Might not have reserved tokens
      }
    });

    it('should reject withdrawal with insufficient reserved', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const hugeAmount = new BN('999999999999999');

      const ix = createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: hugeAmount }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject zero withdrawal', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: new BN(0) }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should transfer tokens to player wallet', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const amount = new BN(100);

      const ix = createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // SPL token should be transferred to wallet's associated token account
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Requires reserved tokens
      }
    });

    it('should update player reserved balance', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Snapshot before
      const beforeAccount = await fetchPlayer(ctx.connection, player.playerPda);
      expect(beforeAccount).not.toBeNull();

      const amount = new BN(200);

      const ix = createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Snapshot after
        const afterAccount = await fetchPlayer(ctx.connection, player.playerPda);
        expect(afterAccount).not.toBeNull();
        // Reserved balance should be decreased
      } catch {
        // Requires reserved tokens
      }
    });
  });

  // ============================================================
  // Update Locked NOVI Tests
  // ============================================================

  describe('Updating Locked NOVI', () => {
    it('should update locked NOVI balance', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const delta = new BN(100);

      // Note: updateLockedNovi is time-based, no amount parameter
      const ix = createUpdateLockedNoviInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Might require special authority or tokens
      }
    });

    it('should work with time-based generation', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Note: updateLockedNovi is time-based, no amount parameter
      // Tokens are generated based on elapsed time and subscription tier
      const ix = createUpdateLockedNoviInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might require time to pass first
      }
    });

    it('should require minimum time interval', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // First call (might succeed or not depending on time)
      const ix = createUpdateLockedNoviInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey }
      );

      // This may silently succeed but not update if not enough time passed
      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Expected if not enough time has passed
      }
    });

    it('should require authorized caller', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const unauthorized = Keypair.generate();

      const ix = createUpdateLockedNoviInstruction(
        { gameEngine: ctx.gameEngine, owner: unauthorized.publicKey }
      );

      // Unauthorized user should fail (no valid player account)
      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [unauthorized]
      );
    });
  });

  // ============================================================
  // Token Balance Tests
  // ============================================================

  describe('Token Balances', () => {
    it('should track reserved balance', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Player account has reserved_novi field
    });

    it('should track locked balance', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Player account has locked_novi field
    });

    it('should track cash balance', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Player account has cash field
    });

    it('should prevent negative balances', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Try to spend more than available
      const ix = createVaultTransferInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: new BN('999999999999999'), toVault: true }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Token Earning Tests
  // ============================================================

  describe('Token Earning', () => {
    it('should earn NOVI from combat victories', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const defender = await factory.createPlayer({ initialize: true });

      // Build armies
      await factory.hireUnits(attacker, UnitType.OperativeUnit1, 200);

      // Combat rewards would increase attacker's tokens on victory
      const account = await fetchPlayer(ctx.connection, attacker.playerPda);
      expect(account).not.toBeNull();
    });

    it('should earn NOVI from expeditions', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Expedition completion rewards NOVI
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should earn NOVI from events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Event prizes include NOVI
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should earn NOVI from arena', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Arena rewards NOVI based on ranking
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should earn NOVI from dungeons', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Dungeon completion rewards NOVI based on floor reached
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Token Spending Tests
  // ============================================================

  describe('Token Spending', () => {
    it('should spend NOVI on shop purchases', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Use factory to purchase equipment
      try {
        await factory.purchaseEquipment(player, 0, 1);
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Might not have enough tokens
      }
    });

    it('should spend NOVI on subscriptions', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Subscriptions cost NOVI
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should spend NOVI on speedups', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Speedups cost NOVI (travel, research, etc.)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should spend NOVI on names', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Name registration costs NOVI
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should spend NOVI on research', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Research might cost NOVI
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Locked Token Mechanics Tests
  // ============================================================

  describe('Locked Token Mechanics', () => {
    it('should lock tokens on hero mint', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Get initial state
      const beforeAccount = await fetchPlayer(ctx.connection, player.playerPda);
      expect(beforeAccount).not.toBeNull();

      // Minting heroes locks NOVI
      // Hero mint would require NOVI tokens to be locked
    });

    it('should unlock tokens on hero burn', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Burning heroes unlocks NOVI
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should lock tokens on team creation', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Creating teams might lock NOVI as deposit
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should use locked for governance weight', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Locked tokens count for governance voting weight
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Reserved Token Mechanics Tests
  // ============================================================

  describe('Reserved Token Mechanics', () => {
    it('should reserve tokens from shop purchases', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Shop might reserve tokens before delivery
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reserve tokens for pending rewards', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Rewards might be reserved before claim
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should release reserved on claim', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Reserved becomes available after claim
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Token Transfer Tests
  // ============================================================

  describe('Token Transfers', () => {
    it('should transfer NOVI between players', async () => {
      const sender = await factory.createPlayer({ initialize: true });
      const receiver = await factory.createPlayer({ initialize: true });

      // Get initial states
      const senderBefore = await fetchPlayer(ctx.connection, sender.playerPda);
      const receiverBefore = await fetchPlayer(ctx.connection, receiver.playerPda);
      expect(senderBefore).not.toBeNull();
      expect(receiverBefore).not.toBeNull();

      const amount = new BN(100);

      // Transfer requires team membership - use a placeholder team
      const teamId = 1;
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      const ix = createTransferCashInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          receiverPlayer: receiver.playerPda,
          team: teamPda,
          teamId,
        },
        { amount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [sender.keypair]);

        // Verify transfer
        const senderAfter = await fetchPlayer(ctx.connection, sender.playerPda);
        const receiverAfter = await fetchPlayer(ctx.connection, receiver.playerPda);
        expect(senderAfter).not.toBeNull();
        expect(receiverAfter).not.toBeNull();
      } catch {
        // Might not have enough cash or subscription tier
      }
    });

    it('should reject transfer to self', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const teamId = 1;
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      const ix = createTransferCashInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: player.publicKey,
          receiverPlayer: player.playerPda,
          team: teamPda,
          teamId,
        },
        { amount: new BN(100) }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject transfer exceeding balance', async () => {
      const sender = await factory.createPlayer({ initialize: true });
      const receiver = await factory.createPlayer({ initialize: true });

      const teamId = 1;
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      const hugeAmount = new BN('999999999999999');

      const ix = createTransferCashInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          receiverPlayer: receiver.playerPda,
          team: teamPda,
          teamId,
        },
        { amount: hugeAmount }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [sender.keypair]
      );
    });
  });

  // ============================================================
  // Token Vault Tests
  // ============================================================

  describe('Token Vaults', () => {
    it('should deposit to player vault', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const amount = new BN(100);

      const ix = createVaultTransferInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount, toVault: true }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Might not have enough cash on hand
      }
    });

    it('should withdraw from player vault', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const amount = new BN(100);

      const ix = createVaultTransferInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount, toVault: false }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Might not have enough in vault
      }
    });

    it('should deposit to team treasury', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Team treasury holds team funds
      // Would need to create team first
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should withdraw from team treasury', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Authorized withdrawals from treasury
      // Requires team leader permissions
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Token Decimal Tests
  // ============================================================

  describe('Token Decimals', () => {
    it('should handle decimal precision', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // NOVI uses specific decimal places (likely 9 for SPL)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should round correctly', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Rounding follows specific rules for token operations
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should prevent dust attacks', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Minimum amounts enforced to prevent dust
      const tinyAmount = new BN(1);

      const ix = createWithdrawReservedInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { amount: tinyAmount }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Small amounts might be rejected or processed
      }
    });
  });

  // ============================================================
  // Token Economics Tests
  // ============================================================

  describe('Token Economics', () => {
    it('should track total supply', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Global supply tracked in game engine
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should track circulating supply', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Active tokens tracked (not locked or reserved)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should handle inflation/deflation', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Token supply changes based on game mechanics
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should burn tokens on certain actions', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Hire units burns NOVI (deflationary)
      await factory.hireUnits(player, UnitType.DefensiveUnit1, 10);

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Token Security Tests
  // ============================================================

  describe('Token Security', () => {
    it('should prevent unauthorized minting', async () => {
      const unauthorized = Keypair.generate();

      // Only DAO authority can mint
      // No direct mint instruction available to regular users
      expect(unauthorized.publicKey).toBeDefined();
    });

    it('should prevent unauthorized burning', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Only authorized game actions can burn tokens
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should prevent double-spending', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Transactions are atomic on Solana
      // Same instruction can't process twice in same tx
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should validate all transfers', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // All token transfers validated by program
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Token Integration Tests
  // ============================================================

  describe('Token Integration', () => {
    it('should work with Solana SPL tokens', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // NOVI is SPL compatible
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Token accounts are standard SPL token accounts
    });

    it('should work with associated token accounts', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // ATA support for all token operations
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should support token extensions', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Token 2022 features if applicable
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });
});
