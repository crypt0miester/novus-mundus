/**
 * Borsh-compatible Deserialization Utilities
 *
 * Low-level utilities for deserializing account data from raw bytes.
 * All accounts are #[repr(C)] packed structs with explicit padding.
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/** Offset tracker for sequential reads */
export class BufferReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array | Buffer) {}

  /** Get current offset */
  getOffset(): number {
    return this.offset;
  }

  /** Set offset (for seeking) */
  setOffset(offset: number): void {
    this.offset = offset;
  }

  /** Skip bytes */
  skip(bytes: number): void {
    this.offset += bytes;
  }

  /** Read u8 */
  readU8(): number {
    const value = this.data[this.offset]!;
    this.offset += 1;
    return value;
  }

  /** Read i8 */
  readI8(): number {
    const value = this.readU8();
    return value > 127 ? value - 256 : value;
  }

  /** Read u16 (little-endian) */
  readU16(): number {
    const value = this.data[this.offset]! | (this.data[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }

  /** Read i16 (little-endian) */
  readI16(): number {
    const value = this.readU16();
    return value > 32767 ? value - 65536 : value;
  }

  /** Read u32 (little-endian) */
  readU32(): number {
    const value =
      this.data[this.offset]! |
      (this.data[this.offset + 1]! << 8) |
      (this.data[this.offset + 2]! << 16) |
      (this.data[this.offset + 3]! << 24);
    this.offset += 4;
    return value >>> 0; // Ensure unsigned
  }

  /** Read i32 (little-endian) */
  readI32(): number {
    const value =
      this.data[this.offset]! |
      (this.data[this.offset + 1]! << 8) |
      (this.data[this.offset + 2]! << 16) |
      (this.data[this.offset + 3]! << 24);
    this.offset += 4;
    return value;
  }

  /** Read u64 as BN (little-endian) */
  readU64(): BN {
    const bytes = this.data.slice(this.offset, this.offset + 8);
    this.offset += 8;
    return new BN(bytes, 'le');
  }

  /** Read i64 as BN (little-endian) */
  readI64(): BN {
    const bytes = this.data.slice(this.offset, this.offset + 8);
    this.offset += 8;
    const bn = new BN(bytes, 'le');
    // Handle signed: if high bit is set, subtract 2^64
    if (bytes[7]! & 0x80) {
      return bn.sub(new BN(1).shln(64));
    }
    return bn;
  }

  /** Read f32 (little-endian) */
  readF32(): number {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    for (let i = 0; i < 4; i++) {
      view.setUint8(i, this.data[this.offset + i]!);
    }
    this.offset += 4;
    return view.getFloat32(0, true);
  }

  /** Read f64 (little-endian) */
  readF64(): number {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    for (let i = 0; i < 8; i++) {
      view.setUint8(i, this.data[this.offset + i]!);
    }
    this.offset += 8;
    return view.getFloat64(0, true);
  }

  /** Read bool (1 byte) */
  readBool(): boolean {
    return this.readU8() !== 0;
  }

  /** Read PublicKey (32 bytes) */
  readPubkey(): PublicKey {
    const bytes = this.data.slice(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(bytes);
  }

  /** Read fixed-size byte array */
  readBytes(length: number): Uint8Array {
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  /** Read fixed-size string (null-terminated or full length) */
  readString(maxLength: number): string {
    const bytes = this.readBytes(maxLength);
    // Find null terminator
    let end = bytes.length;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) {
        end = i;
        break;
      }
    }
    return new TextDecoder().decode(bytes.slice(0, end));
  }

  /** Read string with separate length field (already read) */
  readStringWithLength(maxLength: number, actualLength: number): string {
    const bytes = this.readBytes(maxLength);
    return new TextDecoder().decode(bytes.slice(0, Math.min(actualLength, maxLength)));
  }

  /** Read array of u16 */
  readU16Array(count: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readU16());
    }
    return result;
  }

  /** Read array of u32 */
  readU32Array(count: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readU32());
    }
    return result;
  }

  /** Read array of u64 as BN */
  readU64Array(count: number): BN[] {
    const result: BN[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readU64());
    }
    return result;
  }

  /** Read array of i64 as BN */
  readI64Array(count: number): BN[] {
    const result: BN[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readI64());
    }
    return result;
  }

  /** Read array of f32 */
  readF32Array(count: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readF32());
    }
    return result;
  }

  /** Read array of Pubkeys */
  readPubkeyArray(count: number): PublicKey[] {
    const result: PublicKey[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readPubkey());
    }
    return result;
  }

  /** Check if pubkey is null (all zeros) */
  static isNullPubkey(pubkey: PublicKey): boolean {
    return pubkey.toBuffer().every((b) => b === 0);
  }

  /** Remaining bytes */
  remaining(): number {
    return this.data.length - this.offset;
  }
}

/** Null pubkey constant */
export const NULL_PUBKEY = new PublicKey(new Uint8Array(32));

/** Check if pubkey is null */
export function isNullPubkey(pubkey: PublicKey): boolean {
  return BufferReader.isNullPubkey(pubkey);
}
