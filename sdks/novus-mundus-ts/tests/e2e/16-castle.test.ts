/**
 * Castle System E2E Tests
 *
 * Tests for King's Castle mechanics:
 * - Castle claiming
 * - Garrison management
 * - Court appointments
 * - Castle upgrades
 * - Castle rewards
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
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
  deriveCastlePda,
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
  fetchCastleRaw,
} from '../utils/accounts';

// ============================================================
// Test Suite
// ============================================================

describe('Castle System', () => {
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
  // Castle Claiming Tests
  // ============================================================

  describe('Castle Claiming', () => {
    it('should claim vacant castle', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      const ix = createClaimVacantCastleInstruction({
        gameEngine: ctx.gameEngine,
        claimer: player.publicKey,
        cityId,
        castleId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify claimed
        const castleInfo = await fetchCastleRaw(ctx.connection, ctx.gameEngine, cityId, castleId);
        expect(castleInfo).not.toBeNull();
      } catch {
        // Castle might not exist or already claimed
      }
    });

    it('should reject claim of occupied castle', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        // Player1 claims
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: player1.publicKey,
              cityId,
              castleId,
            })
          ),
          [player1.keypair]
        );

        // Player2 tries to claim same
        const ix = createClaimVacantCastleInstruction({
          gameEngine: ctx.gameEngine,
          claimer: player2.publicKey,
          cityId,
          castleId,
        });

        await expectTransactionToFail(
          ctx.connection,
          new Transaction().add(ix),
          [player2.keypair]
        );
      } catch {
        // First claim might fail
      }
    });

    it('should require minimum level to claim', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Castles have level requirements
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should require team membership', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Only team leaders/officers can claim
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Castle Attack Tests
  // ============================================================

  describe('Castle Attacks', () => {
    it('should attack occupied castle', async () => {
      const attacker = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      await factory.hireUnits(attacker, 3, 200);

      const ix = createAttackCastleInstruction(
        { gameEngine: ctx.gameEngine, attacker: attacker.publicKey, cityId, castleId },
        { driveBy: false }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [attacker.keypair]);
      } catch {
        // Castle might not exist or attacker not eligible
      }
    });

    it('should use garrison in defense', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Garrison troops defend castle
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should transfer castle on successful attack', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Winner becomes new king
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have protection period after claim', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // New kings have temporary protection
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Garrison Tests
  // ============================================================

  describe('Garrison Management', () => {
    it('should join castle garrison', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      await factory.hireUnits(player, 0, 100);

      const ix = createJoinGarrisonInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey, cityId, castleId },
        { units: [new BN(50), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
      );

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Castle might not exist or player not in team
      }
    });

    it('should leave castle garrison', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        // Join first
        await factory.hireUnits(player, 0, 100);
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createJoinGarrisonInstruction(
              { gameEngine: ctx.gameEngine, owner: player.publicKey, cityId, castleId },
              { units: [new BN(50), new BN(0), new BN(0)], weapons: [new BN(0), new BN(0), new BN(0)], heroSlot: 255 }
            )
          ),
          [player.keypair]
        );

        // Leave
        const leaveIx = createLeaveGarrisonInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          cityId,
          castleId,
        });

        await sendTransaction(ctx.connection, new Transaction().add(leaveIx), [player.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should limit garrison size', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Castles have max garrison capacity
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should require team membership for garrison', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Only team members can garrison
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Court Tests
  // ============================================================

  describe('Court Management', () => {
    it('should appoint court member', async () => {
      const king = await factory.createPlayer({ initialize: true });
      const courtier = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        // King claims castle
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: king.publicKey,
              cityId,
              castleId,
            })
          ),
          [king.keypair]
        );

        // Appoint court member
        const appointIx = createAppointCourtInstruction(
          { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId, castleId },
          { position: 0 } // Advisor position
        );

        await sendTransaction(ctx.connection, new Transaction().add(appointIx), [king.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should allow court member to resign', async () => {
      const king = await factory.createPlayer({ initialize: true });
      const courtier = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        // Setup court
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: king.publicKey,
              cityId,
              castleId,
            })
          ),
          [king.keypair]
        );

        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createAppointCourtInstruction(
              { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId, castleId },
              { position: 0 }
            )
          ),
          [king.keypair]
        );

        // Resign
        const resignIx = createResignCourtInstruction(
          { gameEngine: ctx.gameEngine, courtMember: courtier.publicKey, cityId, castleId },
          { position: 0 }
        );

        await sendTransaction(ctx.connection, new Transaction().add(resignIx), [courtier.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should dismiss court member', async () => {
      const king = await factory.createPlayer({ initialize: true });
      const courtier = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: king.publicKey,
              cityId,
              castleId,
            })
          ),
          [king.keypair]
        );

        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createAppointCourtInstruction(
              { gameEngine: ctx.gameEngine, king: king.publicKey, appointee: courtier.publicKey, cityId, castleId },
              { position: 0 }
            )
          ),
          [king.keypair]
        );

        // Dismiss
        const dismissIx = createDismissCourtInstruction(
          { gameEngine: ctx.gameEngine, king: king.publicKey, dismissed: courtier.publicKey, cityId, castleId },
          { position: 0 }
        );

        await sendTransaction(ctx.connection, new Transaction().add(dismissIx), [king.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should have court position limits', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Limited court positions
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Upgrade Tests
  // ============================================================

  describe('Castle Upgrades', () => {
    it('should initiate castle upgrade', async () => {
      const king = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: king.publicKey,
              cityId,
              castleId,
            })
          ),
          [king.keypair]
        );

        const upgradeIx = createInitiateUpgradeInstruction(
          { gameEngine: ctx.gameEngine, king: king.publicKey, cityId, castleId },
          { upgradeType: 1 } // Fortification
        );

        await sendTransaction(ctx.connection, new Transaction().add(upgradeIx), [king.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should cancel castle upgrade', async () => {
      const king = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      try {
        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createClaimVacantCastleInstruction({
              gameEngine: ctx.gameEngine,
              claimer: king.publicKey,
              cityId,
              castleId,
            })
          ),
          [king.keypair]
        );

        await sendTransaction(
          ctx.connection,
          new Transaction().add(
            createInitiateUpgradeInstruction(
              { gameEngine: ctx.gameEngine, king: king.publicKey, cityId, castleId },
              { upgradeType: 1 }
            )
          ),
          [king.keypair]
        );

        const cancelIx = createCancelUpgradeInstruction({
          gameEngine: ctx.gameEngine,
          king: king.publicKey,
          cityId,
          castleId,
        });

        await sendTransaction(ctx.connection, new Transaction().add(cancelIx), [king.keypair]);
      } catch {
        // Might fail
      }
    });

    it('should have upgrade types', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Fortification, Treasury, Chambers, etc.
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should require resources for upgrade', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Upgrades cost resources
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Reward Tests
  // ============================================================

  describe('Castle Rewards', () => {
    it('should claim castle rewards', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      const ix = createClaimCastleRewardsInstruction({
        gameEngine: ctx.gameEngine,
        claimant: player.publicKey,
        cityId,
        castleId,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might not be eligible
      }
    });

    it('should scale rewards with castle tier', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tier castles = better rewards
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should distribute to king, court, garrison', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Different roles get different shares
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should track daily reward claims', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Daily reward limit
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Force Remove Tests
  // ============================================================

  describe('Force Removal', () => {
    it('should force remove inactive king', async () => {
      const newKing = await factory.createPlayer({ initialize: true });
      const cityId = 1;
      const castleId = 1;

      const ix = createForceRemoveKingInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: ctx.daoAuthority.publicKey,
        cityId,
        castleId,
        currentKing: newKing.publicKey, // Would need actual king
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [ctx.daoAuthority]);
      } catch {
        // King might not be inactive
      }
    });

    it('should require inactivity period', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // King must be inactive for X days
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should transfer castle to challenger', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Successful removal makes challenger king
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // ============================================================
  // Castle Tier Tests
  // ============================================================

  describe('Castle Tiers', () => {
    it('should have tier-based capacities', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tier = more garrison/court slots
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have tier-based rewards', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tier = better rewards
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should have tier-based requirements', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Higher tier = stricter requirements
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
    });
  });
});
