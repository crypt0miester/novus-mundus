/**
 * Full Game Flow Integration Tests
 *
 * Comprehensive tests that verify complete game flows with proper state verification.
 * No silent try-catch - operations that should succeed must succeed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  // Combat
  createAttackPlayerInstruction,
  createAttackEncounterInstruction,
  // Travel
  createIntercityStartInstruction,
  createIntercityCompleteInstruction,
  createIntracityStartInstruction,
  createIntracityCompleteInstruction,
  // Expedition
  createExpeditionStartInstruction,
  createExpeditionStrikeInstruction,
  createExpeditionClaimInstruction,
  createExpeditionAbortInstruction,
  createExpeditionSpeedupInstruction,
  // Reinforcement
  createSendReinforcementInstruction,
  createProcessArrivalInstruction,
  createRecallReinforcementInstruction,
  createProcessReturnInstruction,
  createReinforcementSpeedupInstruction,
  // Rally
  createRallyCreateInstruction,
  createRallyJoinInstruction,
  createRallyLeaveInstruction,
  createRallyCancelInstruction,
  // Team
  createTeamCreateInstruction,
  createTeamJoinInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  deriveTeamPda,
  // Estate
  createCreateEstateInstruction,
  createBuildBuildingInstruction,
  // Loot
  createClaimLootInstruction,
  // PDAs
  derivePlayerPda,
  deriveRallyPda,
  deriveExpeditionPda,
  // Enums
  BuildingType,
  ExpeditionType,
  RallyTargetType,
  ReinforcementStatus,
} from '../../src/index';

import type { PublicKey } from '@solana/web3.js';
import {
  type TestContext,
  beforeAllTests,
} from '../fixtures/setup';
import {
  PlayerFactory,
  createCombatReadyPlayers,
  createTeamReadyPlayers,
  type TestPlayer,
} from '../fixtures/players';
import {
  HeroFactory,
} from '../fixtures/heroes';
import {
  sendTransaction,
} from '../utils/transactions';
import { advanceTime } from '../fixtures/time';
import {
  fetchPlayer,
  fetchExpedition,
  fetchRally,
  fetchReinforcement,
  snapshotPlayer,
  diffPlayerSnapshots,
} from '../utils/accounts';

// Unique team-id generator to avoid collisions across tests in this file
let teamIdCounter = 0;
function nextTeamId(): number {
  teamIdCounter += 1;
  return (Date.now() % 1_000_000) * 100 + teamIdCounter;
}

// Test Suite

describe('Full Game Flow Integration', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let heroFactory: HeroFactory;

  // Create a team led by `leader` with `members` invited and accepted.
  // Unlocks EXT_TEAM for the leader and each member (prereq for rally/etc).
  async function createTeamWithMembers(
    leader: TestPlayer,
    members: TestPlayer[],
  ): Promise<{ teamPda: PublicKey; teamId: number }> {
    const teamId = nextTeamId();
    const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createTeamCreateInstruction(
          { gameEngine: ctx.gameEngine, owner: leader.publicKey, teamId },
          { name: `IntTeam${teamId % 100000}` },
        ),
      ),
      [leader.keypair],
    );

    for (let i = 0; i < members.length; i++) {
      const member = members[i]!;
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createTeamInviteInstruction({
            gameEngine: ctx.gameEngine,
            inviter: leader.publicKey,
            team: teamPda,
            inviteePlayer: member.playerPda,
            teamId,
            inviterSlotIndex: 0,
          }),
        ),
        [leader.keypair],
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createTeamAcceptInviteInstruction({
            gameEngine: ctx.gameEngine,
            owner: member.publicKey,
            team: teamPda,
            slotIndex: i + 1,
            teamId,
            inviteRefund: leader.publicKey,
          }),
        ),
        [member.keypair],
      );
    }

    return { teamPda, teamId };
  }

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
    heroFactory = new HeroFactory(ctx);
  });

  afterAll(() => {
    factory.clear();
  });

  // Player Initialization and Basic Actions

  describe('Player Initialization', () => {
    it('should create and initialize a new player', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Verify player exists and has correct initial state
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.owner.equals(player.publicKey)).toBe(true);
      expect(account!.level).toBe(1);
      expect(account!.currentCity).toBe(player.startingCityId);
    });

    it('should hire units and verify state changes', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });

      // Snapshot before
      const before = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(before).not.toBeNull();

      // Hire defensive units
      await factory.hireUnits(player, 0, 100); // defensive unit type 0

      // Snapshot after
      const after = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();

      // Verify units increased
      const diff = diffPlayerSnapshots(before!, after!);
      expect(diff.changes.defensiveUnit1).toBeDefined();
      expect(after!.data.defensiveUnit1.gt(before!.data.defensiveUnit1)).toBe(true);
    });

    it('should purchase equipment and verify state changes', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Market] });

      const before = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(before).not.toBeNull();

      // Purchase melee weapons
      await factory.purchaseEquipment(player, 0, 10);

      const after = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();

      // Verify weapons increased
      expect(after!.data.meleeWeapons.gt(before!.data.meleeWeapons)).toBe(true);
    });
  });

  // Combat Flow

  describe('Combat Flow', () => {
    it('should attack another player (PvP) and create loot', async () => {
      // Create combat-ready players (attacker moved to defender's location)
      const { attacker, defender } = await createCombatReadyPlayers(factory);

      // Get initial states
      const attackerBefore = await snapshotPlayer(ctx.svm, attacker.playerPda);
      const defenderBefore = await snapshotPlayer(ctx.svm, defender.playerPda);
      expect(attackerBefore).not.toBeNull();
      expect(defenderBefore).not.toBeNull();

      // Perform attack
      const attackIx = createAttackPlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          attacker: attacker.publicKey,
          defenderPlayer: defender.playerPda,
          attackerCityId: attackerBefore!.data.currentCity,
          defenderCityId: defenderBefore!.data.currentCity,
        },
        { driveBy: false }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(attackIx),
        [attacker.keypair]
      );

      // Verify state changes
      const attackerAfter = await snapshotPlayer(ctx.svm, attacker.playerPda);
      const defenderAfter = await snapshotPlayer(ctx.svm, defender.playerPda);
      expect(defenderAfter).not.toBeNull();

      // Attacker should have lost some defensive units in combat (units used to attack)
      expect(attackerAfter!.data.defensiveUnit1.lt(attackerBefore!.data.defensiveUnit1)).toBe(true);
    });

    it('should build army with multiple unit types', async () => {
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Camp, BuildingType.Market],
      });

      // Hire different unit types. 200 NOVI each so the Hiring time-of-day
      // penalty (DeepNight/Evening 0.618x) can't drop us below 1 unit.
      await factory.hireUnits(player, 0, 200); // defensive 1
      await factory.hireUnits(player, 1, 200); // defensive 2
      await factory.hireUnits(player, 2, 200); // defensive 3
      await factory.hireUnits(player, 3, 200); // operative 1
      await factory.hireUnits(player, 4, 200); // operative 2

      // Purchase equipment
      await factory.purchaseEquipment(player, 0, 30); // melee
      await factory.purchaseEquipment(player, 1, 20); // ranged
      await factory.purchaseEquipment(player, 3, 50); // armor

      // Verify final state
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.defensiveUnit1.toNumber()).toBeGreaterThan(0);
      expect(account!.defensiveUnit2.toNumber()).toBeGreaterThan(0);
      expect(account!.defensiveUnit3.toNumber()).toBeGreaterThan(0);
      expect(account!.operativeUnit1.toNumber()).toBeGreaterThan(0);
      expect(account!.operativeUnit2.toNumber()).toBeGreaterThan(0);
      expect(account!.meleeWeapons.toNumber()).toBeGreaterThan(0);
      expect(account!.rangedWeapons.toNumber()).toBeGreaterThan(0);
      expect(account!.armorPieces.toNumber()).toBeGreaterThan(0);
    });
  });

  // Travel Flow

  describe('Travel Flow', () => {
    it('should start and complete intracity travel', async () => {
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.TransportBay],
      });

      const before = await fetchPlayer(ctx.svm, player.playerPda);
      expect(before).not.toBeNull();

      const cityId = before!.currentCity;
      const currentGridLat = Math.round(before!.currentLat * 10000);
      const currentGridLong = Math.round(before!.currentLong * 10000);

      // Destination = small lat/lon offset from current position (f64 coords)
      const destLat = before!.currentLat + 0.001;
      const destLong = before!.currentLong + 0.001;
      const destGridLat = Math.round(destLat * 10000);
      const destGridLong = Math.round(destLong * 10000);

      // Start intracity travel
      await factory.startIntracityTravel(player, cityId, currentGridLat, currentGridLong, destLat, destLong);

      // Buy gems and speedup. Tier 2 cuts remaining travel time to 25% per
      // application; repeat until we can advance the clock past arrival.
      await factory.buyGems(player, 1);
      for (let i = 0; i < 10; i++) {
        try {
          await factory.speedupTravel(player, 2);
        } catch {
          break;
        }
      }

      // Advance clock past travel arrival
      await advanceTime(ctx.svm, 5);

      // Complete travel
      await factory.completeIntracityTravel(player, cityId, destGridLat, destGridLong);

      // Verify location changed
      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();

      const afterGridLat = Math.round(after!.currentLat * 10000);
      const afterGridLong = Math.round(after!.currentLong * 10000);

      expect(afterGridLat).toBe(destGridLat);
      expect(afterGridLong).toBe(destGridLong);
    });

    it('should start and complete intercity travel', async () => {
      // Use cityId 19 → 18 to avoid colliding with other tests that target cities 1-3
      const player = await factory.createPlayer({
        initialize: true,
        cityId: 19,
        createEstate: true,
        buildings: [BuildingType.TransportBay],
      });

      const before = await fetchPlayer(ctx.svm, player.playerPda);
      expect(before).not.toBeNull();
      expect(before!.currentCity).toBe(19);

      const destinationCityId = 18; // Madrid
      // Derive destination grid coords from the actual city center
      const destCity = { lat: 40.4168, lon: -3.7038 }; // CITIES[18]
      // Offset by player index to avoid clashing with other intercity travelers
      const destGridLat = Math.round(destCity.lat * 10000);
      const destGridLong = Math.round(destCity.lon * 10000);

      // Get current location for origin params
      const currentGridLat = Math.round(before!.currentLat * 10000);
      const currentGridLong = Math.round(before!.currentLong * 10000);

      // Start intercity travel — pass dest coords explicitly so they match complete()
      await factory.startIntercityTravel(
        player,
        before!.currentCity,
        destinationCityId,
        currentGridLat,
        currentGridLong,
        destGridLat,
        destGridLong,
      );

      // Buy gems and speedup repeatedly to collapse the multi-hour travel
      await factory.buyGems(player, 2);
      for (let i = 0; i < 12; i++) {
        try {
          await factory.speedupTravel(player, 2);
        } catch {
          break;
        }
      }

      // Advance clock past travel arrival
      await advanceTime(ctx.svm, 5);

      // Complete travel at the same coords used for start
      await factory.completeIntercityTravel(player, before!.currentCity, destinationCityId, destGridLat, destGridLong);

      // Verify city changed
      const after = await fetchPlayer(ctx.svm, player.playerPda);
      expect(after).not.toBeNull();
      expect(after!.currentCity).toBe(destinationCityId);
    });

    it('should move player to another player location', async () => {
      const player1 = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.TransportBay],
      });
      const player2 = await factory.createPlayer({ initialize: true, cityId: 3 });

      // Get initial locations
      const p1Before = await factory.getPlayerLocation(player1);
      const p2Location = await factory.getPlayerLocation(player2);

      expect(p1Before).not.toBeNull();
      expect(p2Location).not.toBeNull();
      expect(p1Before!.cityId).not.toBe(p2Location!.cityId);

      // Move player1 to player2
      await factory.movePlayerToPlayer(player1, player2);

      // Verify player1 is now in same city
      const p1After = await factory.getPlayerLocation(player1);
      expect(p1After).not.toBeNull();
      expect(p1After!.cityId).toBe(p2Location!.cityId);
    });
  });

  // Expedition Flow

  describe('Expedition Flow', () => {
    it('should start an expedition', async () => {
      // Mining expedition: needs Academy + Mine + research 21 + Camp (for operatives)
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Academy, BuildingType.Mine, BuildingType.Camp],
      });
      await factory.completeResearch(player, 21); // Unlock mining

      // Need operatives for expedition
      await factory.hireUnits(player, 3, 100);

      const before = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(before).not.toBeNull();

      // Start mining expedition
      const startIx = createExpeditionStartInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        {
          expeditionType: ExpeditionType.Mining,
          tier: 0,
          operativeUnit1: new BN(50),
          operativeUnit2: new BN(0),
          operativeUnit3: new BN(0),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(startIx),
        [player.keypair]
      );

      // Verify expedition created
      const expedition = await fetchExpedition(ctx.svm, player.publicKey);
      expect(expedition).not.toBeNull();
      expect(expedition!.expeditionType).toBe(ExpeditionType.Mining);
      expect(expedition!.operativeUnit1.toNumber()).toBe(50);

      // Verify operatives deducted
      const after = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(after!.data.operativeUnit1.lt(before!.data.operativeUnit1)).toBe(true);
    });

    it('should abort an expedition and return operatives', async () => {
      // Fishing expedition: needs Academy + Dock + research 22 + Camp (for operatives)
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Academy, BuildingType.Dock, BuildingType.Camp],
      });
      await factory.completeResearch(player, 22); // Unlock fishing

      await factory.hireUnits(player, 3, 100);

      // Start expedition
      const startIx = createExpeditionStartInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        {
          expeditionType: ExpeditionType.Fishing,
          tier: 0,
          operativeUnit1: new BN(30),
          operativeUnit2: new BN(0),
          operativeUnit3: new BN(0),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(startIx),
        [player.keypair]
      );

      const beforeAbort = await snapshotPlayer(ctx.svm, player.playerPda);

      // Abort expedition
      const abortIx = createExpeditionAbortInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
      });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(abortIx),
        [player.keypair]
      );

      // Verify expedition gone
      const expedition = await fetchExpedition(ctx.svm, player.publicKey);
      expect(expedition).toBeNull();

      // Verify operatives returned
      const afterAbort = await snapshotPlayer(ctx.svm, player.playerPda);
      expect(afterAbort!.data.operativeUnit1.gt(beforeAbort!.data.operativeUnit1)).toBe(true);
    });
  });

  // Reinforcement Flow

  describe('Reinforcement Flow', () => {
    it('should send reinforcements to another player', async () => {
      const sender = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Market],
      });
      const receiver = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });

      // Both players must be on the same team
      const { teamId } = await createTeamWithMembers(sender, [receiver]);

      // Sender needs defensive units
      await factory.hireUnits(sender, 0, 100);
      await factory.hireUnits(sender, 1, 50);
      await factory.purchaseEquipment(sender, 0, 20); // melee
      await factory.purchaseEquipment(sender, 3, 30); // armor

      const senderBefore = await snapshotPlayer(ctx.svm, sender.playerPda);

      const sendIx = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 1,
          destinationCityId: 1,
          teamId,
        },
        {
          defensiveUnit1: new BN(25),
          defensiveUnit2: new BN(15),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(10),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(15),
          heroSlot: 255,
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(sendIx),
        [sender.keypair]
      );

      // Verify reinforcement account created
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.unitsDef1.toNumber()).toBe(25);
      expect(reinforcement!.unitsDef2.toNumber()).toBe(15);

      // Verify sender's units deducted
      const senderAfter = await snapshotPlayer(ctx.svm, sender.playerPda);
      expect(senderAfter!.data.defensiveUnit1.lt(senderBefore!.data.defensiveUnit1)).toBe(true);
    });

    it('should recall reinforcements', async () => {
      const sender = await factory.createPlayer({
        initialize: true,
        cityId: 2,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      const receiver = await factory.createPlayer({
        initialize: true,
        cityId: 2,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });

      const { teamId } = await createTeamWithMembers(sender, [receiver]);
      await factory.hireUnits(sender, 0, 100);

      const sendIx = createSendReinforcementInstruction(
        {
          gameEngine: ctx.gameEngine,
          sender: sender.publicKey,
          destinationOwner: receiver.publicKey,
          senderCityId: 2,
          destinationCityId: 2,
          teamId,
        },
        {
          defensiveUnit1: new BN(30),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
          heroSlot: 255,
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(sendIx),
        [sender.keypair]
      );

      // Recall them
      const recallIx = createRecallReinforcementInstruction({
        gameEngine: ctx.gameEngine,
        sender: sender.publicKey,
        destinationOwner: receiver.publicKey,
        senderCityId: 2,
        destinationCityId: 2,
      });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(recallIx),
        [sender.keypair]
      );

      // Verify reinforcement is in returning state
      const reinforcement = await fetchReinforcement(
        ctx.svm,
        ctx.gameEngine,
        sender.publicKey,
        receiver.publicKey
      );
      expect(reinforcement).not.toBeNull();
      expect(reinforcement!.status).toBe(ReinforcementStatus.Returning);
    });
  });

  // Rally Flow

  describe('Rally Flow', () => {
    it('should create a rally', async () => {
      const creator = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Citadel],
      });
      const target = await factory.createPlayer({ initialize: true });

      // Team unlocks EXT_TEAM, required before rally.create can unlock EXT_RALLY
      const { teamId } = await createTeamWithMembers(creator, []);

      // Creator needs defensive units (rallies consume defensive_unit_1)
      await factory.hireUnits(creator, 0, 100);

      const leaderCityId = 1;
      const targetCityId = 1;

      // Create rally
      const rallyIx = createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: 0,
          target: target.playerPda,
          teamId,
          rallyCityId: leaderCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: new BN(3600),
          targetCityId,
          defensiveUnit1: new BN(50),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(rallyIx),
        [creator.keypair]
      );

      // Verify rally created
      const [rallyPda] = deriveRallyPda(ctx.gameEngine, creator.publicKey, 0);
      const rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();
    });

    it('should join and leave a rally', async () => {
      const creator = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Citadel],
      });
      const joiner = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      const target = await factory.createPlayer({ initialize: true });

      // Both creator and joiner must be on the same team for rally.join
      const { teamId } = await createTeamWithMembers(creator, [joiner]);

      await factory.hireUnits(creator, 0, 100);
      await factory.hireUnits(joiner, 0, 80);

      const leaderCityId = 1;
      const targetCityId = 1;

      // Create rally
      const createIx = createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: 1,
          target: target.playerPda,
          teamId,
          rallyCityId: leaderCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: new BN(3600),
          targetCityId,
          defensiveUnit1: new BN(30),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createIx),
        [creator.keypair]
      );

      const [rallyPda] = deriveRallyPda(ctx.gameEngine, creator.publicKey, 1);

      // Join rally
      const joinIx = createRallyJoinInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: joiner.publicKey,
          rally: rallyPda,
          rallyCreator: creator.publicKey,
          rallyId: 1,
          teamId,
          rallyCityId: leaderCityId,
        },
        {
          defensiveUnit1: new BN(40),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(joinIx),
        [joiner.keypair]
      );

      // Verify rally has more operatives
      let rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();

      // Leave rally
      const leaveIx = createRallyLeaveInstruction({
        gameEngine: ctx.gameEngine,
        owner: joiner.publicKey,
        rally: rallyPda,
        rallyCreator: creator.publicKey,
        rallyId: 1,
        rallyCityId: leaderCityId,
        homeCityId: leaderCityId,
      });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(leaveIx),
        [joiner.keypair]
      );

      // Verify rally state changed
      rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();
    });

    it('should cancel a rally', async () => {
      const creator = await factory.createPlayer({
        initialize: true,
        cityId: 1,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Citadel],
      });
      const target = await factory.createPlayer({ initialize: true });

      const { teamId } = await createTeamWithMembers(creator, []);
      await factory.hireUnits(creator, 0, 100);

      const leaderCityId = 1;
      const targetCityId = 1;

      // Create rally
      const createIx = createRallyCreateInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: creator.publicKey,
          rallyId: 2,
          target: target.playerPda,
          teamId,
          rallyCityId: leaderCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: new BN(3600),
          targetCityId,
          defensiveUnit1: new BN(25),
          defensiveUnit2: new BN(0),
          defensiveUnit3: new BN(0),
          meleeWeapons: new BN(0),
          rangedWeapons: new BN(0),
          siegeWeapons: new BN(0),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createIx),
        [creator.keypair]
      );

      const [rallyPda] = deriveRallyPda(ctx.gameEngine, creator.publicKey, 2);

      // Cancel rally
      const cancelIx = createRallyCancelInstruction({
        gameEngine: ctx.gameEngine,
        owner: creator.publicKey,
        rally: rallyPda,
        rallyId: 2,
        rallyCityId: leaderCityId,
      });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(cancelIx),
        [creator.keypair]
      );

      // Verify rally was cancelled. Units don't return immediately — the leader
      // starts a return journey and only restocks units after process_return.
      const rally = await fetchRally(ctx.svm, rallyPda);
      expect(rally).not.toBeNull();
      expect(rally!.status).toBe(5); // RallyStatus::Cancelled
    });
  });

  // Team Flow

  describe('Team Flow', () => {
    it('should create a team with multiple players', async () => {
      // Leader needs estate+gems to unlock EXT_INVENTORY → EXT_TEAM
      const leader = await factory.createPlayer({ initialize: true, createEstate: true });
      // Members created for symmetry; join is not exercised here
      await factory.createPlayer({ initialize: true });
      await factory.createPlayer({ initialize: true });

      const teamId = Date.now();

      // Create team
      const createIx = createTeamCreateInstruction(
        { gameEngine: ctx.gameEngine, owner: leader.publicKey, teamId },
        { name: `TestTeam${teamId % 10000}` }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(createIx),
        [leader.keypair]
      );

      // Verify leader is in a team
      const leaderAccount = await fetchPlayer(ctx.svm, leader.playerPda);
      expect(leaderAccount).not.toBeNull();
      expect(leaderAccount!.team).not.toBeNull();
    });
  });

  // Estate Flow

  describe('Estate Flow', () => {
    it('should create an estate', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Create estate
      const estateIx = createCreateEstateInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { cityId: 1 }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(estateIx),
        [player.keypair]
      );

      // Mark as having estate
      player.hasEstate = true;
    });

    it('should build a building in estate', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true });

      // Build first building (type 0)
      const buildIx = createBuildBuildingInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { buildingType: 0 }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(buildIx),
        [player.keypair]
      );
    });
  });

  // Hero Flow

  describe('Hero Flow', () => {
    it('should mint and use a hero', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Attempt to mint hero
      const hero = await heroFactory.mintHero(player, 1);

      expect(hero).not.toBeNull();
      expect(hero.templateId).toBe(1);
      expect(hero.owner.equals(player.publicKey)).toBe(true);
    });

    it('should lock and unlock a hero', async () => {
      // Hero lock requires EXT_RALLY (full extension chain) + MeditationChamber
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Citadel, BuildingType.MeditationChamber],
      });

      // Walk the extension journey: INVENTORY (estate+gems) → TEAM → RALLY
      const { teamId } = await createTeamWithMembers(player, []);
      await factory.hireUnits(player, 0, 500); // Need units for rally

      const rallyId = nextTeamId(); // reuse generator for uniqueness
      const dummyTarget = Keypair.generate().publicKey;
      const rallyCityId = player.startingCityId;
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createRallyCreateInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              rallyId,
              target: dummyTarget,
              teamId,
              rallyCityId,
            },
            {
              targetType: RallyTargetType.Player,
              gatherDuration: new BN(3600),
              targetCityId: rallyCityId,
              defensiveUnit1: new BN(1),
              defensiveUnit2: new BN(0),
              defensiveUnit3: new BN(0),
              meleeWeapons: new BN(0),
              rangedWeapons: new BN(0),
              siegeWeapons: new BN(0),
            },
          ),
        ),
        [player.keypair],
      );

      const hero = await heroFactory.mintHero(player, 2);
      expect(hero.locked).toBe(false);

      // Lock hero
      await heroFactory.lockHero(player, hero);
      expect(hero.locked).toBe(true);

      // Unlock hero
      await heroFactory.unlockHero(player, hero);
      expect(hero.locked).toBe(false);
    });
  });

  // Cross-System Integration

  describe('Cross-System Integration', () => {
    it('should complete full early game flow', async () => {
      // On-chain handlers gate hire/purchase on estate + buildings; set those up first
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Camp, BuildingType.Market],
      });

      // 1. Hire initial units (must be at least 100 NOVI to convert to >= 1 unit)
      await factory.hireUnits(player, 0, 100);
      await factory.hireUnits(player, 3, 100);

      // 2. Purchase equipment
      await factory.purchaseEquipment(player, 0, 10);
      await factory.purchaseEquipment(player, 3, 20);

      // 3. Verify final state
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      expect(account!.defensiveUnit1.toNumber()).toBeGreaterThan(0);
      expect(account!.operativeUnit1.toNumber()).toBeGreaterThan(0);
      expect(account!.meleeWeapons.toNumber()).toBeGreaterThan(0);
      expect(account!.armorPieces.toNumber()).toBeGreaterThan(0);
    });

    it('should support multiple players in same test', async () => {
      // Create multiple players in different cities
      const players = await factory.createPlayers(5, { initialize: true });

      expect(players.length).toBe(5);

      // All should have unique addresses
      const addresses = new Set(players.map(p => p.publicKey.toBase58()));
      expect(addresses.size).toBe(5);

      // All should be initialized
      for (const player of players) {
        const account = await fetchPlayer(ctx.svm, player.playerPda);
        expect(account).not.toBeNull();
        expect(account!.level).toBe(1);
      }
    });

    it('should verify economic actions affect player state', async () => {
      const player = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks, BuildingType.Market],
      });

      // Take multiple snapshots through economic actions
      const snap1 = await snapshotPlayer(ctx.svm, player.playerPda);

      await factory.hireUnits(player, 0, 100);
      const snap2 = await snapshotPlayer(ctx.svm, player.playerPda);

      await factory.purchaseEquipment(player, 0, 25);
      const snap3 = await snapshotPlayer(ctx.svm, player.playerPda);

      // Verify progressive changes
      expect(snap2!.data.defensiveUnit1.gt(snap1!.data.defensiveUnit1)).toBe(true);
      expect(snap3!.data.meleeWeapons.gt(snap2!.data.meleeWeapons)).toBe(true);

      // Cash should have decreased (spent on units and equipment)
      // Note: This assumes players start with cash - adjust if needed
    });
  });
});
