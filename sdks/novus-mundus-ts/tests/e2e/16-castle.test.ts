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
  createForceRemoveKingInstruction,
  createTeamCreateInstruction,
  createTeamInviteInstruction,
  createTeamAcceptInviteInstruction,
  createUpdateCastleStatusInstruction,
  createCompleteUpgradeInstruction,
  createRelieveGarrisonInstruction,
  derivePlayerPda,
  deriveCastlePda,
  deriveGarrisonPda,
  deriveTeamPda,
  BuildingType,
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
  fetchCastleRaw,
} from '../utils/accounts';
import { log } from '../utils/logger';

// ============================================================
// Helpers
// ============================================================

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

  await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
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
  await sendTransaction(ctx.connection, new Transaction().add(inviteIx), [leader.keypair]);

  // Accept
  const acceptIx = createTeamAcceptInviteInstruction({
    owner: member.publicKey,
    gameEngine: ctx.gameEngine,
    team: teamPda,
    teamId,
    slotIndex,
    inviteRefund: leader.publicKey,
  });
  await sendTransaction(ctx.connection, new Transaction().add(acceptIx), [member.keypair]);
}

/** Create castle via DAO */
async function createCastle(
  ctx: TestContext,
  cityId: number,
  castleId: number,
  tier: number = 2,
  minLevel: number = 1
): Promise<void> {
  const ix = createCreateCastleInstruction(
    { daoAuthority: ctx.daoAuthority.publicKey, gameEngine: ctx.gameEngine },
    {
      cityId,
      castleId,
      tier,
      latitude: 400000,
      longitude: -740000,
      minLevel,
      minNetworthMillions: 0,
      minTroopsThousands: 0,
      name: `Castle-${cityId}-${castleId}`,
    }
  );

  await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
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
  const ix = createUpdateCastleStatusInstruction({
    caller: ctx.daoAuthority.publicKey,
    gameEngine: ctx.gameEngine,
    cityId,
    castleId,
  });
  await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
}

