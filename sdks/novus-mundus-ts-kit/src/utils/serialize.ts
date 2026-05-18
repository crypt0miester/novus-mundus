/**
 * Borsh-compatible Serialization Utilities
 *
 * Low-level utilities for serializing instruction data to raw bytes.
 * Compatible with Pinocchio's little-endian u16 discriminator format.
 */

import type { Address } from '@solana/kit';
import BN from 'bn.js';
import { addressBytes } from '../crypto';

/**
 * BufferWriter for sequential byte writes.
 * Preallocates buffer and writes sequentially.
 */
export class BufferWriter {
  private buffer: Buffer;
  private offset = 0;

  constructor(size: number) {
    this.buffer = Buffer.alloc(size);
  }

  /** Get current offset */
  getOffset(): number {
    return this.offset;
  }

  /** Get the written portion of the buffer */
  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }

  /** Get full allocated buffer (including unwritten zeros) */
  toFullBuffer(): Buffer {
    return this.buffer;
  }

  /** Write u8 */
  writeU8(value: number): this {
    this.buffer[this.offset] = value & 0xff;
    this.offset += 1;
    return this;
  }

  /** Write i8 */
  writeI8(value: number): this {
    const unsigned = value < 0 ? value + 256 : value;
    return this.writeU8(unsigned);
  }

  /** Write u16 (little-endian) */
  writeU16(value: number): this {
    this.buffer[this.offset] = value & 0xff;
    this.buffer[this.offset + 1] = (value >> 8) & 0xff;
    this.offset += 2;
    return this;
  }

  /** Write i16 (little-endian) */
  writeI16(value: number): this {
    const unsigned = value < 0 ? value + 65536 : value;
    return this.writeU16(unsigned);
  }

  /** Write u32 (little-endian) */
  writeU32(value: number): this {
    this.buffer[this.offset] = value & 0xff;
    this.buffer[this.offset + 1] = (value >> 8) & 0xff;
    this.buffer[this.offset + 2] = (value >> 16) & 0xff;
    this.buffer[this.offset + 3] = (value >> 24) & 0xff;
    this.offset += 4;
    return this;
  }

  /** Write i32 (little-endian) */
  writeI32(value: number): this {
    const unsigned = value < 0 ? value + 4294967296 : value;
    return this.writeU32(unsigned);
  }

  /** Write u64 from BN or number (little-endian) */
  writeU64(value: BN | number | bigint): this {
    let bn: BN;
    if (typeof value === 'number') {
      bn = new BN(value);
    } else if (typeof value === 'bigint') {
      bn = new BN(value.toString());
    } else {
      bn = value;
    }
    const bytes = bn.toArrayLike(Buffer, 'le', 8);
    bytes.copy(this.buffer as Uint8Array, this.offset);
    this.offset += 8;
    return this;
  }

  /** Write i64 from BN or number (little-endian) */
  writeI64(value: BN | number | bigint): this {
    let bn: BN;
    if (typeof value === 'number') {
      bn = new BN(value);
    } else if (typeof value === 'bigint') {
      bn = new BN(value.toString());
    } else {
      bn = value;
    }
    // Handle negative: add 2^64
    if (bn.isNeg()) {
      bn = bn.add(new BN(1).shln(64));
    }
    const bytes = bn.toArrayLike(Buffer, 'le', 8);
    bytes.copy(this.buffer as Uint8Array, this.offset);
    this.offset += 8;
    return this;
  }

  /** Write f32 (little-endian) */
  writeF32(value: number): this {
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.offset, 4);
    view.setFloat32(0, value, true);
    this.offset += 4;
    return this;
  }

  /** Write f64 (little-endian) */
  writeF64(value: number): this {
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.offset, 8);
    view.setFloat64(0, value, true);
    this.offset += 8;
    return this;
  }

  /** Write bool (1 byte: 0 or 1) */
  writeBool(value: boolean): this {
    return this.writeU8(value ? 1 : 0);
  }

  /** Write an Address (32 bytes) */
  writePubkey(value: Address): this {
    this.buffer.set(addressBytes(value), this.offset);
    this.offset += 32;
    return this;
  }

  /** Write raw bytes */
  writeBytes(bytes: Buffer | Uint8Array): this {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    buf.copy(this.buffer as Uint8Array, this.offset);
    this.offset += bytes.length;
    return this;
  }

  /** Write fixed-size string (padded with zeros) */
  writeString(value: string, maxLength: number): this {
    const bytes = Buffer.from(value, 'utf8');
    const toWrite = Math.min(bytes.length, maxLength);
    bytes.copy(this.buffer as Uint8Array, this.offset, 0, toWrite);
    // Zero-pad remaining
    this.buffer.fill(0, this.offset + toWrite, this.offset + maxLength);
    this.offset += maxLength;
    return this;
  }

  /** Write zeros (padding) */
  writeZeros(count: number): this {
    this.buffer.fill(0, this.offset, this.offset + count);
    this.offset += count;
    return this;
  }

  /** Write array of u8 */
  writeU8Array(values: number[]): this {
    for (const v of values) {
      this.writeU8(v);
    }
    return this;
  }

  /** Write array of u16 */
  writeU16Array(values: number[]): this {
    for (const v of values) {
      this.writeU16(v);
    }
    return this;
  }

  /** Write array of u32 */
  writeU32Array(values: number[]): this {
    for (const v of values) {
      this.writeU32(v);
    }
    return this;
  }

  /** Write array of u64 */
  writeU64Array(values: (BN | number | bigint)[]): this {
    for (const v of values) {
      this.writeU64(v);
    }
    return this;
  }

  /** Write array of Addresses */
  writePubkeyArray(values: Address[]): this {
    for (const v of values) {
      this.writePubkey(v);
    }
    return this;
  }
}

/**
 * Create instruction data with discriminator prefix.
 * @param discriminator - 2-byte little-endian u16 instruction discriminator
 * @param data - Optional additional instruction data
 */
export function createInstructionData(discriminator: number, data?: Buffer): Buffer {
  const discriminatorBuf = Buffer.alloc(2);
  discriminatorBuf.writeUInt16LE(discriminator);

  if (!data || data.length === 0) {
    return discriminatorBuf;
  }

  return Buffer.concat([discriminatorBuf, data] as Uint8Array[]);
}
