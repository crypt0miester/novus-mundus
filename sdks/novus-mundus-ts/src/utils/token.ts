/**
 * SPL Token Utilities
 *
 * Helper functions for SPL Token operations.
 *
 * web3.js v3: PDA derivation is async (`getProgramDerivedAddress`), so the ATA
 * helpers are async too. The historical `*Sync` names are kept for call-site
 * stability even though they now return Promises (callers must `await`).
 */

import { PublicKey } from '@solana/web3.js';
import { getProgramDerivedAddress, type Address } from '@solana/addresses';

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
 * Async in web3.js v3 (derivation uses crypto.subtle). The `Sync` suffix is
 * retained for call-site compatibility; callers must `await`.
 *
 * @param mint - Token mint address
 * @param owner - Owner wallet address
 * @param allowOwnerOffCurve - Allow owner off curve (for PDAs)
 * @param programId - Token program ID (defaults to SPL Token)
 * @param associatedTokenProgramId - ATA program ID
 */
export async function getAssociatedTokenAddressAsync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): Promise<PublicKey> {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) {
    throw new Error('TokenOwnerOffCurve');
  }

  const [address] = await getProgramDerivedAddress({
    programAddress: associatedTokenProgramId.toBase58() as Address,
    seeds: [owner.toBytes(), programId.toBytes(), mint.toBytes()],
  });

  return new PublicKey(address);
}

/**
 * Get ATA address for a PDA owner.
 */
export async function getAssociatedTokenAddressAsyncForPda(
  mint: PublicKey,
  pdaOwner: PublicKey,
  programId = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): Promise<PublicKey> {
  return getAssociatedTokenAddressAsync(
    mint,
    pdaOwner,
    true, // Allow off curve for PDAs
    programId,
    associatedTokenProgramId
  );
}
