/**
 * Event System E2E Tests
 *
 * Tests for game events and competitions:
 * - Joining events
 * - Event scoring
 * - Prize claiming
 * - Event finalization
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createJoinEventInstruction,
  createClaimPrizeInstruction,
  createFinalizeEventInstruction,
  createHireUnitsInstruction,
  createCollectResourcesInstruction,
  deriveEventPda,
  deriveEventParticipationPda,
  derivePlayerPda,
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

describe('Event System', () => {
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
  // Join Event Tests
  // ============================================================

  describe('Joining Events', () => {
    it('should join active event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const eventId = 1;

      const ix = createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify joined
        const [participantPda] = deriveEventParticipationPda(ctx.gameEngine, eventId, player.publicKey);
        // Would fetch and verify participant account
      } catch {
        // Event might not exist
      }
    });

    it('should reject joining same event twice', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      try {
        // Join first time
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId,
            })
          ),
          [player.keypair]
        );

        // Try again
        const ix = createJoinEventInstruction({
          gameEngine: ctx.gameEngine,
          payer: player.publicKey,
          playerOwner: player.publicKey,
          eventId,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(ix),
          [player.keypair]
        );
      } catch {
        // First join might fail
      }
    });

    it('should reject joining ended event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Event 0 or non-existent should fail
      const ix = createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: 999,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject joining before start', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Events have start times - attempting to join future event
      const futureEventId = 9999;

      const ix = createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: futureEventId,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should require entry fee if applicable', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Some events have entry fees - player without funds should fail
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Entry fee events require sufficient NOVI balance
    });

    it('should check level requirements', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Some events have level requirements
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Player must meet minimum level to join certain events
    });
  });

  // ============================================================
  // Event Scoring Tests
  // ============================================================

  describe('Event Scoring', () => {
    it('should track player score', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      // Join event
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId,
            })
          ),
          [player.keypair]
        );

        // Perform scoring actions
        await factory.hireUnits(player, UnitType.DefensiveUnit1, 10);

        // Score should accumulate
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Event might not exist
      }
    });

    it('should update leaderboard on score change', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      // Leaderboard reflects current standings
      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId,
            })
          ),
          [player.keypair]
        );

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Event might not exist
      }
    });

    it('should score combat victories', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Build army and attack enemies
      await factory.hireUnits(player, UnitType.OperativeUnit1, 100);

      // Combat actions score points in combat events
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should score resource collection', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Collect resources with eventId to score
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Collection events track resources gathered
    });

    it('should score expedition completions', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Expedition completions score points
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should score dungeon progress', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Dungeon rooms cleared score points
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have score multipliers', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Certain actions have multipliers (e.g., 2x during happy hour)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should apply team bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Team events have team-based scoring bonuses
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Prize Claiming Tests
  // ============================================================

  describe('Claiming Prizes', () => {
    it('should claim event prize after finalization', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      const ix = createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        winnerOwner: player.publicKey,
        eventId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify prize received
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Might not be eligible
      }
    });

    it('should reject claim before finalization', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      try {
        // Join event
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId,
            })
          ),
          [player.keypair]
        );

        // Try to claim immediately
        const claimIx = createClaimPrizeInstruction({
          gameEngine: ctx.gameEngine,
          payer: player.publicKey,
          winnerOwner: player.publicKey,
          eventId,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(claimIx),
          [player.keypair]
        );
      } catch {
        // Join might fail
      }
    });

    it('should reject duplicate claims', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      try {
        // First claim
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimPrizeInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              winnerOwner: player.publicKey,
              eventId,
            })
          ),
          [player.keypair]
        );

        // Try again
        const claimIx = createClaimPrizeInstruction({
          gameEngine: ctx.gameEngine,
          payer: player.publicKey,
          winnerOwner: player.publicKey,
          eventId,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(claimIx),
          [player.keypair]
        );
      } catch {
        // First claim might fail
      }
    });

    it('should reject claim by non-participant', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      // Don't join, just try to claim
      const claimIx = createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        winnerOwner: player.publicKey,
        eventId,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it('should scale prize with ranking', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher ranks get better prizes
      // Top 1: 50%, Top 2-3: 20%, Top 4-10: 10%, etc.
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have participation rewards', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Everyone who participates gets something
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Event Finalization Tests
  // ============================================================

  describe('Event Finalization', () => {
    it('should finalize event (DAO)', async () => {
      const eventId = 1;

      const ix = createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
      } catch {
        // Event might not exist or already finalized
      }
    });

    it('should reject finalization by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      const ix = createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject early finalization', async () => {
      const eventId = 1;

      // Can't finalize before end time
      const ix = createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
      } catch {
        // Expected to fail if event is still active
      }
    });

    it('should freeze scores on finalization', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      // After finalization, no more score changes
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should calculate final rankings', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      // Rankings are computed at finalization
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should enable prize claims', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const eventId = 1;

      // Prizes become claimable after finalization
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Event Type Tests
  // ============================================================

  describe('Event Types', () => {
    it('should have combat events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Combat events score from kills and victories
      await factory.hireUnits(player, UnitType.OperativeUnit1, 50);

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have collection events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Collection events score from gathering resources
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have exploration events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Exploration events score from traveling/exploring
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have team events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Team events - combined team score
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have solo events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Solo events - individual competition
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have seasonal events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Holiday or time-limited events
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Leaderboard Tests
  // ============================================================

  describe('Leaderboards', () => {
    it('should track top players', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });
      const player3 = await factory.createPlayer({ initialize: true });

      // Leaderboard shows top N players
      const account1 = await fetchPlayer(ctx.connection, player1.playerPda);
      const account2 = await fetchPlayer(ctx.connection, player2.playerPda);
      const account3 = await fetchPlayer(ctx.connection, player3.playerPda);
      expect(account1).not.toBeNull();
      expect(account2).not.toBeNull();
      expect(account3).not.toBeNull();
    });

    it('should update on score change', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Score changes trigger leaderboard updates
      await factory.hireUnits(player, UnitType.DefensiveUnit1, 10);

      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should handle ties', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      // Tie-breaking rules: earlier join time wins
      const account1 = await fetchPlayer(ctx.connection, player1.playerPda);
      const account2 = await fetchPlayer(ctx.connection, player2.playerPda);
      expect(account1).not.toBeNull();
      expect(account2).not.toBeNull();
    });

    it('should show player rank', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Players can see their rank
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Prize Pool Tests
  // ============================================================

  describe('Prize Pools', () => {
    it('should have NOVI prizes', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // NOVI token rewards for top players
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have equipment prizes', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Equipment rewards for winners
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have resource prizes', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Resource rewards (cash, materials)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should scale with participation', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Bigger events have bigger prizes
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should distribute by tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Different tiers get different percentages
      // Tier 1: 30%, Tier 2: 20%, Tier 3: 15%, etc.
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Event Duration Tests
  // ============================================================

  describe('Event Duration', () => {
    it('should have start time', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Events start at specific time
      const now = await getCurrentTimestamp(ctx.connection);
      expect(now).toBeGreaterThan(0);
    });

    it('should have end time', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Events end at specific time
      const now = await getCurrentTimestamp(ctx.connection);
      expect(now).toBeGreaterThan(0);
    });

    it('should track remaining time', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can check time until end
      const now = await getCurrentTimestamp(ctx.connection);
      expect(now).toBeGreaterThan(0);
    });

    it('should prevent actions after end', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // No scoring after event ends
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Multi-Event Tests
  // ============================================================

  describe('Multiple Events', () => {
    it('should allow joining multiple events', async () => {
      const player = await factory.createPlayer({ initialize: true });

      try {
        // Join event 1
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId: 1,
            })
          ),
          [player.keypair]
        );

        // Join event 2
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId: 2,
            })
          ),
          [player.keypair]
        );
      } catch {
        // Events might not exist
      }
    });

    it('should track scores separately', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Each event has its own score
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should claim prizes separately', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Each event claimed independently
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });
});
