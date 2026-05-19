/**
 * Null-address helpers.
 *
 * Account deserialization is handled by the struct codecs in `utils/codec.ts`.
 */

import { address, type Address } from '@solana/kit';

/** Null address constant (32 zero bytes) */
export const NULL_PUBKEY: Address = address('11111111111111111111111111111111');

/** Check if an address is null (the all-zeros address) */
export function isNullPubkey(pubkey: Address): boolean {
  return pubkey === NULL_PUBKEY;
}
