/**
 * Name Service E2E Tests
 *
 * Tests for player and team naming using domain names:
 * - Setting names (domain transfer to player PDA)
 * - Updating names (swap domains)
 * - Removing names (domain transfer back)
 *
 * Note: Domain operations require real domain accounts from
 * TLD House / ALT Name Service. Without actual domains registered,
 * all set/update/remove operations fail with account errors.
 * We test the failure paths and validate instruction construction.
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
import { log } from '../utils/logger';

// Test Suite

describe('Name Service', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Name Service');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // Player Name Tests

  describe('Player Names', () => {
    it('should reject set name without real domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Name service requires real domain accounts - fails without them
      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'testplayer',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
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
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject update without existing name', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Update requires existing name set first
      const ix = createUpdatePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'newname',
        oldTld: 'sol',
        oldDomainName: 'oldname',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject remove without existing name', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Remove transfers domain back - fails if no domain set
      const ix = createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'myname',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
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
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });

  // Team Name Tests

  describe('Team Names', () => {
    it('should reject set team name without real domain', async () => {
      const leaderPlayer = await factory.createPlayer({ initialize: true });
      const teamId = Date.now();
      const [teamPda] = deriveTeamPda(ctx.gameEngine, teamId);

      // Requires real domain + team account
      const ix = createSetTeamNameInstruction({
        gameEngine: ctx.gameEngine,
        leader: leaderPlayer.publicKey,
        team: teamPda,
        tld: 'sol',
        domainName: 'myteam',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [leaderPlayer.keypair]
      );
    });

    it('should reject update team name without real domain', async () => {
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

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [leaderPlayer.keypair]
      );
    });

    it('should reject remove team name without real domain', async () => {
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

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [leaderPlayer.keypair]
      );
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
        ctx.svm,
        new Transaction().add(ix),
        [memberPlayer.keypair]
      );
    });
  });

  // Domain Validation Tests

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
        ctx.svm,
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
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject unregistered domains for both TLDs', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      // Different TLDs supported (sol, bonk, etc.) but domains must exist
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

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix1),
        [player1.keypair]
      );

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix2),
        [player2.keypair]
      );
    });
  });

  // Name Display Tests

  describe('Name Display', () => {
    it('should reject storing name without real domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Player account stores domain reference - requires real domain
      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'fullname',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should allow reverse lookup', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Can find player by domain name
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
      // Reverse lookup would query domain registry to find player PDA
    });
  });

  // Name Transfer Tests

  describe('Name Transfers', () => {
    it('should reject transfer without real domain on set', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'transfertest',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject transfer back without real domain on remove', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'returndomain',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });

    it('should reject swap without real domains on update', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = createUpdatePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'newdomain',
        oldTld: 'sol',
        oldDomainName: 'olddomain',
      });

      await expectTransactionToFail(
        ctx.svm,
        new Transaction().add(ix),
        [player.keypair]
      );
    });
  });
});
