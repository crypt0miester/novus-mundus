/**
 * Address & PDA Cryptography
 *
 * Synchronous program-address derivation for @solana/kit `Address` values.
 *
 * `@solana/kit`'s `getProgramDerivedAddress` is async (it hashes via SubtleCrypto).
 * The SDK derives PDAs everywhere and relies on synchronous results, so we
 * reimplement the derivation with synchronous primitives — `@noble/hashes` for
 * SHA-256 and `@noble/curves` for the on-curve check. This mirrors exactly what
 * `@solana/web3.js`'s `PublicKey.findProgramAddressSync` did internally.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  type Address,
  getAddressEncoder,
  getAddressDecoder,
} from '@solana/kit';

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

/** Raw 32-byte encoding of an `Address`. */
export function addressBytes(addr: Address): Uint8Array<ArrayBuffer> {
  return new Uint8Array(addressEncoder.encode(addr));
}

/** Decode 32 raw bytes into an `Address`. */
export function bytesToAddress(bytes: Uint8Array): Address {
  return addressDecoder.decode(bytes);
}

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

/** True when the 32 bytes decompress to a valid ed25519 curve point. */
function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the address lies on the ed25519 curve — i.e. it could be a wallet
 * keypair rather than a program-derived address.
 */
export function isAddressOnCurve(addr: Address): boolean {
  return isOnCurve(addressBytes(addr));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
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

/**
 * Synchronously derive a program address from the given seeds.
 * Throws if the resulting address falls on the ed25519 curve.
 */
export function createProgramAddressSync(
  seeds: Uint8Array[],
  programId: Address
): Address {
  for (const seed of seeds) {
    if (seed.length > 32) {
      throw new Error(`Max seed length exceeded (${seed.length} > 32)`);
    }
  }
  const hash = sha256(
    concatBytes([...seeds, addressBytes(programId), PDA_MARKER])
  );
  if (isOnCurve(hash)) {
    throw new Error('Invalid seeds, address must fall off the curve');
  }
  return bytesToAddress(hash);
}

/**
 * Synchronously find a valid PDA and its bump seed.
 * Equivalent to `PublicKey.findProgramAddressSync` / Solana's
 * `find_program_address` (highest bump that yields an off-curve address).
 */
export function findProgramAddressSync(
  seeds: Uint8Array[],
  programId: Address
): [Address, number] {
  for (let bump = 255; bump >= 0; bump--) {
    try {
      const addr = createProgramAddressSync(
        [...seeds, new Uint8Array([bump])],
        programId
      );
      return [addr, bump];
    } catch {
      // address landed on-curve for this bump; try the next one
    }
  }
  throw new Error('Unable to find a viable program address bump seed');
}
