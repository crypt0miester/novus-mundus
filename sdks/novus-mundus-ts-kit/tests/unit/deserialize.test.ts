/**
 * Deserialization Unit Tests
 *
 * Tests for BufferReader and account data deserialization.
 */

import { describe, it, expect } from 'bun:test';
import { address, generateKeyPairSigner } from '@solana/kit';
import BN from 'bn.js';
import { BufferReader, NULL_PUBKEY, isNullPubkey } from '../../src/utils/deserialize';
import { addressBytes } from '../../src/crypto';

const DEFAULT_ADDRESS = address('11111111111111111111111111111111');

describe('BufferReader', () => {
  describe('integer reads', () => {
    it('should read u8 correctly', () => {
      const reader = new BufferReader(Buffer.from([0, 127, 255]));

      expect(reader.readU8()).toBe(0);
      expect(reader.readU8()).toBe(127);
      expect(reader.readU8()).toBe(255);
    });

    it('should read i8 correctly', () => {
      const reader = new BufferReader(Buffer.from([0, 127, 128, 255]));

      expect(reader.readI8()).toBe(0);
      expect(reader.readI8()).toBe(127);
      expect(reader.readI8()).toBe(-128);
      expect(reader.readI8()).toBe(-1);
    });

    it('should read u16 little-endian', () => {
      const reader = new BufferReader(Buffer.from([0x34, 0x12, 0xff, 0xff]));

      expect(reader.readU16()).toBe(0x1234);
      expect(reader.readU16()).toBe(0xffff);
    });

    it('should read i16 correctly', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt16LE(1000, 0);
      buf.writeInt16LE(-1000, 2);

      const reader = new BufferReader(buf);
      expect(reader.readI16()).toBe(1000);
      expect(reader.readI16()).toBe(-1000);
    });

    it('should read u32 little-endian', () => {
      const reader = new BufferReader(Buffer.from([0x78, 0x56, 0x34, 0x12]));

      expect(reader.readU32()).toBe(0x12345678);
    });

    it('should read i32 correctly', () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32LE(1000000, 0);
      buf.writeInt32LE(-1000000, 4);

      const reader = new BufferReader(buf);
      expect(reader.readI32()).toBe(1000000);
      expect(reader.readI32()).toBe(-1000000);
    });

    it('should read u64 as BN', () => {
      // Zero
      const zeroReader = new BufferReader(Buffer.alloc(8));
      expect(zeroReader.readU64().toNumber()).toBe(0);

      // Max u64
      const maxReader = new BufferReader(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
      expect(maxReader.readU64().toString()).toBe('18446744073709551615');

      // Regular value
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(1000000, 0);
      buf.writeUInt32LE(0, 4);
      const reader = new BufferReader(buf);
      expect(reader.readU64().toNumber()).toBe(1000000);
    });

    it('should read i64 with negative values', () => {
      // -1 (all 0xFF)
      const negOneReader = new BufferReader(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
      expect(negOneReader.readI64().toNumber()).toBe(-1);

      // Positive value
      const buf = Buffer.alloc(8);
      new BN(1000000).toArrayLike(Buffer, 'le', 8).copy(buf);
      const posReader = new BufferReader(buf);
      expect(posReader.readI64().toNumber()).toBe(1000000);

      // Large negative
      const negBuf = Buffer.alloc(8);
      new BN(-1000000).add(new BN(1).shln(64)).toArrayLike(Buffer, 'le', 8).copy(negBuf);
      const negReader = new BufferReader(negBuf);
      expect(negReader.readI64().toNumber()).toBe(-1000000);
    });
  });

  describe('float reads', () => {
    it('should read f32 correctly', () => {
      const buf = Buffer.alloc(4);
      const view = new DataView(buf.buffer);
      view.setFloat32(0, 3.14159, true);

      const reader = new BufferReader(buf);
      expect(reader.readF32()).toBeCloseTo(3.14159, 4);
    });

    it('should read f64 correctly', () => {
      const buf = Buffer.alloc(8);
      const view = new DataView(buf.buffer);
      view.setFloat64(0, 3.141592653589793, true);

      const reader = new BufferReader(buf);
      expect(reader.readF64()).toBeCloseTo(3.141592653589793, 10);
    });
  });

  describe('bool and pubkey reads', () => {
    it('should read bool correctly', () => {
      const reader = new BufferReader(Buffer.from([0, 1, 2, 255]));

      expect(reader.readBool()).toBe(false);
      expect(reader.readBool()).toBe(true);
      expect(reader.readBool()).toBe(true); // Any non-zero is true
      expect(reader.readBool()).toBe(true);
    });

    it('should read PublicKey correctly', async () => {
      const keypair = await generateKeyPairSigner();
      const buf = Buffer.from(addressBytes(keypair.address));

      const reader = new BufferReader(buf);
      const pubkey = reader.readPubkey();

      expect(pubkey).toBe(keypair.address);
    });
  });

  describe('string and bytes reads', () => {
    it('should read null-terminated string', () => {
      const buf = Buffer.alloc(32);
      buf.write('Hello', 0, 'utf8');
      buf[5] = 0; // null terminator

      const reader = new BufferReader(buf);
      expect(reader.readString(32)).toBe('Hello');
    });

    it('should read full string without null terminator', () => {
      const buf = Buffer.from('HelloWorld');

      const reader = new BufferReader(buf);
      expect(reader.readString(10)).toBe('HelloWorld');
    });

    it('should read string with separate length', () => {
      const buf = Buffer.alloc(32);
      buf.write('Hello', 0, 'utf8');

      const reader = new BufferReader(buf);
      expect(reader.readStringWithLength(32, 5)).toBe('Hello');
    });

    it('should read raw bytes', () => {
      const reader = new BufferReader(Buffer.from([1, 2, 3, 4, 5]));

      const bytes = reader.readBytes(3);
      expect(Array.from(bytes)).toEqual([1, 2, 3]);

      const more = reader.readBytes(2);
      expect(Array.from(more)).toEqual([4, 5]);
    });
  });

  describe('array reads', () => {
    it('should read u16 array', () => {
      const buf = Buffer.alloc(6);
      buf.writeUInt16LE(100, 0);
      buf.writeUInt16LE(200, 2);
      buf.writeUInt16LE(300, 4);

      const reader = new BufferReader(buf);
      expect(reader.readU16Array(3)).toEqual([100, 200, 300]);
    });

    it('should read u32 array', () => {
      const buf = Buffer.alloc(12);
      buf.writeUInt32LE(1000, 0);
      buf.writeUInt32LE(2000, 4);
      buf.writeUInt32LE(3000, 8);

      const reader = new BufferReader(buf);
      expect(reader.readU32Array(3)).toEqual([1000, 2000, 3000]);
    });

    it('should read u64 array', () => {
      const buf = Buffer.alloc(16);
      new BN(100).toArrayLike(Buffer, 'le', 8).copy(buf, 0);
      new BN(200).toArrayLike(Buffer, 'le', 8).copy(buf, 8);

      const reader = new BufferReader(buf);
      const arr = reader.readU64Array(2);

      expect(arr[0]!.toNumber()).toBe(100);
      expect(arr[1]!.toNumber()).toBe(200);
    });

    it('should read i64 array', () => {
      const buf = Buffer.alloc(16);
      new BN(100).toArrayLike(Buffer, 'le', 8).copy(buf, 0);
      new BN(-100).add(new BN(1).shln(64)).toArrayLike(Buffer, 'le', 8).copy(buf, 8);

      const reader = new BufferReader(buf);
      const arr = reader.readI64Array(2);

      expect(arr[0]!.toNumber()).toBe(100);
      expect(arr[1]!.toNumber()).toBe(-100);
    });

    it('should read f32 array', () => {
      const buf = Buffer.alloc(8);
      const view = new DataView(buf.buffer);
      view.setFloat32(0, 1.5, true);
      view.setFloat32(4, 2.5, true);

      const reader = new BufferReader(buf);
      const arr = reader.readF32Array(2);

      expect(arr[0]).toBeCloseTo(1.5, 5);
      expect(arr[1]).toBeCloseTo(2.5, 5);
    });

    it('should read pubkey array', async () => {
      const k1 = (await generateKeyPairSigner()).address;
      const k2 = (await generateKeyPairSigner()).address;
      const buf = Buffer.concat([
        Buffer.from(addressBytes(k1)),
        Buffer.from(addressBytes(k2)),
      ]);

      const reader = new BufferReader(buf);
      const arr = reader.readPubkeyArray(2);

      expect(arr[0]!).toBe(k1);
      expect(arr[1]!).toBe(k2);
    });
  });

  describe('offset management', () => {
    it('should track offset correctly', () => {
      const reader = new BufferReader(Buffer.alloc(100));

      expect(reader.getOffset()).toBe(0);

      reader.readU8();
      expect(reader.getOffset()).toBe(1);

      reader.readU16();
      expect(reader.getOffset()).toBe(3);

      reader.readU32();
      expect(reader.getOffset()).toBe(7);

      reader.readU64();
      expect(reader.getOffset()).toBe(15);

      reader.readPubkey();
      expect(reader.getOffset()).toBe(47);
    });

    it('should allow setting offset', () => {
      const buf = Buffer.alloc(10);
      buf.writeUInt8(1, 0);
      buf.writeUInt8(2, 5);

      const reader = new BufferReader(buf);
      expect(reader.readU8()).toBe(1);

      reader.setOffset(5);
      expect(reader.readU8()).toBe(2);
    });

    it('should skip bytes', () => {
      const buf = Buffer.alloc(10);
      buf.writeUInt8(1, 0);
      buf.writeUInt8(2, 5);

      const reader = new BufferReader(buf);
      expect(reader.readU8()).toBe(1);

      reader.skip(4);
      expect(reader.readU8()).toBe(2);
    });

    it('should report remaining bytes', () => {
      const reader = new BufferReader(Buffer.alloc(10));

      expect(reader.remaining()).toBe(10);

      reader.readU8();
      expect(reader.remaining()).toBe(9);

      reader.readU32();
      expect(reader.remaining()).toBe(5);
    });
  });

  describe('null pubkey', () => {
    it('should correctly identify null pubkey', () => {
      expect(isNullPubkey(NULL_PUBKEY)).toBe(true);
      expect(isNullPubkey(DEFAULT_ADDRESS)).toBe(true);
      expect(BufferReader.isNullPubkey(NULL_PUBKEY)).toBe(true);
    });

    it('should correctly identify non-null pubkey', async () => {
      const keypair = await generateKeyPairSigner();
      expect(isNullPubkey(keypair.address)).toBe(false);
      expect(BufferReader.isNullPubkey(keypair.address)).toBe(false);
    });
  });
});

