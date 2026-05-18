/**
 * Research System E2E Tests
 *
 * Tests for the tech tree and research mechanics:
 * - Starting research (requires Academy building)
 * - Completing research (speedup + complete)
 * - Cancelling research
 * - Speedup with gems
 * - Prerequisites and invalid types
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);

import BN from 'bn.js';

import {
  createStartResearchInstruction,
  createCompleteResearchInstruction,
  createCancelResearchInstruction,
  createSpeedUpResearchInstruction,
  deriveResearchPda,
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
} from '../utils/accounts';
import { log } from '../utils/logger';

// Test Suite

describe('Research System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    log.section('Research System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  afterAll(() => {
    factory.clear();
  });

  // Helper: create a research-ready player with estate + Academy
  async function createResearchPlayer(): Promise<TestPlayer> {
    return factory.createPlayer({
      initialize: true,
      createEstate: true,
      buildings: [BuildingType.Academy],
    });
  }

  // Starting Research Tests

  describe('Starting Research', () => {
    it('should start battle research with Academy', async () => {
      log.step('Creating player with estate + Academy');
      const player = await createResearchPlayer();

      log.step('Starting research type 0 (Battle category)');
      const ix = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });

      await sendTransaction(ctx.svm, [ix], [player.keypair]);
      log.txSuccess('research started');

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject starting research while already researching', async () => {
      log.step('Starting first research then attempting second');
      const player = await createResearchPlayer();

      // Start first research
      const ix1 = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });
      await sendTransaction(ctx.svm, [ix1], [player.keypair]);

      // Try to start second - should fail (already researching)
      const ix2 = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 1,
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix2],
        [player.keypair]
      );
      log.txExpectedFail('concurrent research rejected');
    });

    it('should reject research without prerequisites', async () => {
      log.step('Attempting high-level research without prereqs');
      const player = await createResearchPlayer();

      // Try advanced research without prereqs
      const ix = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 100, // High-level research requiring prereqs
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
      log.txExpectedFail('prerequisite-missing research rejected');
    });

    it('should reject invalid research type', async () => {
      log.step('Attempting research with invalid type 31');
      const player = await createResearchPlayer();

      const ix = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 31, // Invalid type (Rust rejects >= 30)
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
      log.txExpectedFail('invalid research type rejected');
    });

    it('should reject research without estate/Academy', async () => {
      log.step('Attempting research without estate');
      const player = await factory.createPlayer({ initialize: true });

      const ix = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
      log.txExpectedFail('research without estate rejected');
    });
  });

  // Completing Research Tests

  describe('Completing Research', () => {
    it('should complete research after speedup', async () => {
      log.step('Starting research, speeding up, then completing');
      const player = await createResearchPlayer();

      // Start research
      const startIx = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });
      await sendTransaction(ctx.svm, [startIx], [player.keypair]);

      // Speedup to completion (0 = complete all remaining)
      // First buy enough gems
      await factory.buyGems(player, 20);
      const speedupIx = createSpeedUpResearchInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey, researchType: 0 },
        { speedUpSeconds: new BN(0) } // 0 = complete all remaining time
      );
      await sendTransaction(ctx.svm, [speedupIx], [player.keypair]);

      // Complete
      const completeIx = createCompleteResearchInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        researchType: 0,
      });
      await sendTransaction(ctx.svm, [completeIx], [player.keypair]);
      log.txSuccess('research completed after speedup');
    });

    it('should reject completing before duration elapsed', async () => {
      log.step('Starting research then immediately trying to complete');
      const player = await createResearchPlayer();

      // Start research
      const startIx = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });
      await sendTransaction(ctx.svm, [startIx], [player.keypair]);

      // Immediate complete should fail
      const completeIx = createCompleteResearchInstruction({
        gameEngine: ctx.gameEngine,
        payer: player.publicKey,
        playerOwner: player.publicKey,
        researchType: 0,
      });

      await expectTransactionToFail(
        ctx.svm,
        [completeIx],
        [player.keypair]
      );
      log.txExpectedFail('early completion rejected');
    });
  });

  // Cancel Research Tests

  describe('Canceling Research', () => {
    it('should cancel ongoing research', async () => {
      log.step('Starting then cancelling research');
      const player = await createResearchPlayer();

      // Start research
      const startIx = createStartResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });
      await sendTransaction(ctx.svm, [startIx], [player.keypair]);

      // Cancel
      const cancelIx = createCancelResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });
      await sendTransaction(ctx.svm, [cancelIx], [player.keypair]);
      log.txSuccess('research cancelled');
    });

    it('should reject cancel when not researching', async () => {
      log.step('Attempting cancel with no active research');
      const player = await createResearchPlayer();

      const cancelIx = createCancelResearchInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        researchType: 0,
      });

      await expectTransactionToFail(
        ctx.svm,
        [cancelIx],
        [player.keypair]
      );
      log.txExpectedFail('cancel without active research rejected');
    });

    it('should allow starting new research after cancel', async () => {
      log.step('Start → cancel → start new research');
      const player = await createResearchPlayer();

      // Start first research
      await sendTransaction(
        ctx.svm,
        [createStartResearchInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );

      // Cancel
      await sendTransaction(
        ctx.svm,
        [createCancelResearchInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );

      // Start same research again (should succeed since cancelled resets state)
      await sendTransaction(
        ctx.svm,
        [createStartResearchInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );
      log.txSuccess('new research started after cancel');
    });
  });

  // Speedup Tests

  describe('Research Speedup', () => {
    it('should speedup research with gems', async () => {
      log.step('Starting research and applying speedup');
      const player = await createResearchPlayer();

      // Start research
      await sendTransaction(
        ctx.svm,
        [createStartResearchInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );

      // Speedup (partial)
      const speedupIx = createSpeedUpResearchInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey, researchType: 0 },
        { speedUpSeconds: new BN(60) }
      );
      await sendTransaction(ctx.svm, [speedupIx], [player.keypair]);
      log.txSuccess('research sped up by 60 seconds');
    });

    it('should reject speedup when not researching', async () => {
      log.step('Attempting speedup with no active research');
      const player = await createResearchPlayer();

      const speedupIx = createSpeedUpResearchInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey, researchType: 0 },
        { speedUpSeconds: new BN(3600) }
      );

      await expectTransactionToFail(
        ctx.svm,
        [speedupIx],
        [player.keypair]
      );
      log.txExpectedFail('speedup without active research rejected');
    });
  });

  // Full Research Cycle Test

  describe('Full Research Cycle', () => {
    it('should complete full start → speedup → complete → start next cycle', async () => {
      log.step('Full research cycle');
      const player = await createResearchPlayer();
      await factory.buyGems(player, 20);

      // 1. Start research type 0
      log.step('Start research type 0');
      await sendTransaction(
        ctx.svm,
        [createStartResearchInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );

      // 2. Speedup to completion
      log.step('Speedup to completion');
      await sendTransaction(
        ctx.svm,
        [createSpeedUpResearchInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, researchType: 0 },
          { speedUpSeconds: new BN(0) }
        )],
        [player.keypair]
      );

      // 3. Complete research
      log.step('Complete research');
      await sendTransaction(
        ctx.svm,
        [createCompleteResearchInstruction({
          gameEngine: ctx.gameEngine,
          payer: player.publicKey,
          playerOwner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );

      // 4. Start next level of same research (type 0, level 2)
      log.step('Start next research type 0 level 2');
      await sendTransaction(
        ctx.svm,
        [createStartResearchInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          researchType: 0,
        })],
        [player.keypair]
      );
      log.txSuccess('full research cycle completed');
    });
  });
});
