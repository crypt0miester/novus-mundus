/**
 * Hero NFT Test Helpers
 *
 * Utilities for minting and managing hero NFTs in tests.
 */

import {
  Keypair,
  Transaction,
  PublicKey,
} from '@solana/web3.js';
import BN from 'bn.js';

import {
  createMintHeroInstruction,
  createLockHeroInstruction,
  createUnlockHeroInstruction,
  createLevelUpHeroInstruction,
  createAssignDefensiveHeroInstruction,
  createBurnHeroInstruction,
  derivePlayerPda,
  deriveHeroTemplatePda,
  deriveEstatePda,
  PROGRAM_ID,
} from '../../src/index';

import { type TestContext, sendTx } from './setup';
import { type TestPlayer } from './players';

// Types

export interface TestHero {
  mint: Keypair;
  mintPubkey: PublicKey;
  templateId: number;
  owner: PublicKey;
  ownerPda: PublicKey;
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
    const heroMint = Keypair.generate();
    const [templatePda] = deriveHeroTemplatePda(templateId);

    const ix = createMintHeroInstruction(
      {
        minter: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroMint: heroMint.publicKey,
        treasury: this.ctx.treasury.publicKey,
      },
      { templateId }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.svm, tx, [player.keypair, heroMint], this.ctx.config);

    const hero: TestHero = {
      mint: heroMint,
      mintPubkey: heroMint.publicKey,
      templateId,
      owner: player.publicKey,
      ownerPda: player.playerPda,
      locked: false,
      level: 1,
    };

    this.heroes.set(heroMint.publicKey.toBase58(), hero);
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
    const [heroTemplate] = deriveHeroTemplatePda(hero.templateId);
    const [estateAccount] = deriveEstatePda(player.playerPda);

    const ix = createLockHeroInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroMint: hero.mintPubkey,
        heroTemplate,
        estateAccount,
      },
      { slotIndex }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.svm, tx, [player.keypair], this.ctx.config);
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
    const [heroTemplate] = deriveHeroTemplatePda(hero.templateId);
    const [estateAccount] = deriveEstatePda(player.playerPda);

    const ix = createUnlockHeroInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroMint: hero.mintPubkey,
        heroTemplate,
        estateAccount,
      },
      { slotIndex }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.svm, tx, [player.keypair], this.ctx.config);
    hero.locked = false;
  }

  /**
   * Level up a hero (always by 1 level).
   */
  async levelUpHero(
    player: TestPlayer,
    hero: TestHero
  ): Promise<void> {
    const [heroTemplate] = deriveHeroTemplatePda(hero.templateId);
    const [estateAccount] = deriveEstatePda(player.playerPda);

    const ix = createLevelUpHeroInstruction({
      owner: player.publicKey,
      gameEngine: this.ctx.gameEngine,
      heroMint: hero.mintPubkey,
      heroTemplate,
      estateAccount,
    });

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.svm, tx, [player.keypair], this.ctx.config);
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
    const ix = createAssignDefensiveHeroInstruction(
      { owner: player.publicKey, gameEngine: this.ctx.gameEngine },
      { slotIndex }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.svm, tx, [player.keypair], this.ctx.config);
  }

  /**
   * Burn a hero NFT (destroys it, credits locked NOVI).
   */
  async burnHero(
    player: TestPlayer,
    hero: TestHero
  ): Promise<void> {
    const ix = createBurnHeroInstruction(
      {
        owner: player.publicKey,
        gameEngine: this.ctx.gameEngine,
        heroAsset: hero.mintPubkey,
      },
      { templateId: hero.templateId }
    );

    const tx = new Transaction().add(ix);
    await sendTx(this.ctx.svm, tx, [player.keypair], this.ctx.config);
    this.heroes.delete(hero.mintPubkey.toBase58());
  }

  /**
   * Get hero by mint address.
   */
  getHero(mintPubkey: PublicKey): TestHero | undefined {
    return this.heroes.get(mintPubkey.toBase58());
  }

  /**
   * Get all heroes for a player.
   */
  getPlayerHeroes(playerPda: PublicKey): TestHero[] {
    return Array.from(this.heroes.values()).filter(
      h => h.ownerPda.equals(playerPda)
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
