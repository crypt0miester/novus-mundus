/**
 * Instruction Parser Unit Tests
 *
 * Tests for instruction data parsing.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseInstructionData,
  parseInstructionFromBase64,
  isNovusMundusInstruction,
  getInstructionNameFromData,
  type HireUnitsData,
  type IntercityStartData,
  type IntracityStartData,
  type TeamCreateData,
  type RallyJoinData,
} from '../../src/parser/instruction';
import { DISCRIMINATORS } from '../../src/program';
import { createInstructionData } from '../../src/utils/serialize';
import { getBase64Decoder } from '@solana/kit';

// Test-data builders — construct instruction-argument byte arrays directly as
// Uint8Arrays (no Node Buffer), mirroring the on-chain little-endian layout.

/** Build a u8. */
function u8Bytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

/** Build a little-endian u16. */
function u16Bytes(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

/** Build a little-endian i32. */
function i32Bytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value, true);
  return out;
}

/** Build a little-endian u64. */
function u64Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** Concatenate byte chunks into a single Uint8Array. */
function concat(...chunks: Uint8Array[]): Uint8Array {
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

describe('Instruction Parser', () => {
  describe('parseInstructionData', () => {
    it('should return null for data too short', () => {
      expect(parseInstructionData(new Uint8Array(1))).toBeNull();
      expect(parseInstructionData(new Uint8Array(0))).toBeNull();
    });

    it('should return null for unknown discriminator', () => {
      const buf = createInstructionData(9999); // Unknown discriminator
      expect(parseInstructionData(buf)).toBeNull();
    });

    it('should parse HireUnits instruction', () => {
      // Build instruction data: discriminator (2) + unitType (1) + noviAmount (8)
      const args = concat(u8Bytes(3), u64Bytes(1000n));
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, args);

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.discriminator).toBe(DISCRIMINATORS.HIRE_UNITS);
      expect(parsed!.name).toBe('HIRE_UNITS');
      expect(parsed!.category).toBe('Economy');

      const hireData = parsed!.data as HireUnitsData;
      expect(hireData.unitType).toBe(3);
      expect(Number(hireData.noviAmount)).toBe(1000);
    });

    it('should parse IntercityStart instruction', () => {
      const args = u16Bytes(5); // targetCityId
      const data = createInstructionData(DISCRIMINATORS.INTERCITY_START, args);

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('INTERCITY_START');
      expect(parsed!.category).toBe('TravelIntercity');

      const travelData = parsed!.data as IntercityStartData;
      expect(travelData.targetCityId).toBe(5);
    });

    it('should parse IntracityStart instruction', () => {
      const args = concat(
        i32Bytes(40712800), // targetLat (fixed-point)
        i32Bytes(-74006000) // targetLong (fixed-point)
      );
      const data = createInstructionData(DISCRIMINATORS.INTRACITY_START, args);

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('INTRACITY_START');

      const intracityData = parsed!.data as IntracityStartData;
      expect(intracityData.targetLat).toBe(40712800);
      expect(intracityData.targetLong).toBe(-74006000);
    });

    it('should parse TeamCreate instruction', () => {
      const teamName = 'TestTeam';
      const nameBytes = new TextEncoder().encode(teamName);
      const args = concat(u8Bytes(nameBytes.length), nameBytes);
      const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE, args);

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('TEAM_CREATE');
      expect(parsed!.category).toBe('Team');

      const teamData = parsed!.data as TeamCreateData;
      expect(teamData.name).toBe('TestTeam');
    });

    it('should parse RallyJoin instruction', () => {
      const args = concat(
        u64Bytes(100n), // du1
        u64Bytes(200n), // du2
        u64Bytes(300n), // du3
        u64Bytes(50n), // melee
        u64Bytes(60n), // ranged
        u64Bytes(70n) // siege
      );
      const data = createInstructionData(DISCRIMINATORS.RALLY_JOIN, args);

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('RALLY_JOIN');
      expect(parsed!.category).toBe('Rally');

      const rallyData = parsed!.data as RallyJoinData;
      expect(Number(rallyData.du1)).toBe(100);
      expect(Number(rallyData.du2)).toBe(200);
      expect(Number(rallyData.du3)).toBe(300);
      expect(Number(rallyData.meleeWeapons)).toBe(50);
      expect(Number(rallyData.rangedWeapons)).toBe(60);
      expect(Number(rallyData.siegeWeapons)).toBe(70);
    });

    it('should handle instructions with no parameters', () => {
      // COLLECT_RESOURCES has no parameters
      const data = createInstructionData(DISCRIMINATORS.COLLECT_RESOURCES);

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('COLLECT_RESOURCES');
      expect(parsed!.data).toEqual({});
    });

    it('should handle parse errors gracefully', () => {
      // HireUnits expects 9 bytes of data, but we give it less
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, new Uint8Array(2));

      const parsed = parseInstructionData(data);

      // Should still return parsed instruction with error info
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('HIRE_UNITS');
    });
  });

  describe('parseInstructionFromBase64', () => {
    it('should parse base64-encoded instruction', () => {
      const args = concat(u8Bytes(2), u64Bytes(500n));
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, args);
      const base64 = getBase64Decoder().decode(data);

      const parsed = parseInstructionFromBase64(base64);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('HIRE_UNITS');
      expect((parsed!.data as HireUnitsData).unitType).toBe(2);
    });

    it('should handle invalid base64', () => {
      // This will decode but produce garbage
      const parsed = parseInstructionFromBase64('!!!invalid!!!');
      // Will likely be null due to unknown discriminator
      expect(parsed).toBeNull();
    });
  });

  describe('isNovusMundusInstruction', () => {
    it('should return true for known discriminator', () => {
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS);
      expect(isNovusMundusInstruction(data)).toBe(true);
    });

    it('should return false for unknown discriminator', () => {
      const buf = createInstructionData(9999);
      expect(isNovusMundusInstruction(buf)).toBe(false);
    });

    it('should return false for data too short', () => {
      expect(isNovusMundusInstruction(new Uint8Array(1))).toBe(false);
    });
  });

  describe('getInstructionNameFromData', () => {
    it('should return instruction name', () => {
      const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE);
      expect(getInstructionNameFromData(data)).toBe('TEAM_CREATE');
    });

    it('should return undefined for unknown discriminator', () => {
      const buf = createInstructionData(9999);
      expect(getInstructionNameFromData(buf)).toBeUndefined();
    });

    it('should return undefined for data too short', () => {
      expect(getInstructionNameFromData(new Uint8Array(1))).toBeUndefined();
    });
  });

  describe('category mapping', () => {
    it('should categorize Economy instructions', () => {
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS);
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Economy');
    });

    it('should categorize Combat instructions', () => {
      const data = createInstructionData(DISCRIMINATORS.ATTACK_PLAYER, new Uint8Array([0]));
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Combat');
    });

    it('should categorize Travel instructions', () => {
      const data = createInstructionData(DISCRIMINATORS.INTERCITY_START, u16Bytes(1));
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('TravelIntercity');
    });

    it('should categorize Team instructions', () => {
      const teamName = 'Test';
      const nameBytes = new TextEncoder().encode(teamName);
      const args = concat(u8Bytes(nameBytes.length), nameBytes);
      const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE, args);
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Team');
    });

    it('should categorize Rally instructions', () => {
      const args = concat(...Array.from({ length: 6 }, () => u64Bytes(0n)));
      const data = createInstructionData(DISCRIMINATORS.RALLY_JOIN, args);
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Rally');
    });
  });
});

describe('Instruction Roundtrip', () => {
  it('should roundtrip HireUnits data', () => {
    const originalUnitType = 3;
    const originalAmount = 12345n;

    // Create instruction
    const args = concat(u8Bytes(originalUnitType), u64Bytes(originalAmount));
    const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, args);

    // Parse back
    const parsed = parseInstructionData(data);
    const hireData = parsed!.data as HireUnitsData;

    expect(hireData.unitType).toBe(originalUnitType);
    expect(hireData.noviAmount === originalAmount).toBe(true);
  });

  it('should roundtrip negative coordinates', () => {
    const originalLat = -40712800;
    const originalLong = 74006000;

    const args = concat(i32Bytes(originalLat), i32Bytes(originalLong));
    const data = createInstructionData(DISCRIMINATORS.INTRACITY_START, args);

    const parsed = parseInstructionData(data);
    const intracityData = parsed!.data as IntracityStartData;

    expect(intracityData.targetLat).toBe(originalLat);
    expect(intracityData.targetLong).toBe(originalLong);
  });
});
