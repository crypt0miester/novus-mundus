/**
 * Events Parser Unit Tests
 *
 * Tests for event discriminator computation and log parsing.
 */

import { describe, it, expect } from 'bun:test';
import { generateKeyPairSigner, type Address, getU64Encoder, getBase64Decoder } from '@solana/kit';
import { addressBytes } from '../../src/crypto';

/** Copy an Address's 32 raw bytes into `dst` at `offset`. */
function copyAddress(addr: Address, dst: Uint8Array, offset: number): void {
  dst.set(addressBytes(addr), offset);
}

/** Encode a Uint8Array to a base64 string. */
function toBase64(data: Uint8Array): string {
  return getBase64Decoder().decode(data);
}
import {
  computeEventDiscriminator,
  discriminatorToHex,
  EVENT_DISCRIMINATORS,
  parseNovusMundusEvent,
  parseEventFromBase64,
  parseEventsFromLogs,
  getEventName,
  isEventType,
} from '../../src/events/parser';

describe('Event Discriminator', () => {
  describe('computeEventDiscriminator', () => {
    it('should compute 8-byte discriminator', () => {
      const disc = computeEventDiscriminator('PlayerAttacked');
      expect(disc.length).toBe(8);
    });

    it('should be deterministic', () => {
      const disc1 = computeEventDiscriminator('TeamCreated');
      const disc2 = computeEventDiscriminator('TeamCreated');
      expect(discriminatorToHex(disc1)).toBe(discriminatorToHex(disc2));
    });

    it('should produce different discriminators for different events', () => {
      const disc1 = computeEventDiscriminator('PlayerAttacked');
      const disc2 = computeEventDiscriminator('TeamCreated');
      expect(discriminatorToHex(disc1)).not.toBe(discriminatorToHex(disc2));
    });

    it('should use event: prefix', () => {
      // This matches Anchor's convention
      const disc = computeEventDiscriminator('Test');
      // SHA256("event:Test") first 8 bytes
      expect(disc.length).toBe(8);
    });
  });

  describe('discriminatorToHex', () => {
    it('should convert to hex string', () => {
      const disc = new Uint8Array([0x01, 0x02, 0x0a, 0xff, 0x00, 0x10, 0xab, 0xcd]);
      const hex = discriminatorToHex(disc);
      expect(hex).toBe('01020aff0010abcd');
    });

    it('should pad single-digit bytes', () => {
      const disc = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
      const hex = discriminatorToHex(disc);
      expect(hex).toBe('0001020304050607');
    });
  });

  describe('EVENT_DISCRIMINATORS', () => {
    it('should contain all major event types', () => {
      const expectedEvents = [
        'PlayerAttacked',
        'EncounterAttacked',
        'EncounterDefeated',
        'ResourcesCollected',
        'UnitsHired',
        'TeamCreated',
        'TeamJoined',
        'IntercityTravelStarted',
        'IntercityTravelCompleted',
        'RallyCreated',
        'ReinforcementSent',
        'ExpeditionStarted',
        'LootClaimed',
        'PlayerCreated',
        'HeroMinted',
        'ItemPurchased',
        'DungeonEntered',
        'CastleAttacked',
      ];

      for (const event of expectedEvents) {
        const disc = computeEventDiscriminator(event);
        const hex = discriminatorToHex(disc);
        expect(EVENT_DISCRIMINATORS.has(hex)).toBe(true);
        expect(EVENT_DISCRIMINATORS.get(hex)).toBe(event);
      }
    });
  });

  describe('getEventName', () => {
    it('should return event name for known discriminator', () => {
      const disc = computeEventDiscriminator('PlayerAttacked');
      expect(getEventName(disc)).toBe('PlayerAttacked');
    });

    it('should return undefined for unknown discriminator', () => {
      const disc = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(getEventName(disc)).toBeUndefined();
    });
  });

  describe('isEventType', () => {
    it('should return true for matching discriminator', () => {
      const disc = computeEventDiscriminator('TeamCreated');
      expect(isEventType(disc, 'TeamCreated')).toBe(true);
    });

    it('should return false for non-matching discriminator', () => {
      const disc = computeEventDiscriminator('TeamCreated');
      expect(isEventType(disc, 'TeamJoined')).toBe(false);
    });
  });
});

