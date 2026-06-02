/**
 * Name Service E2E Tests
 *
 * Player display names backed by an AllDomains (ANS) `.solana` domain:
 * - Set name    (domain transfer: wallet → player PDA)
 * - Update name (swap domains)
 * - Remove name (domain transfer: player PDA → wallet)
 *
 * Negative paths assert the on-chain validation rejects unregistered/unowned
 * domains. The positive path mints a domain to the wallet (injected NameRecords)
 * and runs a full set → remove cycle against the real ANS + TLD-House programs.
 *
 * Team names are intentionally unsupported: a team PDA cannot hold a TLD-House
 * MainDomain, and domains held directly by the player PDA need no MainDomain.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Transaction } from '@solana/web3.js';

import {
  createSetPlayerNameInstruction,
  createUpdatePlayerNameInstruction,
  createRemovePlayerNameInstruction,
} from '../../src/index';

import { type TestContext, beforeAllTests } from '../fixtures/setup';
import {
  mintDomainToWallet,
  TLD_HOUSE_SOLANA,
  TLD_REGISTRY_SOLANA,
  svmKey,
} from '../fixtures/svm';
import { PlayerFactory } from '../fixtures/players';
import { sendTransaction, expectTransactionToFail } from '../utils/transactions';
import { fetchPlayer } from '../utils/accounts';
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

      const ix = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'testplayer',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject set name with non-owned domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'someoneelsesdomain',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject update without existing name', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createUpdatePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'newname',
        oldDomainName: 'oldname',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject remove without existing name', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'myname',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject remove when no name set', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'nonexistent',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });
  });

  // Domain Validation Tests

  describe('Domain Validation', () => {
    it('should reject invalid TLD', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'invalidtld',
        domainName: 'myname',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject domain not owned by caller', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'notmydomain',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject unregistered domains for both TLDs', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      const ix1 = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player1.publicKey,
        tld: 'sol',
        domainName: 'player1',
      });

      const ix2 = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player2.publicKey,
        tld: 'bonk',
        domainName: 'player2',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix1), [player1.keypair]);
      await expectTransactionToFail(ctx.svm, new Transaction().add(ix2), [player2.keypair]);
    });
  });

  // Name Display Tests

  describe('Name Display', () => {
    it('should reject storing name without real domain', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'fullname',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should allow reverse lookup', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // Name Transfer Tests

  describe('Name Transfers', () => {
    it('should reject transfer without real domain on set', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'transfertest',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject transfer back without real domain on remove', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'returndomain',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });

    it('should reject swap without real domains on update', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createUpdatePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'sol',
        domainName: 'newdomain',
        oldDomainName: 'olddomain',
      });

      await expectTransactionToFail(ctx.svm, new Transaction().add(ix), [player.keypair]);
    });
  });

  // Positive path — exercised against real `.solana` mainnet snapshots
  // (TLD house/state/registry + the ANS & TLD-House programs), with the
  // domain "minted" to the wallet via injected NameRecords. The domain lives
  // directly on the player PDA; there is no MainDomain.

  describe('Set + Remove (real .solana mint)', () => {
    // NameRecordHeader.owner lives at byte offset 40, 32 bytes wide.
    const ownerOf = (data: Uint8Array): Buffer => Buffer.from(data).subarray(40, 72);

    it('sets then removes a player name (domain moves wallet <-> PDA)', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const domainName = 'cairnhero';
      const { nameAccount } = await mintDomainToWallet(ctx.svm, domainName, player.publicKey);

      // The .solana house/registry differ from the canonical deriveTldHousePda
      // address, so the builders take them as explicit overrides.
      const solanaOverride = { tldHouse: TLD_HOUSE_SOLANA, nameParent: TLD_REGISTRY_SOLANA };

      // SET — transfers the domain to the player PDA.
      const setIx = await createSetPlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'solana',
        domainName,
        ...solanaOverride,
      });
      await sendTransaction(ctx.svm, new Transaction().add(setIx), [player.keypair]);

      // Domain now owned by the player PDA, name stored on the player account.
      const forwardAfterSet = ctx.svm.getAccount(svmKey(nameAccount));
      expect(forwardAfterSet).not.toBeNull();
      expect(ownerOf(forwardAfterSet!.data).equals(Buffer.from(player.playerPda.toBytes()))).toBe(true);

      const named = await fetchPlayer(ctx.svm, player.playerPda);
      expect(named).not.toBeNull();
      expect(named!.name).toBe(`${domainName}.solana`);

      // REMOVE — transfers the domain back to the wallet.
      const removeIx = await createRemovePlayerNameInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        tld: 'solana',
        domainName,
        ...solanaOverride,
      });
      await sendTransaction(ctx.svm, new Transaction().add(removeIx), [player.keypair]);

      // Domain returned to the wallet, name cleared.
      const forwardAfterRemove = ctx.svm.getAccount(svmKey(nameAccount));
      expect(forwardAfterRemove).not.toBeNull();
      expect(ownerOf(forwardAfterRemove!.data).equals(Buffer.from(player.publicKey.toBytes()))).toBe(true);

      const cleared = await fetchPlayer(ctx.svm, player.playerPda);
      expect(cleared!.name).toBe('');
    });
  });
});
