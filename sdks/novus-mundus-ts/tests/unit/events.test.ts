/**
 * Events Parser Unit Tests
 *
 * Tests for event discriminator computation and log parsing.
 */

import { describe, it, expect } from 'bun:test';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  computeEventDiscriminator,
  discriminatorToHex,
  EVENT_DISCRIMINATORS,
  EventBufferReader,
  parseNovusMundusEvent,
  parseEventFromBase64,
  parseEventsFromLogs,
  getEventName,
  isEventType,
} from '../../src/events/parser';

// Encode a value as a little-endian 8-byte buffer (replaces BN.toArrayLike).
function u64le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt.asUintN(64, value), 0);
  return buf;
}

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

describe('EventBufferReader', () => {
  describe('integer reads', () => {
    it('should read u8', () => {
      const reader = new EventBufferReader(Buffer.from([0, 127, 255]));
      expect(reader.readU8()).toBe(0);
      expect(reader.readU8()).toBe(127);
      expect(reader.readU8()).toBe(255);
    });

    it('should read i8', () => {
      const reader = new EventBufferReader(Buffer.from([0, 127, 128, 255]));
      expect(reader.readI8()).toBe(0);
      expect(reader.readI8()).toBe(127);
      expect(reader.readI8()).toBe(-128);
      expect(reader.readI8()).toBe(-1);
    });

    it('should read u16 little-endian', () => {
      const reader = new EventBufferReader(Buffer.from([0x34, 0x12]));
      expect(reader.readU16()).toBe(0x1234);
    });

    it('should read i16', () => {
      const buf = Buffer.alloc(2);
      buf.writeInt16LE(-1000, 0);
      const reader = new EventBufferReader(buf);
      expect(reader.readI16()).toBe(-1000);
    });

    it('should read u32 little-endian', () => {
      const reader = new EventBufferReader(Buffer.from([0x78, 0x56, 0x34, 0x12]));
      expect(reader.readU32()).toBe(0x12345678);
    });

    it('should read i32', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(-1000000, 0);
      const reader = new EventBufferReader(buf);
      expect(reader.readI32()).toBe(-1000000);
    });

    it('should read u64 as bigint', () => {
      const buf = Buffer.alloc(8);
      u64le(1000000n).copy(buf);
      const reader = new EventBufferReader(buf);
      expect(Number(reader.readU64())).toBe(1000000);
    });

    it('should read i64 as bigint', () => {
      const buf = Buffer.alloc(8);
      u64le(-1000000n).copy(buf);
      const reader = new EventBufferReader(buf);
      expect(Number(reader.readI64())).toBe(-1000000);
    });
  });

  describe('bool and pubkey reads', () => {
    it('should read bool', () => {
      const reader = new EventBufferReader(Buffer.from([0, 1]));
      expect(reader.readBool()).toBe(false);
      expect(reader.readBool()).toBe(true);
    });

    it('should read PublicKey', async () => {
      const keypair = await Keypair.generate();
      const reader = new EventBufferReader(keypair.publicKey.toBytes());
      expect(reader.readPubkey().equals(keypair.publicKey)).toBe(true);
    });
  });

  describe('string reads', () => {
    it('should read null-terminated string', () => {
      const buf = Buffer.alloc(32);
      buf.write('TestPlayer', 0, 'utf8');
      const reader = new EventBufferReader(buf);
      expect(reader.readString(32)).toBe('TestPlayer');
    });

    it('should read Name32', () => {
      const buf = Buffer.alloc(32);
      buf.write('MyTeam', 0, 'utf8');
      const reader = new EventBufferReader(buf);
      expect(reader.readName32()).toBe('MyTeam');
    });

    it('should read Name48', () => {
      const buf = Buffer.alloc(48);
      buf.write('LongerPlayerName', 0, 'utf8');
      const reader = new EventBufferReader(buf);
      expect(reader.readName48()).toBe('LongerPlayerName');
    });
  });

  describe('offset tracking', () => {
    it('should track offset correctly', () => {
      const reader = new EventBufferReader(Buffer.alloc(100));
      expect(reader.getOffset()).toBe(0);

      reader.readU8();
      expect(reader.getOffset()).toBe(1);

      reader.readU32();
      expect(reader.getOffset()).toBe(5);

      reader.readPubkey();
      expect(reader.getOffset()).toBe(37);
    });

    it('should report remaining bytes', () => {
      const reader = new EventBufferReader(Buffer.alloc(10));
      expect(reader.remaining()).toBe(10);

      reader.readU32();
      expect(reader.remaining()).toBe(6);
    });
  });
});

