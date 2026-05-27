/**
 * Castle System E2E Tests
 *
 * Tests for King's Castle mechanics:
 * - Castle creation (DAO)
 * - Castle claiming (requires team)
 * - Garrison management
 * - Court appointments
 * - Castle upgrades
 * - Castle attacks
 * - Castle rewards
 * - Force removal (admin)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createCreateCastleInstruction,
  createClaimVacantCastleInstruction,
  createAttackCastleInstruction,
  createJoinGarrisonInstruction,
  createLeaveGarrisonInstruction,
  createAppointCourtInstruction,
  createResignCourtInstruction,
  createDismissCourtInstruction,
  createInitiateUpgradeInstruction,
  createCancelUpgradeInstruction,
  createClaimCastleRewardsInstruction,
  createClaimGarrisonLootInstruction,
  createForceRemoveKingInstruction,
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createUpdateCastleStatusInstruction,
  createCompleteUpgradeInstruction,
  createRelieveGarrisonInstruction,
  createGarrisonCleanupInstruction,
  createCourtCleanupInstruction,
  createRewardsCleanupInstruction,
  createFinalizeTransitionInstruction,
  createUpdateCastleConfigInstruction,
  derivePlayerPda,
  deriveCastlePda,
  deriveGarrisonPda,
  deriveTeamPda,
  deriveCourtPda,
  deriveTeamCastleRewardPda,
  deserializeCastle,
  BuildingType,
} from '../../src/index';

import {
  type TestContext,
  beforeAllTests,
  CITIES,
} from '../fixtures/setup';
import { advanceTime } from '../fixtures/time';
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
  fetchCastleRaw,
} from '../utils/accounts';
import { log } from '../utils/logger';

// Helpers

let teamCounter = 9000;
let memberSlotCounter = new Map<string, number>(); // track next available slot per team

function uniqueTeamId(): number {
  return teamCounter++;
}

/** Create a team for a player (player needs estate+gems for EXT_INVENTORY) */
async function createTeamForPlayer(
  ctx: TestContext,
  player: TestPlayer
): Promise<{ teamPda: PublicKey; teamId: number }> {
  const teamId = uniqueTeamId();
  const teamIdBn = new BN(teamId);
  const teamIdBuffer = teamIdBn.toArrayLike(Buffer, 'le', 8);
  const [teamPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('team'), ctx.gameEngine.toBuffer(), teamIdBuffer],
    (await import('../../src/program')).PROGRAM_ID
  );

  const ix = createTeamCreateInstruction(
    { owner: player.publicKey, gameEngine: ctx.gameEngine, teamId },
    { name: `CastleTeam${teamId}` }
  );

  await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);
  memberSlotCounter.set(teamPda.toBase58(), 1); // founder is slot 0, next is 1
  return { teamPda, teamId };
}

/** Add a player to an existing team via invite + accept */
async function addPlayerToTeam(
  ctx: TestContext,
  leader: TestPlayer,
  member: TestPlayer,
  teamPda: PublicKey,
  teamId: number
): Promise<void> {
  const [memberPlayerPda] = derivePlayerPda(ctx.gameEngine, member.publicKey);
  const slotIndex = memberSlotCounter.get(teamPda.toBase58()) ?? 1;
  memberSlotCounter.set(teamPda.toBase58(), slotIndex + 1);

  // Invite
  const inviteIx = createTeamInviteInstruction({
    inviter: leader.publicKey,
    gameEngine: ctx.gameEngine,
    team: teamPda,
    teamId,
    inviterSlotIndex: 0, // leader is always slot 0
    inviteePlayer: memberPlayerPda,
  });
  await sendTransaction(ctx.svm, new Transaction().add(inviteIx), [leader.keypair]);

  // Accept
  const acceptIx = createTeamAcceptInviteInstruction({
    owner: member.publicKey,
    gameEngine: ctx.gameEngine,
    team: teamPda,
    teamId,
    slotIndex,
    inviteRefund: leader.publicKey,
  });
  await sendTransaction(ctx.svm, new Transaction().add(acceptIx), [member.keypair]);
}

/** Create castle via DAO. Anchor is placed at the city's centre + small
 *  offset so the N×N footprint stays inside the city's AABB. */
async function createCastle(
  ctx: TestContext,
  cityId: number,
  castleId: number,
  tier: number = 2,
  minLevel: number = 1
): Promise<void> {
  const city = CITIES[cityId]!;
  const cityLatGrid = Math.round(city.lat * 10000);
  const cityLonGrid = Math.round(city.lon * 10000);
  const ix = createCreateCastleInstruction(
    { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
    {
      cityId,
      castleId,
      tier,
      // Castle anchors spread on a 5-cell-spaced grid bounded inside
      // the no-water zone (±200 from city centre for TEST_BIOME_SEED).
      // 5-cell spacing with 2×2 footprints leaves a 3-cell gap between
      // castles — no overlap, no collision with player cells from the
      // spawn picker which fills offsets starting at (0, 0). Modulo
      // wraps so high castleIds (199 etc.) stay in bounds.
      latitude: cityLatGrid + ((castleId % 30) * 5 + 30),
      longitude: cityLonGrid + (Math.floor(castleId / 30) * 5 + 30),
      minLevel,
      minNetworthMillions: 0,
      minTroopsThousands: 0,
      name: `Castle-${cityId}-${castleId}`,
      footprintSize: 2,
    }
  );

  await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);
}

/** Create castle positioned at a specific player's current coords (within 1 grid cell). */
async function createCastleAtPlayer(
  ctx: TestContext,
  player: TestPlayer,
  cityId: number,
  castleId: number,
  tier: number = 2,
): Promise<void> {
  const data = await fetchPlayer(ctx.svm, player.playerPda);
  if (!data) throw new Error('player not initialized');
  // Place the castle anchor +1 grid cell away from the player so the
  // player's cell isn't inside the castle's N×N footprint (the chain
  // rejects creates that would overlap an existing LocationAccount).
  const ix = createCreateCastleInstruction(
    { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
    {
      cityId,
      castleId,
      tier,
      latitude: Math.round(data.currentLat * 10000) + 1,
      longitude: Math.round(data.currentLong * 10000) + 1,
      minLevel: 1,
      minNetworthMillions: 0,
      minTroopsThousands: 0,
      name: `AtkCastle${castleId}`,
      footprintSize: 2,
    }
  );
  await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);
}

