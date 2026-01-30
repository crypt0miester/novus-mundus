/**
 * Loot Instructions
 *
 * Instructions for claiming loot rewards.
 */

import {
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program.ts';
import { createInstructionData } from '../utils/serialize.ts';
import {
  derivePlayerPda,
  deriveUserPda,
} from '../pda.ts';

// ============================================================
// Claim Loot
// ============================================================

export interface ClaimLootAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Loot account to claim */
  loot: PublicKey;
  /** Creator wallet that paid rent for loot (receives refund) */
  creator: PublicKey;
}

/**
 * Claim rewards from a loot account.
 *
 * Loot is generated from:
 * - Encounter kills (PvE)
 * - PvP combat wins
 * - Rally participation
 * - Expedition completion
 *
 * Loot expires after 30 days if not claimed.
 *
 * Rewards added to player account:
 * - Cash
 * - Reserved NOVI (to UserAccount)
 * - Weapons (melee, ranged, siege)
 * - Produce
 * - Vehicles
 * - Fragments
 * - Gems
 */
export function createClaimLootInstruction(
  accounts: ClaimLootAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = deriveUserPda(accounts.owner);

  // Rust account order:
  // 0. loot (WRITE)
  // 1. player (WRITE)
  // 2. user (WRITE)
  // 3. owner (SIGNER, WRITE)
  // 4. game_engine (READ)
  // 5. creator (WRITE - receives rent refund)
  const keys = [
    { pubkey: accounts.loot, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.creator, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.LOOT_CLAIM);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
