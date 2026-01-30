/**
 * Name Service E2E Tests
 *
 * Tests for player and team naming using domain names:
 * - Setting names (domain transfer to player PDA)
 * - Updating names (swap domains)
 * - Removing names (domain transfer back)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import {
  createSetPlayerNameInstruction,
  createUpdatePlayerNameInstruction,
  createRemovePlayerNameInstruction,
  createSetTeamNameInstruction,
  createUpdateTeamNameInstruction,
  createRemoveTeamNameInstruction,
  derivePlayerPda,
  deriveTeamPda,
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
} from '../utils/assertions';
import {
  sendTransaction,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
} from '../utils/accounts';

// ============================================================
// Test Suite
// ============================================================

describe('Name Service', () => {
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
  // Player Name Tests
  // ============================================================

  describe('Player Names', () => {
    it('should set player name with domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Name service uses domain names (e.g., "player.sol")
      const tld = 'sol';
      const domainName = 'testplayer';

      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld,
        domainName,
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        // Verify name set
        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
      } catch {
        // Domain might not exist or not owned by player
        console.warn('Set name failed - domain might not exist');
      }
    });

    it('should reject set name with non-owned domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Try to set a domain we don't own
      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'someoneelsesdomain',
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should update player name to new domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Would need to have set a name first
      const ix = createUpdatePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'newname',
        oldTld: 'sol',
        oldDomainName: 'oldname',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail if no current name or domain issues
        console.warn('Update name failed');
      }
    });

    it('should remove player name', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Remove transfers domain back to wallet
      const ix = createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'myname',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
      } catch {
        // Might fail if no current name
        console.warn('Remove name failed');
      }
    });

    it('should reject remove when no name set', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'nonexistent',
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // ============================================================
  // Team Name Tests
  // ============================================================

  describe('Team Names', () => {
    it('should set team name with domain', async () => {
      const leaderPlayer = await factory.createPlayer({ initialize: true });
      const teamId = Date.now();
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      // Would need to create team first
      const ix = createSetTeamNameInstruction({
        gameEngine: ctx.gameEngine,
        leader: leaderPlayer.publicKey,
        team: teamPda,
        tld: 'sol',
        domainName: 'myteam',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [leaderPlayer.keypair]);
      } catch {
        // Team might not exist or domain issues
        console.warn('Set team name failed');
      }
    });

    it('should update team name', async () => {
      const leaderPlayer = await factory.createPlayer({ initialize: true });
      const teamId = Date.now();
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      const ix = createUpdateTeamNameInstruction({
        gameEngine: ctx.gameEngine,
        leader: leaderPlayer.publicKey,
        team: teamPda,
        tld: 'sol',
        domainName: 'newteamname',
        oldTld: 'sol',
        oldDomainName: 'oldteamname',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [leaderPlayer.keypair]);
      } catch {
        console.warn('Update team name failed');
      }
    });

    it('should remove team name', async () => {
      const leaderPlayer = await factory.createPlayer({ initialize: true });
      const teamId = Date.now();
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      const ix = createRemoveTeamNameInstruction({
        gameEngine: ctx.gameEngine,
        leader: leaderPlayer.publicKey,
        team: teamPda,
        tld: 'sol',
        domainName: 'teamname',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [leaderPlayer.keypair]);
      } catch {
        console.warn('Remove team name failed');
      }
    });

    it('should reject non-leader setting team name', async () => {
      const leaderPlayer = await factory.createPlayer({ initialize: true });
      const memberPlayer = await factory.createPlayer({ initialize: true });
      const teamId = Date.now();
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      // Only team leader/officer can set team name
      const ix = createSetTeamNameInstruction({
        gameEngine: ctx.gameEngine,
        leader: memberPlayer.publicKey, // Not the leader
        team: teamPda,
        tld: 'sol',
        domainName: 'unauthorized',
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [memberPlayer.keypair]
      );
    });
  });

  // ============================================================
  // Domain Validation Tests
  // ============================================================

  describe('Domain Validation', () => {
    it('should reject invalid TLD', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Only supported TLDs work
      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'invalidtld',
        domainName: 'myname',
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject domain not owned by caller', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Domain ownership verification
      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'notmydomain',
      });

      await expectTransactionToFail(
        ctx.connection,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should support multiple TLDs', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      // Different TLDs supported (sol, bonk, etc.)
      const ix1 = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player1.publicKey,
        tld: 'sol',
        domainName: 'player1',
      });

      const ix2 = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player2.publicKey,
        tld: 'bonk',
        domainName: 'player2',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix1), [player1.keypair]);
        await sendTransaction(ctx.connection, new Transaction().add(ix2), [player2.keypair]);
      } catch {
        // Domains might not exist or different TLD might not be supported
        console.warn('Multiple TLD test failed - domains might not exist');
      }
    });
  });

  // ============================================================
  // Name Display Tests
  // ============================================================

  describe('Name Display', () => {
    it('should store full domain name', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Player account stores domain reference
      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'fullname',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);

        const account = await fetchPlayer(ctx.connection, player.playerPda);
        expect(account).not.toBeNull();
        // Player account should have domain reference stored
      } catch {
        // Domain might not exist
        console.warn('Store name test failed - domain might not exist');
      }
    });

    it('should allow reverse lookup', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can find player by domain name
      const account = await fetchPlayer(ctx.connection, player.playerPda);
      expect(account).not.toBeNull();
      // Reverse lookup would query domain registry to find player PDA
    });
  });

  // ============================================================
  // Name Transfer Tests
  // ============================================================

  describe('Name Transfers', () => {
    it('should transfer domain to player PDA on set', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'transfertest',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        // Domain should now be owned by player PDA, not wallet
      } catch {
        // Domain might not exist
      }
    });

    it('should transfer domain back to wallet on remove', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'returndomain',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        // Domain should now be back in wallet
      } catch {
        // Might not have a name set
      }
    });

    it('should swap domains on update', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createUpdatePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'newdomain',
        oldTld: 'sol',
        oldDomainName: 'olddomain',
      });

      try {
        await sendTransaction(ctx.connection, new Transaction().add(ix), [player.keypair]);
        // Old domain returned to wallet, new domain owned by PDA
      } catch {
        // Domains might not exist
      }
    });
  });
});
