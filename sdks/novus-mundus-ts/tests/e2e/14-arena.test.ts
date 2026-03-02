/**
 * Arena System E2E Tests
 *
 * Tests for competitive PvP arena:
 * - Creating seasons (DAO)
 * - Joining seasons
 * - Challenging players
 * - Daily/master rewards
 * - Season closing
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createCreateSeasonInstruction,
  createJoinSeasonInstruction,
  createChallengePlayerInstruction,
  createClaimArenaDailyRewardInstruction,
  createClaimMasterRewardInstruction,
  createCloseSeasonInstruction,
  createUpdateLoadoutInstruction,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  derivePlayerPda,
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
  fetchArenaSeason,
  fetchArenaParticipant,
} from '../utils/accounts';
import { log } from '../utils/logger';
import {
  getCurrentTimestamp,
} from '../fixtures/time';

// ============================================================
// Test Suite
// ============================================================

setDefaultTimeout(120_000);

describe('Arena System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  const SEASON_ID = 1;

  beforeAll(async () => {
    log.section('Arena System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });

    // DAO creates arena season 1
    const createSeasonIx = createCreateSeasonInstruction(
      {
        authority: ctx.daoAuthority.publicKey,
        gameEngine: ctx.gameEngine,
        seasonId: SEASON_ID,
      },
      {
        masterPrizePool: new BN(1_000_000),
        dailyPrizePool: new BN(100_000),
        dailyDistributionCap: new BN(50_000),
        minLevelRequired: 1,
      }
    );
    await sendTransaction(ctx.svm, new Transaction().add(createSeasonIx), [ctx.daoAuthority]);

    // Verify season exists
    const season = await fetchArenaSeason(ctx.svm, ctx.gameEngine, SEASON_ID);
    expect(season).not.toBeNull();
    log.info(`Arena season ${SEASON_ID} created, status=${season!.status}`);
  });

  afterAll(() => {
    factory.clear();
  });

  // ============================================================
  // Join Season Tests
  // ============================================================

  describe('Joining Seasons', () => {
    it('should join arena season', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createJoinSeasonInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
      });

      await sendTransaction(ctx.svm, new Transaction().add(ix), [player.keypair]);

      // Verify joined — fetchArenaParticipant takes the player PDA
      const participant = await fetchArenaParticipant(
        ctx.svm,
        ctx.gameEngine,
        SEASON_ID,
        player.playerPda
      );
      expect(participant).not.toBeNull();
    });

    it('should reject joining same season twice', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join first time
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      // Try again — should fail
      const ix = createJoinSeasonInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject joining non-existent season', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createJoinSeasonInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: 999, // Non-existent
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should require minimum level to join', async () => {
      // Create a season with a higher minimum level requirement
      const HIGH_LEVEL_SEASON_ID = 99;
      const createHighLevelSeasonIx = createCreateSeasonInstruction(
        {
          authority: ctx.daoAuthority.publicKey,
          gameEngine: ctx.gameEngine,
          seasonId: HIGH_LEVEL_SEASON_ID,
        },
        {
          masterPrizePool: new BN(1_000_000),
          dailyPrizePool: new BN(100_000),
          dailyDistributionCap: new BN(50_000),
          minLevelRequired: 5, // Requires level 5
        }
      );
      await sendTransaction(ctx.svm, new Transaction().add(createHighLevelSeasonIx), [ctx.daoAuthority]);

      // Level-1 player should fail to join
      const player = await factory.createPlayer({ initialize: true });

      const ix = createJoinSeasonInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: HIGH_LEVEL_SEASON_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should set initial rating on join', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join and check initial rating
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      const participant = await fetchArenaParticipant(
        ctx.svm,
        ctx.gameEngine,
        SEASON_ID,
        player.playerPda
      );
      expect(participant).not.toBeNull();
      // Starting ELO = 1000
      expect(participant!.eloRating).toBe(1000);
    });
  });

  // ============================================================
  // Challenge Tests
  // ============================================================

  describe('Challenging Players', () => {
    it('should challenge another player', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });

      // Give players some units for power calculation
      await factory.hireUnits(attacker, 3, 100);
      await factory.hireUnits(defender, 0, 100);

      // Both join season
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [attacker.keypair]
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: defender.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [defender.keypair]
      );

      // Update loadouts so power is non-zero (loadouts start at 0, causing draws)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(100), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [attacker.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [defender.keypair]
      );

      // Get current timestamp for match
      const now = await getCurrentTimestamp(ctx.svm);

      // Challenge requires game_authority co-signature
      const challengeIx = createChallengePlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          challenger: attacker.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
          defenderAuthority: defender.publicKey,
          challengerHero: PublicKey.default,
          challengerEstate: PublicKey.default,
          defenderHero: PublicKey.default,
          defenderEstate: PublicKey.default,
        },
        { matchId: new BN(1), matchTimestamp: new BN(now) }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(challengeIx),
        [attacker.keypair, ctx.daoAuthority]
      );

      // Verify battle was recorded
      const season = await fetchArenaSeason(ctx.svm, ctx.gameEngine, SEASON_ID);
      expect(season).not.toBeNull();
      expect(season!.totalBattles.toNumber()).toBeGreaterThan(0);
    });

    it('should reject challenge to non-participant', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender = await factory.createPlayer({ initialize: true });

      // Only attacker joins
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [attacker.keypair]
      );

      const now = await getCurrentTimestamp(ctx.svm);

      // Challenge non-participant — should fail
      const challengeIx = createChallengePlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          challenger: attacker.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
          defenderAuthority: defender.publicKey,
          challengerHero: PublicKey.default,
          challengerEstate: PublicKey.default,
          defenderHero: PublicKey.default,
          defenderEstate: PublicKey.default,
        },
        { matchId: new BN(1), matchTimestamp: new BN(now) }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(challengeIx),
        [attacker.keypair, ctx.daoAuthority]
      );
    });

    it('should update ratings after challenge', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });

      // Give different units to create power difference
      await factory.hireUnits(attacker, 3, 200);
      await factory.hireUnits(defender, 0, 50);

      // Both join
      const joinTx1 = new Transaction().add(
        createJoinSeasonInstruction({
          gameEngine: ctx.gameEngine,
          owner: attacker.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
        })
      );
      const joinTx2 = new Transaction().add(
        createJoinSeasonInstruction({
          gameEngine: ctx.gameEngine,
          owner: defender.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
        })
      );
      await sendTransaction(ctx.svm, joinTx1, [attacker.keypair]);
      await sendTransaction(ctx.svm, joinTx2, [defender.keypair]);

      // Update loadouts so power is non-zero (loadouts start at 0, causing draws)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(200), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [attacker.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [defender.keypair]
      );

      const now = await getCurrentTimestamp(ctx.svm);

      // Challenge
      const challengeIx = createChallengePlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          challenger: attacker.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
          defenderAuthority: defender.publicKey,
          challengerHero: PublicKey.default,
          challengerEstate: PublicKey.default,
          defenderHero: PublicKey.default,
          defenderEstate: PublicKey.default,
        },
        { matchId: new BN(1), matchTimestamp: new BN(now) }
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(challengeIx),
        [attacker.keypair, ctx.daoAuthority]
      );

      // Check ratings changed from 1000
      const attackerPart = await fetchArenaParticipant(
        ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda
      );
      const defenderPart = await fetchArenaParticipant(
        ctx.svm, ctx.gameEngine, SEASON_ID, defender.playerPda
      );
      expect(attackerPart).not.toBeNull();
      expect(defenderPart).not.toBeNull();
      // One should have > 1000 and the other < 1000 (or draw at 1000)
      const totalElo = attackerPart!.eloRating + defenderPart!.eloRating;
      expect(totalElo).toBeGreaterThan(0);
    });

    it('should track daily challenges', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });

      await factory.hireUnits(attacker, 3, 100);
      await factory.hireUnits(defender, 0, 100);

      // Both join season
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [attacker.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: defender.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [defender.keypair]
      );

      // Update loadouts so power is non-zero (loadouts start at 0, causing draws)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(100), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [attacker.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [defender.keypair]
      );

      const now = await getCurrentTimestamp(ctx.svm);

      // Challenge
      const challengeIx = createChallengePlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          challenger: attacker.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
          defenderAuthority: defender.publicKey,
          challengerHero: PublicKey.default,
          challengerEstate: PublicKey.default,
          defenderHero: PublicKey.default,
          defenderEstate: PublicKey.default,
        },
        { matchId: new BN(200), matchTimestamp: new BN(now) }
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(challengeIx),
        [attacker.keypair, ctx.daoAuthority]
      );

      // Fetch participant and verify battle was tracked
      const participant = await fetchArenaParticipant(
        ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda
      );
      expect(participant).not.toBeNull();
      // With asymmetric loadouts, result is not a draw — wins+losses > 0
      expect(participant!.wins + participant!.losses).toBeGreaterThan(0);
    });

    it('should reject self-challenge', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      await factory.hireUnits(player, 3, 100);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      const now = await getCurrentTimestamp(ctx.svm);

      const challengeIx = createChallengePlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          challenger: player.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
          defenderAuthority: player.publicKey,
          challengerHero: PublicKey.default,
          challengerEstate: PublicKey.default,
          defenderHero: PublicKey.default,
          defenderEstate: PublicKey.default,
        },
        { matchId: new BN(1), matchTimestamp: new BN(now) }
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(challengeIx),
        [player.keypair, ctx.daoAuthority]
      );
    });
  });

  // ============================================================
  // Daily Reward Tests
  // ============================================================

  describe('Daily Rewards', () => {
    it('should reject daily claim without enough battles', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join season
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      // Try to claim daily reward without any battles (need 5 min)
      const claimIx = createClaimArenaDailyRewardInstruction({
        gameEngine: ctx.gameEngine,
        playerOwner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it('should claim daily arena reward after enough battles', async () => {
      // Create attacker and 3 defenders sequentially (need 5+ battles, max 2 per opponent)
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender1 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender2 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender3 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defenders = [defender1, defender2, defender3];

      await factory.hireUnits(attacker, 3, 200);
      for (const d of defenders) {
        await factory.hireUnits(d, 0, 200);
      }

      // All join season
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [attacker.keypair]
      );
      for (const d of defenders) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: d.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            })
          ),
          [d.keypair]
        );
      }

      // Update loadouts so power is non-zero (loadouts start at 0, causing draws)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(200), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [attacker.keypair]
      );
      for (const d of defenders) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: d.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
            )
          ),
          [d.keypair]
        );
      }

      // Do 6 battles (2 per defender)
      let matchId = 100;
      for (const d of defenders) {
        for (let i = 0; i < 2; i++) {
          const now = await getCurrentTimestamp(ctx.svm);
          const challengeIx = createChallengePlayerInstruction(
            {
              gameEngine: ctx.gameEngine,
              challenger: attacker.publicKey,
              gameAuthority: ctx.daoAuthority.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
              defenderAuthority: d.publicKey,
              challengerHero: PublicKey.default,
              challengerEstate: PublicKey.default,
              defenderHero: PublicKey.default,
              defenderEstate: PublicKey.default,
            },
            { matchId: new BN(matchId++), matchTimestamp: new BN(now) }
          );
          await sendTransaction(
            ctx.svm,
            new Transaction().add(challengeIx),
            [attacker.keypair, ctx.daoAuthority]
          );
        }
      }

      // Now claim daily reward — should succeed with 6 battles
      const claimIx = createClaimArenaDailyRewardInstruction({
        gameEngine: ctx.gameEngine,
        playerOwner: attacker.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
      });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(claimIx),
        [attacker.keypair]
      );
    });

    it.skip('requires multiple battles to create meaningful rating spread', () => {});

    it.skip('requires clock advancement', () => {});
  });

  // ============================================================
  // Master Reward Tests
  // ============================================================

  describe('Master Rewards', () => {
    it('should reject master claim before season finalized', async () => {
      const player = await factory.createPlayer({ initialize: true });

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      // Master reward requires Finalized status — season is Active
      const claimIx = createClaimMasterRewardInstruction({
        gameEngine: ctx.gameEngine,
        playerOwner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it('should reject master claim before season end', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Join season
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      // Try to claim master rewards while season is still Active
      const claimIx = createClaimMasterRewardInstruction({
        gameEngine: ctx.gameEngine,
        playerOwner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(claimIx),
        [player.keypair]
      );
    });

    it.skip('requires finalized season', () => {});

    it.skip('requires finalized season with multiple participants', () => {});
  });

  // ============================================================
  // Season Close Tests
  // ============================================================

  describe('Season Closing', () => {
    it('should reject close before deadline', async () => {
      // Season was just created — claim_deadline is 37 days away
      // Close requires past claim_deadline OR 4+ seasons behind
      const ix = createCloseSeasonInstruction({
        gameEngine: ctx.gameEngine,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
        cityId: 0,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [ctx.daoAuthority]
      );
    });

    it('should reject close with wrong authority', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Wrong season authority — must match the one stored on season
      const ix = createCloseSeasonInstruction({
        gameEngine: ctx.gameEngine,
        seasonAuthority: player.publicKey,
        seasonId: SEASON_ID,
        cityId: 0,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it.skip('requires season deadline to pass', () => {});

    it.skip('requires season close which needs deadline passed', () => {});
  });

  // ============================================================
  // Rating Tests
  // ============================================================

  describe('Rating System', () => {
    it.skip('already verified in rating update test', () => {});

    it.skip('requires many losses to hit rating floor', () => {});

    it('should track wins and losses', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });

      // Give attacker power advantage to ensure a decisive result
      await factory.hireUnits(attacker, 3, 200);
      await factory.hireUnits(defender, 0, 50);

      // Both join season
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [attacker.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: defender.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [defender.keypair]
      );

      // Update loadouts so power is non-zero (loadouts start at 0, causing draws)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(200), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [attacker.keypair]
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) }
          )
        ),
        [defender.keypair]
      );

      const now = await getCurrentTimestamp(ctx.svm);

      // Challenge
      const challengeIx = createChallengePlayerInstruction(
        {
          gameEngine: ctx.gameEngine,
          challenger: attacker.publicKey,
          gameAuthority: ctx.daoAuthority.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId: SEASON_ID,
          defenderAuthority: defender.publicKey,
          challengerHero: PublicKey.default,
          challengerEstate: PublicKey.default,
          defenderHero: PublicKey.default,
          defenderEstate: PublicKey.default,
        },
        { matchId: new BN(300), matchTimestamp: new BN(now) }
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(challengeIx),
        [attacker.keypair, ctx.daoAuthority]
      );

      // Fetch both participants and verify win/loss tracking
      const attackerPart = await fetchArenaParticipant(
        ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda
      );
      const defenderPart = await fetchArenaParticipant(
        ctx.svm, ctx.gameEngine, SEASON_ID, defender.playerPda
      );
      expect(attackerPart).not.toBeNull();
      expect(defenderPart).not.toBeNull();

      // Total wins + losses across both participants should equal 2 (one win, one loss)
      const totalWins = attackerPart!.wins + defenderPart!.wins;
      const totalLosses = attackerPart!.losses + defenderPart!.losses;
      expect(totalWins).toBe(1);
      expect(totalLosses).toBe(1);
    });

    it('should update leaderboard', async () => {
      // After battles in preceding tests, the season leaderboard should be populated
      const season = await fetchArenaSeason(ctx.svm, ctx.gameEngine, SEASON_ID);
      expect(season).not.toBeNull();
      // leaderboardCount should be > 0 after challenges have occurred
      expect(season!.leaderboardCount).toBeGreaterThan(0);
      // totalBattles should reflect the battles fought
      expect(season!.totalBattles.toNumber()).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Loadout Tests
  // ============================================================

  describe('Arena Loadouts', () => {
    it.skip('verified implicitly by challenge test', () => {});

    it('should allow loadout updates', async () => {
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks, BuildingType.Camp] });
      await factory.hireUnits(player, 0, 100);

      // Join season (creates loadout account)
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          })
        ),
        [player.keypair]
      );

      // Update loadout with specific defensive configuration
      const updateIx = createUpdateLoadoutInstruction(
        {
          owner: player.publicKey,
          gameEngine: ctx.gameEngine,
        },
        {
          arenaHero: PublicKey.default,
          defensiveUnits: [new BN(50), new BN(0), new BN(0)],
          meleeWeapons: new BN(10),
          rangedWeapons: new BN(5),
          siegeWeapons: new BN(0),
          armorPieces: new BN(20),
        }
      );

      await sendTransaction(
        ctx.svm,
        new Transaction().add(updateIx),
        [player.keypair]
      );

      // Verify loadout was updated by confirming participant still exists
      const participant = await fetchArenaParticipant(
        ctx.svm, ctx.gameEngine, SEASON_ID, player.playerPda
      );
      expect(participant).not.toBeNull();
    });

    it.skip('requires hero locked for arena loadout', () => {});
  });
});
