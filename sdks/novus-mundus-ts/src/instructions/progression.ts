/**
 * Progression Instructions
 *
 * Instructions for daily rewards and progression.
 */

import {
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program';
import { createInstructionData } from '../utils/serialize';
import {
  derivePlayerPda,
} from '../pda';

// Claim Daily Reward

export interface ClaimDailyRewardAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~15,000 CU */
/**
 * Claim daily login reward.
 *
 * Rewards scale with subscription tier:
 * - Rookie: 1.0x (base)
 * - Expert: 1.5x
 * - Epic: 2.0x
 * - Legendary: 3.0x
 *
 * Base rewards:
 * - Cash: 1000
 * - Produce: 500
 * - XP: 25
 *
 * 24-hour cooldown between claims.
 */
export async function createClaimDailyRewardInstruction(
  accounts: ClaimDailyRewardAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);

  // Rust account order:
  // 0. player (writable)
  // 1. player_owner (signer, writable)
  // 2. game_engine
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.PROGRESSION_CLAIM_DAILY);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
