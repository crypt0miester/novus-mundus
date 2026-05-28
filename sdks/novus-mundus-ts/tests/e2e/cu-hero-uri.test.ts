// CU benchmark for hero mint + level_up after adding the on-chain URI
// builder (utils/hero_uri.rs) and the UpdateV1 CPI on level_up. Goal: verify
// neither tx blows the default 200k CU budget after the additions.

import { describe, it, beforeAll, setDefaultTimeout } from 'bun:test';
import { Keypair, Transaction, PublicKey } from '@solana/web3.js';

import {
  createMintHeroInstruction,
  createLevelUpHeroInstruction,
  createLockHeroInstruction,
  createUnlockHeroInstruction,
  createBuyPlotInstruction,
  createTeamCreateInstruction,
  createRallyCreateInstruction,
  deriveHeroTemplatePda,
  deriveEstatePda,
  BuildingType,
  RallyTargetType,
} from '../../src/index';

import { type TestContext, beforeAllTests } from '../fixtures/setup';
import { PlayerFactory, type TestPlayer } from '../fixtures/players';
import { sendTransaction, sendTransactionWithResult } from '../utils/transactions';

setDefaultTimeout(120_000);

let heroReadyCounter = 0;

async function createHeroReadyPlayer(
  ctx: TestContext,
  factory: PlayerFactory,
): Promise<TestPlayer> {
  heroReadyCounter++;
  const player = await factory.createPlayer({
    initialize: true,
    createEstate: true,
    buildings: [BuildingType.MeditationChamber, BuildingType.Market, BuildingType.Barracks],
  });
  await sendTransaction(
    ctx.svm,
    new Transaction().add(createBuyPlotInstruction({ owner: player.publicKey, gameEngine: ctx.gameEngine })),
    [player.keypair],
  );
  await factory.buildAndCompleteBuilding(player, BuildingType.Citadel);

  const teamId = (Date.now() % 1000000) + heroReadyCounter;
  await sendTransaction(
    ctx.svm,
    new Transaction().add(
      createTeamCreateInstruction(
        { owner: player.publicKey, gameEngine: ctx.gameEngine, teamId },
        { name: `CuTeam${teamId}` },
      ),
    ),
    [player.keypair],
  );
  await factory.hireUnits(player, 0, 500);

  const rallyId = (Date.now() % 1000000) + heroReadyCounter + 500000;
  await sendTransaction(
    ctx.svm,
    new Transaction().add(
      createRallyCreateInstruction(
        {
          owner: player.publicKey,
          gameEngine: ctx.gameEngine,
          rallyId,
          target: Keypair.generate().publicKey,
          teamId,
          rallyCityId: player.startingCityId,
        },
        {
          targetType: RallyTargetType.Player,
          gatherDuration: 3600,
          targetCityId: player.startingCityId,
          defensiveUnit1: 1,
          defensiveUnit2: 0,
          defensiveUnit3: 0,
          meleeWeapons: 0,
          rangedWeapons: 0,
          siegeWeapons: 0,
        },
      ),
    ),
    [player.keypair],
  );
  return player;
}

describe('Hero URI — CU budget after UpdateV1 addition', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;

  beforeAll(async () => {
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
  });

  it('mint + level_up stay under the default 200k CU budget', async () => {
    const player = await createHeroReadyPlayer(ctx, factory);

    // 1. Mint a hero. The new URI builder runs inside this tx.
    const heroMintKeypair = Keypair.generate();
    const heroMint: PublicKey = heroMintKeypair.publicKey;
    const templateId = 1;
    const [heroTemplate] = deriveHeroTemplatePda(templateId);
    const [estateAccount] = deriveEstatePda(player.playerPda);

    const mintRes = await sendTransactionWithResult(
      ctx.svm,
      new Transaction().add(
        createMintHeroInstruction(
          {
            gameEngine: ctx.gameEngine,
            minter: player.publicKey,
            heroMint,
            treasury: ctx.treasury.publicKey,
          },
          { templateId },
        ),
      ),
      [player.keypair, heroMintKeypair],
    );
    if (!mintRes.success) throw mintRes.error;
    console.log(`  mint_hero  CU: ${mintRes.computeUnitsUsed?.toLocaleString() ?? '???'}`);

    // 2. Lock + unlock to enable EXT_HEROES and put the hero back in the wallet.
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 },
        ),
      ),
      [player.keypair],
    );
    await sendTransaction(
      ctx.svm,
      new Transaction().add(
        createUnlockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 },
        ),
      ),
      [player.keypair],
    );
    // Buy fragments for the level-up cost.
    await factory.buyFragments(player, 1);

    // 3. Level up. Now runs UpdatePluginV1 (existing) + UpdateV1 (new).
    const levelRes = await sendTransactionWithResult(
      ctx.svm,
      new Transaction().add(
        createLevelUpHeroInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        }),
      ),
      [player.keypair],
    );
    if (!levelRes.success) throw levelRes.error;
    console.log(`  level_up   CU: ${levelRes.computeUnitsUsed?.toLocaleString() ?? '???'}  (UpdatePluginV1 + UpdateV1)`);

    const mintCu = mintRes.computeUnitsUsed ?? 0;
    const levelCu = levelRes.computeUnitsUsed ?? 0;
    const budget = 200_000;
    console.log(`  budget:        ${budget.toLocaleString()}`);
    console.log(`  mint headroom: ${(budget - mintCu).toLocaleString()}`);
    console.log(`  lvl headroom:  ${(budget - levelCu).toLocaleString()}`);

    if (mintCu > budget) throw new Error(`mint exceeded ${budget} CU: ${mintCu}`);
    if (levelCu > budget) throw new Error(`level_up exceeded ${budget} CU: ${levelCu}`);
  });
});