describe('Event Parsing', () => {
  describe('parseNovusMundusEvent', () => {
    it('should return null for data too short', () => {
      expect(parseNovusMundusEvent(Buffer.alloc(7))).toBeNull();
    });

    it('should return null for unknown discriminator', () => {
      const data = Buffer.alloc(100);
      // Unknown discriminator
      data.fill(0xff, 0, 8);
      expect(parseNovusMundusEvent(data)).toBeNull();
    });

    it('should parse PlayerCreated event', async () => {
      // Build a mock PlayerCreated event: player(32) + user(32) + city(32) + timestamp(8)
      const disc = computeEventDiscriminator('PlayerCreated');
      const player = (await Keypair.generate()).publicKey;
      const user = (await Keypair.generate()).publicKey;
      const city = (await Keypair.generate()).publicKey;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const data = Buffer.alloc(8 + 32 + 32 + 32 + 8);
      Buffer.from(disc).copy(data, 0);
      Buffer.from(player.toBytes()).copy(data, 8);
      Buffer.from(user.toBytes()).copy(data, 40);
      Buffer.from(city.toBytes()).copy(data, 72);
      u64le(timestamp).copy(data, 104);

      const event = parseNovusMundusEvent(data);

      expect(event).not.toBeNull();
      expect(event!.name).toBe('PlayerCreated');
      expect((event!.data as any).player.equals(player)).toBe(true);
      expect((event!.data as any).user.equals(user)).toBe(true);
      expect((event!.data as any).city.equals(city)).toBe(true);
    });

    it('should parse TeamCreated event', async () => {
      const disc = computeEventDiscriminator('TeamCreated');
      const team = (await Keypair.generate()).publicKey;
      const teamName = 'TestTeam';
      const founder = (await Keypair.generate()).publicKey;
      const noviBurned = 1000n;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      // team(32) + teamName(32) + founder(32) + noviBurned(8) + timestamp(8)
      const data = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
      let offset = 0;

      Buffer.from(disc).copy(data, offset);
      offset += 8;

      Buffer.from(team.toBytes()).copy(data, offset);
      offset += 32;

      const nameBuffer = Buffer.alloc(32);
      nameBuffer.write(teamName, 0, 'utf8');
      nameBuffer.copy(data, offset);
      offset += 32;

      Buffer.from(founder.toBytes()).copy(data, offset);
      offset += 32;

      u64le(noviBurned).copy(data, offset);
      offset += 8;

      u64le(timestamp).copy(data, offset);

      const event = parseNovusMundusEvent(data);

      expect(event).not.toBeNull();
      expect(event!.name).toBe('TeamCreated');
      expect((event!.data as any).team.equals(team)).toBe(true);
      expect((event!.data as any).teamName).toBe(teamName);
      expect((event!.data as any).founder.equals(founder)).toBe(true);
      expect(Number((event!.data as any).noviBurned)).toBe(1000);
    });
  });

  describe('parseEventFromBase64', () => {
    it('should parse base64-encoded event', async () => {
      const disc = computeEventDiscriminator('PlayerCreated');
      const player = (await Keypair.generate()).publicKey;
      const user = (await Keypair.generate()).publicKey;
      const city = (await Keypair.generate()).publicKey;
      const timestamp = BigInt(Math.floor(Date.now() / 1000));

      const data = Buffer.alloc(8 + 32 + 32 + 32 + 8);
      Buffer.from(disc).copy(data, 0);
      Buffer.from(player.toBytes()).copy(data, 8);
      Buffer.from(user.toBytes()).copy(data, 40);
      Buffer.from(city.toBytes()).copy(data, 72);
      u64le(timestamp).copy(data, 104);

      const base64 = data.toString('base64');
      const event = parseEventFromBase64(base64);

      expect(event).not.toBeNull();
      expect(event!.name).toBe('PlayerCreated');
    });
  });

  describe('parseEventsFromLogs', () => {
    it('should extract events from program logs', async () => {
      // Build a mock PlayerCreated event
      const disc = computeEventDiscriminator('PlayerCreated');
      const data = Buffer.alloc(8 + 32 + 32 + 32 + 8);
      Buffer.from(disc).copy(data, 0);
      // Fill with random pubkeys and timestamp
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data, 8);
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data, 40);
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data, 72);
      u64le(BigInt(Math.floor(Date.now() / 1000))).copy(data, 104);

      const base64 = data.toString('base64');
      const logs = [
        'Program NovUSMunDu5111111111111111111111111111111111 invoke [1]',
        'Program log: Instruction: InitPlayer',
        `Program data: ${base64}`,
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
      const data1 = Buffer.alloc(8 + 32 + 32 + 32 + 8);
      Buffer.from(disc1).copy(data1, 0);
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data1, 8);
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data1, 40);
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data1, 72);
      u64le(BigInt(Math.floor(Date.now() / 1000))).copy(data1, 104);

      const disc2 = computeEventDiscriminator('TeamCreated');
      // team(32) + teamName(32) + founder(32) + noviBurned(8) + timestamp(8)
      const data2 = Buffer.alloc(8 + 32 + 32 + 32 + 8 + 8);
      Buffer.from(disc2).copy(data2, 0);
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data2, 8);
      Buffer.alloc(32).copy(data2, 40); // team name
      Buffer.from((await Keypair.generate()).publicKey.toBytes()).copy(data2, 72);
      u64le(0n).copy(data2, 104); // noviBurned
      u64le(BigInt(Math.floor(Date.now() / 1000))).copy(data2, 112);

      const logs = [
        `Program data: ${data1.toString('base64')}`,
        `Program data: ${data2.toString('base64')}`,
      ];

      const events = parseEventsFromLogs(logs);

      expect(events.length).toBe(2);
      expect(events[0]!.name).toBe('PlayerCreated');
      expect(events[1]!.name).toBe('TeamCreated');
    });
  });
});

