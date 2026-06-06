/**
 * SPL Token Utilities
 *
 * Helper functions for SPL Token operations.
 *
 * web3.js v3: PDA derivation is async (`getProgramDerivedAddress`), so the ATA
 * helpers are async too. The historical `*Sync` names are kept for call-site
 * stability even though they now return Promises (callers must `await`).
 */

import { PublicKey, TransactionInstruction, SystemProgram } from '@solana/web3.js';
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

/**
 * Build an idempotent "create associated token account" instruction (ATA program
 * `CreateIdempotent`, discriminator byte `1`) using web3.js v3.
 *
 * A v3-native drop-in for `@solana/spl-token`'s
 * `createAssociatedTokenAccountIdempotentInstruction` (same parameter order),
 * since that v1 library is incompatible with this SDK's web3.js-v3 seam.
 *
 * Accounts (ATA program order): payer (signer, writable), ata (writable),
 * owner, mint, system program, token program.
 */
export function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    programId: associatedTokenProgramId,
    data: Buffer.from([1]), // 1 = CreateIdempotent
  });
}
