/**
 * Address Cryptography
 *
 * Raw-byte helpers and the ed25519 on-curve check for `@solana/kit` `Address`
 * values. 
 */

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