describe('Arena Events', () => {
  // Build an event buffer the way the on-chain events/arena.rs serialize() does:
  // 8-byte discriminator + little-endian fields in declared order.
  const writeArenaEvent = (name: string, fields: Array<[string, any]>): Buffer => {
    const chunks: Buffer[] = [Buffer.from(computeEventDiscriminator(name))];
    for (const [kind, value] of fields) {
      if (kind === 'u8') {
        chunks.push(Buffer.from([Number(value) & 0xff]));
      } else if (kind === 'u32') {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(Number(value));
        chunks.push(b);
      } else if (kind === 'u64') {
        chunks.push(u64le(BigInt(value)));
      } else if (kind === 'i64') {
        const b = Buffer.alloc(8);
        b.writeBigInt64LE(BigInt(value));
        chunks.push(b);
      } else if (kind === 'bool') {
        chunks.push(Buffer.from([value ? 1 : 0]));
      } else {
        chunks.push(Buffer.from((value as PublicKey).toBytes()));
      }
    }
    return Buffer.concat(chunks);
  };

  it('registers all five arena event discriminators', () => {
    for (const name of [
      'ArenaBattleResolved',
      'ArenaPlayerJoined',
      'ArenaDailyRewardClaimed',
      'ArenaMasterRewardClaimed',
      'ArenaSeasonFinalized',
    ]) {
      const hex = discriminatorToHex(computeEventDiscriminator(name));
      expect(EVENT_DISCRIMINATORS.get(hex)).toBe(name);
    }
  });

  it('should parse ArenaBattleResolved', async () => {
    const challenger = (await Keypair.generate()).publicKey;
    const defender = (await Keypair.generate()).publicKey;
    const data = writeArenaEvent('ArenaBattleResolved', [
      ['u32', 1],
      ['u64', 42n],
      ['pk', challenger],
      ['pk', defender],
      ['u64', 5000n],
      ['u64', 3000n],
      ['bool', true],
      ['u64', 150n],
      ['u64', 0n],
      ['u32', 1016],
      ['u32', 984],
      ['i64', 1700000000n],
      ['u64', 12345n],
    ]);

    const event = parseNovusMundusEvent(data);
    expect(event).not.toBeNull();
    expect(event!.name).toBe('ArenaBattleResolved');
    const d = event!.data as any;
    expect(d.seasonId).toBe(1);
    expect(Number(d.battleId)).toBe(42);
    expect(d.challenger.equals(challenger)).toBe(true);
    expect(d.defender.equals(defender)).toBe(true);
    expect(Number(d.challengerPower)).toBe(5000);
    expect(Number(d.defenderPower)).toBe(3000);
    expect(d.challengerWon).toBe(true);
    expect(Number(d.challengerPoints)).toBe(150);
    expect(Number(d.defenderPoints)).toBe(0);
    expect(d.newChallengerElo).toBe(1016);
    expect(d.newDefenderElo).toBe(984);
    expect(Number(d.slot)).toBe(12345);
  });

  it('should parse ArenaPlayerJoined', async () => {
    const player = (await Keypair.generate()).publicKey;
    const data = writeArenaEvent('ArenaPlayerJoined', [
      ['u32', 2],
      ['pk', player],
      ['i64', 1700000001n],
    ]);

    const event = parseNovusMundusEvent(data);
    expect(event!.name).toBe('ArenaPlayerJoined');
    const d = event!.data as any;
    expect(d.seasonId).toBe(2);
    expect(d.player.equals(player)).toBe(true);
  });

  it('should parse ArenaDailyRewardClaimed', async () => {
    const player = (await Keypair.generate()).publicKey;
    const data = writeArenaEvent('ArenaDailyRewardClaimed', [
      ['u32', 1],
      ['pk', player],
      ['u64', 1000n],
      ['u8', 6],
      ['u8', 3],
      ['i64', 1700000002n],
    ]);

    const event = parseNovusMundusEvent(data);
    expect(event!.name).toBe('ArenaDailyRewardClaimed');
    const d = event!.data as any;
    expect(d.seasonId).toBe(1);
    expect(d.player.equals(player)).toBe(true);
    expect(Number(d.amount)).toBe(1000);
    expect(d.battlesFought).toBe(6);
    expect(d.uniqueOpponents).toBe(3);
  });

  it('should parse ArenaMasterRewardClaimed', async () => {
    const player = (await Keypair.generate()).publicKey;
    const data = writeArenaEvent('ArenaMasterRewardClaimed', [
      ['u32', 1],
      ['pk', player],
      ['u8', 1],
      ['u64', 350000n],
      ['i64', 1700000003n],
    ]);

    const event = parseNovusMundusEvent(data);
    expect(event!.name).toBe('ArenaMasterRewardClaimed');
    const d = event!.data as any;
    expect(d.player.equals(player)).toBe(true);
    expect(d.rank).toBe(1);
    expect(Number(d.amount)).toBe(350000);
  });

  it('should parse ArenaSeasonFinalized', () => {
    const data = writeArenaEvent('ArenaSeasonFinalized', [
      ['u32', 1],
      ['u64', 99n],
      ['u8', 10],
      ['i64', 1700000004n],
    ]);

    const event = parseNovusMundusEvent(data);
    expect(event!.name).toBe('ArenaSeasonFinalized');
    const d = event!.data as any;
    expect(d.seasonId).toBe(1);
    expect(Number(d.totalBattles)).toBe(99);
    expect(d.leaderboardCount).toBe(10);
  });
});