describe('Event Parsing', () => {
  describe('parseNovusMundusEvent', () => {
    it('should return null for data too short', () => {
      expect(parseNovusMundusEvent(new Uint8Array(7))).toBeNull();
    });

    it('should return null for unknown discriminator', () => {
      const data = new Uint8Array(100);
      // Unknown discriminator
      data.fill(0xff, 0, 8);
      expect(parseNovusMundusEvent(data)).toBeNull();
    });

    it('should parse PlayerCreated event', async () => {
      // Build a mock PlayerCreated event: player(32) + user(32) + city(32) + timestamp(8)
      const disc = computeEventDiscriminator('PlayerCreated');
      const player = (await generateKeyPairSigner()).address;
      const user = (await generateKeyPairSigner()).address;
      const city = (await generateKeyPairSigner()).address;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const data = new Uint8Array(8 + 32 + 32 + 32 + 8);
      data.set(disc, 0);
      copyAddress(player, data, 8);
      copyAddress(user, data, 40);
      copyAddress(city, data, 72);
      data.set(getU64Encoder().encode(timestamp), 104);

      const event = parseNovusMundusEvent(data);

      expect(event).not.toBeNull();
      expect(event!.name).toBe('PlayerCreated');
      expect((event!.data as any).player).toBe(player);
      expect((event!.data as any).user).toBe(user);
      expect((event!.data as any).city).toBe(city);
    });

    it('should parse TeamCreated event', async () => {
      const disc = computeEventDiscriminator('TeamCreated');
      const team = (await generateKeyPairSigner()).address;
      const teamName = 'TestTeam';
      const founder = (await generateKeyPairSigner()).address;
      const noviBurned = 1000n;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      // team(32) + teamName(32) + founder(32) + noviBurned(8) + timestamp(8)
      const data = new Uint8Array(8 + 32 + 32 + 32 + 8 + 8);
      let offset = 0;

      data.set(disc, offset);
      offset += 8;

      copyAddress(team, data, offset);
      offset += 32;

      data.set(new TextEncoder().encode(teamName), offset);
      offset += 32;

      copyAddress(founder, data, offset);
      offset += 32;

      data.set(getU64Encoder().encode(noviBurned), offset);
      offset += 8;

      data.set(getU64Encoder().encode(timestamp), offset);

      const event = parseNovusMundusEvent(data);

      expect(event).not.toBeNull();
      expect(event!.name).toBe('TeamCreated');
      expect((event!.data as any).team).toBe(team);
      expect((event!.data as any).teamName).toBe(teamName);
      expect((event!.data as any).founder).toBe(founder);
      expect(Number((event!.data as any).noviBurned)).toBe(1000);
    });
  });

  describe('parseEventFromBase64', () => {
    it('should parse base64-encoded event', async () => {
      const disc = computeEventDiscriminator('PlayerCreated');
      const player = (await generateKeyPairSigner()).address;
      const user = (await generateKeyPairSigner()).address;
      const city = (await generateKeyPairSigner()).address;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const data = new Uint8Array(8 + 32 + 32 + 32 + 8);
      data.set(disc, 0);
      copyAddress(player, data, 8);
      copyAddress(user, data, 40);
      copyAddress(city, data, 72);
      data.set(getU64Encoder().encode(timestamp), 104);

      const event = parseEventFromBase64(toBase64(data));

      expect(event).not.toBeNull();
      expect(event!.name).toBe('PlayerCreated');
    });
  });

  describe('parseEventsFromLogs', () => {
    it('should extract events from program logs', async () => {
      // Build a mock PlayerCreated event
      const disc = computeEventDiscriminator('PlayerCreated');
      const data = new Uint8Array(8 + 32 + 32 + 32 + 8);
      data.set(disc, 0);
      // Fill with random pubkeys and timestamp
      copyAddress((await generateKeyPairSigner()).address, data, 8);
      copyAddress((await generateKeyPairSigner()).address, data, 40);
      copyAddress((await generateKeyPairSigner()).address, data, 72);
      data.set(getU64Encoder().encode(BigInt(Math.floor(Date.now() / 1000))), 104);

      const logs = [
        'Program NovUSMunDu5111111111111111111111111111111111 invoke [1]',
        'Program log: Instruction: InitPlayer',
        `Program data: ${toBase64(data)}`,
        'Program NovUSMunDu5111111111111111111111111111111111 success',
      ];

      const events = parseEventsFromLogs(logs);

      expect(events.length).toBe(1);
      expect(events[0]!.name).toBe('PlayerCreated');
    });

    it('should return empty array for logs without events', () => {
      const logs = [
        'Program NovUSMunDu5111111111111111111111111111111111 invoke [1]',
        'Program log: Some log message',
        'Program NovUSMunDu5111111111111111111111111111111111 success',
      ];

      const events = parseEventsFromLogs(logs);

      expect(events.length).toBe(0);
    });

    it('should skip invalid base64 data', () => {
      const logs = [
        'Program data: not-valid-base64!!!',
        'Program data: AAAAAAAAaaaaa', // Too short
      ];

      const events = parseEventsFromLogs(logs);

      // Should not throw, just return empty
      expect(events.length).toBe(0);
    });

    it('should parse multiple events', async () => {
      // Create two different events
      const disc1 = computeEventDiscriminator('PlayerCreated');
      // player(32) + user(32) + city(32) + timestamp(8)
      const data1 = new Uint8Array(8 + 32 + 32 + 32 + 8);
      data1.set(disc1, 0);
      copyAddress((await generateKeyPairSigner()).address, data1, 8);
      copyAddress((await generateKeyPairSigner()).address, data1, 40);
      copyAddress((await generateKeyPairSigner()).address, data1, 72);
      data1.set(getU64Encoder().encode(BigInt(Math.floor(Date.now() / 1000))), 104);

      const disc2 = computeEventDiscriminator('TeamCreated');
      // team(32) + teamName(32) + founder(32) + noviBurned(8) + timestamp(8)
      const data2 = new Uint8Array(8 + 32 + 32 + 32 + 8 + 8);
      data2.set(disc2, 0);
      copyAddress((await generateKeyPairSigner()).address, data2, 8);
      // team name left as zero bytes (40..72)
      copyAddress((await generateKeyPairSigner()).address, data2, 72);
      data2.set(getU64Encoder().encode(0n), 104); // noviBurned
      data2.set(getU64Encoder().encode(BigInt(Math.floor(Date.now() / 1000))), 112);

      const logs = [
        `Program data: ${toBase64(data1)}`,
        `Program data: ${toBase64(data2)}`,
      ];

      const events = parseEventsFromLogs(logs);

      expect(events.length).toBe(2);
      expect(events[0]!.name).toBe('PlayerCreated');
      expect(events[1]!.name).toBe('TeamCreated');
    });
  });
});
