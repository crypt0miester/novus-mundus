/**
 * Instruction-data assembly.
 *
 * Instruction arguments are encoded with the `packed` struct codecs in
 * `utils/codec.ts`; this prepends the 2-byte little-endian u16 discriminator.
 */

import type { ReadonlyUint8Array } from '@solana/kit';
import { concatBytes } from './bytes';

/**
 * Create instruction data with a 2-byte little-endian u16 discriminator prefix.
 * @param discriminator - the u16 instruction discriminator
 * @param data - optional encoded argument bytes (e.g. from a `packed` codec)
 */
export function createInstructionData(
  discriminator: number,
  data?: Uint8Array | ReadonlyUint8Array
): Uint8Array {
  const disc = new Uint8Array(2);
  new DataView(disc.buffer).setUint16(0, discriminator, true);
  return data && data.length > 0 ? concatBytes([disc, data]) : disc;
}
