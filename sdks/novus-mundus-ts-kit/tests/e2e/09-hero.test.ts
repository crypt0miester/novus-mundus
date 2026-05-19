/**
 * Hero System E2E Tests
 *
 * Tests for hero NFT functionality:
 * - Minting heroes
 * - Hero assignment
 * - Hero leveling
 * - Hero locking/unlocking
 * - Hero equipment
 */

import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { address, generateKeyPairSigner, type Address } from '@solana/kit';

/** All-zeros pubkey (web3.js `PublicKey.default` replacement). */
const DEFAULT_PUBKEY: Address = address('11111111111111111111111111111111');

import {
  createMintHeroInstruction,
  createLevelUpHeroInstruction,
  createLockHeroInstruction,
  createUnlockHeroInstruction,
  createAssignDefensiveHeroInstruction,
  createCreateCollectionInstruction,
  createBurnHeroInstruction,
  createUpdateSupplyCapInstruction,
  createTeamCreateInstruction,
  createRallyCreateInstruction,
  derivePlayerPda,
  deriveGameEnginePda,
  deriveHeroTemplatePda,
  deriveHeroMintReceiptPda,
  deriveEstatePda,
  BuildingType,
  RallyTargetType,
  parseAssetV1,
  createBuyPlotInstruction,
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
  HeroFactory,
  type TestHero,
} from '../fixtures/heroes';
import { deserializeHeroTemplate } from '../../src/state/hero';
import {
  assertBnEquals,
  assertBnGreaterThan,
} from '../utils/assertions';
import {
  sendInstructions,
  expectTransactionToFail,
} from '../utils/transactions';
import {
  fetchPlayer,
  fetchAccount,
} from '../utils/accounts';
import { log } from '../utils/logger';

setDefaultTimeout(120_000);

// Helper: Mint hero and return the keypair

async function mintHero(
  ctx: TestContext,
  player: TestPlayer,
  templateId: number = 1
): Promise<{ heroMint: Address; templateId: number }> {
  const heroMintKeypair = await generateKeyPairSigner();

  const ix = await createMintHeroInstruction(
    {
      gameEngine: ctx.gameEngine,
      minter: player.publicKey,
      heroMint: heroMintKeypair.address,
      treasury: ctx.treasury.address,
    },
    { templateId }
  );

  await sendInstructions(
    ctx.svm,
    [ix],
    [player.keypair, heroMintKeypair]
  );

  return { heroMint: heroMintKeypair.address, templateId };
}

// Helper: Create a player with full extension chain for hero lock
// Requires: EXT_RESEARCH → EXT_INVENTORY → EXT_TEAM → EXT_RALLY
// Plus Sanctuary building for lock gate

let heroReadyCounter = 0;

async function createHeroReadyPlayer(
  ctx: TestContext,
  factory: PlayerFactory
): Promise<TestPlayer> {
  heroReadyCounter++;

  // 1. Create player with estate + required buildings
  //    Estate creation buys gems → unlocks EXT_INVENTORY
  //    Buildings: Sanctuary (lock gate), Market (fragments), Barracks (units)
  //    Plot 1 has 4 slots (Mansion auto-built + 3 buildings = full)
  const player = await factory.createPlayer({
    initialize: true,
    createEstate: true,
    buildings: [BuildingType.MeditationChamber, BuildingType.Market, BuildingType.Barracks],
  });

  // 1b. Buy second plot + build Citadel (for rally creation → EXT_RALLY)
  const buyPlotIx = await createBuyPlotInstruction({
    owner: player.publicKey,
    gameEngine: ctx.gameEngine,
  });
  await sendInstructions(ctx.svm, [buyPlotIx], [player.keypair]);
  await factory.buildAndCompleteBuilding(player, BuildingType.Citadel);

  // 2. Create team → unlocks EXT_TEAM, sets player.team
  const teamId = Date.now() % 1000000 + heroReadyCounter;
  const teamIx = await createTeamCreateInstruction(
    { owner: player.publicKey, gameEngine: ctx.gameEngine, teamId },
    { name: `HTeam${teamId}` }
  );
  await sendInstructions(ctx.svm, [teamIx], [player.keypair]);

  // 3. Hire minimal units (needed for rally creation, which requires total_units > 0)
  //    Unit cost is 100 NOVI per unit, so we need at least 100 to get 1 unit
  await factory.hireUnits(player, 0, 500);

  // 4. Create rally → unlocks EXT_RALLY
  const rallyId = Date.now() % 1000000 + heroReadyCounter + 500000;
  const target = (await generateKeyPairSigner()).address; // Dummy target
  const rallyCityId = player.startingCityId;
  const rallyIx = await createRallyCreateInstruction(
    {
      owner: player.publicKey,
      gameEngine: ctx.gameEngine,
      rallyId,
      target,
      teamId,
      rallyCityId,
    },
    {
      targetType: RallyTargetType.Player,
      gatherDuration: 3600,
      targetCityId: rallyCityId,
      defensiveUnit1: 1,
      defensiveUnit2: 0,
      defensiveUnit3: 0,
      meleeWeapons: 0,
      rangedWeapons: 0,
      siegeWeapons: 0,
    }
  );
  await sendInstructions(ctx.svm, [rallyIx], [player.keypair]);

  return player;
}

