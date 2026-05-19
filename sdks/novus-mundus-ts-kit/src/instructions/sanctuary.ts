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
import { createInstructionData } from '../utils/serialize';
import { packed, u8 } from '../utils/codec';
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

/** StartMeditation args: hero_slot (u8). */
const startMeditationArgs = packed<{ heroSlot: number }>([['heroSlot', u8]], 1);

/** ~10,000 CU */
/**
 * Start hero meditation at the Sanctuary.
 *
 * Meditation is a slow but free way to level up heroes.
 * Requires Sanctuary building and hero must be locked.
 */
export async function createStartMeditationInstruction(
  accounts: StartMeditationAccounts,
  params: StartMeditationParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [heroTemplate] = await deriveHeroTemplatePda(accounts.heroTemplateId);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: false },
    { pubkey: heroTemplate, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.SANCTUARY_START_MEDITATION,
    startMeditationArgs.encode({ heroSlot: params.heroSlot })
  );

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
export async function createClaimMeditationInstruction(
  accounts: ClaimMeditationAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [heroTemplate] = await deriveHeroTemplatePda(accounts.heroTemplateId);
  const [heroCollection] = await deriveHeroCollectionPda();

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

/** SpeedupMeditation args: speedup_tier (u8). */
const speedupMeditationArgs = packed<{ speedupTier: number }>([['speedupTier', u8]], 1);

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
export async function createSpeedupMeditationInstruction(
  accounts: SpeedupMeditationAccounts,
  params: SpeedupMeditationParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.SANCTUARY_SPEEDUP_MEDITATION,
    speedupMeditationArgs.encode({ speedupTier: params.speedupTier })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
