/**
 * SPL Token Utilities
 *
 * Helper functions for SPL Token operations.
 */

import { address, getProgramDerivedAddress, type Address } from '@solana/kit';
import { addressBytes, isAddressOnCurve } from '../crypto';

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID: Address = address(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

/** SPL Token Program ID */
export const SPL_TOKEN_PROGRAM_ID: Address = address(
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
export async function getAssociatedTokenAddressSync(
  mint: Address,
  owner: Address,
  allowOwnerOffCurve = false,
  programId: Address = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId: Address = ASSOCIATED_TOKEN_PROGRAM_ID
): Promise<Address> {
  if (!allowOwnerOffCurve && !isAddressOnCurve(owner)) {
    throw new Error('TokenOwnerOffCurve');
  }

  const [ata] = await getProgramDerivedAddress({
    programAddress: associatedTokenProgramId,
    seeds: [addressBytes(owner), addressBytes(programId), addressBytes(mint)],
  });

  return ata;
}

/**
 * Get ATA address for a PDA owner.
 */
export function getAssociatedTokenAddressSyncForPda(
  mint: Address,
  pdaOwner: Address,
  programId: Address = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId: Address = ASSOCIATED_TOKEN_PROGRAM_ID
): Promise<Address> {
  return getAssociatedTokenAddressSync(
    mint,
    pdaOwner,
    true, // Allow off curve for PDAs
    programId,
    associatedTokenProgramId
  );
}
