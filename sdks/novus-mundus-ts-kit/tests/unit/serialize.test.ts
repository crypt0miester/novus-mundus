/**
 * Serialization Unit Tests
 *
 * Tests for BufferWriter and instruction data serialization.
 */

import { describe, it, expect } from 'bun:test';
import { address, generateKeyPairSigner } from '@solana/kit';
import BN from 'bn.js';
import { BufferWriter, createInstructionData } from '../../src/utils/serialize';
import { addressBytes } from '../../src/crypto';

const DEFAULT_ADDRESS = address('11111111111111111111111111111111');

describe('BufferWriter', () => {
  describe('integer writes', () => {
    it('should write u8 correctly', () => {
      const writer = new BufferWriter(3);
      writer.writeU8(0);
      writer.writeU8(127);
      writer.writeU8(255);

      const buf = writer.toBuffer();
      expect(buf.length).toBe(3);
      expect(buf[0]).toBe(0);
      expect(buf[1]).toBe(127);
      expect(buf[2]).toBe(255);
    });

    it('should write i8 correctly', () => {
      const writer = new BufferWriter(3);
      writer.writeI8(0);
      writer.writeI8(127);
      writer.writeI8(-128);

      const buf = writer.toBuffer();
      expect(buf.length).toBe(3);
      expect(buf[0]).toBe(0);
      expect(buf[1]).toBe(127);
      expect(buf[2]).toBe(128); // -128 as unsigned
    });

    it('should write u16 little-endian', () => {
      const writer = new BufferWriter(4);
      writer.writeU16(0);
      writer.writeU16(0x1234);

      const buf = writer.toBuffer();
      expect(buf.length).toBe(4);
      expect(buf[0]).toBe(0);
      expect(buf[1]).toBe(0);
      expect(buf[2]).toBe(0x34); // low byte first (little-endian)
      expect(buf[3]).toBe(0x12); // high byte second
    });

    it('should write i16 correctly', () => {
      const writer = new BufferWriter(4);
      writer.writeI16(1000);
      writer.writeI16(-1000);

      const buf = writer.toBuffer();
      // 1000 = 0x03E8
      expect(buf[0]).toBe(0xe8);
      expect(buf[1]).toBe(0x03);
      // -1000 in two's complement = 0xFC18
      expect(buf[2]).toBe(0x18);
      expect(buf[3]).toBe(0xfc);
    });

    it('should write u32 little-endian', () => {
      const writer = new BufferWriter(4);
      writer.writeU32(0x12345678);

      const buf = writer.toBuffer();
      expect(buf[0]).toBe(0x78);
      expect(buf[1]).toBe(0x56);
      expect(buf[2]).toBe(0x34);
      expect(buf[3]).toBe(0x12);
    });

    it('should write i32 correctly', () => {
      const writer = new BufferWriter(8);
      writer.writeI32(1000000);
      writer.writeI32(-1000000);

      const buf = writer.toBuffer();
      // 1000000 = 0x000F4240
      expect(buf.readInt32LE(0)).toBe(1000000);
      expect(buf.readInt32LE(4)).toBe(-1000000);
    });

    it('should write u64 from BN', () => {
      const writer = new BufferWriter(16);
      writer.writeU64(new BN(0));
      writer.writeU64(new BN('18446744073709551615')); // max u64

      const buf = writer.toBuffer();
      // First u64 should be all zeros
      for (let i = 0; i < 8; i++) {
        expect(buf[i]).toBe(0);
      }
      // Max u64 should be all 0xFF
      for (let i = 8; i < 16; i++) {
        expect(buf[i]).toBe(0xff);
      }
    });

    it('should write u64 from number', () => {
      const writer = new BufferWriter(8);
      writer.writeU64(1000000);

      const buf = writer.toBuffer();
      const bn = new BN(buf, 'le');
      expect(bn.toNumber()).toBe(1000000);
    });

    it('should write u64 from bigint', () => {
      const writer = new BufferWriter(8);
      writer.writeU64(BigInt('9007199254740992')); // Beyond safe integer

      const buf = writer.toBuffer();
      const bn = new BN(buf, 'le');
      expect(bn.toString()).toBe('9007199254740992');
    });

    it('should write i64 with negative values', () => {
      const writer = new BufferWriter(8);
      writer.writeI64(new BN(-1));

      const buf = writer.toBuffer();
      // -1 in two's complement is all 0xFF
      for (let i = 0; i < 8; i++) {
        expect(buf[i]).toBe(0xff);
      }
    });
  });

  describe('float writes', () => {
    it('should write f32 correctly', () => {
      const writer = new BufferWriter(4);
      writer.writeF32(3.14159);

      const buf = writer.toBuffer();
      const view = new DataView(buf.buffer, buf.byteOffset, 4);
      expect(view.getFloat32(0, true)).toBeCloseTo(3.14159, 4);
    });

    it('should write f64 correctly', () => {
      const writer = new BufferWriter(8);
      writer.writeF64(3.141592653589793);

      const buf = writer.toBuffer();
      const view = new DataView(buf.buffer, buf.byteOffset, 8);
      expect(view.getFloat64(0, true)).toBeCloseTo(3.141592653589793, 10);
    });
  });

  describe('bool and pubkey writes', () => {
    it('should write bool correctly', () => {
      const writer = new BufferWriter(2);
      writer.writeBool(true);
      writer.writeBool(false);

      const buf = writer.toBuffer();
      expect(buf[0]).toBe(1);
      expect(buf[1]).toBe(0);
    });

    it('should write PublicKey correctly', async () => {
      const keypair = await generateKeyPairSigner();
      const writer = new BufferWriter(32);
      writer.writePubkey(keypair.address);

      const buf = writer.toBuffer();
      expect(Uint8Array.from(buf)).toEqual(addressBytes(keypair.address));
    });
  });

  describe('string and bytes writes', () => {
    it('should write fixed-size string with padding', () => {
      const writer = new BufferWriter(32);
      writer.writeString('Hello', 32);

      const buf = writer.toBuffer();
      expect(buf.slice(0, 5).toString('utf8')).toBe('Hello');
      // Rest should be zeros
      for (let i = 5; i < 32; i++) {
        expect(buf[i]).toBe(0);
      }
    });

    it('should truncate string if too long', () => {
      const writer = new BufferWriter(5);
      writer.writeString('HelloWorld', 5);

      const buf = writer.toBuffer();
      expect(buf.toString('utf8')).toBe('Hello');
    });

    it('should write raw bytes', () => {
      const writer = new BufferWriter(4);
      writer.writeBytes(Buffer.from([1, 2, 3, 4]));

      const buf = writer.toBuffer();
      expect(buf[0]).toBe(1);
      expect(buf[1]).toBe(2);
      expect(buf[2]).toBe(3);
      expect(buf[3]).toBe(4);
    });

    it('should write zeros', () => {
      const writer = new BufferWriter(8);
      writer.writeU8(1);
      writer.writeZeros(6);
      writer.writeU8(2);

      const buf = writer.toBuffer();
      expect(buf[0]).toBe(1);
      for (let i = 1; i < 7; i++) {
        expect(buf[i]).toBe(0);
      }
      expect(buf[7]).toBe(2);
    });
  });

  describe('array writes', () => {
    it('should write u8 array', () => {
      const writer = new BufferWriter(4);
      writer.writeU8Array([1, 2, 3, 4]);

      const buf = writer.toBuffer();
      expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
    });

    it('should write u16 array', () => {
      const writer = new BufferWriter(4);
      writer.writeU16Array([0x0102, 0x0304]);

      const buf = writer.toBuffer();
      expect(buf[0]).toBe(0x02);
      expect(buf[1]).toBe(0x01);
      expect(buf[2]).toBe(0x04);
      expect(buf[3]).toBe(0x03);
    });

    it('should write u64 array', () => {
      const writer = new BufferWriter(16);
      writer.writeU64Array([new BN(100), new BN(200)]);

      const buf = writer.toBuffer();
      expect(new BN(buf.slice(0, 8), 'le').toNumber()).toBe(100);
      expect(new BN(buf.slice(8, 16), 'le').toNumber()).toBe(200);
    });

    it('should write pubkey array', async () => {
      const k1 = (await generateKeyPairSigner()).address;
      const k2 = (await generateKeyPairSigner()).address;
      const writer = new BufferWriter(64);
      writer.writePubkeyArray([k1, k2]);

      const buf = writer.toBuffer();
      expect(Uint8Array.from(buf.slice(0, 32))).toEqual(addressBytes(k1));
      expect(Uint8Array.from(buf.slice(32, 64))).toEqual(addressBytes(k2));
    });
  });

  describe('offset tracking', () => {
    it('should track offset correctly', () => {
      const writer = new BufferWriter(100);
      expect(writer.getOffset()).toBe(0);

      writer.writeU8(1);
      expect(writer.getOffset()).toBe(1);

      writer.writeU16(1);
      expect(writer.getOffset()).toBe(3);

      writer.writeU32(1);
      expect(writer.getOffset()).toBe(7);

      writer.writeU64(new BN(1));
      expect(writer.getOffset()).toBe(15);

      writer.writePubkey(DEFAULT_ADDRESS);
      expect(writer.getOffset()).toBe(47);
    });

    it('should return only written portion with toBuffer', () => {
      const writer = new BufferWriter(100);
      writer.writeU8(1);
      writer.writeU8(2);

      const buf = writer.toBuffer();
      expect(buf.length).toBe(2);
    });

    it('should return full buffer with toFullBuffer', () => {
      const writer = new BufferWriter(100);
      writer.writeU8(1);

      const full = writer.toFullBuffer();
      expect(full.length).toBe(100);
    });
  });
});

describe('createInstructionData', () => {
  it('should create discriminator-only data', () => {
    const data = createInstructionData(0x1234);

    expect(data.length).toBe(2);
    expect(data[0]).toBe(0x34); // little-endian
    expect(data[1]).toBe(0x12);
  });

  it('should concatenate discriminator and payload', () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const data = createInstructionData(0x0001, payload);

    expect(data.length).toBe(6);
    expect(data[0]).toBe(0x01);
    expect(data[1]).toBe(0x00);
    expect(data[2]).toBe(1);
    expect(data[3]).toBe(2);
    expect(data[4]).toBe(3);
    expect(data[5]).toBe(4);
  });

  it('should handle empty payload', () => {
    const data = createInstructionData(0x0005, Buffer.alloc(0));

    expect(data.length).toBe(2);
    expect(data[0]).toBe(0x05);
    expect(data[1]).toBe(0x00);
  });
});