// ============================================================
// Test Suite
// ============================================================

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

  // ============================================================
  // Castle Creation Tests (DAO)
  // ============================================================

  describe('Castle Creation', () => {
    it('should create castle via DAO', async () => {
      await createCastle(ctx, 1, 100, 2);

      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 100);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject castle creation by non-DAO', async () => {
      const nonDao = Keypair.generate();
      await ctx.connection.requestAirdrop(nonDao.publicKey, 1_000_000_000);
      await new Promise(r => setTimeout(r, 500));

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
        ctx.connection,
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
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [ctx.daoAuthority]
      );
    });
  });

  // ============================================================
  // Castle Claiming Tests
  // ============================================================

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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, CITY, CASTLE_CLAIM);
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
        ctx.connection,
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
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Garrison Tests
  // ============================================================

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
      await sendTransaction(ctx.connection, new Transaction().add(claimIx), [king.keypair]);
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [member.keypair]);
    }, 30_000);

    it('should leave castle garrison', async () => {
      const member = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await addPlayerToTeam(ctx, king, member, teamPda, teamId);
      await factory.hireUnits(member, 0, 10_000);

      // Join
      await sendTransaction(
        ctx.connection,
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

      await sendTransaction(ctx.connection, new Transaction().add(leaveIx), [member.keypair]);
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
        ctx.connection,
        new Transaction().add(ix),
        [outsider.keypair]
      );
    }, 30_000);
  });

  // ============================================================
  // Court Tests
  // ============================================================

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
      await sendTransaction(ctx.connection, new Transaction().add(claimIx), [king.keypair]);

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

      await sendTransaction(ctx.connection, new Transaction().add(appointIx), [king.keypair]);
    });

    it('should allow court member to resign', async () => {
      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      // Appoint
      await sendTransaction(
        ctx.connection,
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

      await sendTransaction(ctx.connection, new Transaction().add(resignIx), [courtier.keypair]);
    });

    it('should dismiss court member', async () => {
      const courtier = await factory.createPlayer({ initialize: true, createEstate: true });
      await addPlayerToTeam(ctx, king, courtier, teamPda, teamId);

      // Appoint at position 2
      await sendTransaction(
        ctx.connection,
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

      await sendTransaction(ctx.connection, new Transaction().add(dismissIx), [king.keypair]);
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
      await sendTransaction(ctx.connection, new Transaction().add(claimIx), [realKing.keypair]);
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
        ctx.connection,
        new Transaction().add(appointIx),
        [nonKing.keypair]
      );
    }, 30_000);
  });

  // ============================================================
  // Upgrade Tests
  // ============================================================

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
      await sendTransaction(ctx.connection, new Transaction().add(claimIx), [king.keypair]);
    });

    it('should initiate castle upgrade', async () => {
      const upgradeIx = createInitiateUpgradeInstruction(
        { gameEngine: ctx.gameEngine, king: king.publicKey, cityId: CITY, castleId: CASTLE_UPGRADE },
        { upgradeType: 1 } // Fortification
      );

      await sendTransaction(ctx.connection, new Transaction().add(upgradeIx), [king.keypair]);
    });

    it('should cancel castle upgrade', async () => {
      const cancelIx = createCancelUpgradeInstruction({
        gameEngine: ctx.gameEngine,
        king: king.publicKey,
        cityId: CITY,
        castleId: CASTLE_UPGRADE,
      });

      await sendTransaction(ctx.connection, new Transaction().add(cancelIx), [king.keypair]);
    });

    it('should reject upgrade by non-king', async () => {
      const nonKing = await factory.createPlayer({ initialize: true, createEstate: true });
      await createTeamForPlayer(ctx, nonKing);

      const upgradeIx = createInitiateUpgradeInstruction(
        { gameEngine: ctx.gameEngine, king: nonKing.publicKey, cityId: CITY, castleId: CASTLE_UPGRADE },
        { upgradeType: 2 }
      );

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(upgradeIx),
        [nonKing.keypair]
      );
    });
  });

  // ============================================================
  // Castle Attack Tests
  // ============================================================

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
      await sendTransaction(ctx.connection, new Transaction().add(claimIx), [king.keypair]);

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
        ctx.connection,
        new Transaction().add(ix),
        [attacker.keypair]
      );
    }, 30_000);

    it('should reject attack without units', async () => {
      await createCastle(ctx, CITY, 141, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [attacker.keypair]
      );
    }, 30_000);
  });

  // ============================================================
  // Reward Tests
  // ============================================================

  describe('Castle Rewards', () => {
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
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject rewards for non-affiliated player', async () => {
      await createCastle(ctx, 1, 151, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [outsider.keypair]
      );
    }, 30_000);
  });

  // ============================================================
  // Force Remove Tests (Admin)
  // ============================================================

  describe('Force Removal', () => {
    it('should force remove king', async () => {
      await createCastle(ctx, 1, 160, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.connection,
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

      await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);

      // Verify castle is now vacant
      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 160);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject force remove by non-DAO', async () => {
      await createCastle(ctx, 1, 161, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.connection,
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
      await ctx.connection.requestAirdrop(nonDao.publicKey, 1_000_000_000);
      await new Promise(r => setTimeout(r, 500));

      const ix = createForceRemoveKingInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: nonDao.publicKey,
        cityId: 1,
        castleId: 161,
        currentKing: king.publicKey,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [nonDao]
      );
    });
  });

  // ============================================================
  // Complete Upgrade Tests
  // ============================================================

  describe('Complete Upgrade', () => {
    it('should complete upgrade after initiation', async () => {
      // Create castle and claim it
      await createCastle(ctx, 1, 180, 2);
      const king = await createCastleReadyPlayer(factory, ctx);

      await sendTransaction(
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(
          createInitiateUpgradeInstruction(
            { king: king.publicKey, gameEngine: ctx.gameEngine, cityId: 1, castleId: 180 },
            { upgradeType: 1 }
          )
        ),
        [king.keypair]
      );

      // Verify castle has an upgrade in progress
      let castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 180);
      expect(castleInfo).not.toBeNull();

      // Try to complete immediately — should fail (upgrade time not elapsed)
      await expectTransactionToFail(
        ctx.connection,
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
      castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 180);
      expect(castleInfo).not.toBeNull();
    }, 30_000);
  });

  // ============================================================
  // Relieve Garrison Tests
  // ============================================================

  describe('Relieve Garrison', () => {
    it('should allow king to relieve garrison member', async () => {
      // Create castle and claim it
      await createCastle(ctx, 1, 185, 2);
      const king = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(king, 0, 100);

      // Create team for king
      const { teamPda, teamId } = await createTeamForPlayer(ctx, king);

      await sendTransaction(
        ctx.connection,
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
        ctx.connection,
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
      let garrisonAccount = await ctx.connection.getAccountInfo(garrisonPda);
      expect(garrisonAccount).not.toBeNull();

      // King relieves garrison member
      const relieveIx = createRelieveGarrisonInstruction({
        king: king.publicKey,
        gameEngine: ctx.gameEngine,
        cityId: 1,
        castleId: 185,
        garrisonMember: member.publicKey,
      });

      await sendTransaction(ctx.connection, new Transaction().add(relieveIx), [king.keypair]);

      // Verify garrison contribution account is closed
      garrisonAccount = await ctx.connection.getAccountInfo(garrisonPda);
      expect(garrisonAccount).toBeNull();
    }, 60_000);
  });

  // ============================================================
  // Castle Tier Tests
  // ============================================================

  describe('Castle Tiers', () => {
    it('should create outpost (tier 0) with no garrison', async () => {
      await createCastle(ctx, 1, 170, 0); // Outpost
      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 170);
      expect(castleInfo).not.toBeNull();
    });

    it('should create keep (tier 1) with limited court', async () => {
      await createCastle(ctx, 1, 171, 1); // Keep
      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 171);
      expect(castleInfo).not.toBeNull();
    });

    it('should create stronghold (tier 2) with full features', async () => {
      await createCastle(ctx, 1, 172, 2); // Stronghold
      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 172);
      expect(castleInfo).not.toBeNull();
    });

    it('should create fortress (tier 3)', async () => {
      await createCastle(ctx, 1, 173, 3);
      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 173);
      expect(castleInfo).not.toBeNull();
    });

    it('should create citadel (tier 4)', async () => {
      await createCastle(ctx, 1, 174, 4);
      const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, 1, 174);
      expect(castleInfo).not.toBeNull();
    });

    it('should reject garrison join on outpost', async () => {
      // Claim outpost first
      const king = await createCastleReadyPlayer(factory, ctx);
      await sendTransaction(
        ctx.connection,
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
        ctx.connection,
        new Transaction().add(ix),
        [king.keypair]
      );
    });
  });
});
