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

import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

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
import { sleep } from '../fixtures/time';

// ============================================================
// Test Suite
// ============================================================

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
  ): Promise<{ teamPda: PublicKey; teamId: number }> {
    const teamName = uniqueTeamName();
    const teamId = Date.now() % 1000000;

    // Create team
    await sendTransaction(
      ctx.connection,
      new Transaction().add(
        createTeamCreateInstruction(
          { gameEngine: ctx.gameEngine, owner: leader.publicKey, teamId },
          { name: teamName }
        )
      ),
      [leader.keypair]
    );

    const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

    // Add members with delay between each
    for (let i = 0; i < members.length; i++) {
      const member = members[i]!;
      await sleep(200);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamInviteInstruction({
            gameEngine: ctx.gameEngine,
            inviter: leader.publicKey,
            team: teamPda,
            inviteePlayer: member.playerPda,
            teamId,
            inviterSlotIndex: 0,
          })
        ),
        [leader.keypair]
      );

      await sleep(200);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createTeamAcceptInviteInstruction({
            gameEngine: ctx.gameEngine,
            owner: member.publicKey,
            team: teamPda,
            slotIndex: i + 1,
            teamId,
            inviteRefund: leader.publicKey,
          })
        ),
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
    teamPda: PublicKey;
  }> {
    const cityId = 1;
    const sender = await factory.createPlayer({
      cityId,
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks],
    });
    await sleep(200);
    const receiver = await factory.createPlayer({
      cityId: sameCity ? cityId : 2,
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Barracks],
    });
    await sleep(200);

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
    const ix = createSendReinforcementInstruction(
      {
        gameEngine: ctx.gameEngine,
        sender: sender.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId,
        destinationCityId: destCityId,
        teamId,
      },
      {
        defensiveUnit1: new BN(units.def1 ?? 0),
        defensiveUnit2: new BN(units.def2 ?? 0),
        defensiveUnit3: new BN(units.def3 ?? 0),
        meleeWeapons: new BN(0),
        rangedWeapons: new BN(0),
        siegeWeapons: new BN(0),
        heroSlot: 255,
      }
    );
    await sendTransaction(ctx.connection, new Transaction().add(ix), [sender.keypair]);
  }

  // ============================================================
  // Send Reinforcement Tests
  // ============================================================

  describe('Sending Reinforcements', () => {
    it('should send reinforcement to teammate in same city', async () => {
      log.step('Creating reinforcement pair (same city, same team)');
      const { sender, receiver, teamId } = await createReinforcementPair();

      // Hire defensive units for sender
      await factory.hireUnits(sender, 0, 200);

      const senderBefore = await fetchPlayer(ctx.connection, sender.playerPda);
      const initialDef1 = senderBefore!.defensiveUnit1;

      log.step('Sending reinforcement (50 defensive units)');
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Verify units deducted from sender
      const senderAfter = await fetchPlayer(ctx.connection, sender.playerPda);
      expect(senderAfter!.defensiveUnit1.lt(initialDef1)).toBe(true);

      // Verify reinforcement account created
      const reinforcement = await fetchReinforcement(
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.unitsDef1.toNumber()).toBe(50);
      expect(reinforcement!.status).toBe(ReinforcementStatus.Traveling);
      log.info(`Reinforcement created: def1=${reinforcement!.unitsDef1.toNumber()}, status=${reinforcement!.status}`);
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
        ctx.connection,
        new Transaction().add(
          createTeamCreateInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey, teamId },
            { name: teamName }
          )
        ),
        [player.keypair]
      );

      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: player.publicKey,
          destinationOwner: player.publicKey, // Same as sender
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
      log.txExpectedFail('self-reinforcement rejected');
    });

    it('should reject reinforcement with zero troops', async () => {
      log.step('Attempting reinforcement with zero units');
      const { sender, receiver, teamId } = await createReinforcementPair();

      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: new BN(0),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [sender.keypair]
      );
      log.txExpectedFail('zero-troops reinforcement rejected');
    });

    it('should reject reinforcement exceeding available units', async () => {
      log.step('Attempting reinforcement with more units than available');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 50);

      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: new BN(10000), // Way more than available
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
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
      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
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
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.unitsDef1.toNumber()).toBe(30);
      expect(reinforcement!.unitsDef2.toNumber()).toBe(20);
      expect(reinforcement!.unitsDef3.toNumber()).toBe(10);
      log.info(`Multi-type reinforcement: def1=${reinforcement!.unitsDef1}, def2=${reinforcement!.unitsDef2}, def3=${reinforcement!.unitsDef3}`);
    });
  });

  // ============================================================
  // Arrival Processing Tests
  // ============================================================

  describe('Arrival Processing', () => {
    it('should process same-city reinforcement arrival immediately', async () => {
      log.step('Sending same-city reinforcement and processing arrival');
      const { sender, receiver, teamId } = await createReinforcementPair(true);

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Same city = instant travel, so process arrival immediately
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      const arrivalIx = createProcessArrivalInstruction({
        reinforcement: reinforcementPda,
        destinationPlayer,
      });

      await sendTransaction(ctx.connection, new Transaction().add(arrivalIx), [sender.keypair]);

      // Verify status changed to Active
      const reinforcement = await fetchReinforcement(
        ctx.connection,
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
      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.connection, new Transaction().add(ix), [sender.keypair]);

      // Immediate arrival should fail (travel not complete)
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      const arrivalIx = createProcessArrivalInstruction({
        reinforcement: reinforcementPda,
        destinationPlayer,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(arrivalIx),
        [sender.keypair]
      );
      log.txExpectedFail('early arrival rejected for cross-city reinforcement');
    });
  });

  // ============================================================
  // Recall Tests
  // ============================================================

  describe('Recalling Reinforcements', () => {
    it('should recall reinforcement by sender', async () => {
      log.step('Sending and recalling reinforcement');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Recall
      const recallIx = createRecallReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        sender: sender.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await sendTransaction(ctx.connection, new Transaction().add(recallIx), [sender.keypair]);

      // Verify reinforcement is now returning
      const reinforcement = await fetchReinforcement(
        ctx.connection,
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
      const recallIx = createRecallReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        sender: other.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(recallIx),
        [other.keypair]
      );
      log.txExpectedFail('non-sender recall rejected');
    });
  });

  // ============================================================
  // Relieve Tests
  // ============================================================

  describe('Relieving Reinforcements', () => {
    it('should relieve reinforcement by receiver', async () => {
      log.step('Sending, processing arrival, then relieving');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Process arrival first (same city = instant)
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createProcessArrivalInstruction({
            reinforcement: reinforcementPda,
            destinationPlayer,
          })
        ),
        [sender.keypair]
      );

      // Receiver relieves (sends back)
      const relieveIx = createRelieveReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        destinationOwner: receiver.publicKey,
        senderOwner: sender.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await sendTransaction(ctx.connection, new Transaction().add(relieveIx), [receiver.keypair]);

      // Verify reinforcement is now returning, relieved by destination
      const reinforcement = await fetchReinforcement(
        ctx.connection,
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
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createProcessArrivalInstruction({
            reinforcement: reinforcementPda,
            destinationPlayer,
          })
        ),
        [sender.keypair]
      );

      // Other tries to relieve - should fail (wrong destination owner → wrong PDA)
      const relieveIx = createRelieveReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        destinationOwner: other.publicKey,
        senderOwner: sender.publicKey,
        senderCityId: 1,
        destinationCityId: 1,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(relieveIx),
        [other.keypair]
      );
      log.txExpectedFail('non-receiver relieve rejected');
    });
  });

  // ============================================================
  // Return Processing Tests
  // ============================================================

  describe('Return Processing', () => {
    it('should process reinforcement return and restore units', async () => {
      log.step('Full lifecycle: send → recall → process return');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);

      const senderBefore = await fetchPlayer(ctx.connection, sender.playerPda);
      const initialUnits = senderBefore!.defensiveUnit1;

      // Send
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      // Recall (same city = instant travel, so recall immediately)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createRecallReinforcementInstruction({
            gameEngine: ctx.gameEngine,
            sender: sender.publicKey,
            destinationOwner: receiver.publicKey,
            senderCityId: 1,
            destinationCityId: 1,
          })
        ),
        [sender.keypair]
      );

      // Process return (same city = instant return)
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [senderPlayer] = derivePlayerPda(ctx.gameEngine, sender.publicKey);
      const [senderEstate] = deriveEstatePda(senderPlayer);

      const returnIx = createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer,
        senderOwner: sender.publicKey,
        estateAccount: senderEstate,
      });

      await sendTransaction(ctx.connection, new Transaction().add(returnIx), [sender.keypair]);

      // Verify units returned (account should be closed)
      const senderAfter = await fetchPlayer(ctx.connection, sender.playerPda);
      expect(senderAfter!.defensiveUnit1.eq(initialUnits)).toBe(true);
      log.info(`Units restored: before=${initialUnits}, after=${senderAfter!.defensiveUnit1}`);
    });

    it('should reject return before travel complete for cross-city', async () => {
      log.step('Attempting early return for cross-city reinforcement');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.connection, new Transaction().add(ix), [sender.keypair]);

      // Recall immediately (while traveling)
      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createRecallReinforcementInstruction({
            gameEngine: ctx.gameEngine,
            sender: sender.publicKey,
            destinationOwner: receiver.publicKey,
            senderCityId: 1,
            destinationCityId: 2,
          })
        ),
        [sender.keypair]
      );

      // Immediate return should fail (return travel not complete)
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [senderPlayer] = derivePlayerPda(ctx.gameEngine, sender.publicKey);
      const [senderEstate] = deriveEstatePda(senderPlayer);

      const returnIx = createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer,
        senderOwner: sender.publicKey,
        estateAccount: senderEstate,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(returnIx),
        [sender.keypair]
      );
      log.txExpectedFail('early return rejected for cross-city');
    });
  });

  // ============================================================
  // Speedup Tests
  // ============================================================

  describe('Reinforcement Speedup', () => {
    it('should speedup cross-city reinforcement travel', async () => {
      log.step('Sending cross-city reinforcement and applying speedup');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const sendIx = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.connection, new Transaction().add(sendIx), [sender.keypair]);

      // Check initial arrival time
      const reinfBefore = await fetchReinforcement(
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      const arrivalBefore = reinfBefore!.arrivesAt;

      // Apply speedup tier 2 (25% time remains, costs 2x gems)
      const speedupIx = createReinforcementSpeedupInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
        },
        { speedupTier: 2 }
      );

      await sendTransaction(ctx.connection, new Transaction().add(speedupIx), [sender.keypair]);

      // Verify arrival time decreased
      const reinfAfter = await fetchReinforcement(
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinfAfter!.arrivesAt.lt(arrivalBefore)).toBe(true);
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
      const speedupIx = createReinforcementSpeedupInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: other.publicKey,
          destinationOwner: receiver.publicKey,
        },
        { speedupTier: 1 }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(speedupIx),
        [other.keypair]
      );
      log.txExpectedFail('non-sender speedup rejected');
    });
  });

  // ============================================================
  // Full Lifecycle with Speedup Tests
  // ============================================================

  describe('Full Lifecycle', () => {
    it('should complete full send → arrive → relieve → return lifecycle with speedups', async () => {
      log.step('Full lifecycle with speedups for cross-city reinforcement');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 200);

      const senderBefore = await fetchPlayer(ctx.connection, sender.playerPda);
      const initialUnits = senderBefore!.defensiveUnit1;

      // 1. Send to different city
      log.step('Step 1: Send reinforcement');
      const sendIx = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.connection, new Transaction().add(sendIx), [sender.keypair]);

      // 2. Apply multiple speedups to make travel instant
      log.step('Step 2: Apply speedups to complete travel');
      for (let i = 0; i < 10; i++) {
        try {
          const speedupIx = createReinforcementSpeedupInstruction(
            {
              gameEngine: ctx.gameEngine,
              sender: sender.publicKey,
              destinationOwner: receiver.publicKey,
            },
            { speedupTier: 2 }
          );
          await sendTransaction(ctx.connection, new Transaction().add(speedupIx), [sender.keypair]);
        } catch (e) {
          log.caught(`Speedup ${i + 1} failed (travel may already be complete)`, e);
          break;
        }
      }

      // 3. Process arrival
      log.step('Step 3: Process arrival');
      const [reinforcementPda] = deriveReinforcementPda(ctx.gameEngine, sender.publicKey, receiver.publicKey);
      const [destinationPlayer] = derivePlayerPda(ctx.gameEngine, receiver.publicKey);

      await sendTransaction(
        ctx.connection,
        new Transaction().add(
          createProcessArrivalInstruction({
            reinforcement: reinforcementPda,
            destinationPlayer,
          })
        ),
        [sender.keypair]
      );

      const reinfActive = await fetchReinforcement(
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinfActive!.status).toBe(ReinforcementStatus.Active);

      // 4. Relieve by receiver
      log.step('Step 4: Relieve by receiver');
      const relieveIx = createRelieveReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        destinationOwner: receiver.publicKey,
        senderOwner: sender.publicKey,
        senderCityId: 1,
        destinationCityId: 2,
      });
      await sendTransaction(ctx.connection, new Transaction().add(relieveIx), [receiver.keypair]);

      // 5. Speedup return
      log.step('Step 5: Speedup return travel');
      for (let i = 0; i < 10; i++) {
        try {
          const speedupIx = createReinforcementSpeedupInstruction(
            {
              gameEngine: ctx.gameEngine,
              sender: sender.publicKey,
              destinationOwner: receiver.publicKey,
            },
            { speedupTier: 2 }
          );
          await sendTransaction(ctx.connection, new Transaction().add(speedupIx), [sender.keypair]);
        } catch (e) {
          log.caught(`Return speedup ${i + 1} failed (travel may already be complete)`, e);
          break;
        }
      }

      // 6. Process return
      log.step('Step 6: Process return');
      const [senderPlayer] = derivePlayerPda(ctx.gameEngine, sender.publicKey);
      const [senderEstate] = deriveEstatePda(senderPlayer);

      const returnIx = createProcessReturnInstruction({
        reinforcement: reinforcementPda,
        senderPlayer,
        senderOwner: sender.publicKey,
        estateAccount: senderEstate,
      });

      await sendTransaction(ctx.connection, new Transaction().add(returnIx), [sender.keypair]);

      // 7. Verify units returned
      const senderAfter = await fetchPlayer(ctx.connection, sender.playerPda);
      expect(senderAfter!.defensiveUnit1.eq(initialUnits)).toBe(true);
      log.info(`Full lifecycle complete: units restored from ${initialUnits} → ${senderAfter!.defensiveUnit1}`);
    });
  });

  // ============================================================
  // Reinforcement State Tests
  // ============================================================

  describe('Reinforcement State', () => {
    it('should track travel timing correctly', async () => {
      log.step('Verifying reinforcement timing fields');
      const { sender, receiver, teamId } = await createReinforcementPair();

      await factory.hireUnits(sender, 0, 500);
      await sendReinforcement(sender, receiver, teamId, { def1: 50 });

      const reinforcement = await fetchReinforcement(
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();

      // Same city → travel duration should be 0
      expect(reinforcement!.travelDuration).toBe(0);
      expect(reinforcement!.sentAt.toNumber()).toBeGreaterThan(0);
      expect(reinforcement!.arrivesAt.toNumber()).toBeGreaterThan(0);

      // Return not started yet
      expect(reinforcement!.returnStartedAt.toNumber()).toBe(0);
      expect(reinforcement!.returnDuration).toBe(0);

      log.info(`Timing: sentAt=${reinforcement!.sentAt}, travelDuration=${reinforcement!.travelDuration}, arrivesAt=${reinforcement!.arrivesAt}`);
    });

    it('should have non-zero travel duration for cross-city reinforcement', async () => {
      log.step('Verifying cross-city travel duration');
      const { sender, receiver, teamId } = await createReinforcementPair(false);

      await factory.hireUnits(sender, 0, 500);

      // Send to different city
      const ix = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );
      await sendTransaction(ctx.connection, new Transaction().add(ix), [sender.keypair]);

      const reinforcement = await fetchReinforcement(
        ctx.connection,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.travelDuration).toBeGreaterThan(0);
      expect(reinforcement!.arrivesAt.gt(reinforcement!.sentAt)).toBe(true);
      log.info(`Cross-city travel: duration=${reinforcement!.travelDuration}s, sentAt=${reinforcement!.sentAt}, arrivesAt=${reinforcement!.arrivesAt}`);
    });
  });
});
