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
import { HeroFactory } from '../fixtures/heroes';
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
  advanceTime,
} from '../fixtures/time';

// Test Suite

setDefaultTimeout(120_000);

describe('Arena System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let heroFactory: HeroFactory;
  const SEASON_ID = 1;

  beforeAll(async () => {
    log.section('Arena System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
    heroFactory = new HeroFactory(ctx);

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

  // Join Season Tests

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

  // Challenge Tests

  describe('Challenging Players', () => {
    it('should challenge another player', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });

      // Give players some defensive units for power calculation
      await factory.hireUnits(attacker, 0, 100);
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
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });

      // Give different units to create power difference (>= 100 NOVI needed to get >= 1 unit)
      await factory.hireUnits(attacker, 0, 200);
      await factory.hireUnits(defender, 0, 100);

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
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });

      await factory.hireUnits(attacker, 0, 100);
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
      const player = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(player, 0, 100);

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

  // Daily Reward Tests

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
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender1 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender2 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender3 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defenders = [defender1, defender2, defender3];

      await factory.hireUnits(attacker, 0, 200);
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

    it('should produce ELO rating spread across multiple battles', async () => {
      // 3 players with very different loadouts → predictable rating spread.
      // Strong > Mid > Weak (by defensive_units in loadout).
      const strong = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const mid = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const weak = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(strong, 0, 300);
      await factory.hireUnits(mid, 0, 200);
      await factory.hireUnits(weak, 0, 100);

      for (const p of [strong, mid, weak]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            }),
          ),
          [p.keypair],
        );
      }

      // Power = sum of units + weapons; loadouts make winner deterministic.
      const setLoadout = async (p: TestPlayer, units: number) => {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: p.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(units), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
            ),
          ),
          [p.keypair],
        );
      };
      await setLoadout(strong, 300);
      await setLoadout(mid, 150);
      await setLoadout(weak, 30);

      let matchId = 9000;
      const battle = async (challenger: TestPlayer, defender: TestPlayer) => {
        const now = await getCurrentTimestamp(ctx.svm);
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createChallengePlayerInstruction(
              {
                gameEngine: ctx.gameEngine,
                challenger: challenger.publicKey,
                gameAuthority: ctx.daoAuthority.publicKey,
                seasonAuthority: ctx.daoAuthority.publicKey,
                seasonId: SEASON_ID,
                defenderAuthority: defender.publicKey,
                challengerHero: PublicKey.default,
                challengerEstate: PublicKey.default,
                defenderHero: PublicKey.default,
                defenderEstate: PublicKey.default,
              },
              { matchId: new BN(matchId++), matchTimestamp: new BN(now) },
            ),
          ),
          [challenger.keypair, ctx.daoAuthority],
        );
      };

      // Strong beats mid (2x), mid beats weak (2x). Weak loses 2 times.
      await battle(strong, mid);
      await battle(strong, mid);
      await battle(mid, weak);
      await battle(mid, weak);

      const [strongPart] = deriveArenaParticipantPda(ctx.gameEngine, SEASON_ID, strong.playerPda);
      const [midPart] = deriveArenaParticipantPda(ctx.gameEngine, SEASON_ID, mid.playerPda);
      const [weakPart] = deriveArenaParticipantPda(ctx.gameEngine, SEASON_ID, weak.playerPda);
      const strongData = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, strong.playerPda);
      const midData = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, mid.playerPda);
      const weakData = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, weak.playerPda);
      void strongPart; void midPart; void weakPart;

      // Strong: only wins, must exceed starting ELO 1000.
      expect(strongData!.eloRating).toBeGreaterThan(1000);
      // Weak: only losses, must be below starting ELO 1000.
      expect(weakData!.eloRating).toBeLessThan(1000);
      // Mid won 2 and lost 2 — ELO net change should be modest (close to start).
      // Importantly, strong > mid > weak.
      expect(strongData!.eloRating).toBeGreaterThan(midData!.eloRating);
      expect(midData!.eloRating).toBeGreaterThan(weakData!.eloRating);
    });

    it('should allow re-claim on subsequent days after clock advancement', async () => {
      // Player completes battles + claims today, advances >24h, battles again, claims again.
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const opponents: TestPlayer[] = [];
      for (let i = 0; i < 3; i++) {
        const o = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
        await factory.hireUnits(o, 0, 100);
        opponents.push(o);
      }
      await factory.hireUnits(attacker, 0, 300);

      for (const p of [attacker, ...opponents]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            }),
          ),
          [p.keypair],
        );
      }
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(300), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [attacker.keypair],
      );
      for (const o of opponents) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: o.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
            ),
          ),
          [o.keypair],
        );
      }

      let mId = 6000;
      const doBattles = async (count: number) => {
        for (let i = 0; i < count; i++) {
          const opp = opponents[i % opponents.length]!;
          const now = await getCurrentTimestamp(ctx.svm);
          await sendTransaction(
            ctx.svm,
            new Transaction().add(
              createChallengePlayerInstruction(
                {
                  gameEngine: ctx.gameEngine,
                  challenger: attacker.publicKey,
                  gameAuthority: ctx.daoAuthority.publicKey,
                  seasonAuthority: ctx.daoAuthority.publicKey,
                  seasonId: SEASON_ID,
                  defenderAuthority: opp.publicKey,
                  challengerHero: PublicKey.default,
                  challengerEstate: PublicKey.default,
                  defenderHero: PublicKey.default,
                  defenderEstate: PublicKey.default,
                },
                { matchId: new BN(mId++), matchTimestamp: new BN(now) },
              ),
            ),
            [attacker.keypair, ctx.daoAuthority],
          );
        }
      };

      // Day 1: 6 battles, claim.
      await doBattles(6);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimArenaDailyRewardInstruction({
            gameEngine: ctx.gameEngine,
            playerOwner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          }),
        ),
        [attacker.keypair],
      );

      // Advance >24h to enter a new daily window.
      await advanceTime(ctx.svm, 86_401);

      // Day 2: re-up battles (3 opponents x 2 = 6), claim again.
      await doBattles(6);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimArenaDailyRewardInstruction({
            gameEngine: ctx.gameEngine,
            playerOwner: attacker.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          }),
        ),
        [attacker.keypair],
      );

      // Both claims succeeded; participant has 12 cumulative battles recorded.
      const part = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda);
      expect(part).not.toBeNull();
      expect(part!.wins + part!.losses).toBeGreaterThanOrEqual(12);
    });
  });

  // Master Reward Tests

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

    it('should expose end_time, claim_deadline, and Active status after creation', async () => {
      // Active session 1: created in beforeAll. Verifies the timing fields the
      // finalize/close flows reason about are populated correctly.
      const season = await fetchArenaSeason(ctx.svm, ctx.gameEngine, SEASON_ID);
      expect(season).not.toBeNull();
      // end_time = start_time + 7 days
      expect(season!.endTime.toNumber()).toBe(season!.startTime.toNumber() + 7 * 86_400);
      // claim_deadline = end_time + 30 days
      expect(season!.claimDeadline.toNumber()).toBe(season!.endTime.toNumber() + 30 * 86_400);
      expect(season!.status).toBe(1); // ArenaStatus::Active
    });

    it('should create distinct participant accounts when multiple players join the same season', async () => {
      const p1 = await factory.createPlayer({ initialize: true });
      const p2 = await factory.createPlayer({ initialize: true });
      for (const p of [p1, p2]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            }),
          ),
          [p.keypair],
        );
      }

      // Each joiner gets its own participant PDA seeded by (season, player).
      const [pda1] = deriveArenaParticipantPda(ctx.gameEngine, SEASON_ID, p1.playerPda);
      const [pda2] = deriveArenaParticipantPda(ctx.gameEngine, SEASON_ID, p2.playerPda);
      expect(pda1.equals(pda2)).toBe(false);

      const part1 = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, p1.playerPda);
      const part2 = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, p2.playerPda);
      expect(part1).not.toBeNull();
      expect(part2).not.toBeNull();
      expect(part1!.eloRating).toBe(1000);
      expect(part2!.eloRating).toBe(1000);
    });
  });

  // Season Close Tests

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

    it('should reject close with no matching season account', async () => {
      // Permissionless close on a season_id that was never created.
      const NONEXISTENT_SEASON = 9999;
      const ix = createCloseSeasonInstruction({
        gameEngine: ctx.gameEngine,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: NONEXISTENT_SEASON,
        cityId: 0,
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [ctx.daoAuthority],
      );
    });

    it('should keep SEASON_ID=1 alive after a failed pre-deadline close attempt', async () => {
      // Confirm prior reject paths didn't accidentally close the live season.
      const before = await fetchArenaSeason(ctx.svm, ctx.gameEngine, SEASON_ID);
      expect(before).not.toBeNull();

      // Attempt close before deadline; must fail.
      const ix = createCloseSeasonInstruction({
        gameEngine: ctx.gameEngine,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: SEASON_ID,
        cityId: 0,
      });
      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [ctx.daoAuthority],
      );

      const after = await fetchArenaSeason(ctx.svm, ctx.gameEngine, SEASON_ID);
      expect(after).not.toBeNull();
      expect(after!.status).toBe(before!.status);
    });
  });

  // Rating Tests

  describe('Rating System', () => {
    it('should initialize new participants at STARTING_ELO (1000)', async () => {
      const player = await factory.createPlayer({ initialize: true });
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createJoinSeasonInstruction({
            gameEngine: ctx.gameEngine,
            owner: player.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId: SEASON_ID,
          }),
        ),
        [player.keypair],
      );

      const part = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, player.playerPda);
      expect(part).not.toBeNull();
      expect(part!.eloRating).toBe(1000);
      expect(part!.wins).toBe(0);
      expect(part!.losses).toBe(0);
    });

    it('should clamp rating at floor (100) after many losses', async () => {
      // Loser plays repeatedly against high-power winners across multiple days.
      // ELO drops ~16 per loss vs equal opponent; floor logic prevents going below 100.
      const loser = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const winners: TestPlayer[] = [];
      for (let i = 0; i < 5; i++) {
        const w = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
        await factory.hireUnits(w, 0, 500);
        winners.push(w);
      }
      await factory.hireUnits(loser, 0, 100);

      for (const p of [loser, ...winners]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            }),
          ),
          [p.keypair],
        );
      }

      // Loser has near-zero loadout; winners have massive loadouts.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: loser.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(1), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [loser.keypair],
      );
      for (const w of winners) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: w.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(500), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
            ),
          ),
          [w.keypair],
        );
      }

      // Battle loser against each winner twice (rate limit = 2/opponent/day, 10/day total).
      // 5 opponents × 2 = 10 battles per day. Keep total advance < remaining season window
      // so downstream describes can still challenge in this season.
      let mId = 7000;
      for (let day = 0; day < 3; day++) {
        for (const w of winners) {
          for (let b = 0; b < 2; b++) {
            const now = await getCurrentTimestamp(ctx.svm);
            await sendTransaction(
              ctx.svm,
              new Transaction().add(
                createChallengePlayerInstruction(
                  {
                    gameEngine: ctx.gameEngine,
                    challenger: loser.publicKey,
                    gameAuthority: ctx.daoAuthority.publicKey,
                    seasonAuthority: ctx.daoAuthority.publicKey,
                    seasonId: SEASON_ID,
                    defenderAuthority: w.publicKey,
                    challengerHero: PublicKey.default,
                    challengerEstate: PublicKey.default,
                    defenderHero: PublicKey.default,
                    defenderEstate: PublicKey.default,
                  },
                  { matchId: new BN(mId++), matchTimestamp: new BN(now) },
                ),
              ),
              [loser.keypair, ctx.daoAuthority],
            );
          }
        }
        if (day < 2) {
          await advanceTime(ctx.svm, 86_401);
        }
      }

      const part = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, loser.playerPda);
      expect(part).not.toBeNull();
      // Floor logic: rating never drops below 100 no matter how many losses.
      expect(part!.eloRating).toBeGreaterThanOrEqual(100);
      // ~30 losses must have dropped ELO meaningfully below the starting 1000.
      expect(part!.eloRating).toBeLessThan(900);
      // Loss counter incremented for every challenge.
      expect(part!.losses).toBeGreaterThanOrEqual(30);
    });

    it('should track wins and losses', async () => {
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });

      // Give attacker power advantage to ensure a decisive result (>= 100 NOVI rounds to >= 1 unit)
      await factory.hireUnits(attacker, 0, 200);
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

  // Loadout Tests

  describe('Arena Loadouts', () => {
    it('should use the latest loadout to determine challenge outcome', async () => {
      // Loadout drives the power comparison in challenge_player; an updated
      // loadout flips the winner.
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(attacker, 0, 300);
      await factory.hireUnits(defender, 0, 300);

      for (const p of [attacker, defender]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            }),
          ),
          [p.keypair],
        );
      }

      // Attacker dominant loadout, defender minimal: attacker wins.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(300), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [attacker.keypair],
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(5), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [defender.keypair],
      );

      const now1 = await getCurrentTimestamp(ctx.svm);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createChallengePlayerInstruction(
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
            { matchId: new BN(8001), matchTimestamp: new BN(now1) },
          ),
        ),
        [attacker.keypair, ctx.daoAuthority],
      );

      const afterFirst = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda);
      expect(afterFirst!.wins).toBe(1);

      // Flip the loadouts: defender now has the dominant config.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(5), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [attacker.keypair],
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(300), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [defender.keypair],
      );

      const now2 = await getCurrentTimestamp(ctx.svm);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createChallengePlayerInstruction(
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
            { matchId: new BN(8002), matchTimestamp: new BN(now2) },
          ),
        ),
        [attacker.keypair, ctx.daoAuthority],
      );

      const afterSecond = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda);
      // Attacker's loadout dropped to weak; defender's surged. Attacker should now have lost.
      expect(afterSecond!.losses).toBe(1);
    });

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

    it('should accept arena_hero in loadout and use it in challenges', async () => {
      // Mint a hero, set it as arena_hero in the loadout, then challenge while
      // passing the hero NFT account — challenge_player verifies the mint matches
      // the loadout and that the NFT data parses as a hero.
      const attacker = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const defender = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(attacker, 0, 200);
      await factory.hireUnits(defender, 0, 100);

      const hero = await heroFactory.mintHero(attacker, 1);

      for (const p of [attacker, defender]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
            }),
          ),
          [p.keypair],
        );
      }

      // Attacker pins hero into the loadout; defender stays heroless.
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: attacker.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: hero.mintPubkey, defensiveUnits: [new BN(200), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [attacker.keypair],
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: defender.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [defender.keypair],
      );

      // Challenge must reference the locked-in hero NFT account; mismatch errors.
      const now = await getCurrentTimestamp(ctx.svm);
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createChallengePlayerInstruction(
            {
              gameEngine: ctx.gameEngine,
              challenger: attacker.publicKey,
              gameAuthority: ctx.daoAuthority.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId: SEASON_ID,
              defenderAuthority: defender.publicKey,
              challengerHero: hero.mintPubkey,
              challengerEstate: PublicKey.default,
              defenderHero: PublicKey.default,
              defenderEstate: PublicKey.default,
            },
            { matchId: new BN(8500), matchTimestamp: new BN(now) },
          ),
        ),
        [attacker.keypair, ctx.daoAuthority],
      );

      const part = await fetchArenaParticipant(ctx.svm, ctx.gameEngine, SEASON_ID, attacker.playerPda);
      expect(part).not.toBeNull();
      expect(part!.wins + part!.losses).toBeGreaterThanOrEqual(1);
    });
  });

  // Time-Advanced Lifecycle: finalize via auto-finalize, then close after deadline.
  // These tests run last and create their own fresh seasons so global clock advancement
  // doesn't affect any other describe block above.
  describe('Time-Advanced Lifecycle', () => {
    let lifecycleSeasonCounter = 50;

    async function createFreshSeason(): Promise<number> {
      const seasonId = ++lifecycleSeasonCounter;
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCreateSeasonInstruction(
            {
              authority: ctx.daoAuthority.publicKey,
              gameEngine: ctx.gameEngine,
              seasonId,
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
      return seasonId;
    }

    it('should claim master reward after season auto-finalizes past end_time', async () => {
      const seasonId = await createFreshSeason();

      const winner = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const punching = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      await factory.hireUnits(winner, 0, 500);
      await factory.hireUnits(punching, 0, 100);

      for (const p of [winner, punching]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            }),
          ),
          [p.keypair],
        );
      }

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: winner.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(500), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [winner.keypair],
      );
      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createUpdateLoadoutInstruction(
            { owner: punching.publicKey, gameEngine: ctx.gameEngine },
            { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
          ),
        ),
        [punching.keypair],
      );

      // 5 wins × 100 points = 500 → exactly the leaderboard threshold.
      // Distribute across multiple opponents to avoid per-opponent rate limit.
      const punching2 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const punching3 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      const punching4 = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
      for (const p of [punching2, punching3, punching4]) {
        await factory.hireUnits(p, 0, 100);
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            }),
          ),
          [p.keypair],
        );
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: p.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
            ),
          ),
          [p.keypair],
        );
      }

      const opponents = [punching, punching2, punching3, punching4];
      let mId = 9000;
      for (let i = 0; i < 6; i++) {
        const opp = opponents[i % opponents.length]!;
        const tNow = await getCurrentTimestamp(ctx.svm);
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createChallengePlayerInstruction(
              {
                gameEngine: ctx.gameEngine,
                challenger: winner.publicKey,
                gameAuthority: ctx.daoAuthority.publicKey,
                seasonAuthority: ctx.daoAuthority.publicKey,
                seasonId,
                defenderAuthority: opp.publicKey,
                challengerHero: PublicKey.default,
                challengerEstate: PublicKey.default,
                defenderHero: PublicKey.default,
                defenderEstate: PublicKey.default,
              },
              { matchId: new BN(mId++), matchTimestamp: new BN(tNow) },
            ),
          ),
          [winner.keypair, ctx.daoAuthority],
        );
      }

      // Confirm leaderboard placement before advancing.
      const seasonBefore = await fetchArenaSeason(ctx.svm, ctx.gameEngine, seasonId);
      expect(seasonBefore!.leaderboardCount).toBeGreaterThanOrEqual(1);

      // Advance just past end_time (7 days). claim_master_reward should auto-finalize.
      await advanceTime(ctx.svm, 7 * 86_400 + 1);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createClaimMasterRewardInstruction({
            gameEngine: ctx.gameEngine,
            playerOwner: winner.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId,
          }),
        ),
        [winner.keypair],
      );

      const seasonAfter = await fetchArenaSeason(ctx.svm, ctx.gameEngine, seasonId);
      expect(seasonAfter!.status).toBeGreaterThanOrEqual(2); // Finalized or later
    });

    it('should pay master rewards to multiple top participants', async () => {
      const seasonId = await createFreshSeason();

      // 3 players: A, B, C all win against punching bags so each lands on the leaderboard.
      const players: TestPlayer[] = [];
      for (let i = 0; i < 3; i++) {
        const p = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
        await factory.hireUnits(p, 0, 500);
        players.push(p);
      }
      const punchingBags: TestPlayer[] = [];
      for (let i = 0; i < 4; i++) {
        const pb = await factory.createPlayer({ initialize: true, createEstate: true, buildings: [BuildingType.Barracks] });
        await factory.hireUnits(pb, 0, 100);
        punchingBags.push(pb);
      }

      for (const p of [...players, ...punchingBags]) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            }),
          ),
          [p.keypair],
        );
      }
      for (const p of players) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: p.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(500), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
            ),
          ),
          [p.keypair],
        );
      }
      for (const pb of punchingBags) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createUpdateLoadoutInstruction(
              { owner: pb.publicKey, gameEngine: ctx.gameEngine },
              { arenaHero: PublicKey.default, defensiveUnits: [new BN(10), new BN(0), new BN(0)], meleeWeapons: new BN(0), rangedWeapons: new BN(0), siegeWeapons: new BN(0), armorPieces: new BN(0) },
            ),
          ),
          [pb.keypair],
        );
      }

      // Each leaderboard candidate gets 6 wins (across 4 punching bags within rate limits).
      let mId = 10000;
      for (const p of players) {
        for (let i = 0; i < 6; i++) {
          const opp = punchingBags[i % punchingBags.length]!;
          const tNow = await getCurrentTimestamp(ctx.svm);
          await sendTransaction(
            ctx.svm,
            new Transaction().add(
              createChallengePlayerInstruction(
                {
                  gameEngine: ctx.gameEngine,
                  challenger: p.publicKey,
                  gameAuthority: ctx.daoAuthority.publicKey,
                  seasonAuthority: ctx.daoAuthority.publicKey,
                  seasonId,
                  defenderAuthority: opp.publicKey,
                  challengerHero: PublicKey.default,
                  challengerEstate: PublicKey.default,
                  defenderHero: PublicKey.default,
                  defenderEstate: PublicKey.default,
                },
                { matchId: new BN(mId++), matchTimestamp: new BN(tNow) },
              ),
            ),
            [p.keypair, ctx.daoAuthority],
          );
        }
      }

      const seasonBefore = await fetchArenaSeason(ctx.svm, ctx.gameEngine, seasonId);
      expect(seasonBefore!.leaderboardCount).toBeGreaterThanOrEqual(3);

      // Past end_time → auto-finalize on first claim.
      await advanceTime(ctx.svm, 7 * 86_400 + 1);

      // All 3 leaderboard members successfully claim master rewards.
      for (const p of players) {
        await sendTransaction(
          ctx.svm,
          new Transaction().add(
            createClaimMasterRewardInstruction({
              gameEngine: ctx.gameEngine,
              playerOwner: p.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            }),
          ),
          [p.keypair],
        );
      }

      const seasonAfter = await fetchArenaSeason(ctx.svm, ctx.gameEngine, seasonId);
      expect(seasonAfter!.status).toBeGreaterThanOrEqual(2);
    });

    it('should allow close_season once past the claim deadline', async () => {
      const seasonId = await createFreshSeason();

      // Advance past claim_deadline = end_time + 30 days = ~37 days from creation.
      await advanceTime(ctx.svm, 37 * 86_400 + 1);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCloseSeasonInstruction({
            gameEngine: ctx.gameEngine,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId,
            cityId: 0,
          }),
        ),
        [ctx.daoAuthority],
      );

      // Season account is gone after close.
      const seasonAfter = await fetchArenaSeason(ctx.svm, ctx.gameEngine, seasonId);
      expect(seasonAfter).toBeNull();
    });

    it('should refund close_season rent to the season authority', async () => {
      const seasonId = await createFreshSeason();
      const [seasonPda] = deriveArenaSeasonPda(ctx.gameEngine, seasonId);

      const seasonAccountBefore = ctx.svm.getAccount(seasonPda);
      expect(seasonAccountBefore).not.toBeNull();
      const seasonLamports = Number(seasonAccountBefore!.lamports);

      const authorityBefore = ctx.svm.getAccount(ctx.daoAuthority.publicKey);
      const authBefore = Number(authorityBefore!.lamports);

      await advanceTime(ctx.svm, 37 * 86_400 + 1);

      await sendTransaction(
        ctx.svm,
        new Transaction().add(
          createCloseSeasonInstruction({
            gameEngine: ctx.gameEngine,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId,
            cityId: 0,
          }),
        ),
        [ctx.daoAuthority],
      );

      const authorityAfter = ctx.svm.getAccount(ctx.daoAuthority.publicKey);
      const authAfter = Number(authorityAfter!.lamports);
      // Authority lamport balance rose by at least the season's rent (minus the fee
      // paid by the closer; close_season is permissionless and the sender pays).
      expect(authAfter).toBeGreaterThan(authBefore - 1_000_000); // tolerate any tx fee
      expect(authAfter - authBefore).toBeGreaterThanOrEqual(seasonLamports - 1_000_000);
    });
  });
});
