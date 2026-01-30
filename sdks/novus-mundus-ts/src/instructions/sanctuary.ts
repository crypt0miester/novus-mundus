/**
 * Sanctuary Instructions
 *
 * Instructions for sanctuary/meditation system:
 * - Start meditation
 * - Claim meditation rewards
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program.ts';
import { BufferWriter, createInstructionData } from '../utils/serialize.ts';
import {
  derivePlayerPda,
  deriveEstatePda,
  deriveHeroTemplatePda,
  deriveHeroCollectionPda,
} from '../pda.ts';

// ============================================================
// Start Meditation
// ============================================================

export interface StartMeditationAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint */
  heroMint: PublicKey;
  /** Hero template ID */
  heroTemplateId: number;
}

export interface StartMeditationParams {
  /** Active hero slot index (0-2) */
  heroSlot: number;
}

/**
 * Start hero meditation at the Sanctuary.
 *
 * Meditation is a slow but free way to level up heroes.
 * Requires Sanctuary building and hero must be locked.
 */
export function createStartMeditationInstruction(
  accounts: StartMeditationAccounts,
  params: StartMeditationParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);
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

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Claim Meditation
// ============================================================

export interface ClaimMeditationAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint */
  heroMint: PublicKey;
  /** Hero template ID (for buff power calculation) */
  heroTemplateId: number;
}

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
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);
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
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroTemplate, isSigner: false, isWritable: false },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.SANCTUARY_CLAIM_MEDITATION);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
