/**
 * Borsh-compatible Serialization Utilities
 *
 * Low-level utilities for serializing instruction data to raw bytes.
 * Compatible with Pinocchio's little-endian u16 discriminator format.
 *
 * Operates on Uint8Array (web3.js v3 / browser-safe). u64/i64 values are native
 * `bigint`, not BN.
 */

import { PublicKey } from '@solana/web3.js';

/**
 * BufferWriter for sequential byte writes.
 * Preallocates a Uint8Array and writes sequentially.
 */
export class BufferWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(size: number) {
    this.buffer = new Uint8Array(size);
    this.view = new DataView(this.buffer.buffer);
  }

  /** Get current offset */
  getOffset(): number {
    return this.offset;
  }

  /** Get the written portion of the buffer */
  toBuffer(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }

  /** Get full allocated buffer (including unwritten zeros) */
  toFullBuffer(): Uint8Array {
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

  /** Write u64 from number or bigint (little-endian) */
  writeU64(value: number | bigint): this {
    this.view.setBigUint64(this.offset, BigInt(value), true);
    this.offset += 8;
    return this;
  }

  /** Write i64 from number or bigint (little-endian) */
  writeI64(value: number | bigint): this {
    this.view.setBigInt64(this.offset, BigInt(value), true);
    this.offset += 8;
    return this;
  }

  /** Write f32 (little-endian) */
  writeF32(value: number): this {
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
    return this;
  }

  /** Write f64 (little-endian) */
  writeF64(value: number): this {
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
    return this;
  }

  /** Write bool (1 byte: 0 or 1) */
  writeBool(value: boolean): this {
    return this.writeU8(value ? 1 : 0);
  }

  /** Write PublicKey (32 bytes) */
  writePubkey(value: PublicKey): this {
    this.buffer.set(value.toBytes(), this.offset);
    this.offset += 32;
    return this;
  }

  /** Write raw bytes */
  writeBytes(bytes: Uint8Array): this {
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
    return this;
  }

  /** Write fixed-size string (padded with zeros) */
  writeString(value: string, maxLength: number): this {
    const bytes = new TextEncoder().encode(value);
    const toWrite = Math.min(bytes.length, maxLength);
    this.buffer.set(bytes.subarray(0, toWrite), this.offset);
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
  writeU64Array(values: (number | bigint)[]): this {
    for (const v of values) {
      this.writeU64(v);
    }
    return this;
  }

  /** Write array of Pubkeys */
  writePubkeyArray(values: PublicKey[]): this {
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
export function createInstructionData(discriminator: number, data?: Uint8Array): Uint8Array {
  const discriminatorBuf = new Uint8Array(2);
  new DataView(discriminatorBuf.buffer).setUint16(0, discriminator, true);

  if (!data || data.length === 0) {
    return discriminatorBuf;
  }

  const out = new Uint8Array(discriminatorBuf.length + data.length);
  out.set(discriminatorBuf, 0);
  out.set(data, discriminatorBuf.length);
  return out;
}
