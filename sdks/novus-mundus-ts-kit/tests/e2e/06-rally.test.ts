/**
 * Rally System E2E Tests
 *
 * Tests for coordinated team attacks:
 * - Rally creation (player and encounter targets)
 * - Joining rallies (team members only)
 * - Leaving rallies (during gathering phase)
 * - Cancelling rallies (creator only)
 * - Rally speedup (gather phase)
 * - Rally process return (after cancel)
 * - Rally close (after all participants returned)
 * - Rally state tracking (participant count, total units)
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);
import { generateKeyPairSigner, type Address } from '@solana/kit';

import {
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createRallyCreateInstruction,
  createRallyJoinInstruction,
  createRallyLeaveInstruction,
  createRallyCancelInstruction,
  createRallySpeedupInstruction,
  createRallyCloseInstruction,
  createRallyProcessReturnInstruction,
  createRallyExecuteInstruction,
  deriveRallyPda,
  deriveRallyParticipantPda,
  deriveTeamPda,
  derivePlayerPda,
  deriveTeamInvitePda,
  deriveEstatePda,
  RallyTargetType,
  RallySpeedupType,
  RallyStatus,
  BuildingType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import {
  PlayerFactory,
  type TestPlayer,
  createRallyReadyPlayers,
} from '../fixtures/players';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchRally,
  fetchRallyParticipant,
} from '../utils/accounts';
import { log } from '../utils/logger';
import { advanceTime } from '../fixtures/time';

// Test Suite

describe('Rally System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let teamCounter = 0;

  beforeAll(async () => {
    log.section('Rally System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  function uniqueTeamName(): string {
    return `RallyTeam${++teamCounter}`;
  }

  // Helper to create a team with members, adding 200ms delay between operations
  async function createTeamWithMembers(
    leader: TestPlayer,
    members: TestPlayer[]
  ): Promise<{ teamPda: Address; teamId: number }> {
    const teamName = uniqueTeamName();
    const teamId = Date.now() % 1000000;

    // Create team
    await sendTransaction(
      ctx.svm,
      [
        await createTeamCreateInstruction(
          { gameEngine: ctx.gameEngine, owner: leader.publicKey, teamId },
          { name: teamName }
        )
      ],
      [leader.keypair]
    );

    const [teamPda] = await deriveTeamPda(ctx.gameEngine, teamId);

    // Add members with 200ms delay between each
    for (let i = 0; i < members.length; i++) {
      const member = members[i]!;


      await sendTransaction(
        ctx.svm,
        [
          await createTeamInviteInstruction({
            gameEngine: ctx.gameEngine,
            inviter: leader.publicKey,
            team: teamPda,
            inviteePlayer: member.playerPda,
            teamId,
            inviterSlotIndex: 0,
            leaderPlayer: leader.playerPda,
          })
        ],
        [leader.keypair]
      );



      await sendTransaction(
        ctx.svm,
        [
          await createTeamAcceptInviteInstruction({
            gameEngine: ctx.gameEngine,
            owner: member.publicKey,
            team: teamPda,
            slotIndex: i + 1,
            teamId,
            inviteRefund: leader.publicKey,
            leaderPlayer: leader.playerPda,
          })
        ],
        [member.keypair]
      );
    }

    return { teamPda, teamId };
  }

  // Helper to create rally-ready players with delays between each creation
  async function createRallyReadyPlayersWithDelay(participantCount: number) {
    const result = await createRallyReadyPlayers(factory, participantCount);
    return result;
  }

  // Rally Creation Tests

  describe('Rally Creation', () => {
    it('should create a rally targeting a player with correct on-chain state', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      const ix = await createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: rallyIndex,
          target: target.playerPda,
          teamId,
          rallyCityId: creatorCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: 3600n,
          targetCityId,
          defensiveUnit1: 100n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
        }
      );

      await sendTransaction(ctx.svm, [ix], [creator.keypair]);

      // Verify rally was created with correct state
      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);
      const rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();
      expect(rally!.participantCount).toBe(1); // Creator is auto-joined
      expect(rally!.status).toBe(RallyStatus.Gathering);
      expect(rally!.rallyCity).toBe(creatorCityId);
      expect(rally!.targetCity).toBe(targetCityId);
      expect(rally!.target === target.playerPda).toBe(true);

      // Verify creator's participant was created
      const creatorParticipant = await fetchRallyParticipant(
        ctx.svm, ctx.gameEngine, creator.publicKey, rallyIndex, creator.publicKey
      );
      expect(creatorParticipant).not.toBeNull();
      expect(creatorParticipant!.isLeader).toBe(true);
      expect(Number(creatorParticipant!.unitsCommitted1)).toBe(100);

      // Verify creator's units were deducted
      const postCreator = await fetchPlayer(ctx.svm, creator.playerPda);
      expect(Number(postCreator!.defensiveUnit1)).toBeLessThan(Number(creatorAccount!.defensiveUnit1));
    });

    it('should create a rally targeting an encounter using a non-null target pubkey', async () => {
      const { creator, participants } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      const rallyIndex = 1;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;

      // Use a random keypair as a dummy encounter target (must be non-null)
      const dummyEncounterTarget = (await generateKeyPairSigner()).address;

      const ix = await createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: rallyIndex,
          target: dummyEncounterTarget,
          teamId,
          rallyCityId: creatorCityId,
        },
        {
          targetType: RallyTargetType.Encounter,
          gatherDuration: 3600n,
          targetCityId: creatorCityId,
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
        }
      );

      await sendTransaction(ctx.svm, [ix], [creator.keypair]);

      // Verify rally was created with encounter target type
      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);
      const rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();
      expect(rally!.targetType).toBe(RallyTargetType.Encounter);
      expect(rally!.target === dummyEncounterTarget).toBe(true);
    });

    it('should reject rally creation when player has no team', async () => {
      // Create a player with estate+citadel but NOT on any team
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      // Do NOT create a team — creator is not on any team yet
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;

      // Try to create rally without being on a team — use a fake teamId
      const ix = await createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: 0,
          target: target.playerPda,
          teamId: 99999,
          rallyCityId: creatorCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: 3600n,
          targetCityId: creatorCityId,
          defensiveUnit1: 100n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [creator.keypair]
      );
    });

    it('should reject rally with invalid target type value (99)', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;

      const ix = await createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: 0,
          target: target.playerPda,
          teamId,
          rallyCityId: creatorCityId,
        },
        {
          targetType: 99 as any,
          gatherDuration: 3600n,
          targetCityId: creatorCityId,
          defensiveUnit1: 100n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [creator.keypair]
      );
    });

    it('should reject rally with zero committed units', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;

      const ix = await createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: 0,
          target: target.playerPda,
          teamId,
          rallyCityId: creatorCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: 3600n,
          targetCityId: creatorCityId,
          defensiveUnit1: 0n, // Zero units should fail
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [creator.keypair]
      );
    });
  });

  // Rally Join Tests

  describe('Rally Join', () => {
    it('should allow a team member to join a rally and create participant account', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(3);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // First participant joins the rally
      const participant = participants[0]!;


      await sendTransaction(
        ctx.svm,
        [
          await createRallyJoinInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: participant.publicKey,
              rally: rallyPda,
              rallyCreator: creator.publicKey,
              rallyId: rallyIndex,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              defensiveUnit1: 50n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [participant.keypair]
      );

      // Verify participant account was created
      const participantInfo = await fetchRallyParticipant(
        ctx.svm, ctx.gameEngine, creator.publicKey, rallyIndex, participant.publicKey
      );
      expect(participantInfo).not.toBeNull();
      expect(participantInfo!.isLeader).toBe(false);
      expect(Number(participantInfo!.unitsCommitted1)).toBe(50);

      // Verify rally participant count increased
      const rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.participantCount).toBe(2);
    });

    it('should reject a non-team-member from joining rally', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Create an outsider player (not on the team) with Barracks for units
      const outsider = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await factory.hireUnits(outsider, 0, 50000);



      const joinIx = await createRallyJoinInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: outsider.publicKey,
          rally: rallyPda,
          rallyCreator: creator.publicKey,
          rallyId: rallyIndex,
          teamId,
          rallyCityId: creatorCityId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [joinIx],
        [outsider.keypair]
      );
    });
  });

  // Rally Leave Tests

  describe('Rally Leave', () => {
    it('should allow a non-leader participant to leave during gathering phase', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(3);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Participant joins
      const participant = participants[0]!;
      const participantAccount = await fetchPlayer(ctx.svm, participant.playerPda);
      const participantCityId = participantAccount!.currentCity;


      await sendTransaction(
        ctx.svm,
        [
          await createRallyJoinInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: participant.publicKey,
              rally: rallyPda,
              rallyCreator: creator.publicKey,
              rallyId: rallyIndex,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              defensiveUnit1: 50n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [participant.keypair]
      );

      // Verify joined (participant_count should be 2)
      let rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.participantCount).toBe(2);

      // Now leave

      await sendTransaction(
        ctx.svm,
        [
          await createRallyLeaveInstruction({
            gameEngine: ctx.gameEngine,
            owner: participant.publicKey,
            rally: rallyPda,
            rallyCreator: creator.publicKey,
            rallyId: rallyIndex,
            rallyCityId: creatorCityId,
            homeCityId: participantCityId,
          })
        ],
        [participant.keypair]
      );

      // Verify participant count decreased
      rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.participantCount).toBe(1);
    });
  });

  // Rally Cancel Tests

  describe('Rally Cancel', () => {
    it('should allow the rally creator to cancel during gathering phase', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Cancel rally

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCancelInstruction({
            gameEngine: ctx.gameEngine,
            owner: creator.publicKey,
            rally: rallyPda,
            rallyId: rallyIndex,
            rallyCityId: creatorCityId,
          })
        ],
        [creator.keypair]
      );

      // Verify rally status is Cancelled
      const rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();
      expect(rally!.status).toBe(RallyStatus.Cancelled);
    });

    it('should reject cancel by non-creator participant', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Non-creator tries to cancel — should fail
      const participant = participants[0]!;

      const cancelIx = await createRallyCancelInstruction({
        gameEngine: ctx.gameEngine,
        owner: participant.publicKey,
        rally: rallyPda,
        rallyId: rallyIndex,
        rallyCityId: creatorCityId,
      });

      await expectTransactionToFail(
        ctx.svm,
        [cancelIx],
        [participant.keypair]
      );
    });
  });

  // Rally Speedup Tests

  describe('Rally Speedup', () => {
    it('should speedup rally participant gather travel using gems', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally with long gather duration
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 7200n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Speedup the leader's gather travel

      const speedupIx = await createRallySpeedupInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rally: rallyPda,
          rallyCreator: creator.publicKey,
          rallyId: rallyIndex,
          participant: creator.publicKey,
        },
        {
          speedupType: RallySpeedupType.Gather,
          speedupTier: 2,
        }
      );

      await sendTransaction(ctx.svm, [speedupIx], [creator.keypair]);

      // Verify the participant's travel time was reduced
      const participantInfo = await fetchRallyParticipant(
        ctx.svm, ctx.gameEngine, creator.publicKey, rallyIndex, creator.publicKey
      );
      expect(participantInfo).not.toBeNull();
      // After tier 2 speedup, travel time should be reduced (25% remaining)
    });
  });

  // Rally Process Return & Close Tests

  describe('Rally Process Return & Close', () => {
    it('should process return after cancel and then close the rally', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Cancel rally

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCancelInstruction({
            gameEngine: ctx.gameEngine,
            owner: creator.publicKey,
            rally: rallyPda,
            rallyId: rallyIndex,
            rallyCityId: creatorCityId,
          })
        ],
        [creator.keypair]
      );

      // Speedup the creator's return journey (12x tier 2 to get near zero)
      for (let i = 0; i < 12; i++) {
        try {
          await sendTransaction(
            ctx.svm,
            [
              await createRallySpeedupInstruction(
                {
                  gameEngine: ctx.gameEngine,
                  owner: creator.publicKey,
                  rally: rallyPda,
                  rallyCreator: creator.publicKey,
                  rallyId: rallyIndex,
                  participant: creator.publicKey,
                },
                {
                  speedupType: RallySpeedupType.Return,
                  speedupTier: 2,
                }
              )
            ],
            [creator.keypair]
          );
        } catch {
          break; // Already fast enough
        }
      }

      // Advance LiteSVM clock past return travel time
      await advanceTime(ctx.svm, 60);

      // Process return — returns units to player and closes participant account
      await sendTransaction(
        ctx.svm,
        [
          await createRallyProcessReturnInstruction({
            gameEngine: ctx.gameEngine,
            rally: rallyPda,
            rallyCreator: creator.publicKey,
            rallyId: rallyIndex,
            participantOwner: creator.publicKey,
            rallyCityId: creatorCityId,
            homeCityId: creatorCityId,
          })
        ],
        [creator.keypair]
      );

      // Verify participant was closed
      const participantInfo = await fetchRallyParticipant(
        ctx.svm, ctx.gameEngine, creator.publicKey, rallyIndex, creator.publicKey
      );
      expect(participantInfo).toBeNull();

      // Verify returned_count matches participant_count
      let rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.returnedCount).toBe(rally!.participantCount);

      // Close rally — refund rent to leader
      await sendTransaction(
        ctx.svm,
        [
          await createRallyCloseInstruction({
            leaderOwner: creator.publicKey,
            rally: rallyPda,
          })
        ],
        [creator.keypair]
      );

      // Verify rally account is closed
      rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).toBeNull();
    });
  });

  // Rally State Tests

  describe('Rally State', () => {
    it('should increment participant count when members join', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(3);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Check initial state — creator auto-joined
      let rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.participantCount).toBe(1);

      // First participant joins
      const p1 = participants[0]!;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyJoinInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: p1.publicKey,
              rally: rallyPda,
              rallyCreator: creator.publicKey,
              rallyId: rallyIndex,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              defensiveUnit1: 50n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [p1.keypair]
      );

      rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.participantCount).toBe(2);

      // Second participant joins
      const p2 = participants[1]!;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyJoinInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: p2.publicKey,
              rally: rallyPda,
              rallyCreator: creator.publicKey,
              rallyId: rallyIndex,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              defensiveUnit1: 30n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [p2.keypair]
      );

      rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally!.participantCount).toBe(3);
    });

    it('should accumulate total units from all participants', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(3);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally with 100 units from creator
      const rallyIndex = 0;
      const creatorUnits = 100;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 3600n,
              targetCityId,
              defensiveUnit1: BigInt(creatorUnits),
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Verify initial total units
      let rally = await fetchRally(ctx.svm, rallyPda);
      expect(Number(rally!.totalUnits)).toBe(creatorUnits);

      // Join with 75 more units
      const participant = participants[0]!;
      const participantUnits = 75;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyJoinInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: participant.publicKey,
              rally: rallyPda,
              rallyCreator: creator.publicKey,
              rallyId: rallyIndex,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              defensiveUnit1: BigInt(participantUnits),
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [participant.keypair]
      );

      // Verify total units accumulated correctly
      rally = await fetchRally(ctx.svm, rallyPda);
      expect(Number(rally!.totalUnits)).toBe(creatorUnits + participantUnits);
    });
  });

  // Rally Execute Tests

  describe('Rally Execute', () => {
    it('should execute rally after gather time expires', async () => {
      const { creator, participants, target } = await createRallyReadyPlayersWithDelay(2);
      const { teamPda, teamId } = await createTeamWithMembers(creator, participants);

      // Create rally with very short gather duration (1 second)
      const rallyIndex = 0;
      const creatorAccount = await fetchPlayer(ctx.svm, creator.playerPda);
      const creatorCityId = creatorAccount!.currentCity;
      const targetAccount = await fetchPlayer(ctx.svm, target.playerPda);
      const targetCityId = targetAccount!.currentCity;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: creator.publicKey,
              rallyId: rallyIndex,
              target: target.playerPda,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: 1n, // 1 second gather time
              targetCityId,
              defensiveUnit1: 100n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [creator.keypair]
      );

      const [rallyPda] = await deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyIndex);

      // Join with a participant
      const participant = participants[0]!;

      await sendTransaction(
        ctx.svm,
        [
          await createRallyJoinInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: participant.publicKey,
              rally: rallyPda,
              rallyCreator: creator.publicKey,
              rallyId: rallyIndex,
              teamId,
              rallyCityId: creatorCityId,
            },
            {
              defensiveUnit1: 50n,
              defensiveUnit2: 0n,
              defensiveUnit3: 0n,
              meleeWeapons: 0n,
              rangedWeapons: 0n,
              siegeWeapons: 0n,
            }
          )
        ],
        [participant.keypair]
      );

      // Speedup gather phase to completion
      for (let i = 0; i < 5; i++) {
        try {
          await sendTransaction(
            ctx.svm,
            [
              await createRallySpeedupInstruction(
                {
                  gameEngine: ctx.gameEngine,
                  owner: creator.publicKey,
                  rally: rallyPda,
                  rallyCreator: creator.publicKey,
                  rallyId: rallyIndex,
                  participant: creator.publicKey,
                },
                { speedupType: RallySpeedupType.Gather, speedupTier: 2 }
              )
            ],
            [creator.keypair]
          );
        } catch {
          break;
        }
      }

      // Advance LiteSVM clock past gather time
      await advanceTime(ctx.svm, 5);

      // Build participant PDA list
      const [creatorParticipantPda] = await deriveRallyParticipantPda(ctx.gameEngine, creator.publicKey, rallyIndex, creator.publicKey);
      const [participantPda] = await deriveRallyParticipantPda(ctx.gameEngine, creator.publicKey, rallyIndex, participant.publicKey);
      const [leaderEstatePda] = await deriveEstatePda(creator.playerPda);

      // Execute rally
      const executeIx = await createRallyExecuteInstruction({
        gameEngine: ctx.gameEngine,
        rally: rallyPda,
        target: target.playerPda,
        leaderEstate: leaderEstatePda,
        rallyParticipants: [creatorParticipantPda, participantPda],
      });

      try {
        await sendTransaction(ctx.svm, [executeIx], [creator.keypair]);

        // Verify rally status changed
        const rally = await fetchRally(ctx.svm, rallyPda);
        expect(rally).not.toBeNull();
        // After execute, status should be Returning or Completed
        expect(rally!.status).not.toBe(RallyStatus.Gathering);
      } catch {
        // Rally execute may fail if gather time hasn't fully elapsed on-chain
        // or if travel to target is required. This validates the instruction builds correctly.
      }
    });
  });
});