describe('roundtrip serialization', () => {
  it('should roundtrip integers', () => {
    // Import writer dynamically to avoid circular dependency issues in test
    const { BufferWriter } = require('../../src/utils/serialize');

    const writer = new BufferWriter(50);
    writer.writeU8(255);
    writer.writeI8(-100);
    writer.writeU16(65535);
    writer.writeI16(-30000);
    writer.writeU32(0xdeadbeef);
    writer.writeI32(-1000000);
    writer.writeU64(new BN('9007199254740992'));
    writer.writeI64(new BN(-1000000));

    const reader = new BufferReader(writer.toBuffer());

    expect(reader.readU8()).toBe(255);
    expect(reader.readI8()).toBe(-100);
    expect(reader.readU16()).toBe(65535);
    expect(reader.readI16()).toBe(-30000);
    expect(reader.readU32()).toBe(0xdeadbeef);
    expect(reader.readI32()).toBe(-1000000);
    expect(reader.readU64().toString()).toBe('9007199254740992');
    expect(reader.readI64().toNumber()).toBe(-1000000);
  });

  it('should roundtrip floats', () => {
    const { BufferWriter } = require('../../src/utils/serialize');

    const writer = new BufferWriter(12);
    writer.writeF32(3.14159);
    writer.writeF64(2.718281828459045);

    const reader = new BufferReader(writer.toBuffer());

    expect(reader.readF32()).toBeCloseTo(3.14159, 4);
    expect(reader.readF64()).toBeCloseTo(2.718281828459045, 10);
  });

  it('should roundtrip pubkeys and strings', async () => {
    const { BufferWriter } = require('../../src/utils/serialize');

    const keypair = await generateKeyPairSigner();
    const writer = new BufferWriter(64);
    writer.writePubkey(keypair.address);
    writer.writeString('TestPlayer', 32);

    const reader = new BufferReader(writer.toBuffer());

    expect(reader.readPubkey()).toBe(keypair.address);
    expect(reader.readString(32)).toBe('TestPlayer');
  });
});
