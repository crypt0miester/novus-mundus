/**
 * SPL Token Utilities
 *
 * Helper functions for SPL Token operations.
 */

import { PublicKey } from '@solana/web3.js';

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

/** SPL Token Program ID */
export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

/**
 * Derive the Associated Token Account address for a given mint and owner.
 *
 * @param mint - Token mint address
 * @param owner - Owner wallet address
 * @param allowOwnerOffCurve - Allow owner off curve (for PDAs)
 * @param programId - Token program ID (defaults to SPL Token)
 * @param associatedTokenProgramId - ATA program ID
 */
export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new Error('TokenOwnerOffCurve');
  }

  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );

  return address;
}

/**
 * Get ATA address for a PDA owner.
 */
export function getAssociatedTokenAddressSyncForPda(
  mint: PublicKey,
  pdaOwner: PublicKey,
  programId = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    pdaOwner,
    true, // Allow off curve for PDAs
    programId,
    associatedTokenProgramId
  );
}
