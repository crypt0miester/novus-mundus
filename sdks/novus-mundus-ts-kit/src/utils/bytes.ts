/**
 * Byte-array helpers — `Uint8Array` only (no Node `Buffer`, so this runs in
 * browsers too).
 */

import type { ReadonlyUint8Array } from '@solana/kit';

/** Concatenate byte arrays into a single `Uint8Array`. */
export function concatBytes(chunks: ReadonlyArray<Uint8Array | ReadonlyUint8Array>): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
