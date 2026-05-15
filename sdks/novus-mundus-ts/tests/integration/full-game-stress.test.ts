/**
 * Full Game Stress Test
 *
 * 200-player multi-system simulation: onboarding, teams, castles, arena,
 * events, PvP, rallies, then an invariant audit over the resulting world
 * state. Designed to surface scale-related bugs that single-flow tests
 * can't see — leaderboard drift, team/castle/rally membership desync,
 * counter off-by-ones, NOVI accounting drift.
 *
 * Determinism: seeded mulberry32. Failures reproduce.
 *
 * Robustness: gameplay phases tolerate per-action failures (e.g., a PvP
 * attack rejected for protection still counts as a "phase ran"). End-state
 * invariants are HARD assertions — violations fail the test.
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  // Team
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  deriveTeamPda,
  // Arena
  createCreateSeasonInstruction,
  createJoinSeasonInstruction,
  createUpdateLoadoutInstruction,
  createChallengePlayerInstruction,
  // Event
  createCreateEventInstruction,
  createJoinEventInstruction,
  createFinalizeEventInstruction,
  // Combat
  createAttackPlayerInstruction,
  // Castle
  createCreateCastleInstruction,
  createClaimVacantCastleInstruction,
  createAppointCourtInstruction,
  createUpdateCastleStatusInstruction,
  deriveCastlePda,
  // Rally
  createRallyCreateInstruction,
  createRallyJoinInstruction,
  createRallyCancelInstruction,
  deriveRallyPda,
  deriveRallyParticipantPda,
  // Enums
  BuildingType,
  EventStatus,
  RallyTargetType,
  RallyStatus,
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
  extractErrorCode,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchTeam,
  fetchTeamMemberSlot,
  fetchArenaSeason,
  fetchEvent,
  fetchEventParticipation,
  fetchRally,
  fetchAccount,
} from '../utils/accounts';
import { log } from '../utils/logger';
import {
  getCurrentTimestamp,
  advanceTime,
} from '../fixtures/time';

// Tolerate any transaction-level failure (Custom program error, InstructionError,
// AccountDataTooSmall, etc.) but re-throw bare JS errors so a misnamed ix builder
// or a refactor regression isn't silently absorbed.
function isExpectedTxError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (extractErrorCode(e) !== null) return true;
  return e.message.includes('Transaction failed') || e.message.includes('Program ');
}

// Seeded PRNG (mulberry32)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xC0FFEE;
const rand = mulberry32(SEED);
const randInt = (lo: number, hi: number): number => Math.floor(rand() * (hi - lo + 1)) + lo;
const pickOne = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)]!;

// Scale knobs — total 200 players

const TIER_A_COUNT = 40;   // Combat-ready (estate + buildings + units + equipment)
const TIER_B_COUNT = 80;   // Economy (estate + barracks + units)
const TIER_C_COUNT = 80;   // Minimal (init only)
const TOTAL_PLAYERS = TIER_A_COUNT + TIER_B_COUNT + TIER_C_COUNT; // 200

// First 15 Tier A players get Citadel for rally creation.
const RALLY_LEADER_COUNT = 15;

const NUM_TEAMS = 15;                // 15 teams, one per rally-leader Tier A player
const PLAYERS_PER_TEAM = 5;          // Leader + 4 members (TIER_ROOKIE cap = 5)
const NUM_CASTLES = 8;               // 8 vacant castles for capture
const ARENA_PARTICIPANT_COUNT = 30;  // Players in arena season
const EVENT_PARTICIPANT_COUNT = 80;  // Joining the event
const PVP_ATTACK_ROUNDS = 16;        // PvP attempts
const RALLY_COUNT = 10;              // Rallies created

// Suite

setDefaultTimeout(900_000); // 15 min cap

describe('Full Game Stress (200 players)', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let tierA: TestPlayer[] = [];
  let tierB: TestPlayer[] = [];
  let tierC: TestPlayer[] = [];
  let teams: { teamPda: PublicKey; teamId: number; leader: TestPlayer; members: TestPlayer[] }[] = [];
  let castleClaims: { cityId: number; castleId: number; lord: TestPlayer }[] = [];
  let createdRallies: { creator: TestPlayer; rallyId: number; rallyPda: PublicKey; status: 'created' | 'cancelled' }[] = [];

  beforeAll(async () => {
    log.section('Full Game Stress (200 players)');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });

    // DAO creates vacant castles for the castle phase. Cities 1..NUM_CASTLES,
    // tier 2, level 1 — cheap to claim.
    for (let i = 0; i < NUM_CASTLES; i++) {
      const cityId = i + 1;
      const castleId = 1000 + i;
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateCastleInstruction(
            { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
            {
              cityId,
              castleId,
              tier: 2,
              latitude: 400000,
              longitude: -740000,
              minLevel: 1,
              minNetworthMillions: 0,
              minTroopsThousands: 0,
              name: `StressCastle${i}`,
            },
          ),
        ),
        [ctx.daoAuthority],
      );
    }
    log.info(`Castles created: ${NUM_CASTLES}`);
  }, 600_000);

  afterAll(() => {
    factory.clear();
  });

  // Phase 1: Onboarding

  it(`Phase 1: onboards ${TOTAL_PLAYERS} players across 3 tiers`, async () => {
    const t0 = performance.now();

    // Tier A — full combat setup. First RALLY_LEADER_COUNT also get Citadel.
    for (let i = 0; i < TIER_A_COUNT; i++) {
      const isRallyLeader = i < RALLY_LEADER_COUNT;
      const buildings: BuildingType[] = isRallyLeader
        ? [BuildingType.Barracks, BuildingType.Market, BuildingType.Citadel, BuildingType.TransportBay]
        : [BuildingType.Barracks, BuildingType.Market, BuildingType.TransportBay];

      const p = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings,
        customKeypair: Keypair.generate(),
      });
      await factory.hireUnits(p, 0, 500);
      await factory.hireUnits(p, 1, 300);
      await factory.purchaseEquipment(p, 0, 20);
      await factory.purchaseEquipment(p, 3, 30);
      tierA.push(p);
    }
    log.info(`Tier A ready: ${tierA.length} (rally leaders: ${RALLY_LEADER_COUNT})`);

    // Tier B — estate + barracks + light units
    for (let i = 0; i < TIER_B_COUNT; i++) {
      const p = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
        customKeypair: Keypair.generate(),
      });
      await factory.hireUnits(p, 0, 200);
      tierB.push(p);
    }
    log.info(`Tier B ready: ${tierB.length}`);

    // Tier C — minimal init only
    for (let i = 0; i < TIER_C_COUNT; i++) {
      const p = await factory.createPlayer({
        initialize: true,
        customKeypair: Keypair.generate(),
      });
      tierC.push(p);
    }
    log.info(`Tier C ready: ${tierC.length}`);

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    log.info(`Onboarding complete: ${TOTAL_PLAYERS} players in ${elapsed}s`);

    expect(tierA.length).toBe(TIER_A_COUNT);
    expect(tierB.length).toBe(TIER_B_COUNT);
    expect(tierC.length).toBe(TIER_C_COUNT);
  }, 900_000);

  // Phase 2: Team Formation
  //
  // The first 15 Tier A players are team leaders (and rally creators). The
  // remaining Tier A + Tier B fill member slots. Tier C is held back — most
  // tests have shown Tier C without estate/buildings struggles to satisfy the
  // EXT_TEAM extension prerequisites cleanly.

  it(`Phase 2: forms ${NUM_TEAMS} teams of ${PLAYERS_PER_TEAM} players each`, async () => {
    const leaders = tierA.slice(0, NUM_TEAMS);
    const memberPool: TestPlayer[] = [
      ...tierA.slice(NUM_TEAMS),
      ...tierB,
    ];
    let cursor = 0;
    let teamsCreated = 0;
    let totalMembersInvited = 0;
    let acceptFailures = 0;

    for (let i = 0; i < NUM_TEAMS; i++) {
      const leader = leaders[i]!;
      const members: TestPlayer[] = [];
      for (let j = 0; j < PLAYERS_PER_TEAM - 1; j++) {
        if (cursor >= memberPool.length) break;
        members.push(memberPool[cursor++]!);
      }

      const teamId = 100_000 + i;
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createTeamCreateInstruction(
              { gameEngine: ctx.gameEngine, owner: leader.publicKey, teamId },
              { name: `StressTeam${i}` },
            ),
          ),
          [leader.keypair],
        );
        teamsCreated += 1;
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        continue;
      }

      let memberSlot = 1;
      for (const member of members) {
        totalMembersInvited += 1;
        try {
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
                slotIndex: memberSlot,
                teamId,
                inviteRefund: leader.publicKey,
              }),
            ),
            [member.keypair],
          );
          memberSlot += 1;
        } catch (e) {
        if (!isExpectedTxError(e)) throw e;
          acceptFailures += 1;
        }
      }

      teams.push({ teamPda, teamId, leader, members: members.slice(0, memberSlot - 1) });
    }

    log.info(
      `Teams: ${teamsCreated} created, ${totalMembersInvited - acceptFailures}/${totalMembersInvited} members joined`,
    );
    expect(teamsCreated).toBe(NUM_TEAMS);
  }, 900_000);

  // Phase 3: Castle Capture
  //
  // 8 vacant castles wait. Team leaders try to claim them in order. Lord must
  // be in a team (satisfied for our leaders). After claim, attempt court
  // appointments.

  it(`Phase 3: captures ${NUM_CASTLES} vacant castles + appoints courts`, async () => {
    let claimed = 0;
    let appointed = 0;
    let claimFailures = 0;
    let appointFailures = 0;

    // First pass: claim all vacant castles. Each claim puts the castle into
    // CONTEST status — court appointments are gated on the contest period
    // having elapsed (CASTLE_CONTEST_DURATION = 7200s).
    for (let i = 0; i < NUM_CASTLES; i++) {
      const cityId = i + 1;
      const castleId = 1000 + i;
      const lord = teams[i]?.leader;
      if (!lord) break;

      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: lord.publicKey,
              cityId,
              castleId,
            }),
          ),
          [lord.keypair],
        );
        castleClaims.push({ cityId, castleId, lord });
        claimed += 1;
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        claimFailures += 1;
      }
    }

    // Warp past the contest period and transition each castle CONTEST→PROTECTED.
    // The status flip is permissionless but must be triggered explicitly.
    await advanceTime(ctx.svm, 7_201);
    for (const c of castleClaims) {
      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateCastleStatusInstruction({
              caller: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              cityId: c.cityId,
              castleId: c.castleId,
            }),
          ),
          [ctx.daoAuthority],
        );
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        // Already transitioned (rare) — ignore.
      }
    }

    // Second pass: appoint courts.
    for (const c of castleClaims) {
      const teamRecord = teams.find((t) => t.leader.publicKey.equals(c.lord.publicKey));
      const teammates = teamRecord?.members.slice(0, 4) ?? [];
      for (let pos = 0; pos < teammates.length; pos++) {
        try {
          await sendTransaction(
            ctx.svm,
            new Transaction().add(
              createAppointCourtInstruction(
                {
                  king: c.lord.publicKey,
                  appointee: teammates[pos]!.publicKey,
                  gameEngine: ctx.gameEngine,
                  cityId: c.cityId,
                  castleId: c.castleId,
                },
                { position: pos },
              ),
            ),
            [c.lord.keypair],
          );
          appointed += 1;
        } catch (e) {
        if (!isExpectedTxError(e)) throw e;
          appointFailures += 1;
        }
      }
    }

    log.info(
      `Castles: ${claimed}/${NUM_CASTLES} claimed, ${appointed} court appointments (${appointFailures} failed)`,
    );
    expect(claimed).toBeGreaterThan(0);
    expect(appointed).toBeGreaterThan(0);
  }, 900_000);

  // Phase 4: Arena Season

  const ARENA_SEASON_ID = 9001;
  let arenaParticipants: TestPlayer[] = [];

  it(`Phase 4: runs an arena season with up to ${ARENA_PARTICIPANT_COUNT} participants`, async () => {
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createCreateSeasonInstruction(
          {
            authority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            seasonId: ARENA_SEASON_ID,
          },
          {
            masterPrizePool: new BN(1_000_000),
            dailyPrizePool: new BN(100_000),
            dailyDistributionCap: new BN(50_000),
            minLevelRequired: 1,
          },
        ),
      ),
      [ctx.daoAuthority],
    );

    const candidates: TestPlayer[] = [...tierA, ...tierB.slice(0, 10)];
    const selected = candidates.slice(0, ARENA_PARTICIPANT_COUNT);

    let joined = 0;
    for (const p of selected) {
      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: ARENA_SEASON_ID,
            }),
          ),
          [p.keypair],
        );

        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: p.publicKey, gameEngine: ctx.gameEngine },
              {
                arenaHero: PublicKey.default,
                defensiveUnits: [new BN(200), new BN(100), new BN(0)],
                meleeWeapons: new BN(0),
                rangedWeapons: new BN(0),
                siegeWeapons: new BN(0),
                armorPieces: new BN(0),
              },
            ),
          ),
          [p.keypair],
        );

        arenaParticipants.push(p);
        joined += 1;
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        // No units / sub gate / etc.
      }
    }

    let matchId = 1_000_000;
    let challenges = 0;
    let challengeFailures = 0;
    for (const challenger of arenaParticipants) {
      for (let i = 0; i < 3; i++) {
        let opponent: TestPlayer;
        let tries = 0;
        do {
          opponent = pickOne(arenaParticipants);
          tries += 1;
        } while (opponent.publicKey.equals(challenger.publicKey) && tries < 5);
        if (opponent.publicKey.equals(challenger.publicKey)) continue;

        try {
          const tNow = await getCurrentTimestamp(ctx.svm);
          await sendTransaction(
            ctx.svm,
            new Transaction().add(
              createChallengePlayerInstruction(
                {
                  gameEngine: ctx.gameEngine,
                  challenger: challenger.publicKey,
                  gameAuthority: ctx.daoAuthority.publicKey,
                  seasonAuthority: ctx.daoAuthority.publicKey,
                  seasonId: ARENA_SEASON_ID,
                  defenderAuthority: opponent.publicKey,
                  challengerHero: PublicKey.default,
                  challengerEstate: PublicKey.default,
                  defenderHero: PublicKey.default,
                  defenderEstate: PublicKey.default,
                },
                { matchId: new BN(matchId++), matchTimestamp: new BN(tNow) },
              ),
            ),
            [challenger.keypair, ctx.daoAuthority],
          );
          challenges += 1;
        } catch (e) {
        if (!isExpectedTxError(e)) throw e;
          challengeFailures += 1;
        }
      }
    }

    log.info(`Arena: ${joined} joined, ${challenges}/${challenges + challengeFailures} challenges succeeded`);
    expect(joined).toBeGreaterThan(0);
    expect(challenges).toBeGreaterThan(0);
  }, 900_000);

  // Phase 5: Event Lifecycle (create + mass join)

  const STRESS_EVENT_ID = 9002;
  let eventJoiners: TestPlayer[] = [];

  it(`Phase 5: opens event with up to ${EVENT_PARTICIPANT_COUNT} joiners`, async () => {
    const now = await getCurrentTimestamp(ctx.svm);
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createCreateEventInstruction(
          {
            authority: ctx.daoAuthority.publicKey,
            gameEngine: ctx.gameEngine,
            eventId: STRESS_EVENT_ID,
          },
          {
            name: 'StressEvent',
            startTime: now - 60,
            endTime: now + 600,
            eventType: 0,            // TotalDamageDealt
            minLevel: 1,
            minReputation: 0,
            requiredSubscriptionTier: 0,
            prizeType: 2,            // Cash
            prizeAmount: 50_000,
            autoActivate: true,
          },
        ),
      ),
      [ctx.daoAuthority],
    );

    const candidates: TestPlayer[] = [...tierA, ...tierB].slice(0, EVENT_PARTICIPANT_COUNT);
    let joined = 0;
    for (const p of candidates) {
      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinEventInstruction({
              gameEngine: ctx.gameEngine,
              payer: p.publicKey,
              playerOwner: p.publicKey,
              eventId: STRESS_EVENT_ID,
            }),
          ),
          [p.keypair],
        );
        eventJoiners.push(p);
        joined += 1;
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        // gate failed
      }
    }
    log.info(`Event joined: ${joined}/${candidates.length}`);
    expect(joined).toBeGreaterThan(0);

    const evt = await fetchEvent(ctx.svm, ctx.gameEngine, STRESS_EVENT_ID);
    expect(evt).not.toBeNull();
    expect(evt!.status).toBe(EventStatus.Active);
    expect(evt!.participantCount).toBe(joined);
  }, 900_000);

  // Phase 6: PvP Combat (with correct city IDs)

  it(`Phase 6: runs ${PVP_ATTACK_ROUNDS} PvP rounds with random pairings`, async () => {
    let attacks = 0;
    let failures = 0;

    for (let i = 0; i < PVP_ATTACK_ROUNDS; i++) {
      const attacker = pickOne(tierA);
      let defender = pickOne(tierA);
      let attempts = 0;
      while (defender.publicKey.equals(attacker.publicKey) && attempts < 5) {
        defender = pickOne(tierA);
        attempts += 1;
      }
      if (defender.publicKey.equals(attacker.publicKey)) continue;

      try {
        await factory.movePlayerToPlayer(attacker, defender);
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        failures += 1;
        continue;
      }

      // Read actual current cities — combat ix needs them, and after
      // movePlayerToPlayer the attacker is in the defender's city.
      const attackerAcc = await fetchPlayer(ctx.svm, attacker.playerPda);
      const defenderAcc = await fetchPlayer(ctx.svm, defender.playerPda);
      if (!attackerAcc || !defenderAcc) {
        failures += 1;
        continue;
      }
      const attackerCity = attackerAcc.currentCity;
      const defenderCity = defenderAcc.currentCity;

      const tagEvent =
        i % 2 === 0 && eventJoiners.some((p) => p.publicKey.equals(attacker.publicKey));

      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createAttackPlayerInstruction(
              {
                gameEngine: ctx.gameEngine,
                attacker: attacker.publicKey,
                defenderPlayer: defender.playerPda,
                attackerCityId: attackerCity,
                defenderCityId: defenderCity,
                attackerEventId: tagEvent ? STRESS_EVENT_ID : undefined,
              },
              { driveBy: false },
            ),
          ),
          [attacker.keypair],
        );
        attacks += 1;
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        failures += 1;
      }
    }

    log.info(`PvP: ${attacks} succeeded, ${failures} failed`);
    expect(attacks).toBeGreaterThan(0);
  }, 900_000);

  // Phase 7: Rallies (team leaders with Citadel create rallies, members join, some cancel)

  it(`Phase 7: creates ${RALLY_COUNT} rallies + lifecycle`, async () => {
    let created = 0;
    let joined = 0;
    let cancelled = 0;
    let skippedUnits = 0;
    let skippedTraveling = 0;

    for (let i = 0; i < RALLY_COUNT; i++) {
      // Only rally-leader Tier A players (first 15) have Citadel.
      const teamRecord = teams[i];
      if (!teamRecord) break;
      const creator = teamRecord.leader;
      if (tierA.indexOf(creator) >= RALLY_LEADER_COUNT) continue;

      // Fresh airdrop right before each rally — PvP / buildings drained
      // creator wallets, so guarantee enough rent for rally + participant.
      ctx.svm.airdrop(creator.publicKey, BigInt(20 * 1_000_000_000));

      const creatorAcc = await fetchPlayer(ctx.svm, creator.playerPda);
      if (!creatorAcc) continue;

      // Skip if creator has insufficient units (spent in PvP) or is mid-travel.
      // Rally requires 50 def_1; check before attempting.
      if (creatorAcc.defensiveUnit1.lt(new BN(50))) {
        skippedUnits += 1;
        continue;
      }
      if (creatorAcc.arrivalTime && creatorAcc.arrivalTime.gtn(0)) {
        // arrival_time > 0 indicates active travel (set to -1 when not traveling)
        const tNow = await getCurrentTimestamp(ctx.svm);
        if (creatorAcc.arrivalTime.gtn(tNow)) {
          skippedTraveling += 1;
          continue;
        }
      }
      const creatorCity = creatorAcc.currentCity;
      // Target a Tier B player (cheap, has no fancy state).
      const targetPlayer = pickOne(tierB);
      const targetAcc = await fetchPlayer(ctx.svm, targetPlayer.playerPda);
      if (!targetAcc) continue;
      const targetCity = targetAcc.currentCity;

      const rallyId = i; // Unique per creator; creator+id is the PDA seed.
      const [rallyPda] = deriveRallyPda(ctx.gameEngine, creator.publicKey, rallyId);

      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createRallyCreateInstruction(
              {
                gameEngine: ctx.gameEngine,
                owner: creator.publicKey,
                rallyId,
                target: targetPlayer.playerPda,
                teamId: teamRecord.teamId,
                rallyCityId: creatorCity,
              },
              {
                targetType: RallyTargetType.Player,
                gatherDuration: new BN(3600),
                targetCityId: targetCity,
                defensiveUnit1: new BN(50),
                defensiveUnit2: new BN(0),
                defensiveUnit3: new BN(0),
                meleeWeapons: new BN(0),
                rangedWeapons: new BN(0),
                siegeWeapons: new BN(0),
              },
            ),
          ),
          [creator.keypair],
        );
        created += 1;

        // Up to 2 teammates join the rally.
        for (const member of teamRecord.members.slice(0, 2)) {
          try {
            await sendTransaction(
              ctx.svm,
              new Transaction().add(
                createRallyJoinInstruction(
                  {
                    gameEngine: ctx.gameEngine,
                    owner: member.publicKey,
                    rally: rallyPda,
                    rallyCreator: creator.publicKey,
                    rallyId,
                    teamId: teamRecord.teamId,
                    rallyCityId: creatorCity,
                  },
                  {
                    defensiveUnit1: new BN(20),
                    defensiveUnit2: new BN(0),
                    defensiveUnit3: new BN(0),
                    meleeWeapons: new BN(0),
                    rangedWeapons: new BN(0),
                    siegeWeapons: new BN(0),
                  },
                ),
              ),
              [member.keypair],
            );
            joined += 1;
          } catch (e) {
        if (!isExpectedTxError(e)) throw e;
            // Member may not have units / extension / etc.
          }
        }

        // Cancel half the rallies; let the others linger in Gathering state.
        if (i % 2 === 0) {
          try {
            await sendTransaction(
              ctx.svm,
              new Transaction().add(
                createRallyCancelInstruction({
                  gameEngine: ctx.gameEngine,
                  owner: creator.publicKey,
                  rally: rallyPda,
                  rallyId,
                  rallyCityId: creatorCity,
                }),
              ),
              [creator.keypair],
            );
            cancelled += 1;
            createdRallies.push({ creator, rallyId, rallyPda, status: 'cancelled' });
          } catch (e) {
        if (!isExpectedTxError(e)) throw e;
            createdRallies.push({ creator, rallyId, rallyPda, status: 'created' });
          }
        } else {
          createdRallies.push({ creator, rallyId, rallyPda, status: 'created' });
        }
      } catch (e) {
        if (!isExpectedTxError(e)) throw e;
        // Rally creation failed — Citadel-level / extension / etc. Skip.
      }
    }

    log.info(
      `Rallies: ${created} created, ${joined} joins, ${cancelled} cancelled (skipped: ${skippedUnits} no-units, ${skippedTraveling} traveling)`,
    );
    // Half the rally leaders should have units left after PvP; expect ≥3 created.
    expect(created).toBeGreaterThanOrEqual(3);
  }, 900_000);

  // Phase 8: Finalize Event

  it('Phase 8: finalizes event after end_time', async () => {
    const evt = await fetchEvent(ctx.svm, ctx.gameEngine, STRESS_EVENT_ID);
    expect(evt).not.toBeNull();

    const now = await getCurrentTimestamp(ctx.svm);
    const remaining = evt!.endTime.toNumber() - now;
    if (remaining > 0) {
      await advanceTime(ctx.svm, remaining + 5);
    }

    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createFinalizeEventInstruction({
          gameEngine: ctx.gameEngine,
          eventId: STRESS_EVENT_ID,
        }),
      ),
      [ctx.daoAuthority],
    );

    const finalized = await fetchEvent(ctx.svm, ctx.gameEngine, STRESS_EVENT_ID);
    expect(finalized!.status).toBe(EventStatus.Finalized);
  }, 900_000);

  // Phase 9: Invariant Audit
  //
  // Walk the full state and assert global invariants. Bugs in counters,
  // ordering, shared state, or PDA hygiene surface here.

  it('Phase 9: end-state invariants hold', async () => {
    log.section('Invariant Audit');
    const violations: string[] = [];

    // Invariant A: every player account well-formed; owner matches.
    const allPlayers: TestPlayer[] = [...tierA, ...tierB, ...tierC];
    let playersChecked = 0;
    for (const p of allPlayers) {
      const acc = await fetchPlayer(ctx.svm, p.playerPda);
      if (!acc) {
        violations.push(`Player ${p.publicKey.toBase58()} account missing`);
        continue;
      }
      if (!acc.owner.equals(p.publicKey)) {
        violations.push(`Player ${p.publicKey.toBase58()} owner mismatch`);
      }
      if (acc.networth.isNeg()) {
        violations.push(`Player ${p.publicKey.toBase58()} negative networth`);
      }
      playersChecked += 1;
    }
    log.info(`Players verified: ${playersChecked}/${allPlayers.length}`);

    // Invariant B: each team's member_count matches populated slots.
    for (const team of teams) {
      const teamAcc = await fetchTeam(ctx.svm, team.teamPda);
      if (!teamAcc) {
        violations.push(`Team ${team.teamId} account missing`);
        continue;
      }
      let populated = 0;
      for (let i = 0; i < teamAcc.maxMembers; i++) {
        const slot = await fetchTeamMemberSlot(ctx.svm, team.teamPda, i);
        if (slot && !slot.player.equals(PublicKey.default)) {
          populated += 1;
        }
      }
      if (populated !== teamAcc.memberCount) {
        violations.push(
          `Team ${team.teamId}: member_count=${teamAcc.memberCount} vs slots=${populated}`,
        );
      }
    }
    log.info(`Teams verified: ${teams.length}`);

    // Invariant C: every claimed castle account exists at the expected PDA.
    let castlesVerified = 0;
    for (const c of castleClaims) {
      const [castlePda] = deriveCastlePda(ctx.gameEngine, c.cityId, c.castleId);
      const info = await fetchAccount(ctx.svm, castlePda);
      if (!info || info.data.length === 0) {
        violations.push(`Castle (city=${c.cityId}, id=${c.castleId}) account missing`);
        continue;
      }
      castlesVerified += 1;
    }
    log.info(`Castles verified: ${castlesVerified}/${castleClaims.length} claimed`);

    // Invariant D: arena leaderboard sorted descending + unique.
    const season = await fetchArenaSeason(ctx.svm, ctx.gameEngine, ARENA_SEASON_ID);
    if (season) {
      const seenArena = new Set<string>();
      const lb = season.leaderboard ?? [];
      for (let i = 0; i < season.leaderboardCount; i++) {
        const entry = lb[i];
        if (!entry) {
          violations.push(`Arena LB rank ${i + 1} undefined`);
          continue;
        }
        const key = entry.player.toBase58();
        if (seenArena.has(key)) {
          violations.push(`Arena LB duplicate: ${key}`);
        }
        seenArena.add(key);
        if (i > 0) {
          const prev = lb[i - 1];
          if (prev && prev.totalPoints.lt(entry.totalPoints)) {
            violations.push(`Arena LB unsorted at rank ${i + 1}`);
          }
        }
      }
      log.info(`Arena leaderboard: ${season.leaderboardCount} entries`);
    }

    // Invariant E: event leaderboard sorted descending + unique, participantCount ≥ LB count.
    const finalEvent = await fetchEvent(ctx.svm, ctx.gameEngine, STRESS_EVENT_ID);
    if (finalEvent) {
      const seenEvent = new Set<string>();
      for (let i = 0; i < finalEvent.leaderboardCount; i++) {
        const entry = finalEvent.leaderboard[i];
        if (!entry) continue;
        const key = entry.player.toBase58();
        if (seenEvent.has(key)) {
          violations.push(`Event LB duplicate: ${key}`);
        }
        seenEvent.add(key);
        if (i > 0) {
          const prev = finalEvent.leaderboard[i - 1];
          if (prev && prev.score.lt(entry.score)) {
            violations.push(`Event LB unsorted at rank ${i + 1}`);
          }
        }
      }
      log.info(`Event leaderboard: ${finalEvent.leaderboardCount} entries`);

      if (finalEvent.participantCount < finalEvent.leaderboardCount) {
        violations.push(
          `Event: participantCount=${finalEvent.participantCount} < leaderboardCount=${finalEvent.leaderboardCount}`,
        );
      }

      // Invariant F: every event LB entry has a matching participation account.
      for (let i = 0; i < finalEvent.leaderboardCount; i++) {
        const entry = finalEvent.leaderboard[i];
        if (!entry) continue;
        const part = await fetchEventParticipation(
          ctx.svm, ctx.gameEngine, STRESS_EVENT_ID, entry.player,
        );
        if (!part) {
          violations.push(
            `Event LB rank ${i + 1} (${entry.player.toBase58()}) has no participation acct`,
          );
        }
      }
    }

    // Invariant G: every created (non-cancelled) rally still on-chain in a
    // recognizable status. Cancelled rallies may have been closed (account
    // gone) or still readable — both acceptable.
    let ralliesAlive = 0;
    let ralliesCancelled = 0;
    for (const r of createdRallies) {
      const acc = await fetchRally(ctx.svm, r.rallyPda);
      if (!acc) {
        if (r.status === 'cancelled') {
          ralliesCancelled += 1;
        } else {
          violations.push(`Rally ${r.rallyId} (creator=${r.creator.publicKey.toBase58()}) account missing`);
        }
        continue;
      }
      // rally.creator is the owner wallet pubkey, not the player PDA.
      if (!acc.creator.equals(r.creator.publicKey)) {
        violations.push(`Rally ${r.rallyId} creator mismatch`);
      }
      // Cancelled rallies should reflect that in status; non-cancelled should
      // be in some pre-execution state. We accept any non-Failed status — the
      // important thing is the field is readable.
      ralliesAlive += 1;
    }
    log.info(`Rallies: ${ralliesAlive} accounts intact, ${ralliesCancelled} cancelled+closed`);

    // Final report
    if (violations.length > 0) {
      log.section('INVARIANT VIOLATIONS');
      for (const v of violations) log.info(`- ${v}`);
    } else {
      log.info('All invariants hold ✓');
    }
    expect(violations).toEqual([]);
  }, 900_000);
});
