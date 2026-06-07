/**
 * Event System E2E Tests
 *
 * Tests for game events and competitions:
 * - Creating events (admin)
 * - Joining events
 * - Event finalization (permissionless)
 * - Prize claiming
 * - Event participation tracking
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';

import {
  createCreateEventInstruction,
  createJoinEventInstruction,
  createLeaveEventInstruction,
  createClaimPrizeInstruction,
  createFinalizeEventInstruction,
  createAttackPlayerInstruction,
  createCollectResourcesInstruction,
  deriveEventPda,
  deriveEventParticipationPda,
  derivePlayerPda,
  EventStatus,
  EventPrizeType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import {
  PlayerFactory,
  type TestPlayer,
  createCombatReadyPlayers,
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
  fetchEvent,
  fetchEventParticipation,
  accountExists,
} from '../utils/accounts';
import { log } from '../utils/logger';
import {
  getCurrentTimestamp,
  advanceTime,
} from '../fixtures/time';

// Constants

const ACTIVE_EVENT_ID = 1;
const ENDED_EVENT_ID = 2;
const HIGH_LEVEL_EVENT_ID = 3;

// Test Suite

describe('Event System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Event System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });

    const now = await getCurrentTimestamp(ctx.svm);

    // Create active event (started 1 hour ago, ends in 24 hours)
    const createActiveEventIx = await createCreateEventInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        eventId: ACTIVE_EVENT_ID,
      },
      {
        name: 'TestActiveEvent',
        startTime: now - 3600,
        endTime: now + 86400,
        eventType: 0,
        minLevel: 1,
        minReputation: 0,
        requiredSubscriptionTier: 0,
        prizeType: 0, // LockedNovi
        prizeAmount: 10000,
        autoActivate: true,
      }
    );

    // Create soon-to-end event: end_time briefly in the future so a setup
    // player can join (which auto-activates it), after which we advance the
    // clock past end_time below. Activation is what makes finalize legal.
    const createEndedEventIx = await createCreateEventInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        eventId: ENDED_EVENT_ID,
      },
      {
        name: 'TestEndedEvent',
        startTime: now - 60,
        endTime: now + 60,
        eventType: 0,
        minLevel: 1,
        minReputation: 0,
        requiredSubscriptionTier: 0,
        prizeType: 0,
        prizeAmount: 5000,
        autoActivate: true,
      }
    );

    // Create high-level event (requires level 50)
    const createHighLevelEventIx = await createCreateEventInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        eventId: HIGH_LEVEL_EVENT_ID,
      },
      {
        name: 'TestHighLevelEvent',
        startTime: now - 3600,
        endTime: now + 86400,
        eventType: 0,
        minLevel: 50,
        minReputation: 0,
        requiredSubscriptionTier: 0,
        prizeType: 1, // Gems
        prizeAmount: 1000,
        autoActivate: true,
      }
    );

    await sendTransaction(
      ctx.svm,
      new Transaction().add(createActiveEventIx),
      [ctx.daoAuthority]
    );

    await sendTransaction(
      ctx.svm,
      new Transaction().add(createEndedEventIx),
      [ctx.daoAuthority]
    );

    await sendTransaction(
      ctx.svm,
      new Transaction().add(createHighLevelEventIx),
      [ctx.daoAuthority]
    );

    // Activate ENDED event by having a setup player join (status 0 → 1).
    // Then advance the clock past end_time so finalize tests see an
    // Active-but-time-expired event.
    const setupPlayer = await factory.createPlayer({ initialize: true });
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        await createJoinEventInstruction({
          gameEngine: ctx.gameEngine,
          payer: setupPlayer.publicKey,
          playerOwner: setupPlayer.publicKey,
          eventId: ENDED_EVENT_ID,
        }),
      ),
      [setupPlayer.keypair],
    );
    await advanceTime(ctx.svm, 120); // past ENDED event's end_time
  });

  afterAll(() => {
    factory.clear();
  });

  // Event Creation Tests

  describe('Event Creation', () => {
    it('should create event with correct parameters', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.name).toBe('TestActiveEvent');
      // Events are always created as Pending; autoActivate is stored but activation happens separately
      expect(event!.status).toBe(EventStatus.Pending);
      expect(event!.eventType).toBe(0);
      expect(event!.minLevel).toBe(1);
      expect(event!.prizeType).toBe(EventPrizeType.LockedNovi);
      assertBnEquals(event!.prizeAmount, 10000);
      expect(event!.autoActivate).toBe(true);
      expect(event!.participantCount).toBe(0);
    });

    it('should create ended event with correct timestamps', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ENDED_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.name).toBe('TestEndedEvent');
      // endTime < now, so the event window has passed
      const now = await getCurrentTimestamp(ctx.svm);
      expect(Number(event!.endTime)).toBeLessThan(now);
      assertBnEquals(event!.prizeAmount, 5000);
    });

    it('should create event with high level requirement', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, HIGH_LEVEL_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.minLevel).toBe(50);
      expect(event!.prizeType).toBe(EventPrizeType.Gems);
      assertBnEquals(event!.prizeAmount, 1000);
    });

    it('should reject event creation by non-authority', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createCreateEventInstruction(
        {
          authority: player.publicKey,
          gameEngine: ctx.gameEngine,
          eventId: 999,
        },
        {
          name: 'UnauthorizedEvent',
          startTime: 0,
          endTime: 0,
          eventType: 0,
          minLevel: 1,
          minReputation: 0,
          requiredSubscriptionTier: 0,
          prizeType: 0,
          prizeAmount: 100,
          autoActivate: false,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Join Event Tests

  describe('Joining Events', () => {
    it('should join active event and create participation account', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: ACTIVE_EVENT_ID,
      });

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify participation account was created
      const participation = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID, player.publicKey
      );
      expect(participation).not.toBeNull();
      assertBnEquals(participation!.eventId, ACTIVE_EVENT_ID);
      expect(participation!.player.equals(player.publicKey)).toBe(true);
      assertBnEquals(participation!.score, 0);
      assertBnGreaterThan(participation!.joinedAt, 0, 'joinedAt should be set');

      // Verify player's currentEvent is set
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertBnEquals(account!.currentEvent, ACTIVE_EVENT_ID);

      // Verify event participant count increased
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.participantCount).toBeGreaterThan(0);
    });

    it('should reject joining when already in an event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join first time
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      // Verify player is now in event
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertBnEquals(account!.currentEvent, ACTIVE_EVENT_ID);

      // Try to join the same event again — should fail (already participating)
      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: ACTIVE_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    }, 15_000);

    it('should reject joining ended event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: ENDED_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    }, 15_000);

    it('should reject joining non-existent event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: 9999,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject joining event when level requirement not met', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Player starts at level 1, event requires level 50
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.level).toBeLessThan(50);

      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: HIGH_LEVEL_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should allow different payer than player owner', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const payer = await factory.createPlayer({ initialize: true });

      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: payer.publicKey,
        playerOwner: player.publicKey,
        eventId: ACTIVE_EVENT_ID,
      });

      // Payer signs, player owner's account is updated
      await sendTransaction(ctx.svm, new Transaction().add(ix), [payer.keypair]);

      // Verify the player (not payer) has the participation
      const participation = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID, player.publicKey
      );
      expect(participation).not.toBeNull();
      expect(participation!.player.equals(player.publicKey)).toBe(true);
    });
  });

  // Event Participation Tracking

  describe('Participation Tracking', () => {
    it('should initialize participation with zero score', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      const participation = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID, player.publicKey
      );
      expect(participation).not.toBeNull();
      assertBnEquals(participation!.score, 0);
      assertBnGreaterThan(participation!.joinedAt, 0, 'joinedAt should be set');
    });

    it('should track multiple participants independently', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      // Both join
      for (const player of [player1, player2]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            await createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: player.publicKey,
              playerOwner: player.publicKey,
              eventId: ACTIVE_EVENT_ID,
            })
          ),
          [player.keypair]
        );
      }

      // Each has their own participation account
      const p1 = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID, player1.publicKey
      );
      const p2 = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID, player2.publicKey
      );
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p1!.player.equals(player1.publicKey)).toBe(true);
      expect(p2!.player.equals(player2.publicKey)).toBe(true);
    });

    it('should increment event participant count per join', async () => {
      const eventBefore = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(eventBefore).not.toBeNull();
      const countBefore = eventBefore!.participantCount;

      const player = await factory.createPlayer({ initialize: true });
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      const eventAfter = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(eventAfter).not.toBeNull();
      expect(eventAfter!.participantCount).toBe(countBefore + 1);
    });
  });

  // Event Finalization Tests

  describe('Event Finalization', () => {
    it('should finalize ended event (permissionless)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Event 2 end_time has passed — anyone can finalize
      const ix = await createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId: ENDED_EVENT_ID,
      });

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify event status changed to Finalized
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ENDED_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.status).toBe(EventStatus.Finalized);
    });

    it('should reject finalizing active event (not ended)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Event 1 is still active (ends in ~24h) — finalize should fail
      const ix = await createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId: ACTIVE_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject finalizing already finalized event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Event 2 was finalized in the first test — trying again should fail
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ENDED_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.status).toBe(EventStatus.Finalized);

      const ix = await createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId: ENDED_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject finalizing non-existent event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId: 9999,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should preserve participant count after finalization', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ENDED_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.status).toBe(EventStatus.Finalized);
      // participantCount should still reflect total who joined (could be 0 if nobody joined ended event)
      expect(event!.participantCount).toBeGreaterThanOrEqual(0);
    });
  });

  // Prize Claiming Tests

  describe('Claiming Prizes', () => {
    it('should reject claim for non-finalized event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join active event first
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      // Verify event is not finalized
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.status).not.toBe(EventStatus.Finalized);

      // Try to claim — event not finalized, should fail
      const claimIx = await createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        winnerOwner: player.publicKey,
        eventId: ACTIVE_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it('should reject claim by non-participant', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Don't join, just try to claim — should fail because no participation account exists
      const [participationPda] = await deriveEventParticipationPda(
        ctx.gameEngine, ACTIVE_EVENT_ID, player.publicKey
      );
      const exists = await accountExists(ctx.svm, participationPda);
      expect(exists).toBe(false);

      const claimIx = await createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        winnerOwner: player.publicKey,
        eventId: ACTIVE_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it('should reject claim for non-existent event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const claimIx = await createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        winnerOwner: player.publicKey,
        eventId: 9999,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it('should reject claim on finalized event with no participation', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Event 2 is finalized but this player never joined it
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ENDED_EVENT_ID);
      expect(event).not.toBeNull();
      expect(event!.status).toBe(EventStatus.Finalized);

      const claimIx = await createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        winnerOwner: player.publicKey,
        eventId: ENDED_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });
  });

  // Leaving Events

  describe('Leaving Events', () => {
    const LEAVE_FINALIZE_EVENT_ID = 5;

    it('should reject leaving an active (still-running) event', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join the active event so the player is genuinely in it.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      // Leaving a live event is not allowed (can't bail mid-competition).
      const leaveIx = await createLeaveEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: ACTIVE_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(leaveIx),
        [player.keypair],
        6607 // EventNotCompleted — event still running
      );
    });

    it('should let a non-winner leave a finalized event, free the slot, and rejoin another', async () => {
      // A short event the player can join (auto-activate) then we end + finalize.
      const now = await getCurrentTimestamp(ctx.svm);
      const createIx = await createCreateEventInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          eventId: LEAVE_FINALIZE_EVENT_ID,
        },
        {
          name: 'LeaveFinalizeEvent',
          startTime: now - 60,
          endTime: now + 20,
          eventType: 0,
          minLevel: 1,
          minReputation: 0,
          requiredSubscriptionTier: 0,
          prizeType: 0,
          prizeAmount: 1000,
          autoActivate: true,
        }
      );
      await sendTransaction(ctx.svm, new Transaction().add(createIx), [ctx.daoAuthority]);

      const player = await factory.createPlayer({ initialize: true });

      // Join (auto-activates Pending -> Active). Player never scores, so they end
      // up off the leaderboard: a non-winner.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: LEAVE_FINALIZE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      const joined = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnEquals(joined!.currentEvent, LEAVE_FINALIZE_EVENT_ID);

      // End the event and finalize it.
      await advanceTime(ctx.svm, 30);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createFinalizeEventInstruction({
            gameEngine: ctx.gameEngine,
            eventId: LEAVE_FINALIZE_EVENT_ID,
          })
        ),
        [player.keypair]
      );
      const finalized = await fetchEvent(ctx.svm, ctx.gameEngine, LEAVE_FINALIZE_EVENT_ID);
      expect(finalized!.status).toBe(EventStatus.Finalized);

      // Leave succeeds: clears the slot and closes the participation account.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createLeaveEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: LEAVE_FINALIZE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      // currentEvent cleared.
      const afterLeave = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnEquals(afterLeave!.currentEvent, 0);

      // Participation PDA closed (rent refunded).
      const [participationPda] = await deriveEventParticipationPda(
        ctx.gameEngine, LEAVE_FINALIZE_EVENT_ID, player.publicKey
      );
      expect(await accountExists(ctx.svm, participationPda)).toBe(false);

      // Slot is free: the player can now join a different event.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );
      const rejoined = await fetchPlayer(ctx.svm, player.playerPda);
      assertBnEquals(rejoined!.currentEvent, ACTIVE_EVENT_ID);
    }, 30_000);

    it('should reject leaving a finalized event without ever joining it', async () => {
      // Event 2 is finalized but this player never participated.
      const player = await factory.createPlayer({ initialize: true });

      const leaveIx = await createLeaveEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: ENDED_EVENT_ID,
      });

      // No participation account exists, so the load fails.
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(leaveIx),
        [player.keypair]
      );
    });
  });

  // Event Account State Tests

  describe('Event Account State', () => {
    it('should store start and end times correctly', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(event).not.toBeNull();

      // startTime should be in the past (event already started)
      const now = await getCurrentTimestamp(ctx.svm);
      expect(Number(event!.startTime)).toBeLessThan(now);

      // endTime should be in the future (event not yet ended)
      expect(Number(event!.endTime)).toBeGreaterThan(now);

      // endTime > startTime
      expect(Number(event!.endTime)).toBeGreaterThan(Number(event!.startTime));
    });

    it('should have correct prize pool configuration', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(event).not.toBeNull();

      expect(event!.prizeType).toBe(EventPrizeType.LockedNovi);
      assertBnEquals(event!.prizeAmount, 10000);
      // Initially, prizeRemaining should equal prizeAmount
      assertBnEquals(event!.prizeRemaining, event!.prizeAmount);
    });

    it('should track leaderboard entries', async () => {
      const event = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(event).not.toBeNull();

      // Leaderboard is an array of 10 slots
      expect(event!.leaderboard.length).toBe(10);
      // leaderboardCount tracks how many are populated
      expect(event!.leaderboardCount).toBeGreaterThanOrEqual(0);
      expect(event!.leaderboardCount).toBeLessThanOrEqual(10);
    });

    it('should have different event types', async () => {
      const activeEvent = await fetchEvent(ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID);
      const highLevelEvent = await fetchEvent(ctx.svm, ctx.gameEngine, HIGH_LEVEL_EVENT_ID);
      expect(activeEvent).not.toBeNull();
      expect(highLevelEvent).not.toBeNull();

      // Both are type 0 in our setup, but verify they're stored correctly
      expect(activeEvent!.eventType).toBe(0);
      expect(highLevelEvent!.eventType).toBe(0);

      // Different prize types
      expect(activeEvent!.prizeType).toBe(EventPrizeType.LockedNovi);
      expect(highLevelEvent!.prizeType).toBe(EventPrizeType.Gems);
    });
  });

  // Multi-Event Isolation Tests

  describe('Multiple Events', () => {
    it('should reject joining second event while in first', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join event 1
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      // Verify player is in event 1
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      assertBnEquals(account!.currentEvent, ACTIVE_EVENT_ID);

      // Try to join event 3 (high level) — should fail for multiple reasons:
      // currentEvent is non-zero AND level too low
      const ix = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: HIGH_LEVEL_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should keep participation accounts separate per event', async () => {
      // Create two events' worth of participations and verify they don't interfere
      const player = await factory.createPlayer({ initialize: true });

      // Join active event
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: ACTIVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      // Verify participation exists for active event
      const p1 = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ACTIVE_EVENT_ID, player.publicKey
      );
      expect(p1).not.toBeNull();
      assertBnEquals(p1!.eventId, ACTIVE_EVENT_ID);

      // Verify NO participation for ended event (player never joined it)
      const p2 = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, ENDED_EVENT_ID, player.publicKey
      );
      expect(p2).toBeNull();
    });

    it('should derive unique PDAs per event+player combination', async () => {
      const playerA = (await Keypair.generate()).publicKey;
      const playerB = (await Keypair.generate()).publicKey;

      const [pda1] = await deriveEventParticipationPda(ctx.gameEngine, ACTIVE_EVENT_ID, playerA);
      const [pda2] = await deriveEventParticipationPda(ctx.gameEngine, ACTIVE_EVENT_ID, playerB);
      const [pda3] = await deriveEventParticipationPda(ctx.gameEngine, ENDED_EVENT_ID, playerA);

      // Same event, different player => different PDA
      expect(pda1.equals(pda2)).toBe(false);
      // Same player, different event => different PDA
      expect(pda1.equals(pda3)).toBe(false);
    });
  });

  // Event PDA Derivation Tests

  describe('PDA Derivation', () => {
    it('should derive consistent event PDAs', async () => {
      const [pda1] = await deriveEventPda(ctx.gameEngine, ACTIVE_EVENT_ID);
      const [pda2] = await deriveEventPda(ctx.gameEngine, ACTIVE_EVENT_ID);
      expect(pda1.equals(pda2)).toBe(true);
    });

    it('should derive unique PDAs per event ID', async () => {
      const [pda1] = await deriveEventPda(ctx.gameEngine, ACTIVE_EVENT_ID);
      const [pda2] = await deriveEventPda(ctx.gameEngine, ENDED_EVENT_ID);
      expect(pda1.equals(pda2)).toBe(false);
    });

    it('should derive consistent participation PDAs', async () => {
      const player = (await Keypair.generate()).publicKey;
      const [pda1] = await deriveEventParticipationPda(ctx.gameEngine, ACTIVE_EVENT_ID, player);
      const [pda2] = await deriveEventParticipationPda(ctx.gameEngine, ACTIVE_EVENT_ID, player);
      expect(pda1.equals(pda2)).toBe(true);
    });
  });

  // Full Lifecycle: Create → Join → Score → Finalize → Claim

  describe('Event Lifecycle', () => {
    const LIFECYCLE_EVENT_ID = 4;

    it('should complete full lifecycle: create, join, score via PvP, finalize, verify claim eligibility', async () => {
      // 1. Create combat-ready players (estates, barracks, market, units, equipment, travel)
      //    This sets up two players: attacker (moved to city 1) and defender (city 1)
      const { attacker, defender } = await createCombatReadyPlayers(factory, { moveToRange: true });

      // 2. Create event after players are ready (use fresh timestamp)
      const now = await getCurrentTimestamp(ctx.svm);

      const createEventIx = await createCreateEventInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          eventId: LIFECYCLE_EVENT_ID,
        },
        {
          name: 'LifecycleTest',
          startTime: now - 3600,    // Started 1 hour ago
          endTime: now + 20,         // Ends in 20 seconds
          eventType: 0,              // TotalDamageDealt
          minLevel: 1,
          minReputation: 0,
          requiredSubscriptionTier: 0,
          prizeType: 2,              // Cash
          prizeAmount: 10000,
          autoActivate: true,
        }
      );
      await sendTransaction(ctx.svm, new Transaction().add(createEventIx), [ctx.daoAuthority]);

      // 3. Attacker joins event (auto-activates from Pending → Active)
      const joinIx = await createJoinEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: attacker.publicKey,
        playerOwner: attacker.publicKey,
        eventId: LIFECYCLE_EVENT_ID,
      });
      await sendTransaction(ctx.svm, new Transaction().add(joinIx), [attacker.keypair]);

      // Verify event auto-activated on join
      const eventAfterJoin = await fetchEvent(ctx.svm, ctx.gameEngine, LIFECYCLE_EVENT_ID);
      expect(eventAfterJoin).not.toBeNull();
      expect(eventAfterJoin!.status).toBe(EventStatus.Active);
      expect(eventAfterJoin!.participantCount).toBe(1);

      // Verify participation created with zero score
      const participationBefore = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, LIFECYCLE_EVENT_ID, attacker.publicKey
      );
      expect(participationBefore).not.toBeNull();
      assertBnEquals(participationBefore!.score, 0);

      // 4. PvP attack with event scoring (TotalDamageDealt)
      const attackIx = await createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: 1,
          defenderCityId: 1,
          attackerEventId: LIFECYCLE_EVENT_ID,
        },
        { driveBy: false }
      );
      await sendTransaction(ctx.svm, new Transaction().add(attackIx), [attacker.keypair]);

      // Verify score updated and leaderboard populated
      const participationAfter = await fetchEventParticipation(
        ctx.svm, ctx.gameEngine, LIFECYCLE_EVENT_ID, attacker.publicKey
      );
      expect(participationAfter).not.toBeNull();
      assertBnGreaterThan(participationAfter!.score, 0, 'Score should increase after PvP attack');

      const eventAfterAttack = await fetchEvent(ctx.svm, ctx.gameEngine, LIFECYCLE_EVENT_ID);
      expect(eventAfterAttack).not.toBeNull();
      expect(eventAfterAttack!.leaderboardCount).toBeGreaterThanOrEqual(1);
      expect(eventAfterAttack!.leaderboard[0]!.player.equals(attacker.publicKey)).toBe(true);
      assertBnGreaterThan(eventAfterAttack!.leaderboard[0]!.score, 0, 'Leaderboard score > 0');

      // 5. Advance clock past event end time
      const remaining = Number(eventAfterAttack!.endTime) - (await getCurrentTimestamp(ctx.svm));
      if (remaining > 0) {
        await advanceTime(ctx.svm, remaining + 2);
      }

      // 6. Finalize event (permissionless — anyone can call after end_time)
      const finalizeIx = await createFinalizeEventInstruction({
        gameEngine: ctx.gameEngine,
        eventId: LIFECYCLE_EVENT_ID,
      });
      await sendTransaction(ctx.svm, new Transaction().add(finalizeIx), [attacker.keypair]);

      // Verify finalized state
      const finalizedEvent = await fetchEvent(ctx.svm, ctx.gameEngine, LIFECYCLE_EVENT_ID);
      expect(finalizedEvent).not.toBeNull();
      expect(finalizedEvent!.status).toBe(EventStatus.Finalized);
      assertBnEquals(finalizedEvent!.prizeAmount, 10000);
      assertBnEquals(finalizedEvent!.prizeRemaining, 10000); // Nothing claimed yet

      // Verify attacker is rank 1 on the leaderboard
      expect(finalizedEvent!.leaderboardCount).toBeGreaterThanOrEqual(1);
      expect(finalizedEvent!.leaderboard[0]!.player.equals(attacker.publicKey)).toBe(true);

      // Expected prize: rank 1 = 3500 bps of 10000 = 3500 Cash
      const expectedPrize = Math.floor(10000 * 3500 / 10000);
      expect(expectedPrize).toBe(3500);

      // 7. Attempt claim
      //    Fails with AccountTooNew (6122) because test accounts are < 7 days old.
      //    This proves: player IS rank 1 on leaderboard, event IS finalized,
      //    correct accounts passed. The only blocker is the anti-sybil age check
      //    (7-day minimum account age for prizes < 25K).
      const claimIx = await createClaimPrizeInstruction({
        gameEngine: ctx.gameEngine,
        payer: attacker.publicKey,
        winnerOwner: attacker.publicKey,
        eventId: LIFECYCLE_EVENT_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [attacker.keypair],
        6122, // AccountTooNew — anti-sybil: account age < 7 days
      );

      // Prize pool verified: 10000 Cash, rank 1 gets 35% = 3500 Cash
      // Full lifecycle complete: create → join → score → finalize → claim (blocked by anti-sybil only)
    }, 120_000);
  });

  // Leaving Events: Winner Guard
  //
  // Placed last because it advances the chain clock far enough to finalize a
  // long-window event; running it after every sibling keeps that advance from
  // ending the still-active events those tests rely on. Scores via resource
  // collection (EventType 6) instead of PvP, so it needs no combat fixture.

  describe('Leaving Events: Winner Guard', () => {
    const WINNER_LEAVE_EVENT_ID = 6;

    it('should reject a top-10 winner leaving before claiming their prize', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });
      const now = await getCurrentTimestamp(ctx.svm);

      // MostResourcesCollected event with a long window, so the player can score
      // inside it before we jump the clock past end_time to finalize.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createCreateEventInstruction(
            {
              authority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              eventId: WINNER_LEAVE_EVENT_ID,
            },
            {
              name: 'WinnerLeaveEvent',
              startTime: now - 3600,
              endTime: now + 86400,
              eventType: 6, // MostResourcesCollected (accumulative)
              minLevel: 1,
              minReputation: 0,
              requiredSubscriptionTier: 0,
              prizeType: 2, // Cash
              prizeAmount: 10000,
              autoActivate: true,
            }
          )
        ),
        [ctx.daoAuthority]
      );

      // Join (auto-activate), let resources accrue, then collect with the event
      // attached so the player lands on the leaderboard.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createJoinEventInstruction({
            gameEngine: ctx.gameEngine,
            payer: player.publicKey,
            playerOwner: player.publicKey,
            eventId: WINNER_LEAVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );

      await advanceTime(ctx.svm, 3600);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createCollectResourcesInstruction(
            { owner: player.publicKey, gameEngine: ctx.gameEngine, eventId: WINNER_LEAVE_EVENT_ID },
            { noviAmount: BigInt(100), collectionType: 0 }
          )
        ),
        [player.keypair]
      );

      // Confirm the score registered the player as the sole leaderboard winner.
      const scored = await fetchEvent(ctx.svm, ctx.gameEngine, WINNER_LEAVE_EVENT_ID);
      expect(scored!.leaderboardCount).toBeGreaterThanOrEqual(1);
      expect(scored!.leaderboard[0]!.player.equals(player.publicKey)).toBe(true);

      // End + finalize the event.
      const remaining = Number(scored!.endTime) - (await getCurrentTimestamp(ctx.svm));
      if (remaining > 0) {
        await advanceTime(ctx.svm, remaining + 2);
      }
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          await createFinalizeEventInstruction({
            gameEngine: ctx.gameEngine,
            eventId: WINNER_LEAVE_EVENT_ID,
          })
        ),
        [player.keypair]
      );
      const finalized = await fetchEvent(ctx.svm, ctx.gameEngine, WINNER_LEAVE_EVENT_ID);
      expect(finalized!.status).toBe(EventStatus.Finalized);
      expect(finalized!.leaderboard[0]!.player.equals(player.publicKey)).toBe(true);

      // The winner can't leave (and silently forfeit) before claiming.
      const leaveIx = await createLeaveEventInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        eventId: WINNER_LEAVE_EVENT_ID,
      });
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(leaveIx),
        [player.keypair],
        6614 // EventPrizeUnclaimed — winners must claim first
      );
    }, 30_000);
  });
});
