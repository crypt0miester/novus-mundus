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
import { BufferWriter, createInstructionData } from '../../src/utils/serialize';

describe('Instruction Parser', () => {
  describe('parseInstructionData', () => {
    it('should return null for data too short', () => {
      expect(parseInstructionData(Buffer.alloc(1))).toBeNull();
      expect(parseInstructionData(Buffer.alloc(0))).toBeNull();
    });

    it('should return null for unknown discriminator', () => {
      const buf = Buffer.alloc(10);
      buf.writeUInt16LE(9999, 0); // Unknown discriminator
      expect(parseInstructionData(buf)).toBeNull();
    });

    it('should parse HireUnits instruction', () => {
      // Build instruction data: discriminator (2) + unitType (1) + noviAmount (8)
      const writer = new BufferWriter(9);
      writer.writeU8(3); // unitType
      writer.writeU64(1000n);
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, writer.toBuffer());

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
      const writer = new BufferWriter(2);
      writer.writeU16(5); // targetCityId
      const data = createInstructionData(DISCRIMINATORS.INTERCITY_START, writer.toBuffer());

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('INTERCITY_START');
      expect(parsed!.category).toBe('TravelIntercity');

      const travelData = parsed!.data as IntercityStartData;
      expect(travelData.targetCityId).toBe(5);
    });

    it('should parse IntracityStart instruction', () => {
      const writer = new BufferWriter(8);
      writer.writeI32(40712800); // targetLat (fixed-point)
      writer.writeI32(-74006000); // targetLong (fixed-point)
      const data = createInstructionData(DISCRIMINATORS.INTRACITY_START, writer.toBuffer());

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('INTRACITY_START');

      const intracityData = parsed!.data as IntracityStartData;
      expect(intracityData.targetLat).toBe(40712800);
      expect(intracityData.targetLong).toBe(-74006000);
    });

    it('should parse TeamCreate instruction', () => {
      const teamName = 'TestTeam';
      const writer = new BufferWriter(1 + teamName.length);
      writer.writeU8(teamName.length);
      writer.writeBytes(Buffer.from(teamName, 'utf8'));
      const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE, writer.toBuffer());

      const parsed = parseInstructionData(data);

      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('TEAM_CREATE');
      expect(parsed!.category).toBe('Team');

      const teamData = parsed!.data as TeamCreateData;
      expect(teamData.name).toBe('TestTeam');
    });

    it('should parse RallyJoin instruction', () => {
      const writer = new BufferWriter(48);
      writer.writeU64(100n); // du1
      writer.writeU64(200n); // du2
      writer.writeU64(300n); // du3
      writer.writeU64(50n); // melee
      writer.writeU64(60n); // ranged
      writer.writeU64(70n); // siege
      const data = createInstructionData(DISCRIMINATORS.RALLY_JOIN, writer.toBuffer());

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
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, Buffer.alloc(2));

      const parsed = parseInstructionData(data);

      // Should still return parsed instruction with error info
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe('HIRE_UNITS');
    });
  });

  describe('parseInstructionFromBase64', () => {
    it('should parse base64-encoded instruction', () => {
      const writer = new BufferWriter(9);
      writer.writeU8(2);
      writer.writeU64(500n);
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, writer.toBuffer());
      const base64 = Buffer.from(data).toString('base64');

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
      const buf = Buffer.alloc(10);
      buf.writeUInt16LE(9999, 0);
      expect(isNovusMundusInstruction(buf)).toBe(false);
    });

    it('should return false for data too short', () => {
      expect(isNovusMundusInstruction(Buffer.alloc(1))).toBe(false);
    });
  });

  describe('getInstructionNameFromData', () => {
    it('should return instruction name', () => {
      const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE);
      expect(getInstructionNameFromData(data)).toBe('TEAM_CREATE');
    });

    it('should return undefined for unknown discriminator', () => {
      const buf = Buffer.alloc(10);
      buf.writeUInt16LE(9999, 0);
      expect(getInstructionNameFromData(buf)).toBeUndefined();
    });

    it('should return undefined for data too short', () => {
      expect(getInstructionNameFromData(Buffer.alloc(1))).toBeUndefined();
    });
  });

  describe('category mapping', () => {
    it('should categorize Economy instructions', () => {
      const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS);
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Economy');
    });

    it('should categorize Combat instructions', () => {
      const data = createInstructionData(DISCRIMINATORS.ATTACK_PLAYER, Buffer.from([0]));
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Combat');
    });

    it('should categorize Travel instructions', () => {
      const writer = new BufferWriter(2);
      writer.writeU16(1);
      const data = createInstructionData(DISCRIMINATORS.INTERCITY_START, writer.toBuffer());
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('TravelIntercity');
    });

    it('should categorize Team instructions', () => {
      const teamName = 'Test';
      const writer = new BufferWriter(1 + teamName.length);
      writer.writeU8(teamName.length);
      writer.writeBytes(Buffer.from(teamName));
      const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE, writer.toBuffer());
      const parsed = parseInstructionData(data);
      expect(parsed!.category).toBe('Team');
    });

    it('should categorize Rally instructions', () => {
      const writer = new BufferWriter(48);
      for (let i = 0; i < 6; i++) writer.writeU64(0n);
      const data = createInstructionData(DISCRIMINATORS.RALLY_JOIN, writer.toBuffer());
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
    const writer = new BufferWriter(9);
    writer.writeU8(originalUnitType);
    writer.writeU64(originalAmount);
    const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, writer.toBuffer());

    // Parse back
    const parsed = parseInstructionData(data);
    const hireData = parsed!.data as HireUnitsData;

    expect(hireData.unitType).toBe(originalUnitType);
    expect(hireData.noviAmount === originalAmount).toBe(true);
  });

  it('should roundtrip negative coordinates', () => {
    const originalLat = -40712800;
    const originalLong = 74006000;

    const writer = new BufferWriter(8);
    writer.writeI32(originalLat);
    writer.writeI32(originalLong);
    const data = createInstructionData(DISCRIMINATORS.INTRACITY_START, writer.toBuffer());

    const parsed = parseInstructionData(data);
    const intracityData = parsed!.data as IntracityStartData;

    expect(intracityData.targetLat).toBe(originalLat);
    expect(intracityData.targetLong).toBe(originalLong);
  });
});
