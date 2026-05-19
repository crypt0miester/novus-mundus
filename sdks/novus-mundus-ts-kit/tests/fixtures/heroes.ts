/**
 * Hero NFT Test Helpers
 *
 * Utilities for minting and managing hero NFTs in tests.
 */

import {
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';

import {
  createMintHeroInstruction,
  createLockHeroInstruction,
  createUnlockHeroInstruction,
  createLevelUpHeroInstruction,
  createAssignDefensiveHeroInstruction,
  createBurnHeroInstruction,
  deriveHeroTemplatePda,
  deriveEstatePda,
} from '../../src/index';

import { type TestContext } from './setup';
import { sendInstructions } from '../utils/transactions';
import { type TestPlayer } from './players';

// Types

export interface TestHero {
  mint: KeyPairSigner;
  mintPubkey: Address;
  templateId: number;
  owner: Address;
  ownerPda: Address;
  locked: boolean;
  level: number;
}

// Hero Factory

export class HeroFactory {
  private ctx: TestContext;
  private heroes: Map<string, TestHero> = new Map();

  constructor(ctx: TestContext) {
    this.ctx = ctx;
  }

  /**
   * Mint a new hero NFT for a player.
   */
  async mintHero(
    player: TestPlayer,
    templateId: number
  ): Promise<TestHero> {
    const heroMint = await generateKeyPairSigner();

    const ix = await createMintHeroInstruction(
      {
        minter: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroMint: heroMint.address,
        treasury: this.ctx.treasury.address,
      },
      { templateId }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair, heroMint]);

    const hero: TestHero = {
      mint: heroMint,
      mintPubkey: heroMint.address,
      templateId,
      owner: player.publicKey,
      ownerPda: player.playerPda,
      locked: false,
      level: 1,
    };

    this.heroes.set(heroMint.address, hero);
    return hero;
  }

  /**
   * Mint multiple heroes for a player.
   */
  async mintHeroes(
    player: TestPlayer,
    templateIds: number[]
  ): Promise<TestHero[]> {
    const heroes: TestHero[] = [];
    for (const templateId of templateIds) {
      const hero = await this.mintHero(player, templateId);
      heroes.push(hero);
    }
    return heroes;
  }

  /**
   * Lock a hero (transfer to escrow).
   * @param slotIndex - Hero slot index (0-2)
   */
  async lockHero(
    player: TestPlayer,
    hero: TestHero,
    slotIndex: number = 0
  ): Promise<void> {
    const [heroTemplate] = await deriveHeroTemplatePda(hero.templateId);
    const [estateAccount] = await deriveEstatePda(player.playerPda);

    const ix = await createLockHeroInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroMint: hero.mintPubkey,
        heroTemplate,
        estateAccount,
      },
      { slotIndex }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    hero.locked = true;
  }

  /**
   * Unlock a hero (return from escrow).
   * @param slotIndex - Hero slot index (0-2)
   */
  async unlockHero(
    player: TestPlayer,
    hero: TestHero,
    slotIndex: number = 0
  ): Promise<void> {
    const [heroTemplate] = await deriveHeroTemplatePda(hero.templateId);
    const [estateAccount] = await deriveEstatePda(player.playerPda);

    const ix = await createUnlockHeroInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroMint: hero.mintPubkey,
        heroTemplate,
        estateAccount,
      },
      { slotIndex }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    hero.locked = false;
  }

  /**
   * Level up a hero (always by 1 level).
   */
  async levelUpHero(
    player: TestPlayer,
    hero: TestHero
  ): Promise<void> {
    const [heroTemplate] = await deriveHeroTemplatePda(hero.templateId);
    const [estateAccount] = await deriveEstatePda(player.playerPda);

    const ix = await createLevelUpHeroInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      heroMint: hero.mintPubkey,
      heroTemplate,
      estateAccount,
    });

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    hero.level++;
  }

  /**
   * Assign hero to defensive slot.
   * @param slotIndex - Hero slot index (0-2)
   */
  async assignDefensiveHero(
    player: TestPlayer,
    hero: TestHero,
    slotIndex: number = 0
  ): Promise<void> {
    const ix = await createAssignDefensiveHeroInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { slotIndex }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
  }

  /**
   * Burn a hero NFT (destroys it, credits locked NOVI).
   */
  async burnHero(
    player: TestPlayer,
    hero: TestHero
  ): Promise<void> {
    const ix = await createBurnHeroInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroAsset: hero.mintPubkey,
      },
      { templateId: hero.templateId }
    );

    await sendInstructions(this.ctx.svm, [ix], [player.keypair]);
    this.heroes.delete(hero.mintPubkey);
  }

  /**
   * Get hero by mint address.
   */
  getHero(mintPubkey: Address): TestHero | undefined {
    return this.heroes.get(mintPubkey);
  }

  /**
   * Get all heroes for a player.
   */
  getPlayerHeroes(playerPda: Address): TestHero[] {
    return Array.from(this.heroes.values()).filter(
      h => h.ownerPda === playerPda
    );
  }

  /**
   * Clear hero tracking.
   */
  clear(): void {
    this.heroes.clear();
  }
}

// Pre-configured Hero Scenarios

export interface HeroLoadout {
  heroes: TestHero[];
  defensive: TestHero | null;
}

/**
 * Create a standard hero loadout for a player.
 * Mints 3 heroes (one of each starter class) and locks them.
 */
export async function createStandardHeroLoadout(
  factory: HeroFactory,
  player: TestPlayer
): Promise<HeroLoadout> {
  const warrior = await factory.mintHero(player, 1);
  const archer = await factory.mintHero(player, 2);
  const mage = await factory.mintHero(player, 3);

  // Lock all heroes
  await factory.lockHero(player, warrior);
  await factory.lockHero(player, archer);
  await factory.lockHero(player, mage);

  // Assign warrior as defensive hero
  await factory.assignDefensiveHero(player, warrior);

  return {
    heroes: [warrior, archer, mage],
    defensive: warrior,
  };
}

/**
 * Create a leveled hero for expedition/dungeon testing.
 */
export async function createLeveledHero(
  factory: HeroFactory,
  player: TestPlayer,
  templateId: number,
  targetLevel: number
): Promise<TestHero> {
  const hero = await factory.mintHero(player, templateId);
  await factory.lockHero(player, hero);

  // Level up to target
  for (let i = 1; i < targetLevel; i++) {
    try {
      await factory.levelUpHero(player, hero);
    } catch (err) {
      // May fail if player doesn't have enough XP/resources
      break;
    }
  }

  return hero;
}