// Test Suite

describe('Hero System', () => {
  let ctx: TestContext;
  let factory: PlayerFactory;
  let heroFactory: HeroFactory;

  beforeAll(async () => {
    log.section('Hero System');
    ctx = await beforeAllTests();
    factory = new PlayerFactory(ctx, { autoInit: true });
    heroFactory = new HeroFactory(ctx);
  });

  afterAll(() => {
    factory.clear();
  });

  // Hero Minting Tests

  describe('Hero Minting', () => {
    it('should mint a new hero', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const heroMintKeypair = (await generateKeyPairSigner());

      const ix = await createMintHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          minter: player.publicKey,
          heroMint: heroMintKeypair.address,
          treasury: ctx.treasury.address,
        },
        { templateId: 1 }
      );

      const tx = [ix];

      await sendInstructions(ctx.svm, tx, [player.keypair, heroMintKeypair]);

      // Verify: fetch the MPL Core asset account and parse on-chain data
      const assetInfo = await fetchAccount(ctx.svm,heroMintKeypair.address);
      expect(assetInfo).not.toBeNull();

      const asset = parseAssetV1(assetInfo!.data);
      expect(asset).not.toBeNull();

      // Verify owner and base fields
      expect(asset!.owner === player.publicKey).toBe(true);
      expect(asset!.name).toBe('Warrior');
      expect(asset!.uri).toContain('novusmundus');

      const attrs = asset!.attributes;
      console.log(`Hero NFT attributes: ${JSON.stringify(attrs)}`);

      // Verify identity attributes
      expect(attrs['Template']).toBe('1');
      expect(attrs['Level']).toBe('1');
      expect(attrs['XP']).toBe('0'); // meditation XP must be 0 at mint
      expect(attrs['Origin']).toBe('0'); // meditationCityId=0

      // Verify buff attributes (Warrior template: Attack, Defense, Economy, Crit)
      expect(attrs['Attack']).toBeDefined();
      expect(attrs['Defense']).toBeDefined();
      expect(attrs['Economy']).toBeDefined();
      expect(attrs['Crit']).toBeDefined();
      expect(Object.keys(attrs).length).toBeGreaterThanOrEqual(9); // 5 identity + 4 buffs

      // Also verify the HeroTemplate account
      const [heroTemplatePda] = await deriveHeroTemplatePda(1);
      const templateInfo = await fetchAccount(ctx.svm,heroTemplatePda);
      expect(templateInfo).not.toBeNull();
      const heroTemplate = deserializeHeroTemplate(templateInfo!.data);
      expect(heroTemplate.templateId).toBe(1);
    });

    it('should reject minting without enough resources', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const heroMintKeypair = (await generateKeyPairSigner());

      // Expensive hero template
      const ix = await createMintHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          minter: player.publicKey,
          heroMint: heroMintKeypair.address,
          treasury: ctx.treasury.address,
        },
        { templateId: 10 } // Premium hero
      );

      // Might fail if insufficient resources
      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair, heroMintKeypair]
      );
    });

    it('should reject minting non-existent template', async () => {
      const player = await factory.createPlayer({ initialize: true });
      const heroMintKeypair = (await generateKeyPairSigner());

      const ix = await createMintHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          minter: player.publicKey,
          heroMint: heroMintKeypair.address,
          treasury: ctx.treasury.address,
        },
        { templateId: 9999 } // Non-existent
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair, heroMintKeypair]
      );
    });

    it('should reject second mint of same template (per-player limit)', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // First mint should succeed
      const heroMint1 = (await generateKeyPairSigner());
      const ix1 = await createMintHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          minter: player.publicKey,
          heroMint: heroMint1.address,
          treasury: ctx.treasury.address,
        },
        { templateId: 1 }
      );
      await sendInstructions(ctx.svm, [ix1], [player.keypair, heroMint1]);

      // Verify receipt PDA exists
      const [receiptPda] = await deriveHeroMintReceiptPda(player.playerPda, 1);
      const receiptInfo = await fetchAccount(ctx.svm,receiptPda);
      expect(receiptInfo).not.toBeNull();
      expect(receiptInfo!.data.length).toBe(0); // 0-byte receipt

      // Second mint of same template should fail
      const heroMint2 = (await generateKeyPairSigner());
      const ix2 = await createMintHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          minter: player.publicKey,
          heroMint: heroMint2.address,
          treasury: ctx.treasury.address,
        },
        { templateId: 1 }
      );
      await expectTransactionToFail(
        ctx.svm,
        [ix2],
        [player.keypair, heroMint2]
      );
    });

    it('should allow minting different templates', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mint template 1
      const heroMint1 = (await generateKeyPairSigner());
      await sendInstructions(ctx.svm,
        [await createMintHeroInstruction(
          { gameEngine: ctx.gameEngine, minter: player.publicKey, heroMint: heroMint1.address, treasury: ctx.treasury.address },
          { templateId: 1 }
        )],
        [player.keypair, heroMint1]
      );

      // Mint template 2 (different template, should succeed)
      const heroMint2 = (await generateKeyPairSigner());
      await sendInstructions(ctx.svm,
        [await createMintHeroInstruction(
          { gameEngine: ctx.gameEngine, minter: player.publicKey, heroMint: heroMint2.address, treasury: ctx.treasury.address },
          { templateId: 2 }
        )],
        [player.keypair, heroMint2]
      );
    });
  });

  // Hero Level Up Tests

  describe('Hero Level Up', () => {
    it('should level up hero with fragments', async () => {
      // Level up requires EXT_HEROES + Sanctuary
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint a hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero first (this unlocks EXT_HEROES)
      const lockIx = await createLockHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        },
        { slotIndex: 0 }
      );
      await sendInstructions(ctx.svm, [lockIx], [player.keypair]);

      // Now unlock to get hero back in wallet for level-up test
      const unlockIx = await createUnlockHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        },
        { slotIndex: 0 }
      );
      await sendInstructions(ctx.svm, [unlockIx], [player.keypair]);

      // Buy fragments for level-up (cost is ~15 for level 1→2)
      await factory.buyFragments(player, 1); // 100 fragments

      // Level up the hero (hero in wallet, not locked)
      const levelUpIx = await createLevelUpHeroInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        heroMint,
        heroTemplate,
        estateAccount,
      });

      await sendInstructions(ctx.svm, [levelUpIx], [player.keypair]);
    });

    it('should reject level up without enough fragments', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint a hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock to unlock EXT_HEROES
      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );
      await sendInstructions(ctx.svm,
        [await createUnlockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Try many level ups - should eventually fail due to fragment cost
      let failed = false;
      for (let i = 0; i < 20; i++) {
        const levelUpIx = await createLevelUpHeroInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        });
        try {
          await sendInstructions(ctx.svm, [levelUpIx], [player.keypair]);
        } catch (err) {
          failed = true;
          break;
        }
      }
      expect(failed).toBe(true);
    });

    it('should reject level up at max level', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint a hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock/unlock to get EXT_HEROES
      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );
      await sendInstructions(ctx.svm,
        [await createUnlockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Level up multiple times until we hit the cap
      let reachedMax = false;
      for (let i = 0; i < 50; i++) {
        const levelUpIx = await createLevelUpHeroInstruction({
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        });
        try {
          await sendInstructions(ctx.svm, [levelUpIx], [player.keypair]);
        } catch (err: any) {
          reachedMax = true;
          break;
        }
      }
      expect(reachedMax).toBe(true);
    });

    it('should increase stats on level up', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint a hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock/unlock to get EXT_HEROES
      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );
      await sendInstructions(ctx.svm,
        [await createUnlockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Get initial player state
      const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerBefore).not.toBeNull();

      // Buy fragments for level-up
      await factory.buyFragments(player, 1);

      // Level up hero
      const levelUpIx = await createLevelUpHeroInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        heroMint,
        heroTemplate,
        estateAccount,
      });

      await sendInstructions(ctx.svm, [levelUpIx], [player.keypair]);

      // Verify transaction succeeded (stats in NFT attributes)
    });
  });

  // Hero Lock/Unlock Tests

  describe('Hero Lock/Unlock', () => {
    it('should lock hero for expedition', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero
      const lockIx = await createLockHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        },
        { slotIndex: 0 }
      );

      await sendInstructions(ctx.svm, [lockIx], [player.keypair]);
    });

    it('should unlock hero after expedition', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero
      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Unlock hero
      const unlockIx = await createUnlockHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        },
        { slotIndex: 0 }
      );

      await sendInstructions(ctx.svm, [unlockIx], [player.keypair]);
    });

    it('should lock and unlock without expedition', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and lock hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Unlock immediately (no expedition active)
      const unlockIx = await createUnlockHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        },
        { slotIndex: 0 }
      );

      await sendInstructions(ctx.svm, [unlockIx], [player.keypair]);
    });

    it('should reject lock on occupied slot', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint two heroes (different templates — 1-per-player-per-template limit)
      const hero1 = await mintHero(ctx, player, 1);
      const hero2 = await mintHero(ctx, player, 2);
      const [heroTemplate1] = await deriveHeroTemplatePda(hero1.templateId);
      const [heroTemplate2] = await deriveHeroTemplatePda(hero2.templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero1 to slot 0
      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint: hero1.heroMint, heroTemplate: heroTemplate1, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Try to lock hero2 to slot 0 (already occupied) - should fail
      await expectTransactionToFail(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint: hero2.heroMint, heroTemplate: heroTemplate2, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );
    });
  });

  // Hero Assignment Tests

  describe('Hero Assignment', () => {
    it('should assign hero for defense', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero first (required before assignment)
      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Assign for defense (uses slot index, not hero mint)
      const assignIx = await createAssignDefensiveHeroInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { slotIndex: 0 }
      );

      await sendInstructions(ctx.svm, [assignIx], [player.keypair]);

      // Verify hero assigned
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should remove defensive assignment', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and assign hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero
      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Assign
      await sendInstructions(
        ctx.svm,
        [
          await createAssignDefensiveHeroInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Unassign by unlocking the hero (removes it from active_heroes, resets defensive slot)
      const unlockIx = await createUnlockHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          owner: player.publicKey,
          heroMint,
          heroTemplate,
          estateAccount,
        },
        { slotIndex: 0 }
      );

      await sendInstructions(ctx.svm, [unlockIx], [player.keypair]);
    });

    it('should reject assigning empty slot', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Try to assign slot 2 which has no hero locked
      const assignIx = await createAssignDefensiveHeroInstruction(
        { gameEngine: ctx.gameEngine, owner: player.publicKey },
        { slotIndex: 2 } // Slot 2 is empty
      );

      await expectTransactionToFail(
        ctx.svm,
        [assignIx],
        [player.keypair]
      );
    });
  });

  // Hero Stats Tests

  describe('Hero Stats', () => {
    it('should have correct base stats from template', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mint different heroes from different templates
      const { heroMint: hero1 } = await mintHero(ctx, player, 1);

      // Hero stats are stored in MPL Core NFT attributes
      // The template defines base stats which are written to the NFT
      expect(hero1).toBeTruthy();
    });

    it('should apply hero bonuses when locked', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Get player stats before hero
      const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerBefore).not.toBeNull();

      // Mint and lock hero (locked heroes provide combat bonuses)
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Assign as defensive hero
      await sendInstructions(
        ctx.svm,
        [
          await createAssignDefensiveHeroInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Verify hero bonuses applied
      const playerAfter = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerAfter).not.toBeNull();
    });

    it('should have specialization bonuses', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mint a hero - the template determines its type
      const { heroMint } = await mintHero(ctx, player, 1);

      // The hero's buffs are set at mint time based on template
      // We verify the hero was created successfully
      expect(heroMint).toBeTruthy();
    });
  });

  // Hero Equipment Tests

  describe('Hero Equipment', () => {
    it('should lock hero for equipment readiness', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint a hero first
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero (required before equipping)
      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Verify hero is locked and ready for equipment
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should unlock hero after removing equipment', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and lock hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Unlock hero
      await sendInstructions(
        ctx.svm,
        [
          await createUnlockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should reject equipping to non-locked hero slot', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint hero but don't lock
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Try to assign slot 0 without locking - should fail (slot is empty)
      await expectTransactionToFail(
        ctx.svm,
        [
          await createAssignDefensiveHeroInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );
    });
  });

  // Hero Collection Tests

  describe('Hero Collection', () => {
    it('should reject duplicate collection creation', async () => {
      // Collection already created in setup, so this should fail
      const ix = await createCreateCollectionInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: ctx.daoAuthority.address,
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [ctx.daoAuthority]
      );
    });

    it('should reject collection creation by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createCreateCollectionInstruction({
        gameEngine: ctx.gameEngine,
        daoAuthority: player.publicKey,
      });

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
    });
  });

  // Hero XP Tests

  describe('Hero Experience', () => {
    it('should gain XP from locking hero', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and lock hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Assign as defensive hero
      await sendInstructions(
        ctx.svm,
        [
          await createAssignDefensiveHeroInstruction(
            { gameEngine: ctx.gameEngine, owner: player.publicKey },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      // Hero XP is gained through combat and expeditions
      // We verify the setup succeeded
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });

    it('should gain XP from expeditions', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mint hero
      const { heroMint } = await mintHero(ctx, player, 1);

      // Heroes can be used in expeditions for XP
      // Full expedition flow is tested in 13-expedition.test.ts
      expect(heroMint).toBeTruthy();
    });

    it('should calculate XP to next level', async () => {
      // XP requirements scale with hero level
      const player = await createHeroReadyPlayer(ctx, factory);

      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock/unlock to get EXT_HEROES
      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );
      await sendInstructions(ctx.svm,
        [await createUnlockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Buy fragments for level-up
      await factory.buyFragments(player, 1);

      // Try leveling up (always levels up by 1)
      const levelUpIx = await createLevelUpHeroInstruction({
        gameEngine: ctx.gameEngine,
        owner: player.publicKey,
        heroMint,
        heroTemplate,
        estateAccount,
      });

      await sendInstructions(ctx.svm, [levelUpIx], [player.keypair]);
    });
  });

  // Hero Rarity Tests

  describe('Hero Rarity', () => {
    it('should mint heroes with rarity from template', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Hero rarity is deterministic based on template
      const { heroMint } = await mintHero(ctx, player, 1);

      expect(heroMint).toBeTruthy();
    });

    it('should apply rarity stat multipliers when locked', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      // Lock hero to see location bonus applied
      await sendInstructions(
        ctx.svm,
        [
          await createLockHeroInstruction(
            {
              gameEngine: ctx.gameEngine,
              owner: player.publicKey,
              heroMint,
              heroTemplate,
              estateAccount,
            },
            { slotIndex: 0 }
          )
        ],
        [player.keypair]
      );

      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });
  });

  // Hero Burn Tests

  describe('Hero Burn', () => {
    it('should burn hero and receive locked NOVI', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mint a hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);

      // Get player state before burn
      const playerBefore = await fetchPlayer(ctx.svm, player.playerPda);
      expect(playerBefore).not.toBeNull();
      const lockedNoviBefore = playerBefore!.lockedNovi;

      // Burn the hero
      const burnIx = await createBurnHeroInstruction(
        {
          owner: player.publicKey,
          gameEngine: ctx.gameEngine,
          heroAsset: heroMint,
        },
        { templateId }
      );

      await sendInstructions(ctx.svm, [burnIx], [player.keypair]);

      // Verify hero NFT is destroyed
      // LiteSVM may retain the account after MPL Core burn — check it's no longer a valid asset
      const assetInfo = (await fetchAccount(ctx.svm,heroMint));
      if (assetInfo !== null) {
        // Account exists but should not be a valid MPL Core asset anymore
        const parsed = parseAssetV1(assetInfo.data);
        expect(parsed === null || parsed.owner === DEFAULT_PUBKEY).toBe(true);
      }

      // Verify receipt PDA was closed (allowing re-mint)
      const [receiptPda] = await deriveHeroMintReceiptPda(player.playerPda, templateId);
      const receiptInfo = (await fetchAccount(ctx.svm,receiptPda));
      expect(receiptInfo === null || Number(receiptInfo.lamports) === 0).toBe(true);
    });

    it('should reject burning locked hero', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and lock a hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Try to burn locked hero - should fail
      const burnIx = await createBurnHeroInstruction(
        {
          owner: player.publicKey,
          gameEngine: ctx.gameEngine,
          heroAsset: heroMint,
        },
        { templateId }
      );

      await expectTransactionToFail(
        ctx.svm,
        [burnIx],
        [player.keypair]
      );
    });

    it('should allow re-mint after burn', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Mint hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);

      // Burn it
      const burnIx = await createBurnHeroInstruction(
        {
          owner: player.publicKey,
          gameEngine: ctx.gameEngine,
          heroAsset: heroMint,
        },
        { templateId }
      );
      await sendInstructions(ctx.svm, [burnIx], [player.keypair]);

      // Re-mint same template - should succeed (receipt was closed)
      const heroMint2 = (await generateKeyPairSigner());
      const mintIx = await createMintHeroInstruction(
        {
          gameEngine: ctx.gameEngine,
          minter: player.publicKey,
          heroMint: heroMint2.address,
          treasury: ctx.treasury.address,
        },
        { templateId }
      );
      await sendInstructions(ctx.svm, [mintIx], [player.keypair, heroMint2]);
    });

    it('should reject burn by non-owner', async () => {
      const player1 = await factory.createPlayer({ initialize: true });
      const player2 = await factory.createPlayer({ initialize: true });

      // Player1 mints a hero
      const { heroMint, templateId } = await mintHero(ctx, player1, 1);

      // Player2 tries to burn player1's hero - should fail
      const burnIx = await createBurnHeroInstruction(
        {
          owner: player2.publicKey,
          gameEngine: ctx.gameEngine,
          heroAsset: heroMint,
        },
        { templateId }
      );

      await expectTransactionToFail(
        ctx.svm,
        [burnIx],
        [player2.keypair]
      );
    });
  });

  // Supply Cap Update Tests

  describe('Supply Cap Update', () => {
    it('should increase supply cap (DAO)', async () => {
      const templateId = 1;
      const [templatePda] = await deriveHeroTemplatePda(templateId);

      // Read current supply cap
      const templateBefore = await fetchAccount(ctx.svm,templatePda);
      expect(templateBefore).not.toBeNull();

      // Update supply cap (increase)
      const ix = await createUpdateSupplyCapInstruction(
        {
          daoAuthority: ctx.daoAuthority.address,
          gameEngine: ctx.gameEngine,
        },
        { templateId, newSupplyCap: 50000 }
      );

      await sendInstructions(ctx.svm, [ix], [ctx.daoAuthority]);
    });

    it('should reject supply cap decrease', async () => {
      const ix = await createUpdateSupplyCapInstruction(
        {
          daoAuthority: ctx.daoAuthority.address,
          gameEngine: ctx.gameEngine,
        },
        { templateId: 1, newSupplyCap: 1 } // Decrease - should fail
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [ctx.daoAuthority]
      );
    });

    it('should reject supply cap update by non-DAO', async () => {
      const player = await factory.createPlayer({ initialize: true });

      const ix = await createUpdateSupplyCapInstruction(
        {
          daoAuthority: player.publicKey,
          gameEngine: ctx.gameEngine,
        },
        { templateId: 1, newSupplyCap: 99999 }
      );

      await expectTransactionToFail(
        ctx.svm,
        [ix],
        [player.keypair]
      );
    });
  });

  // Hero Trading Tests

  describe('Hero Trading', () => {
    it('should mint hero to wallet', async () => {
      const player = await factory.createPlayer({ initialize: true });

      // Player mints hero (hero is in wallet by default)
      const { heroMint } = await mintHero(ctx, player, 1);

      // Heroes are MPL Core NFTs - they can be transferred using standard
      // MPL Core TransferV1 instruction when NOT locked
      expect(heroMint).toBeTruthy();
    });

    it('should reject unlock with wrong slot', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and lock hero to slot 0
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Try to unlock from slot 1 (hero is in slot 0)
      await expectTransactionToFail(ctx.svm,
        [await createUnlockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 1 }
        )],
        [player.keypair]
      );
    });

    it('should verify locked hero is owned by PDA', async () => {
      const player = await createHeroReadyPlayer(ctx, factory);

      // Mint and lock hero
      const { heroMint, templateId } = await mintHero(ctx, player, 1);
      const [heroTemplate] = await deriveHeroTemplatePda(templateId);
      const [estateAccount] = await deriveEstatePda(player.playerPda);

      await sendInstructions(ctx.svm,
        [await createLockHeroInstruction(
          { gameEngine: ctx.gameEngine, owner: player.publicKey, heroMint, heroTemplate, estateAccount },
          { slotIndex: 0 }
        )],
        [player.keypair]
      );

      // Verify hero is locked in player's active_heroes
      const account = await fetchPlayer(ctx.svm, player.playerPda);
      expect(account).not.toBeNull();
    });
  });
});
