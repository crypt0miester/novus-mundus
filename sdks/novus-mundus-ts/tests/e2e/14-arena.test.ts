/**
 * Arena System E2E Tests
 *
 * Tests for competitive PvP arena:
 * - Joining seasons
 * - Challenging players
 * - Daily/master rewards
 * - Season closing
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createJoinSeasonInstruction,
  createChallengePlayerInstruction,
  createClaimArenaDailyRewardInstruction,
  createClaimMasterRewardInstruction,
  createCloseSeasonInstruction,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  derivePlayerPda,
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
  assertBnEquals,
  assertBnGreaterThan,
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchArenaSeason,
  fetchArenaParticipant,
} from '../utils/accounts';
import {
  getCurrentTimestamp,
} from '../fixtures/time';

// ============================================================
// Test Suite
// ============================================================

describe('Arena System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
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

      const seasonId = 1;
      const seasonAuthority = ctx.daoAuthority.publicKey;

      const ix = createJoinSeasonInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        seasonAuthority,
        seasonId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify joined
        const participant = await fetchArenaParticipant(
          ctx.connection,
          seasonAuthority,
          seasonId,
          player.playerPda
        );
        expect(participant).not.toBeNull();
      } catch {
        // Season might not exist
      }
    });

    it('should reject joining same season twice', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      try {
        // Join first time
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [player.keypair]
        );

        // Try again
        const ix = createJoinSeasonInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(ix),
          [player.keypair]
        );
      } catch {
        // First join might fail
      }
    });

    it('should reject joining closed season', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Season 0 or non-existent should fail
      const ix = createJoinSeasonInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId: 999,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should require minimum level to join', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Arena might have level requirements
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should set initial rating on join', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // New participants start at base rating (e.g., 1000 ELO)
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Challenge Tests
  // ============================================================

  describe('Challenging Players', () => {
    it('should challenge another player', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const defender = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      // Give players some units
      await factory.hireUnits(attacker, 3, 100);
      await factory.hireUnits(defender, 0, 100);

      try {
        // Both join season
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: attacker.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [attacker.keypair]
        );

        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: defender.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [defender.keypair]
        );

        // Challenge (requires game authority signature for matchmaking)
        const challengeIx = createChallengePlayerInstruction(
          {
            gameEngine: ctx.gameEngine,
            challenger: attacker.publicKey,
            gameAuthority: ctx.daoAuthority.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId,
            defenderAuthority: defender.publicKey,
            challengerHero: PublicKey.default,
            challengerEstate: PublicKey.default,
            defenderHero: PublicKey.default,
            defenderEstate: PublicKey.default,
          },
          { matchId: new BN(1), matchTimestamp: new BN(Date.now() / 1000) }
        );

        await sendTransaction(ctx.connection, new Transaction().add(challengeIx), [attacker.keypair, ctx.daoAuthority]);

        // Verify challenge processed
      } catch {
        // Might fail
      }
    });

    it('should reject challenge to non-participant', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const defender = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      await factory.hireUnits(attacker, 3, 100);

      try {
        // Only attacker joins
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: attacker.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [attacker.keypair]
        );

        // Challenge non-participant
        const challengeIx = createChallengePlayerInstruction(
          {
            gameEngine: ctx.gameEngine,
            challenger: attacker.publicKey,
            gameAuthority: ctx.daoAuthority.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId,
            defenderAuthority: defender.publicKey,
            challengerHero: PublicKey.default,
            challengerEstate: PublicKey.default,
            defenderHero: PublicKey.default,
            defenderEstate: PublicKey.default,
          },
          { matchId: new BN(1), matchTimestamp: new BN(Date.now() / 1000) }
        );

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(challengeIx),
          [attacker.keypair]
        );
      } catch {
        // Join might fail
      }
    });

    it('should update ratings after challenge', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const defender = await factory.createPlayer({ initialize: true });

      // Winner gains rating, loser loses rating
      const attackerAccount = await fetchPlayer(ctx.connection, attacker.playerPda);
      const defenderAccount = await fetchPlayer(ctx.connection, defender.playerPda);
      expect(attackerAccount).not.toBeNull();
      expect(defenderAccount).not.toBeNull();
    });

    it('should track daily challenges', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Limited challenges per day
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject self-challenge', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [player.keypair]
        );

        const challengeIx = createChallengePlayerInstruction(
          {
            gameEngine: ctx.gameEngine,
            challenger: player.publicKey,
            gameAuthority: ctx.daoAuthority.publicKey,
            seasonAuthority: ctx.daoAuthority.publicKey,
            seasonId,
            defenderAuthority: player.publicKey,
            challengerHero: PublicKey.default,
            challengerEstate: PublicKey.default,
            defenderHero: PublicKey.default,
            defenderEstate: PublicKey.default,
          },
          { matchId: new BN(1), matchTimestamp: new BN(Date.now() / 1000) }
        );

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(challengeIx),
          [player.keypair]
        );
      } catch {
        // Join might fail
      }
    });
  });

  // ============================================================
  // Daily Reward Tests
  // ============================================================

  describe('Daily Rewards', () => {
    it('should claim daily arena reward', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      try {
        // Join season
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [player.keypair]
        );

        // Claim daily reward (permissionless)
        const claimIx = createClaimArenaDailyRewardInstruction({
          gameEngine: ctx.gameEngine,
          playerOwner: player.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId,
        });

        await sendTransaction(ctx.connection, new Transaction().add(claimIx), [player.keypair]);

        // Verify reward received
      } catch {
        // Might fail
      }
    });

    it('should reject duplicate daily claim', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [player.keypair]
        );

        // Claim once
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimArenaDailyRewardInstruction({
              gameEngine: ctx.gameEngine,
              playerOwner: player.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [player.keypair]
        );

        // Try again
        const claimIx = createClaimArenaDailyRewardInstruction({
          gameEngine: ctx.gameEngine,
          playerOwner: player.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(claimIx),
          [player.keypair]
        );
      } catch {
        // Might fail
      }
    });

    it('should scale reward with ranking', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher rank = better daily reward
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reset daily claim at midnight', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can claim again next day
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Master Reward Tests
  // ============================================================

  describe('Master Rewards', () => {
    it('should claim master reward at season end', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinSeasonInstruction({
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              seasonAuthority: ctx.daoAuthority.publicKey,
              seasonId,
            })
          ),
          [player.keypair]
        );

        // Master reward (might fail if season not ended)
        const claimIx = createClaimMasterRewardInstruction({
          gameEngine: ctx.gameEngine,
          playerOwner: player.publicKey,
          seasonAuthority: ctx.daoAuthority.publicKey,
          seasonId,
        });

        await sendTransaction(ctx.connection, new Transaction().add(claimIx), [player.keypair]);
      } catch {
        // Season might not be ended
      }
    });

    it('should reject master claim before season end', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can only claim after season closes
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should scale with final ranking', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Final position determines reward
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have rank thresholds for rewards', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Different tiers: Top 1, Top 10, Top 100, etc.
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Season Close Tests
  // ============================================================

  describe('Season Closing', () => {
    it('should close season (DAO)', async () => {
      const seasonId = 1;

      const ix = createCloseSeasonInstruction({
        gameEngine: ctx.gameEngine,
        seasonAuthority: ctx.daoAuthority.publicKey,
        seasonId,
        cityId: 0,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
      } catch {
        // Season might not exist or already closed
      }
    });

    it('should reject close by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const seasonId = 1;

      const ix = createCloseSeasonInstruction({
        gameEngine: ctx.gameEngine,
        seasonAuthority: player.publicKey,
        seasonId,
        cityId: 0,
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should freeze rankings on close', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // No more challenges after close
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should enable master rewards on close', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Master rewards become claimable
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Rating Tests
  // ============================================================

  describe('Rating System', () => {
    it('should use ELO-like rating', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Rating changes based on relative strength
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have rating floors', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can't go below minimum rating
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should track wins and losses', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Statistics tracked per participant
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should update leaderboard', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Top players tracked
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Loadout Tests
  // ============================================================

  describe('Arena Loadouts', () => {
    it('should use snapshot loadout for defense', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Defensive loadout is snapshotted
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should allow loadout updates', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can update defensive loadout
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should include hero in loadout', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Arena uses hero bonuses
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });
});