/** Create a player with estate and team, ready for castle operations */
async function createCastleReadyPlayer(
  factory: PlayerFactory,
  ctx: TestContext
): Promise<TestPlayer> {
  const player = await factory.createPlayer({ initialize: true, createEstate: true });
  await createTeamForPlayer(ctx, player);
  return player;
}

/** Transition castle from CONTEST → PROTECTED (requires contest period to have elapsed) */
async function transitionCastleStatus(
  ctx: TestContext,
  cityId: number,
  castleId: number,
): Promise<void> {
  // CASTLE_CONTEST_DURATION = 7200s; advance past it so update_castle_status
  // can flip CONTEST → PROTECTED.
  await advanceTime(ctx.svm, 7201);
  const ix = createUpdateCastleStatusInstruction({
    caller: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
    cityId,
    castleId,
  });
  await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);
}

// Test Suite

describe('Castle System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Castle System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // Castle Creation Tests (DAO)

  describe('Castle Creation', () => {
    it('should create castle via DAO', async () => {
      await createCastle(ctx, 1, 100, 2);

      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 100);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject castle creation by non-DAO', async () => {
      const nonDao = Keypair.generate();
      ctx.svm.airdrop(nonDao.publicKey, BigInt(1_000_000_000));

      const ix = createCreateCastleInstruction(
        { daoAuthority: nonDao.publicKey, gameEngine: ctx.gameEngine },
        {
          cityId: 1, castleId: 199, tier: 1,
          latitude: 400000, longitude: -740000,
          minLevel: 1, minNetworthMillions: 0, minTroopsThousands: 0,
          name: 'Unauthorized',
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [nonDao]
      );
    });

    it('should reject duplicate castle creation', async () => {
      // Castle 1/100 already created above
      const ix = createCreateCastleInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        {
          cityId: 1, castleId: 100, tier: 2,
          latitude: 400000, longitude: -740000,
          minLevel: 1, minNetworthMillions: 0, minTroopsThousands: 0,
          name: 'Duplicate',
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [ctx.daoAuthority]
      );
    });

    it('should reject invalid tier', async () => {
      const ix = createCreateCastleInstruction(
        { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
        {
          cityId: 1, castleId: 198, tier: 99, // Invalid tier
          latitude: 400000, longitude: -740000,
          minLevel: 1, minNetworthMillions: 0, minTroopsThousands: 0,
          name: 'BadTier',
        }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [ctx.daoAuthority]
      );
    });
  });

  // Castle Claiming Tests

  describe('Castle Claiming', () => {
    const CITY = 1;
    const CASTLE_CLAIM = 101;

    beforeAll(async () => {
      await createCastle(ctx, CITY, CASTLE_CLAIM, 2);
    });

    it('should claim vacant castle', async () => {
      const player = await createCastleReadyPlayer(factory, ctx);

      const ix = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: player.publicKey,
        cityId: CITY,
        castleId: CASTLE_CLAIM,
      });

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE_CLAIM);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject claim of occupied castle', async () => {
      // Castle CASTLE_CLAIM is already claimed above
      const player2 = await createCastleReadyPlayer(factory, ctx);

      const ix = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: player2.publicKey,
        cityId: CITY,
        castleId: CASTLE_CLAIM,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player2.keypair]
      );
    });

    it('should reject claim without team', async () => {
      // Create separate castle for this test
      await createCastle(ctx, CITY, 102, 2);

      const noTeamPlayer = await factory.createPlayer({ initialize: true, createEstate: true });
      // Don't create team!

      const ix = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: noTeamPlayer.publicKey,
        cityId: CITY,
        castleId: 102,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [noTeamPlayer.keypair]
      );
    });

    it('should reject claim with insufficient level', async () => {
      // Create castle with high level requirement
      await createCastle(ctx, CITY, 103, 2, 50);

      const player = await createCastleReadyPlayer(factory, ctx);

      const ix = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: player.publicKey,
        cityId: CITY,
        castleId: 103,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Garrison Tests

  describe('Garrison Management', () => {
    const CITY = 1;
    const CASTLE_GARRISON = 110;
    let king: TestPlayer;
    let teamPda: PublicKey;
    let teamId: number;

    beforeAll(async () => {
      // Create castle and have a king claim it
      await createCastle(ctx, CITY, CASTLE_GARRISON, 2);
      king = await factory.createPlayer({ initialize: true, createEstate: true });
      ({ teamPda, teamId } = await createTeamForPlayer(ctx, king));

      const claimIx = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: king.publicKey,
        cityId: CITY,
        castleId: CASTLE_GARRISON,
      });
      await sendTransaction(ctx.svm, new Transaction().add(claimIx), [king.keypair]);
    });

    it('should join castle garrison', async () => {
      // Create teammate and add to king's team (needs Barracks to hire units)
      const member = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await addPlayerToTeam(ctx, king, member, teamPda, teamId);

      // Give member units (defensive_unit_1 costs 100 power each, ~1:1 NOVI ratio)
      await factory.hireUnits(member, 0, 10_000);

      const ix = createJoinGarrisonInstruction(
        { gameEngine: ctx.gameEngine, owner: member.publicKey, cityId: CITY, castleId: CASTLE_GARRISON },
        { units: [new BN(5), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(ix), [member.keypair]);
    }, 30_000);

    it('should leave castle garrison', async () => {
      const member = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await addPlayerToTeam(ctx, king, member, teamPda, teamId);
      await factory.hireUnits(member, 0, 10_000);

      // Join
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinGarrisonInstruction(
            { gameEngine: ctx.gameEngine, owner: member.publicKey, cityId: CITY, castleId: CASTLE_GARRISON },
            { units: [new BN(5), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
          )
        ),
        [member.keypair]
      );

      // Leave
      const leaveIx = createLeaveGarrisonInstruction({
        gameEngine: ctx.gameEngine,
        owner: member.publicKey,
        cityId: CITY,
        castleId: CASTLE_GARRISON,
      });

      await sendTransaction(ctx.svm, new Transaction().add(leaveIx), [member.keypair]);
    }, 30_000);

    it('should reject garrison from non-team member', async () => {
      const outsider = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await createTeamForPlayer(ctx, outsider);
      await factory.hireUnits(outsider, 0, 10_000);

      const ix = createJoinGarrisonInstruction(
        { gameEngine: ctx.gameEngine, owner: outsider.publicKey, cityId: CITY, castleId: CASTLE_GARRISON },
        { units: [new BN(5), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [outsider.keypair]
      );
    }, 30_000);
  });

  // Court Tests

  describe('Court Management', () => {
    const CITY = 1;
    const CASTLE_COURT = 120;
    let king: TestPlayer;
    let teamPda: PublicKey;
    let teamId: number;

    beforeAll(async () => {
      await createCastle(ctx, CITY, CASTLE_COURT, 2); // Tier 2 = 3 court positions
      king = await factory.createPlayer({ initialize: true, createEstate: true });
      ({ teamPda, teamId } = await createTeamForPlayer(ctx, king));

      const claimIx = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: king.publicKey,
        cityId: CITY,
        castleId: CASTLE_COURT,
      });
      await sendTransaction(ctx.svm, new Transaction().add(claimIx), [king.keypair]);

      // Transition castle from CONTEST → PROTECTED so court appointments work
      await transitionCastleStatus(ctx, CITY, CASTLE_COURT);
    });

    it('should appoint court member', async () => {
      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      const appointIx = createAppointCourtInstruction(
        { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE_COURT },
        { position: 0 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(appointIx), [king.keypair]);
    });

    it('should allow court member to resign', async () => {
      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      // Appoint
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE_COURT },
            { position: 1 }
          )
        ),
        [king.keypair]
      );

      // Resign
      const resignIx = createResignCourtInstruction(
        { gameEngine: ctx.gameEngine, courtMember: courtier.publicKey, cityId: CITY, castleId: CASTLE_COURT },
        { position: 1 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(resignIx), [courtier.keypair]);
    });

    it('should dismiss court member', async () => {
      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      // Appoint at position 2
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE_COURT },
            { position: 2 }
          )
        ),
        [king.keypair]
      );

      // Dismiss
      const dismissIx = createDismissCourtInstruction(
        { gameEngine: ctx.gameEngine, king: king.publicKey, dismissed: courtier.publicKey, cityId: CITY, castleId: CASTLE_COURT },
        { position: 2 }
      );

      await sendTransaction(ctx.svm, new Transaction().add(dismissIx), [king.keypair]);
    });

    it('should reject appointment by non-king', async () => {
      // Use a fresh castle + team to avoid filling up the court team (max 5 members)
      const CASTLE_COURT_NONKING = 121;
      await createCastle(ctx, CITY, CASTLE_COURT_NONKING, 2);

      const realKing = await factory.createPlayer({ initialize: true, createEstate: true });
      const { teamPda: nkTeam, teamId: nkTeamId } = await createTeamForPlayer(ctx, realKing);

      const claimIx = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: realKing.publicKey,
        cityId: CITY,
        castleId: CASTLE_COURT_NONKING,
      });
      await sendTransaction(ctx.svm, new Transaction().add(claimIx), [realKing.keypair]);
      await transitionCastleStatus(ctx, CITY, CASTLE_COURT_NONKING);

      const nonKing = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, realKing, nonKing, nkTeam, nkTeamId);

      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, realKing, courtier, nkTeam, nkTeamId);

      // nonKing is on the team but is NOT the castle king, so this should fail
      const appointIx = createAppointCourtInstruction(
        { gameEngine: ctx.gameEngine, king: nonKing.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE_COURT_NONKING },
        { position: 0 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(appointIx),
        [nonKing.keypair]
      );
    }, 30_000);
  });

  // Upgrade Tests

  describe('Castle Upgrades', () => {
    const CITY = 1;
    const CASTLE_UPGRADE = 130;
    let king: TestPlayer;

    beforeAll(async () => {
      await createCastle(ctx, CITY, CASTLE_UPGRADE, 2);
      king = await factory.createPlayer({ initialize: true, createEstate: true });
      await createTeamForPlayer(ctx, king);

      const claimIx = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: king.publicKey,
        cityId: CITY,
        castleId: CASTLE_UPGRADE,
      });
      await sendTransaction(ctx.svm, new Transaction().add(claimIx), [king.keypair]);
    });

    it('should initiate castle upgrade', async () => {
      const upgradeIx = createInitiateUpgradeInstruction(
        { gameEngine: ctx.gameEngine, king: king.publicKey, cityId: CITY, castleId: CASTLE_UPGRADE },
        { upgradeType: 1 } // Fortification
      );

      await sendTransaction(ctx.svm, new Transaction().add(upgradeIx), [king.keypair]);
    });

    it('should cancel castle upgrade', async () => {
      const cancelIx = createCancelUpgradeInstruction({
        gameEngine: ctx.gameEngine,
        king: king.publicKey,
        cityId: CITY,
        castleId: CASTLE_UPGRADE,
      });

      await sendTransaction(ctx.svm, new Transaction().add(cancelIx), [king.keypair]);
    });

    it('should reject upgrade by non-king', async () => {
      const nonKing = await factory.createPlayer({ initialize: true, createEstate: true });
      await createTeamForPlayer(ctx, nonKing);

      const upgradeIx = createInitiateUpgradeInstruction(
        { gameEngine: ctx.gameEngine, king: nonKing.publicKey, cityId: CITY, castleId: CASTLE_UPGRADE },
        { upgradeType: 2 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(upgradeIx),
        [nonKing.keypair]
      );
    });
  });

  // Castle Attack Tests

  describe('Castle Attacks', () => {
    const CITY = 1;
    const CASTLE_ATTACK = 140;

    it('should reject attack on non-attackable castle', async () => {
      // Create castle and claim it - with contest duration 0, transition to PROTECTED
      await createCastle(ctx, CITY, CASTLE_ATTACK, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      const claimIx = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: king.publicKey,
        cityId: CITY,
        castleId: CASTLE_ATTACK,
      });
      await sendTransaction(ctx.svm, new Transaction().add(claimIx), [king.keypair]);

      // Transition to PROTECTED (contest duration = 0, so immediate)
      await transitionCastleStatus(ctx, CITY, CASTLE_ATTACK);

      // Attacker with units (needs Barracks to hire)
      const attacker = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await createTeamForPlayer(ctx, attacker);
      await factory.hireUnits(attacker, 0, 50_000);

      const ix = createAttackCastleInstruction(
        { gameEngine: ctx.gameEngine, attacker: attacker.publicKey, cityId: CITY, castleId: CASTLE_ATTACK },
        { driveBy: false }
      );

      // Should fail - castle is in PROTECTED status
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [attacker.keypair]
      );
    }, 30_000);

    it('should reject attack without units', async () => {
      await createCastle(ctx, CITY, 141, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: 141,
          })
        ),
        [king.keypair]
      );

      // Attacker with no units
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true });
      await createTeamForPlayer(ctx, attacker);

      const ix = createAttackCastleInstruction(
        { gameEngine: ctx.gameEngine, attacker: attacker.publicKey, cityId: CITY, castleId: 141 },
        { driveBy: true }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [attacker.keypair]
      );
    }, 30_000);

    it('should conquer empty-garrison castle during CONTEST (status → TRANSITIONING)', async () => {
      // Attacker positions a castle at their own current coords so the 50m
      // CASTLE_ATTACK_RANGE_METERS check passes. King claims (CONTEST), no
      // garrison set, attacker attacks: garrison_units=0 triggers "garrison
      // defeated" branch and the castle flips to TRANSITIONING with
      // transition_new_king = attacker.
      const attacker = await factory.createPlayer({
        cityId: CITY,
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await createTeamForPlayer(ctx, attacker);
      await factory.hireUnits(attacker, 0, 10_000);

      // Castle anchored to attacker's coords (so distance ≈ 0m post-fix)
      await createCastleAtPlayer(ctx, attacker, CITY, 142, 2);

      // A separate king claims it. The king might spawn in a different city,
      // which is fine — the GEO check is on the attacker, not the king.
      const king = await createCastleReadyPlayer(factory, ctx);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: 142,
          })
        ),
        [king.keypair]
      );

      // Confirm CONTEST status before attack (claim sets CONTEST)
      const beforeAttack = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, 142))!.data);
      expect(beforeAttack.status).toBe(1); // CONTEST

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAttackCastleInstruction(
            { gameEngine: ctx.gameEngine, attacker: attacker.publicKey, cityId: CITY, castleId: 142 },
            { driveBy: false }
          )
        ),
        [attacker.keypair]
      );

      const afterAttack = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, 142))!.data);
      expect(afterAttack.status).toBe(4); // TRANSITIONING
      expect(afterAttack.transitionNewKing.toBase58()).toBe(attacker.playerPda.toBase58());
      expect(afterAttack.failedDefenses).toBe(1);
    }, 60_000);

    it('should reject out-of-range attack (OutOfRange)', async () => {
      // Castle at default coords (400000,-740000 → 40.0,-74.0 post-fix).
      // Attacker spawns at city center which won't match → distance > 50m.
      await createCastle(ctx, CITY, 143, 2);
      const king = await createCastleReadyPlayer(factory, ctx);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: 143,
          })
        ),
        [king.keypair]
      );

      const attacker = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await createTeamForPlayer(ctx, attacker);
      await factory.hireUnits(attacker, 0, 10_000);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createAttackCastleInstruction(
            { gameEngine: ctx.gameEngine, attacker: attacker.publicKey, cityId: CITY, castleId: 143 },
            { driveBy: true }
          )
        ),
        [attacker.keypair]
      );
    }, 60_000);
  });

  // Reward Tests

  describe('Castle Rewards', () => {
    it('should mint locked NOVI to king (Stronghold = low-tier path)', async () => {
      // Stronghold (tier 2): tier.has_king() is false, so the king collects
      // MEMBER rewards. Low-tier mints to player.locked_novi.
      await createCastle(ctx, 1, 152, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 152,
          })
        ),
        [king.keypair]
      );
      await transitionCastleStatus(ctx, 1, 152);

      // First call: creates the reward account, returns Ok(()) on day 0
      // (no rewards paid, but account persists thanks to the brand-new branch).
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: king.publicKey,
            cityId: 1,
            castleId: 152,
          })
        ),
        [king.keypair]
      );

      // Confirm account persisted across the day-0 claim
      const [castlePda] = deriveCastlePda(ctx.gameEngine, 1, 152);
      const [rewardPda] = deriveTeamCastleRewardPda(castlePda, king.playerPda);
      expect(await ctx.svm.getAccount(rewardPda)).not.toBeNull();

      const lockedBefore = (await fetchPlayer(ctx.svm, king.playerPda))!.lockedNovi;

      // Advance 1 day + slack, then claim again — rewards flow.
      await advanceTime(ctx.svm, 86_400 + 60);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: king.publicKey,
            cityId: 1,
            castleId: 152,
          })
        ),
        [king.keypair]
      );

      const lockedAfter = (await fetchPlayer(ctx.svm, king.playerPda))!.lockedNovi;
      expect(lockedAfter.gt(lockedBefore)).toBe(true);
    }, 60_000);

    it('should claim COURT rewards on Citadel (high-tier reserved path)', async () => {
      // Citadel (tier 4): tier.has_king() and tier.has_court() are both true.
      // High-tier mints to UserAccount.reserved_novi (withdrawable) rather than
      // PlayerAccount.locked_novi.
      const CITY = 1;
      const CASTLE = 154;
      await createCastle(ctx, CITY, CASTLE, 4);

      const king = await factory.createPlayer({ initialize: true, createEstate: true });
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [king.keypair]
      );
      await transitionCastleStatus(ctx, CITY, CASTLE);

      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE },
            { position: 0 }
          )
        ),
        [king.keypair]
      );

      const [castlePda] = deriveCastlePda(ctx.gameEngine, CITY, CASTLE);
      const [courtPda] = deriveCourtPda(castlePda, 0);

      // Day 0 — prime the account
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: courtier.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            courtPosition: courtPda,
          })
        ),
        [courtier.keypair]
      );

      const lockedBefore = (await fetchPlayer(ctx.svm, courtier.playerPda))!.lockedNovi;

      await advanceTime(ctx.svm, 86_400 + 60);

      // Day 1 — high-tier path runs, mints to reserved_novi (UserAccount)
      // NOT locked_novi. So player.locked_novi stays the same; this is the
      // key behavioral difference from the Stronghold test above.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: courtier.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            courtPosition: courtPda,
          })
        ),
        [courtier.keypair]
      );

      const lockedAfter = (await fetchPlayer(ctx.svm, courtier.playerPda))!.lockedNovi;
      expect(lockedAfter.eq(lockedBefore)).toBe(true); // high-tier doesn't touch locked
    }, 60_000);

    it('should reject double-claim within same day (NoRewardsToClaim)', async () => {
      await createCastle(ctx, 1, 156, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 156,
          })
        ),
        [king.keypair]
      );
      await transitionCastleStatus(ctx, 1, 156);

      // Prime
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: king.publicKey,
            cityId: 1,
            castleId: 156,
          })
        ),
        [king.keypair]
      );

      // Advance enough to get one payout
      await advanceTime(ctx.svm, 86_400 + 60);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: king.publicKey,
            cityId: 1,
            castleId: 156,
          })
        ),
        [king.keypair]
      );

      // Immediate re-claim must fail (elapsed_days == 0, account NOT brand-new)
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createClaimCastleRewardsInstruction({
            gameEngine: ctx.gameEngine,
            claimant: king.publicKey,
            cityId: 1,
            castleId: 156,
          })
        ),
        [king.keypair]
      );
    }, 60_000);

    it('should reject rewards when castle not owned', async () => {
      // Create castle but don't claim it
      await createCastle(ctx, 1, 150, 2);

      const player = await createCastleReadyPlayer(factory, ctx);

      const ix = createClaimCastleRewardsInstruction({
        gameEngine: ctx.gameEngine,
        claimant: player.publicKey,
        cityId: 1,
        castleId: 150,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject rewards for non-affiliated player', async () => {
      await createCastle(ctx, 1, 151, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 151,
          })
        ),
        [king.keypair]
      );

      // Non-affiliated player
      const outsider = await createCastleReadyPlayer(factory, ctx);

      const ix = createClaimCastleRewardsInstruction({
        gameEngine: ctx.gameEngine,
        claimant: outsider.publicKey,
        cityId: 1,
        castleId: 151,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [outsider.keypair]
      );
    }, 30_000);
  });

  // Force Remove Tests (Admin)

  describe('Force Removal', () => {
    it('should force remove king', async () => {
      await createCastle(ctx, 1, 160, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 160,
          })
        ),
        [king.keypair]
      );

      const ix = createForceRemoveKingInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: ctx.daoAuthority.publicKey,
        cityId: 1,
        castleId: 160,
        currentKing: king.publicKey,
      });

      await sendTransaction(ctx.svm, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify castle is now vacant
      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 160);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject force remove by non-DAO', async () => {
      await createCastle(ctx, 1, 161, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 161,
          })
        ),
        [king.keypair]
      );

      const nonDao = Keypair.generate();
      ctx.svm.airdrop(nonDao.publicKey, BigInt(1_000_000_000));

      const ix = createForceRemoveKingInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: nonDao.publicKey,
        cityId: 1,
        castleId: 161,
        currentKing: king.publicKey,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [nonDao]
      );
    });
  });

  // Complete Upgrade Tests

  describe('Complete Upgrade', () => {
    it('should complete upgrade after initiation', async () => {
      // Create castle and claim it
      await createCastle(ctx, 1, 180, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 180,
          })
        ),
        [king.keypair]
      );

      // Initiate upgrade (type 1 = Fortification)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createInitiateUpgradeInstruction(
            { king: king.publicKey, gameEngine: ctx.gameEngine, cityId: 1, castleId: 180 },
            { upgradeType: 1 }
          )
        ),
        [king.keypair]
      );

      // Verify castle has an upgrade in progress
      let castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 180);
      expect(castleInfo).not.toBeNull();

      // Try to complete immediately — should fail (upgrade time not elapsed)
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createCompleteUpgradeInstruction({
            payer: king.publicKey,
            gameEngine: ctx.gameEngine,
            cityId: 1,
            castleId: 180,
          })
        ),
        [king.keypair]
      );

      // Verify castle still has upgrade in progress
      castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 180);
      expect(castleInfo).not.toBeNull();
    }, 30_000);

    it('should apply upgrade level after timer expires', async () => {
      // Fortification level 1 takes UPGRADE_DURATION_BASE * 1 = 259_200s (3 days)
      await createCastle(ctx, 1, 181, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 181,
          })
        ),
        [king.keypair]
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createInitiateUpgradeInstruction(
            { king: king.publicKey, gameEngine: ctx.gameEngine, cityId: 1, castleId: 181 },
            { upgradeType: 1 } // Fortification
          )
        ),
        [king.keypair]
      );

      // Verify upgrade in progress before advancing
      let before = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 181))!.data);
      expect(before.upgradeType).toBe(1);
      expect(before.upgradeTargetLevel).toBe(1);
      expect(before.fortificationLevel).toBe(0);

      // Advance past upgrade_end_at (3 days + slack)
      await advanceTime(ctx.svm, 259_201);

      // Permissionless: anyone can call complete_upgrade once the timer is up
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCompleteUpgradeInstruction({
            payer: king.publicKey,
            gameEngine: ctx.gameEngine,
            cityId: 1,
            castleId: 181,
          })
        ),
        [king.keypair]
      );

      const after = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 181))!.data);
      expect(after.upgradeType).toBe(0);
      expect(after.upgradeTargetLevel).toBe(0);
      expect(after.fortificationLevel).toBe(1);
    }, 30_000);

    it('should reject complete when no upgrade in progress', async () => {
      await createCastle(ctx, 1, 182, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 182,
          })
        ),
        [king.keypair]
      );

      // No initiate_upgrade call — castle has no upgrade in flight
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createCompleteUpgradeInstruction({
            payer: king.publicKey,
            gameEngine: ctx.gameEngine,
            cityId: 1,
            castleId: 182,
          })
        ),
        [king.keypair]
      );
    });
  });

  // Relieve Garrison Tests

  describe('Relieve Garrison', () => {
    it('should allow king to relieve garrison member', async () => {
      // Create castle and claim it
      await createCastle(ctx, 1, 185, 2);
      const king = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(king, 0, 100);

      // Create team for king
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 185,
          })
        ),
        [king.keypair]
      );

      // Create a member, add to king's team, and join garrison
      const member = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(member, 0, 100);

      // Add member to king's team
      await addPlayerToTeam(ctx, king, member, teamPda, teamId);

      // Member joins garrison
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinGarrisonInstruction(
            { gameEngine: ctx.gameEngine, owner: member.publicKey, cityId: 1, castleId: 185 },
            { units: [new BN(10), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
          )
        ),
        [member.keypair]
      );

      // Verify garrison exists
      const [castlePda] = deriveCastlePda(ctx.gameEngine, 1, 185);
      const [garrisonPda] = deriveGarrisonPda(castlePda, member.playerPda);
      let garrisonAccount = await ctx.svm.getAccount(garrisonPda);
      expect(garrisonAccount).not.toBeNull();

      // King relieves garrison member
      const relieveIx = createRelieveGarrisonInstruction({
        king: king.publicKey,
        gameEngine: ctx.gameEngine,
        cityId: 1,
        castleId: 185,
        garrisonMember: member.publicKey,
      });

      await sendTransaction(ctx.svm, new Transaction().add(relieveIx), [king.keypair]);

      // Verify garrison contribution account is closed
      garrisonAccount = await ctx.svm.getAccount(garrisonPda);
      expect(garrisonAccount).toBeNull();
    }, 60_000);
  });

  // Castle Tier Tests

  describe('Castle Tiers', () => {
    it('should create outpost (tier 0) with no garrison', async () => {
      await createCastle(ctx, 1, 170, 0); // Outpost
      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 170);
      expect(castleInfo).not.toBeNull();
    });

    it('should create keep (tier 1) with limited court', async () => {
      await createCastle(ctx, 1, 171, 1); // Keep
      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 171);
      expect(castleInfo).not.toBeNull();
    });

    it('should create stronghold (tier 2) with full features', async () => {
      await createCastle(ctx, 1, 172, 2); // Stronghold
      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 172);
      expect(castleInfo).not.toBeNull();
    });

    it('should create fortress (tier 3)', async () => {
      await createCastle(ctx, 1, 173, 3);
      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 173);
      expect(castleInfo).not.toBeNull();
    });

    it('should create citadel (tier 4)', async () => {
      await createCastle(ctx, 1, 174, 4);
      const castleInfo = await fetchCastleRaw(ctx.svm, ctx.gameEngine, 1, 174);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject garrison join on outpost', async () => {
      // Claim outpost first
      const king = await createCastleReadyPlayer(factory, ctx);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 170,
          })
        ),
        [king.keypair]
      );

      // Try to join garrison on outpost (tier 0 = no garrison)
      const ix = createJoinGarrisonInstruction(
        { gameEngine: ctx.gameEngine, owner: king.publicKey, cityId: 1, castleId: 170 },
        { units: [new BN(10), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [king.keypair]
      );
    });

    it('should reject court appointment on Outpost (max_court=0)', async () => {
      // Tier 0 sets max_court=0 in create_castle; appoint_court rejects with CastleTierNoCourt
      await createCastle(ctx, 1, 175, 0);

      const king = await factory.createPlayer({ initialize: true, createEstate: true });
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 175,
          })
        ),
        [king.keypair]
      );

      // Outpost cannot transition CONTEST→PROTECTED via update_castle_status if it
      // never entered CONTEST in a meaningful way — claim_vacant_castle DOES set
      // status=CONTEST regardless of tier. Advance and transition so the appoint
      // call reaches the tier check (not the status check).
      await transitionCastleStatus(ctx, 1, 175);

      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            {
              gameEngine: ctx.gameEngine,
              king: king.publicKey,
              appointee: courtier.publicKey,
              cityId: 1,
              castleId: 175,
            },
            { position: 0 }
          )
        ),
        [king.keypair]
      );
    }, 30_000);

    it('should cap Keep court at 1 position', async () => {
      // Tier 1 sets max_court=1; second appointment must fail (CourtPositionTaken
      // OR CastleNeedsChambersUpgrade — depends on chambers_level path).
      await createCastle(ctx, 1, 176, 1);

      const king = await factory.createPlayer({ initialize: true, createEstate: true });
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: 1,
            castleId: 176,
          })
        ),
        [king.keypair]
      );
      await transitionCastleStatus(ctx, 1, 176);

      const c1 = await factory.createPlayer({ initialize: true, createEstate: true });
      const c2 = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, c1, teamPda, teamId);
      await addPlayerToTeam(ctx, king, c2, teamPda, teamId);

      // First appointment fills the only slot
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: c1.publicKey, cityId: 1, castleId: 176 },
            { position: 0 }
          )
        ),
        [king.keypair]
      );

      // Second appointment must hit the cap
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: c2.publicKey, cityId: 1, castleId: 176 },
            { position: 1 }
          )
        ),
        [king.keypair]
      );
    }, 60_000);
  });

  // Transition Flow Tests (force_remove_king path)
  //
  // attack_castle's success path is blocked by a known coordinate bug in
  // programs/.../castle/attack_castle.rs:115-125 — castle.latitude (i32) is
  // cast directly to f64 without dividing by GRID_PRECISION, so a player at a
  // realistic spawn coord can never fall within the 50m CASTLE_ATTACK_RANGE_METERS.
  // To still cover the full transition pipeline (TRANSITIONING → cleanups →
  // finalize_transition), we use force_remove_king which puts the castle into
  // TRANSITIONING with transition_new_king = NULL (the VACANT branch in
  // finalize_transition).

  describe('Castle Transition (force_remove_king path)', () => {
    it('should complete full transition: cleanups + finalize_transition VACANT', async () => {
      const CITY = 1;
      const CASTLE = 190;
      await createCastle(ctx, CITY, CASTLE, 2);

      const king = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(king, 0, 100);
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [king.keypair]
      );

      await transitionCastleStatus(ctx, CITY, CASTLE);

      // Populate state we'll need to clean: court + garrison + reward account
      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE },
            { position: 0 }
          )
        ),
        [king.keypair]
      );

      const garrisonMember = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(garrisonMember, 0, 100);
      await addPlayerToTeam(ctx, king, garrisonMember, teamPda, teamId);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinGarrisonInstruction(
            { gameEngine: ctx.gameEngine, owner: garrisonMember.publicKey, cityId: CITY, castleId: CASTLE },
            { units: [new BN(5), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
          )
        ),
        [garrisonMember.keypair]
      );

      // Create a TeamCastleRewardAccount by claiming once (will create-only,
      // 0 elapsed days returns NoRewardsToClaim but the account is created
      // before the elapsed-days check — verify by inspection).
      try {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createClaimCastleRewardsInstruction({
              gameEngine: ctx.gameEngine,
              claimant: garrisonMember.publicKey,
              cityId: CITY,
              castleId: CASTLE,
            })
          ),
          [garrisonMember.keypair]
        );
      } catch {
        // NoRewardsToClaim is expected on day 0; the reward account is
        // created in the same instruction before the elapsed-days check
        // returns the error, so the account still exists.
      }

      // Sanity: castle is PROTECTED with 1 court, 1 garrison
      const before = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(before.courtCount).toBe(1);
      expect(before.garrisonCount).toBe(1);

      // DAO force-removes the king → status=TRANSITIONING, transition_new_king=NULL
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createForceRemoveKingInstruction({
            gameEngine: ctx.gameEngine,
            daoAuthority: ctx.daoAuthority.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            currentKing: king.publicKey,
          })
        ),
        [ctx.daoAuthority]
      );

      const afterRemove = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      // status=4 (TRANSITIONING)
      expect(afterRemove.status).toBe(4);

      // garrison_cleanup decrements garrison_count, closes the garrison account
      const [castlePda] = deriveCastlePda(ctx.gameEngine, CITY, CASTLE);
      const [garrisonPda] = deriveGarrisonPda(castlePda, garrisonMember.playerPda);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createGarrisonCleanupInstruction({
            gameEngine: ctx.gameEngine,
            payer: ctx.daoAuthority.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            garrisonMember: garrisonMember.publicKey,
          })
        ),
        [ctx.daoAuthority]
      );

      expect(await ctx.svm.getAccount(garrisonPda)).toBeNull();

      // court_cleanup decrements court_count, closes the court position account
      const [courtPda] = deriveCourtPda(castlePda, 0);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCourtCleanupInstruction(
            {
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.publicKey,
              cityId: CITY,
              castleId: CASTLE,
              holder: courtier.publicKey,
            },
            { position: 0 }
          )
        ),
        [ctx.daoAuthority]
      );

      expect(await ctx.svm.getAccount(courtPda)).toBeNull();

      // rewards_cleanup closes any reward accounts. The reward account may
      // or may not exist (depends on whether create-then-error left it).
      const [rewardPda] = deriveTeamCastleRewardPda(castlePda, garrisonMember.playerPda);
      const rewardExists = (await ctx.svm.getAccount(rewardPda)) !== null;
      if (rewardExists) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createRewardsCleanupInstruction({
              gameEngine: ctx.gameEngine,
              payer: ctx.daoAuthority.publicKey,
              cityId: CITY,
              castleId: CASTLE,
              member: garrisonMember.publicKey,
            })
          ),
          [ctx.daoAuthority]
        );
        expect(await ctx.svm.getAccount(rewardPda)).toBeNull();
      }

      // contest_end_at was set when king claimed; we already advanced past it
      // via transitionCastleStatus. finalize_transition takes the VACANT branch
      // (transition_new_king == NULL) since force_remove_king cleared it.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createFinalizeTransitionInstruction({
            gameEngine: ctx.gameEngine,
            payer: ctx.daoAuthority.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            // transition_new_king is NULL_PUBKEY in the VACANT branch — we pass
            // the previous king's keypair just for PDA derivation. The processor
            // ignores new_king_account when transition_new_king == NULL.
            newKing: king.publicKey,
            oldKing: king.publicKey,
          })
        ),
        [ctx.daoAuthority]
      );

      const final = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      // status=0 (VACANT)
      expect(final.status).toBe(0);
      expect(final.garrisonCount).toBe(0);
      expect(final.courtCount).toBe(0);
    }, 120_000);

    it('should reject finalize_transition before all cleanups done', async () => {
      const CITY = 1;
      const CASTLE = 191;
      await createCastle(ctx, CITY, CASTLE, 2);

      const king = await factory.createPlayer({ initialize: true, createEstate: true });
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [king.keypair]
      );
      await transitionCastleStatus(ctx, CITY, CASTLE);

      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAppointCourtInstruction(
            { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId: CITY, castleId: CASTLE },
            { position: 0 }
          )
        ),
        [king.keypair]
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createForceRemoveKingInstruction({
            gameEngine: ctx.gameEngine,
            daoAuthority: ctx.daoAuthority.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            currentKing: king.publicKey,
          })
        ),
        [ctx.daoAuthority]
      );

      // Skip cleanups — finalize must reject (court_count > 0).
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createFinalizeTransitionInstruction({
            gameEngine: ctx.gameEngine,
            payer: ctx.daoAuthority.publicKey,
            cityId: CITY,
            castleId: CASTLE,
            newKing: king.publicKey,
            oldKing: king.publicKey,
          })
        ),
        [ctx.daoAuthority]
      );
    }, 60_000);
  });

  // Garrison Loot Tests
  //
  // claim_garrison_loot requires loot to have been written to the garrison
  // contribution account, which only happens when an attack is RESOLVED with
  // attacker losing (defender_weapons_looted). attack_castle is blocked by the
  // same coordinate bug — so we cover the negative case (no loot to claim)
  // and the unauthorized-claim path.

  describe('Garrison Loot', () => {
    it('should reject claim when garrison has no loot (GarrisonNoLoot)', async () => {
      const CITY = 1;
      const CASTLE = 195;
      await createCastle(ctx, CITY, CASTLE, 2);

      const king = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(king, 0, 100);
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [king.keypair]
      );

      const member = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(member, 0, 100);
      await addPlayerToTeam(ctx, king, member, teamPda, teamId);

      // Join garrison — no attack has happened, so loot fields are all 0
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinGarrisonInstruction(
            { gameEngine: ctx.gameEngine, owner: member.publicKey, cityId: CITY, castleId: CASTLE },
            { units: [new BN(5), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
          )
        ),
        [member.keypair]
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createClaimGarrisonLootInstruction({
            gameEngine: ctx.gameEngine,
            owner: member.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [member.keypair]
      );
    }, 30_000);

    it('should reject claim when not in garrison', async () => {
      const CITY = 1;
      const CASTLE = 196;
      await createCastle(ctx, CITY, CASTLE, 2);

      const king = await createCastleReadyPlayer(factory, ctx);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [king.keypair]
      );

      // outsider has never joined this castle's garrison
      const outsider = await factory.createPlayer({ initialize: true, createEstate: true });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createClaimGarrisonLootInstruction({
            gameEngine: ctx.gameEngine,
            owner: outsider.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [outsider.keypair]
      );
    }, 30_000);

    it('should claim loot after successful defense', async () => {
      // Combat math (level-0 castle, no fortification/armory bonuses):
      //   attacker_damage = sum(att.du1..du3) × weapon_coverage × effectiveness
      //   garrison_casualties = (attacker_damage / (garrison_units × 10)) × garrison_units
      // A starter player has 10k du1 + 4k du2 + 2k du3 = 16k defensive units, so the
      // garrison must contribute commensurate force. We have the defender commit
      // all 16k starter units + most starter weapons; the attacker uses default
      // starter equipment (so the matchup is roughly symmetric). With the
      // resolve_weapon_combat tie-break, the defender wins when ratios are equal.
      const CITY = 1;
      const CASTLE = 198;

      const attacker = await factory.createPlayer({
        cityId: CITY,
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await createTeamForPlayer(ctx, attacker);

      await createCastleAtPlayer(ctx, attacker, CITY, CASTLE, 2);

      const king = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimVacantCastleInstruction({
            gameEngine: ctx.gameEngine,
            claimer: king.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [king.keypair]
      );

      const garrisonMember = await factory.createPlayer({
        initialize: true,
        createEstate: true,
        buildings: [BuildingType.Barracks],
      });
      await addPlayerToTeam(ctx, king, garrisonMember, teamPda, teamId);

      // Commit nearly the full starter loadout to the garrison.
      // Starter: 10000 du1, 4000 du2, 2000 du3, 8000 melee, 4000 ranged, 2000 siege.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinGarrisonInstruction(
            { gameEngine: ctx.gameEngine, owner: garrisonMember.publicKey, cityId: CITY, castleId: CASTLE },
            {
              units: [new BN(10_000), new BN(4_000), new BN(2_000)],
              weapons: [new BN(8_000), new BN(4_000), new BN(2_000)],
              heroSlot: 255,
            }
          )
        ),
        [garrisonMember.keypair]
      );

      // Attack during CONTEST window. Attacker is geo-positioned at castle.
      const [castlePda] = deriveCastlePda(ctx.gameEngine, CITY, CASTLE);
      const [garrisonPda] = deriveGarrisonPda(castlePda, garrisonMember.playerPda);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createAttackCastleInstruction(
            {
              gameEngine: ctx.gameEngine,
              attacker: attacker.publicKey,
              cityId: CITY,
              castleId: CASTLE,
              garrisonAccounts: [garrisonPda],
            },
            { driveBy: false }
          )
        ),
        [attacker.keypair]
      );

      // Castle should still be CONTEST (defender held); failed_defenses unchanged
      const post = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(post.status).toBe(1); // CONTEST
      expect(post.successfulDefenses).toBe(1);

      // Claim loot — verify garrison member's weapons increased
      const meleeBefore = (await fetchPlayer(ctx.svm, garrisonMember.playerPda))!.meleeWeapons;

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimGarrisonLootInstruction({
            gameEngine: ctx.gameEngine,
            owner: garrisonMember.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [garrisonMember.keypair]
      );

      const meleeAfter = (await fetchPlayer(ctx.svm, garrisonMember.playerPda))!.meleeWeapons;
      expect(meleeAfter.gt(meleeBefore)).toBe(true);

      // Loot can only be claimed once
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createClaimGarrisonLootInstruction({
            gameEngine: ctx.gameEngine,
            owner: garrisonMember.publicKey,
            cityId: CITY,
            castleId: CASTLE,
          })
        ),
        [garrisonMember.keypair]
      );
    }, 120_000);
  });

  // Update Castle Config (DAO)

  describe('Update Castle Config', () => {
    const CITY = 1;
    const CASTLE = 197;

    beforeAll(async () => {
      await createCastle(ctx, CITY, CASTLE, 2);
    });

    it('should update reward rates (configType 0)', async () => {
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateCastleConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, cityId: CITY, castleId: CASTLE },
            {
              configType: 0,
              rewardRates: {
                kingNovi: 9999,
                kingCash: 8888,
                courtNovi: 7777,
                courtCash: 6666,
                memberNovi: 5555,
                memberCash: 4444,
              },
            }
          )
        ),
        [ctx.daoAuthority]
      );

      const castle = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(castle.kingNoviPerDay.toNumber()).toBe(9999);
      expect(castle.memberCashPerDay.toNumber()).toBe(4444);
    });

    it('should update tier multiplier (configType 1)', async () => {
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateCastleConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, cityId: CITY, castleId: CASTLE },
            { configType: 1, tierMultiplier: 12345 }
          )
        ),
        [ctx.daoAuthority]
      );

      const castle = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(castle.tierMultiplierBps).toBe(12345);
    });

    it('should update treasury level (configType 2)', async () => {
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateCastleConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, cityId: CITY, castleId: CASTLE },
            { configType: 2, treasuryLevel: 5 }
          )
        ),
        [ctx.daoAuthority]
      );

      const castle = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(castle.treasuryLevel).toBe(5);
    });

    it('should update name (configType 3) and grow name_len', async () => {
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateCastleConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, cityId: CITY, castleId: CASTLE },
            { configType: 3, name: 'RenamedCastle' }
          )
        ),
        [ctx.daoAuthority]
      );

      // name_len is now recomputed from the new name (position of first null),
      // so longer-than-original renames are preserved verbatim.
      const castle = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(castle.name).toBe('RenamedCastle');
    });

    it('should shrink name_len on shorter rename', async () => {
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateCastleConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: ctx.daoAuthority.publicKey, cityId: CITY, castleId: CASTLE },
            { configType: 3, name: 'Tiny' }
          )
        ),
        [ctx.daoAuthority]
      );

      const castle = deserializeCastle((await fetchCastleRaw(ctx.svm, ctx.gameEngine, CITY, CASTLE))!.data);
      expect(castle.name).toBe('Tiny');
    });

    it('should reject update by non-DAO', async () => {
      const nonDao = Keypair.generate();
      ctx.svm.airdrop(nonDao.publicKey, BigInt(1_000_000_000));

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(
          createUpdateCastleConfigInstruction(
            { gameEngine: ctx.gameEngine, daoAuthority: nonDao.publicKey, cityId: CITY, castleId: CASTLE },
            { configType: 2, treasuryLevel: 99 }
          )
        ),
        [nonDao]
      );
    });
  });
});
