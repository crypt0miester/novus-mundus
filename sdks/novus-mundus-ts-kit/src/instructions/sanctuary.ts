/**
 * Sanctuary Instructions
 *
 * Instructions for sanctuary/meditation system:
 * - Start meditation
 * - Claim meditation rewards
 */

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, MPL_CORE_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  derivePlayerPda,
  deriveEstatePda,
  deriveHeroTemplatePda,
  deriveHeroCollectionPda,
} from '../pda';

// Start Meditation

export interface StartMeditationAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint */
  heroMint: Address;
  /** Hero template ID */
  heroTemplateId: number;
}

export interface StartMeditationParams {
  /** Active hero slot index (0-2) */
  heroSlot: number;
}

/** ~10,000 CU */
/**
 * Start hero meditation at the Sanctuary.
 *
 * Meditation is a slow but free way to level up heroes.
 * Requires Sanctuary building and hero must be locked.
 */
export function createStartMeditationInstruction(
  accounts: StartMeditationAccounts,
  params: StartMeditationParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(player);
  const [heroTemplate] = deriveHeroTemplatePda(accounts.heroTemplateId);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: false },
    { pubkey: heroTemplate, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(params.heroSlot);

  const data = createInstructionData(DISCRIMINATORS.SANCTUARY_START_MEDITATION, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Meditation

export interface ClaimMeditationAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint */
  heroMint: Address;
  /** Hero template ID (for buff power calculation) */
  heroTemplateId: number;
}

/** ~10,000 CU */
/**
 * Claim meditation rewards.
 *
 * Ends the meditation session and grants XP to the meditating hero.
 * XP accumulates in hero.meditation_xp and converts to levels at 5000 XP/level.
 *
 * Two-Phase Hero Progression:
 * - Phase 1 (Meditation): Free but extremely slow leveling up to meditation cap
 * - Phase 2 (Fragments): Must use fragments (level_up.rs) beyond the cap
 */
export function createClaimMeditationInstruction(
  accounts: ClaimMeditationAccounts
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(player);
  const [heroTemplate] = deriveHeroTemplatePda(accounts.heroTemplateId);
  const [heroCollection] = deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. player_account (WRITE)
  // 2. hero_mint (WRITE)
  // 3. hero_template (READ)
  // 4. hero_collection (READ)
  // 5. game_engine (READ)
  // 6. system_program (READ)
  // 7. estate_account (WRITE)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },  // writable: CPI payer for UpdatePluginV1
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroTemplate, isSigner: false, isWritable: false },
    { pubkey: heroCollection, isSigner: false, isWritable: true },  // writable: UpdatePluginV1 CPI
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.SANCTUARY_CLAIM_MEDITATION);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Speedup Meditation

export interface SpeedupMeditationAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface SpeedupMeditationParams {
  /** Speedup tier: 1 = 1 hour (3000 gems), 2 = 6 hours (18000 gems) */
  speedupTier: 1 | 2;
}

/** ~5,000 CU */
/**
 * Speed up an active meditation by spending gems.
 *
 * Advances meditation_started_at backwards so more time appears elapsed
 * when claim is called.
 *
 * - Tier 1: adds 1 hour of meditation time (3,000 gems)
 * - Tier 2: adds 6 hours of meditation time (18,000 gems)
 */
export function createSpeedupMeditationInstruction(
  accounts: SpeedupMeditationAccounts,
  params: SpeedupMeditationParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(params.speedupTier);

  const data = createInstructionData(DISCRIMINATORS.SANCTUARY_SPEEDUP_MEDITATION, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}
