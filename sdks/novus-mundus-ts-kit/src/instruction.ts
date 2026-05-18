/**
 * Instruction Construction Helpers
 *
 * Bridges the SDK's `{ pubkey, isSigner, isWritable }` account-key style
 * (carried over from `@solana/web3.js`) to `@solana/kit`'s `Instruction`
 * shape, so instruction builders stay terse and uniform.
 */

import {
  AccountRole,
  type Address,
  type AccountMeta,
  type Instruction,
} from '@solana/kit';

/** web3.js-style account key, as written inline by each instruction builder. */
export interface AccountKey {
  pubkey: Address;
  isSigner: boolean;
  isWritable: boolean;
}

/** Convert a web3.js-style account key to a kit `AccountMeta`. */
export function toAccountMeta(key: AccountKey): AccountMeta {
  const { pubkey, isSigner, isWritable } = key;
  const role = isWritable
    ? isSigner
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.WRITABLE
    : isSigner
      ? AccountRole.READONLY_SIGNER
      : AccountRole.READONLY;
  return { address: pubkey, role };
}

/** Assemble a kit `Instruction` from a program id, account keys, and data. */
export function buildInstruction(
  programAddress: Address,
  keys: AccountKey[],
  data: Uint8Array
): Instruction {
  return {
    programAddress,
    accounts: keys.map(toAccountMeta),
    data,
  };
}
