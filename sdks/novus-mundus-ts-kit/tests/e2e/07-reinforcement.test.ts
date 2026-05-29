/**
 * Reinforcement System E2E Tests
 *
 * Tests for sending defensive troops between teammates:
 * - Sending reinforcements (same team required, barracks required)
 * - Processing arrivals (permissionless crank)
 * - Recalling reinforcements (sender only)
 * - Relieving reinforcements (receiver only)
 * - Return processing (permissionless crank)
 * - Speedup (gem-based, sender only)
 * - State tracking and validation
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);

import { type Address } from '@solana/kit';

import {
  createSendReinforcementInstruction,
  createProcessArrivalInstruction,
  createRecallReinforcementInstruction,
  createRelieveReinforcementInstruction,
  createProcessReturnInstruction,
  createReinforcementSpeedupInstruction,
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  deriveReinforcementPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveTeamPda,
  BuildingType,
  ReinforcementStatus,
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
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchReinforcement,
} from '../utils/accounts';
import { log } from '../utils/logger';
import { advanceTime } from '../fixtures/time';

// Test Suite

describe('Reinforcement System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let teamCounter = 0;

  beforeAll(async () => {
    log.section('Reinforcement System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  function uniqueTeamName(): string {
    return `ReinfTeam${++teamCounter}`;
  }

  // Helper to create a team with 2 members (leader + 1 member)
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

    // Add members with delay between each
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

  // Helper: create two players on same team with estate+barracks, ready for reinforcement
  async function createReinforcementPair(sameCity: boolean = true): Promise<{
    sender: TestPlayer;
    receiver: TestPlayer;
    teamId: number;
    teamPda: Address;
  }> {
    const cityId = 1;
    const sender = await factory.createPlayer({
      cityId,
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks],
    });

    const receiver = await factory.createPlayer({
      cityId: sameCity ? cityId : 2,
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks],
    });


    const { teamPda, teamId } = await createTeamWithMembers(sender, [receiver]);
    return { sender, receiver, teamId, teamPda };
  }

  // Helper: send a reinforcement between two players already on the same team
  async function sendReinforcement(
    sender: TestPlayer,
    receiver: TestPlayer,
    teamId: number,
    units: { def1?: number; def2?: number; def3?: number } = { def1: 50 },
    senderCityId: number = 1,
    destCityId: number = 1,
  ): Promise<void> {
    const ix = await createSendReinforcementInstruction(
      {
        gameEngine: ctx.gameEngine,
        sender: sender.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId,
        destinationCityId: destCityId,
        teamId,
      },
      {
        defensiveUnit1: BigInt(units.def1 ?? 0),
        defensiveUnit2: BigInt(units.def2 ?? 0),
        defensiveUnit3: BigInt(units.def3 ?? 0),
        meleeWeapons: 0n,
        rangedWeapons: 0n,
        siegeWeapons: 0n,
        heroSlot: 255,
      }
    );
    await sendTransaction(ctx.svm, [ix], [sender.keypair]);
  }

  // Send Reinforcement Tests

  describe('Sending Reinforcements', () => {
    it('should send reinforcement to teammate in same city', async () => {
      log.step('Creating reinforcement pair (same city, same team)');
      const { sender, receiver, teamId } = await createReinforcementPair();

      // Hire defensive units for sender
      await factory.hireUnits(sender, 0, 200);

      const senderBefore = await fetchPlayer(ctx.svm, sender.playerPda);
      const initialDef1 = senderBefore!.defensiveUnit1;

      log.step('Sending reinforcement (50 defensive units)');
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Verify units deducted from sender
      const senderAfter = await fetchPlayer(ctx.svm, sender.playerPda);
      expect((senderAfter!.defensiveUnit1 < initialDef1)).toBe(true);

      // Verify reinforcement account created
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(Number(reinforcement!.unitsDef1)).toBe(50);
      expect(reinforcement!.status).toBe(ReinforcementStatus.Traveling);
      log.info(`Reinforcement created: def1=${Number(reinforcement!.unitsDef1)}, status=${reinforcement!.status}`);
    });

    it('should reject reinforcement to self', async () => {
      log.step('Creating player and attempting self-reinforcement');
      const player = await factory.createPlayer({
        cityId: 1,
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await factory.hireUnits(player, 0, 500);

      // Need a team to pass team validation, but self-send still fails
      const teamName = uniqueTeamName();
      const teamId = Date.now() % 1000000;
      await sendTransaction(
        ctx.svm,
        [
          await createTeamCreateInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey, teamId },
            { name: teamName }
          )
        ],
        [player.keypair]
      );

      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: player.publicKey,
          destinationOwner: player.publicKey, // Same as sender
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
      log.txExpectedFail('self-reinforcement rejected');
    });

    it('should reject reinforcement with zero troops', async () => {
      log.step('Attempting reinforcement with zero units');
      const { sender, receiver, teamId } = await createReinforcementPair();

      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: 0n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [sender.keypair]
      );
      log.txExpectedFail('zero-troops reinforcement rejected');
    });

    it('should reject reinforcement exceeding available units', async () => {
      log.step('Attempting reinforcement with more units than available');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 50);

      // Fetch actual unit count so we can exceed it
      const playerAccount = await fetchPlayer(ctx.svm, sender.playerPda);
      const actualUnits = Number(playerAccount!.defensiveUnit1);
      log.step(`Sender has ${actualUnits} defensiveUnit1, attempting ${actualUnits + 1}`);

      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: BigInt(actualUnits + 1), // One more than available
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [sender.keypair]
      );
      log.txExpectedFail('exceeding-units reinforcement rejected');
    });

    it('should reject duplicate reinforcement to same destination', async () => {
      log.step('Sending first reinforcement then attempting duplicate');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 200);

      // Send first reinforcement
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Try to send second to same destination - should fail
      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [sender.keypair]
      );
      log.txExpectedFail('duplicate reinforcement rejected');
    });

    it('should send multiple defensive unit types', async () => {
      log.step('Sending reinforcement with multiple unit types');
      const { sender, receiver, teamId } = await createReinforcementPair();

      // Hire multiple defensive unit types
      await factory.hireUnits(sender, 0, 500);
      await factory.hireUnits(sender, 1, 500);
      await factory.hireUnits(sender, 2, 500);

      await sendReinforcement(sender, receiver, teamId, { def1: 30, def2: 20, def3: 10 });

      // Verify reinforcement has all unit types
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(Number(reinforcement!.unitsDef1)).toBe(30);
      expect(Number(reinforcement!.unitsDef2)).toBe(20);
      expect(Number(reinforcement!.unitsDef3)).toBe(10);
      log.info(`Multi-type reinforcement: def1=${reinforcement!.unitsDef1}, def2=${reinforcement!.unitsDef2}, def3=${reinforcement!.unitsDef3}`);
    });
  });

  // Arrival Processing Tests

  describe('Arrival Processing', () => {
    it('should process same-city reinforcement arrival immediately', async () => {
      log.step('Sending same-city reinforcement and processing arrival');
      const { sender, receiver, teamId } = await createReinforcementPair(true);

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Same city = instant travel, so process arrival immediately
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      const arrivalIx = await createProcessArrivalInstruction({
        reinforcement: reinforcementPda,
        destinationPlayer,
      });

      await sendTransaction(ctx.svm, [arrivalIx], [sender.keypair]);

      // Verify status changed to Active
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.status).toBe(ReinforcementStatus.Active);
      log.info(`Reinforcement arrived, status=${reinforcement!.status}`);
    });

    it('should reject arrival before travel complete for different-city reinforcement', async () => {
      log.step('Sending cross-city reinforcement and attempting early arrival');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.svm, [ix], [sender.keypair]);

      // Immediate arrival should fail (travel not complete)
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      const arrivalIx = await createProcessArrivalInstruction({
        reinforcement: reinforcementPda,
        destinationPlayer,
      });

      await expectTransactionToFail(
        ctx.svm,
        [arrivalIx],
        [sender.keypair]
      );
      log.txExpectedFail('early arrival rejected for cross-city reinforcement');
    });
  });

  // Recall Tests

  describe('Recalling Reinforcements', () => {
    it('should recall reinforcement by sender', async () => {
      log.step('Sending and recalling reinforcement');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Recall
      const recallIx = await createRecallReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        sender: sender.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await sendTransaction(ctx.svm, [recallIx], [sender.keypair]);

      // Verify reinforcement is now returning
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.status).toBe(ReinforcementStatus.Returning);
      expect(reinforcement!.relievedByDestination).toBe(false);
      log.info(`Reinforcement recalled, status=${reinforcement!.status}`);
    });

    it('should reject recall by non-sender', async () => {
      log.step('Attempting recall by non-sender');
      const { sender, receiver, teamId } = await createReinforcementPair();
      const other = await factory.createPlayer({
        cityId: 1,
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Other player tries to recall - should fail (wrong sender key → wrong PDA)
      const recallIx = await createRecallReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        sender: other.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await expectTransactionToFail(
        ctx.svm,
        [recallIx],
        [other.keypair]
      );
      log.txExpectedFail('non-sender recall rejected');
    });
  });

  // Relieve Tests

  describe('Relieving Reinforcements', () => {
    it('should relieve reinforcement by receiver', async () => {
      log.step('Sending, processing arrival, then relieving');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Process arrival first (same city = instant)
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      await sendTransaction(
        ctx.svm,
        [
          await createProcessArrivalInstruction({
            reinforcement: reinforcementPda,
            destinationPlayer,
          })
        ],
        [sender.keypair]
      );

      // Receiver relieves (sends back)
      const relieveIx = await createRelieveReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        destinationOwner: receiver.publicKey,
        senderOwner: sender.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await sendTransaction(ctx.svm, [relieveIx], [receiver.keypair]);

      // Verify reinforcement is now returning, relieved by destination
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.status).toBe(ReinforcementStatus.Returning);
      expect(reinforcement!.relievedByDestination).toBe(true);
      log.info(`Reinforcement relieved, status=${reinforcement!.status}, relievedByDest=${reinforcement!.relievedByDestination}`);
    });

    it('should reject relieve by non-receiver', async () => {
      log.step('Attempting relieve by non-receiver');
      const { sender, receiver, teamId } = await createReinforcementPair();
      const other = await factory.createPlayer({
        cityId: 1,
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Process arrival
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      await sendTransaction(
        ctx.svm,
        [
          await createProcessArrivalInstruction({
            reinforcement: reinforcementPda,
            destinationPlayer,
          })
        ],
        [sender.keypair]
      );

      // Other tries to relieve - should fail (wrong destination owner → wrong PDA)
      const relieveIx = await createRelieveReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        destinationOwner: other.publicKey,
        senderOwner: sender.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await expectTransactionToFail(
        ctx.svm,
        [relieveIx],
        [other.keypair]
      );
      log.txExpectedFail('non-receiver relieve rejected');
    });
  });

  // Return Processing Tests

  describe('Return Processing', () => {
    it('should process reinforcement return and restore units', async () => {
      log.step('Full lifecycle: send → recall → process return');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);

      const senderBefore = await fetchPlayer(ctx.svm, sender.playerPda);
      const initialUnits = senderBefore!.defensiveUnit1;

      // Send
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Recall (same city = instant travel, so recall immediately)
      await sendTransaction(
        ctx.svm,
        [
          await createRecallReinforcementInstruction({
            gameEngine: ctx.gameEngine,
            sender: sender.publicKey,
            destinationOwner: receiver.publicKey,
            senderCityId: 1,
            destinationCityId: 1,
          })
        ],
        [sender.keypair]
      );

      // Advance clock past return travel time
      await advanceTime(ctx.svm, 5);

      // Process return
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [senderPlayer] = await derivePlayerPda(ctx.gameEngine, sender.publicKey);
      const [senderEstate] = await deriveEstatePda(senderPlayer);

      const returnIx = await createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer,
        senderOwner: sender.publicKey,
        estateAccount: senderEstate,
      });

      await sendTransaction(ctx.svm, [returnIx], [sender.keypair]);

      // Verify units returned (account should be closed)
      const senderAfter = await fetchPlayer(ctx.svm, sender.playerPda);
      expect((senderAfter!.defensiveUnit1 === initialUnits)).toBe(true);
      log.info(`Units restored: before=${initialUnits}, after=${senderAfter!.defensiveUnit1}`);
    });

    it('should reject return before travel complete for cross-city', async () => {
      log.step('Attempting early return for cross-city reinforcement');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.svm, [ix], [sender.keypair]);

      // Recall immediately (while traveling)
      await sendTransaction(
        ctx.svm,
        [
          await createRecallReinforcementInstruction({
            gameEngine: ctx.gameEngine,
            sender: sender.publicKey,
            destinationOwner: receiver.publicKey,
            senderCityId: 1,
            destinationCityId: 2,
          })
        ],
        [sender.keypair]
      );

      // Immediate return should fail (return travel not complete)
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [senderPlayer] = await derivePlayerPda(ctx.gameEngine, sender.publicKey);
      const [senderEstate] = await deriveEstatePda(senderPlayer);

      const returnIx = await createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer,
        senderOwner: sender.publicKey,
        estateAccount: senderEstate,
      });

      await expectTransactionToFail(
        ctx.svm,
        [returnIx],
        [sender.keypair]
      );
      log.txExpectedFail('early return rejected for cross-city');
    });
  });

  // Speedup Tests

  describe('Reinforcement Speedup', () => {
    it('should speedup cross-city reinforcement travel', async () => {
      log.step('Sending cross-city reinforcement and applying speedup');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const sendIx = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.svm, [sendIx], [sender.keypair]);

      // Check initial arrival time
      const reinfBefore = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      const arrivalBefore = reinfBefore!.arrivesAt;

      // Apply speedup tier 2 (25% time remains, costs 2x gems)
      const speedupIx = await createReinforcementSpeedupInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
        },
        { speedupTier: 2 }
      );

      await sendTransaction(ctx.svm, [speedupIx], [sender.keypair]);

      // Verify arrival time decreased
      const reinfAfter = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect((reinfAfter!.arrivesAt < arrivalBefore)).toBe(true);
      log.info(`Speedup applied: arrival before=${arrivalBefore}, after=${reinfAfter!.arrivesAt}`);
    });

    it('should reject speedup by non-sender', async () => {
      log.step('Attempting speedup by non-sender');
      const { sender, receiver, teamId } = await createReinforcementPair();
      const other = await factory.createPlayer({
        cityId: 1,
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Other tries to speedup - wrong sender key → wrong reinforcement PDA
      const speedupIx = await createReinforcementSpeedupInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: other.publicKey,
          destinationOwner: receiver.publicKey,
        },
        { speedupTier: 1 }
      );

      await expectTransactionToFail(
        ctx.svm,
        [speedupIx],
        [other.keypair]
      );
      log.txExpectedFail('non-sender speedup rejected');
    });
  });

  // Full Lifecycle with Speedup Tests

  describe('Full Lifecycle', () => {
    it('should complete full send → arrive → relieve → return lifecycle with speedups', async () => {
      log.step('Full lifecycle with speedups for cross-city reinforcement');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 200);

      const senderBefore = await fetchPlayer(ctx.svm, sender.playerPda);
      const initialUnits = senderBefore!.defensiveUnit1;

      // 1. Send to different city
      log.step('Step 1: Send reinforcement');
      const sendIx = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.svm, [sendIx], [sender.keypair]);

      // 2. Apply multiple speedups to make travel instant
      log.step('Step 2: Apply speedups to complete travel');
      for (let i = 0; i < 10; i++) {
        try {
          const speedupIx = await createReinforcementSpeedupInstruction(
            {
              gameEngine: ctx.gameEngine,
              sender: sender.publicKey,
              destinationOwner: receiver.publicKey,
            },
            { speedupTier: 2 }
          );
          await sendTransaction(ctx.svm, [speedupIx], [sender.keypair]);
        } catch (e) {
          log.caught(`Speedup ${i + 1} failed (travel may already be complete)`, e);
          break;
        }
      }

      // 3. Process arrival
      log.step('Step 3: Process arrival');
      const [reinforcementPda] = await deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = await derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      await sendTransaction(
        ctx.svm,
        [
          await createProcessArrivalInstruction({
            reinforcement: reinforcementPda,
            destinationPlayer,
          })
        ],
        [sender.keypair]
      );

      const reinfActive = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinfActive!.status).toBe(ReinforcementStatus.Active);

      // 4. Relieve by receiver
      log.step('Step 4: Relieve by receiver');
      const relieveIx = await createRelieveReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        destinationOwner: receiver.publicKey,
        senderOwner: sender.publicKey,
        senderCityId: 1,
        destinationCityId: 2,
      });
      await sendTransaction(ctx.svm, [relieveIx], [receiver.keypair]);

      // 5. Speedup return
      log.step('Step 5: Speedup return travel');
      for (let i = 0; i < 10; i++) {
        try {
          const speedupIx = await createReinforcementSpeedupInstruction(
            {
              gameEngine: ctx.gameEngine,
              sender: sender.publicKey,
              destinationOwner: receiver.publicKey,
            },
            { speedupTier: 2 }
          );
          await sendTransaction(ctx.svm, [speedupIx], [sender.keypair]);
        } catch (e) {
          log.caught(`Return speedup ${i + 1} failed (travel may already be complete)`, e);
          break;
        }
      }

      // 6. Process return
      log.step('Step 6: Process return');
      // Advance clock past return travel time
      await advanceTime(ctx.svm, 60);

      const [senderPlayer] = await derivePlayerPda(ctx.gameEngine, sender.publicKey);
      const [senderEstate] = await deriveEstatePda(senderPlayer);

      const returnIx = await createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer,
        senderOwner: sender.publicKey,
        estateAccount: senderEstate,
      });

      await sendTransaction(ctx.svm, [returnIx], [sender.keypair]);

      // 7. Verify units returned
      const senderAfter = await fetchPlayer(ctx.svm, sender.playerPda);
      expect((senderAfter!.defensiveUnit1 === initialUnits)).toBe(true);
      log.info(`Full lifecycle complete: units restored from ${initialUnits} → ${senderAfter!.defensiveUnit1}`);
    });
  });

  // Reinforcement State Tests

  describe('Reinforcement State', () => {
    it('should track travel timing correctly', async () => {
      log.step('Verifying reinforcement timing fields');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();

      // Same city → travel duration should be 0
      expect(reinforcement!.travelDuration).toBe(0);
      expect(Number(reinforcement!.sentAt)).toBeGreaterThan(0);
      expect(Number(reinforcement!.arrivesAt)).toBeGreaterThan(0);

      // Return not started yet
      expect(Number(reinforcement!.returnStartedAt)).toBe(0);
      expect(reinforcement!.returnDuration).toBe(0);

      log.info(`Timing: sentAt=${reinforcement!.sentAt}, travelDuration=${reinforcement!.travelDuration}, arrivesAt=${reinforcement!.arrivesAt}`);
    });

    it('should have non-zero travel duration for cross-city reinforcement', async () => {
      log.step('Verifying cross-city travel duration');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const ix = await createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: 50n,
          defensiveUnit2: 0n,
          defensiveUnit3: 0n,
          meleeWeapons: 0n,
          rangedWeapons: 0n,
          siegeWeapons: 0n,
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.svm, [ix], [sender.keypair]);

      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.travelDuration).toBeGreaterThan(0);
      expect((reinforcement!.arrivesAt > reinforcement!.sentAt)).toBe(true);
      log.info(`Cross-city travel: duration=${reinforcement!.travelDuration}s, sentAt=${reinforcement!.sentAt}, arrivesAt=${reinforcement!.arrivesAt}`);
    });
  });
});
