/**
 * Event Parser
 *
 * Parses on-chain events from transaction logs.
 * Events are emitted via sol_log_data and appear base64-encoded in logs.
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { createHash } from 'crypto';
import type { NovusMundusEvent } from './types.ts';

// ============================================================
// Discriminator Computation
// ============================================================

/**
 * Compute 8-byte discriminator from event name.
 * Uses SHA256 and takes first 8 bytes (Anchor-compatible).
 */
export function computeEventDiscriminator(eventName: string): Uint8Array {
  const hash = createHash('sha256').update(`event:${eventName}`).digest();
  return new Uint8Array(hash.slice(0, 8));
}

/**
 * Convert discriminator to hex string for comparison.
 */
export function discriminatorToHex(disc: Uint8Array): string {
  return Array.from(disc).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// Event Discriminator Map
// ============================================================

/** All known event discriminators mapped to event names */
export const EVENT_DISCRIMINATORS: Map<string, string> = new Map([
  // Combat
  [discriminatorToHex(computeEventDiscriminator('PlayerAttacked')), 'PlayerAttacked'],
  [discriminatorToHex(computeEventDiscriminator('EncounterAttacked')), 'EncounterAttacked'],
  [discriminatorToHex(computeEventDiscriminator('EncounterDefeated')), 'EncounterDefeated'],

  // Economy
  [discriminatorToHex(computeEventDiscriminator('ResourcesCollected')), 'ResourcesCollected'],
  [discriminatorToHex(computeEventDiscriminator('UnitsHired')), 'UnitsHired'],
  [discriminatorToHex(computeEventDiscriminator('CashTransferred')), 'CashTransferred'],
  [discriminatorToHex(computeEventDiscriminator('NoviMinted')), 'NoviMinted'],
  [discriminatorToHex(computeEventDiscriminator('NoviBurned')), 'NoviBurned'],

  // Team
  [discriminatorToHex(computeEventDiscriminator('TeamCreated')), 'TeamCreated'],
  [discriminatorToHex(computeEventDiscriminator('TeamJoined')), 'TeamJoined'],
  [discriminatorToHex(computeEventDiscriminator('TeamLeft')), 'TeamLeft'],
  [discriminatorToHex(computeEventDiscriminator('TeamDisbanded')), 'TeamDisbanded'],
  [discriminatorToHex(computeEventDiscriminator('TeamMemberPromoted')), 'TeamMemberPromoted'],
  [discriminatorToHex(computeEventDiscriminator('TeamMemberDemoted')), 'TeamMemberDemoted'],
  [discriminatorToHex(computeEventDiscriminator('TeamMemberKicked')), 'TeamMemberKicked'],
  [discriminatorToHex(computeEventDiscriminator('TeamLeadershipTransferred')), 'TeamLeadershipTransferred'],
  [discriminatorToHex(computeEventDiscriminator('TeamInviteSent')), 'TeamInviteSent'],
  [discriminatorToHex(computeEventDiscriminator('TeamInviteAccepted')), 'TeamInviteAccepted'],
  [discriminatorToHex(computeEventDiscriminator('TeamInviteDeclined')), 'TeamInviteDeclined'],
  [discriminatorToHex(computeEventDiscriminator('TeamInviteCancelled')), 'TeamInviteCancelled'],
  [discriminatorToHex(computeEventDiscriminator('TeamTreasuryDeposited')), 'TeamTreasuryDeposited'],
  [discriminatorToHex(computeEventDiscriminator('TeamTreasuryWithdrawn')), 'TeamTreasuryWithdrawn'],

  // Travel
  [discriminatorToHex(computeEventDiscriminator('TravelStarted')), 'TravelStarted'],
  [discriminatorToHex(computeEventDiscriminator('TravelCompleted')), 'TravelCompleted'],
  [discriminatorToHex(computeEventDiscriminator('TravelCancelled')), 'TravelCancelled'],

  // Rally
  [discriminatorToHex(computeEventDiscriminator('RallyCreated')), 'RallyCreated'],
  [discriminatorToHex(computeEventDiscriminator('RallyJoined')), 'RallyJoined'],
  [discriminatorToHex(computeEventDiscriminator('RallyLeft')), 'RallyLeft'],
  [discriminatorToHex(computeEventDiscriminator('RallyCancelled')), 'RallyCancelled'],
  [discriminatorToHex(computeEventDiscriminator('RallyExecuted')), 'RallyExecuted'],
  [discriminatorToHex(computeEventDiscriminator('RallyReturnProcessed')), 'RallyReturnProcessed'],

  // Reinforcement
  [discriminatorToHex(computeEventDiscriminator('ReinforcementSent')), 'ReinforcementSent'],
  [discriminatorToHex(computeEventDiscriminator('ReinforcementArrived')), 'ReinforcementArrived'],
  [discriminatorToHex(computeEventDiscriminator('ReinforcementRecalled')), 'ReinforcementRecalled'],
  [discriminatorToHex(computeEventDiscriminator('ReinforcementRelieved')), 'ReinforcementRelieved'],
  [discriminatorToHex(computeEventDiscriminator('ReinforcementReturned')), 'ReinforcementReturned'],

  // Expedition
  [discriminatorToHex(computeEventDiscriminator('ExpeditionStarted')), 'ExpeditionStarted'],
  [discriminatorToHex(computeEventDiscriminator('ExpeditionStrike')), 'ExpeditionStrike'],
  [discriminatorToHex(computeEventDiscriminator('ExpeditionClaimed')), 'ExpeditionClaimed'],
  [discriminatorToHex(computeEventDiscriminator('ExpeditionAborted')), 'ExpeditionAborted'],

  // Loot
  [discriminatorToHex(computeEventDiscriminator('LootClaimed')), 'LootClaimed'],

  // Progression
  [discriminatorToHex(computeEventDiscriminator('DailyRewardClaimed')), 'DailyRewardClaimed'],
  [discriminatorToHex(computeEventDiscriminator('PlayerLeveledUp')), 'PlayerLeveledUp'],

  // Estate
  [discriminatorToHex(computeEventDiscriminator('EstateCreated')), 'EstateCreated'],
  [discriminatorToHex(computeEventDiscriminator('BuildingConstructed')), 'BuildingConstructed'],
  [discriminatorToHex(computeEventDiscriminator('BuildingUpgraded')), 'BuildingUpgraded'],
  [discriminatorToHex(computeEventDiscriminator('PlotPurchased')), 'PlotPurchased'],

  // Forge
  [discriminatorToHex(computeEventDiscriminator('CraftStarted')), 'CraftStarted'],
  [discriminatorToHex(computeEventDiscriminator('CraftStrike')), 'CraftStrike'],
  [discriminatorToHex(computeEventDiscriminator('CraftCompleted')), 'CraftCompleted'],
  [discriminatorToHex(computeEventDiscriminator('CraftAbandoned')), 'CraftAbandoned'],
  [discriminatorToHex(computeEventDiscriminator('EquipmentEquipped')), 'EquipmentEquipped'],

  // Research
  [discriminatorToHex(computeEventDiscriminator('ResearchStarted')), 'ResearchStarted'],
  [discriminatorToHex(computeEventDiscriminator('ResearchCompleted')), 'ResearchCompleted'],
  [discriminatorToHex(computeEventDiscriminator('ResearchCancelled')), 'ResearchCancelled'],
  [discriminatorToHex(computeEventDiscriminator('AscensionCompleted')), 'AscensionCompleted'],

  // Sanctuary
  [discriminatorToHex(computeEventDiscriminator('MeditationStarted')), 'MeditationStarted'],
  [discriminatorToHex(computeEventDiscriminator('MeditationClaimed')), 'MeditationClaimed'],

  // Hero
  [discriminatorToHex(computeEventDiscriminator('HeroMinted')), 'HeroMinted'],
  [discriminatorToHex(computeEventDiscriminator('HeroLocked')), 'HeroLocked'],
  [discriminatorToHex(computeEventDiscriminator('HeroUnlocked')), 'HeroUnlocked'],
  [discriminatorToHex(computeEventDiscriminator('HeroLeveledUp')), 'HeroLeveledUp'],

  // Shop
  [discriminatorToHex(computeEventDiscriminator('ItemPurchased')), 'ItemPurchased'],
  [discriminatorToHex(computeEventDiscriminator('BundlePurchased')), 'BundlePurchased'],
  [discriminatorToHex(computeEventDiscriminator('FlashSalePurchased')), 'FlashSalePurchased'],
  [discriminatorToHex(computeEventDiscriminator('NoviPurchased')), 'NoviPurchased'],

  // Initialization
  [discriminatorToHex(computeEventDiscriminator('GameEngineInitialized')), 'GameEngineInitialized'],
  [discriminatorToHex(computeEventDiscriminator('PlayerInitialized')), 'PlayerInitialized'],
  [discriminatorToHex(computeEventDiscriminator('CityInitialized')), 'CityInitialized'],

  // Name
  [discriminatorToHex(computeEventDiscriminator('PlayerNameSet')), 'PlayerNameSet'],
  [discriminatorToHex(computeEventDiscriminator('TeamNameSet')), 'TeamNameSet'],

  // Token
  [discriminatorToHex(computeEventDiscriminator('LockedNoviUpdated')), 'LockedNoviUpdated'],
  [discriminatorToHex(computeEventDiscriminator('ReservedWithdrawn')), 'ReservedWithdrawn'],

  // Arena
  [discriminatorToHex(computeEventDiscriminator('ArenaSeasonCreated')), 'ArenaSeasonCreated'],
  [discriminatorToHex(computeEventDiscriminator('ArenaJoined')), 'ArenaJoined'],
  [discriminatorToHex(computeEventDiscriminator('ArenaChallenge')), 'ArenaChallenge'],
  [discriminatorToHex(computeEventDiscriminator('ArenaSeasonClosed')), 'ArenaSeasonClosed'],

  // Game Event
  [discriminatorToHex(computeEventDiscriminator('GameEventCreated')), 'GameEventCreated'],
  [discriminatorToHex(computeEventDiscriminator('GameEventJoined')), 'GameEventJoined'],
  [discriminatorToHex(computeEventDiscriminator('GameEventFinalized')), 'GameEventFinalized'],
  [discriminatorToHex(computeEventDiscriminator('GameEventPrizeClaimed')), 'GameEventPrizeClaimed'],

  // Dungeon
  [discriminatorToHex(computeEventDiscriminator('DungeonEntered')), 'DungeonEntered'],
  [discriminatorToHex(computeEventDiscriminator('DungeonRoomCleared')), 'DungeonRoomCleared'],
  [discriminatorToHex(computeEventDiscriminator('DungeonRelicChosen')), 'DungeonRelicChosen'],
  [discriminatorToHex(computeEventDiscriminator('DungeonFloorCompleted')), 'DungeonFloorCompleted'],
  [discriminatorToHex(computeEventDiscriminator('DungeonCompleted')), 'DungeonCompleted'],
  [discriminatorToHex(computeEventDiscriminator('DungeonFailed')), 'DungeonFailed'],
  [discriminatorToHex(computeEventDiscriminator('DungeonFled')), 'DungeonFled'],

  // Castle
  [discriminatorToHex(computeEventDiscriminator('CastleCreated')), 'CastleCreated'],
  [discriminatorToHex(computeEventDiscriminator('CastleClaimed')), 'CastleClaimed'],
  [discriminatorToHex(computeEventDiscriminator('CastleUpgradeInitiated')), 'CastleUpgradeInitiated'],
  [discriminatorToHex(computeEventDiscriminator('CastleUpgradeCompleted')), 'CastleUpgradeCompleted'],
  [discriminatorToHex(computeEventDiscriminator('CourtAppointed')), 'CourtAppointed'],
  [discriminatorToHex(computeEventDiscriminator('CourtDismissed')), 'CourtDismissed'],
  [discriminatorToHex(computeEventDiscriminator('GarrisonJoined')), 'GarrisonJoined'],
  [discriminatorToHex(computeEventDiscriminator('GarrisonLeft')), 'GarrisonLeft'],
  [discriminatorToHex(computeEventDiscriminator('CastleAttacked')), 'CastleAttacked'],
  [discriminatorToHex(computeEventDiscriminator('CastleConquered')), 'CastleConquered'],
  [discriminatorToHex(computeEventDiscriminator('CastleRewardsClaimed')), 'CastleRewardsClaimed'],

  // Kingdom
  [discriminatorToHex(computeEventDiscriminator('KingdomCreated')), 'KingdomCreated'],
  [discriminatorToHex(computeEventDiscriminator('KingdomRegistrationClosed')), 'KingdomRegistrationClosed'],
  [discriminatorToHex(computeEventDiscriminator('PlayerJoinedKingdom')), 'PlayerJoinedKingdom'],
  [discriminatorToHex(computeEventDiscriminator('KingdomEventCreated')), 'KingdomEventCreated'],
  [discriminatorToHex(computeEventDiscriminator('KingdomArenaSeasonStarted')), 'KingdomArenaSeasonStarted'],
  [discriminatorToHex(computeEventDiscriminator('KingdomDungeonLeaderboardCreated')), 'KingdomDungeonLeaderboardCreated'],
  [discriminatorToHex(computeEventDiscriminator('KingdomCitiesInitialized')), 'KingdomCitiesInitialized'],
]);

// ============================================================
// Event Buffer Reader
// ============================================================

/** Reader for sequential byte reads from a buffer */
export class EventBufferReader {
  private buffer: Buffer;
  private offset = 0;

  constructor(data: Buffer | Uint8Array) {
    this.buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  /** Get current offset */
  getOffset(): number {
    return this.offset;
  }

  /** Get remaining bytes */
  remaining(): number {
    return this.buffer.length - this.offset;
  }

  /** Read u8 */
  readU8(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  /** Read i8 */
  readI8(): number {
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  /** Read u16 (little-endian) */
  readU16(): number {
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  /** Read i16 (little-endian) */
  readI16(): number {
    const value = this.buffer.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  /** Read u32 (little-endian) */
  readU32(): number {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  /** Read i32 (little-endian) */
  readI32(): number {
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  /** Read u64 as BN (little-endian) */
  readU64(): BN {
    const bytes = this.buffer.subarray(this.offset, this.offset + 8);
    this.offset += 8;
    return new BN(bytes, 'le');
  }

  /** Read i64 as BN (little-endian) */
  readI64(): BN {
    const bytes = this.buffer.subarray(this.offset, this.offset + 8);
    this.offset += 8;
    const bn = new BN(bytes, 'le');
    // Handle negative: if high bit set, subtract 2^64
    const highByte = this.buffer.readUInt8(this.offset - 1);
    if (highByte & 0x80) {
      return bn.sub(new BN(1).shln(64));
    }
    return bn;
  }

  /** Read bool (1 byte) */
  readBool(): boolean {
    return this.readU8() !== 0;
  }

  /** Read PublicKey (32 bytes) */
  readPubkey(): PublicKey {
    const bytes = this.buffer.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(bytes);
  }

  /** Read raw bytes */
  readBytes(length: number): Uint8Array {
    const bytes = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new Uint8Array(bytes);
  }

  /** Read fixed-size string (null-terminated within fixed buffer) */
  readString(maxLength: number): string {
    const bytes = this.readBytes(maxLength);
    const nullIndex = bytes.indexOf(0);
    const actualBytes = nullIndex >= 0 ? bytes.subarray(0, nullIndex) : bytes;
    return new TextDecoder().decode(actualBytes);
  }

  /** Read fixed-size name (32 bytes) */
  readName32(): string {
    return this.readString(32);
  }

  /** Read fixed-size name (48 bytes) */
  readName48(): string {
    return this.readString(48);
  }
}

// ============================================================
// Event Parsers
// ============================================================

type EventParser = (reader: EventBufferReader) => Record<string, unknown>;

const EVENT_PARSERS = new Map<string, EventParser>();

// Combat
EVENT_PARSERS.set('PlayerAttacked', (r) => ({
  attacker: r.readPubkey(),
  attackerName: r.readName48(),
  defender: r.readPubkey(),
  defenderName: r.readName48(),
  damageDealt: r.readU64(),
  damageReceived: r.readU64(),
  cashStolen: r.readU64(),
  armorStolen: r.readU64(),
  produceStolen: r.readU64(),
  vehiclesStolen: r.readU64(),
  attackerUnitsLost: [r.readU64(), r.readU64(), r.readU64()],
  defenderUnitsLost: [r.readU64(), r.readU64(), r.readU64()],
  attackerWon: r.readBool(),
  driveBy: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EncounterAttacked', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  encounter: r.readPubkey(),
  damageDealt: r.readU64(),
  healthRemaining: r.readU64(),
  staminaConsumed: r.readU16(),
  noviConsumed: r.readU64(),
  attackerCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EncounterDefeated', (r) => ({
  encounter: r.readPubkey(),
  encounterType: r.readU8(),
  level: r.readU8(),
  totalAttackers: r.readU8(),
  killingBlowBy: r.readPubkey(),
  killingBlowName: r.readName48(),
  lootCash: r.readU64(),
  lootNovi: r.readU64(),
  timestamp: r.readI64(),
}));

// Economy
EVENT_PARSERS.set('ResourcesCollected', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  cashCollected: r.readU64(),
  gemsCollected: r.readU64(),
  produceCollected: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('UnitsHired', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  unitType: r.readU8(),
  quantity: r.readU64(),
  totalCost: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CashTransferred', (r) => ({
  sender: r.readPubkey(),
  senderName: r.readName48(),
  recipient: r.readPubkey(),
  recipientName: r.readName48(),
  amount: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('NoviMinted', (r) => ({
  recipient: r.readPubkey(),
  amount: r.readU64(),
  reason: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('NoviBurned', (r) => ({
  from: r.readPubkey(),
  amount: r.readU64(),
  reason: r.readU8(),
  timestamp: r.readI64(),
}));

// Team
EVENT_PARSERS.set('TeamCreated', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  leader: r.readPubkey(),
  leaderName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamJoined', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamLeft', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamDisbanded', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  leader: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamMemberPromoted', (r) => ({
  team: r.readPubkey(),
  member: r.readPubkey(),
  memberName: r.readName48(),
  newRank: r.readU8(),
  promotedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamMemberDemoted', (r) => ({
  team: r.readPubkey(),
  member: r.readPubkey(),
  memberName: r.readName48(),
  newRank: r.readU8(),
  demotedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamMemberKicked', (r) => ({
  team: r.readPubkey(),
  member: r.readPubkey(),
  memberName: r.readName48(),
  kickedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamLeadershipTransferred', (r) => ({
  team: r.readPubkey(),
  oldLeader: r.readPubkey(),
  newLeader: r.readPubkey(),
  newLeaderName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamInviteSent', (r) => ({
  team: r.readPubkey(),
  invitedPlayer: r.readPubkey(),
  invitedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamInviteAccepted', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamInviteDeclined', (r) => ({
  team: r.readPubkey(),
  player: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamInviteCancelled', (r) => ({
  team: r.readPubkey(),
  invitedPlayer: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamTreasuryDeposited', (r) => ({
  team: r.readPubkey(),
  depositor: r.readPubkey(),
  amount: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamTreasuryWithdrawn', (r) => ({
  team: r.readPubkey(),
  recipient: r.readPubkey(),
  amount: r.readU64(),
  timestamp: r.readI64(),
}));

// Travel
EVENT_PARSERS.set('TravelStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  fromCity: r.readPubkey(),
  toCity: r.readPubkey(),
  arrivalTime: r.readI64(),
  travelType: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TravelCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  city: r.readPubkey(),
  travelType: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TravelCancelled', (r) => ({
  player: r.readPubkey(),
  travelType: r.readU8(),
  timestamp: r.readI64(),
}));

// Rally
EVENT_PARSERS.set('RallyCreated', (r) => ({
  rally: r.readPubkey(),
  creator: r.readPubkey(),
  creatorName: r.readName48(),
  targetType: r.readU8(),
  target: r.readPubkey(),
  operatives: r.readU64(),
  maxParticipants: r.readU8(),
  executeTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyJoined', (r) => ({
  rally: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  operatives: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyLeft', (r) => ({
  rally: r.readPubkey(),
  player: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyCancelled', (r) => ({
  rally: r.readPubkey(),
  cancelledBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyExecuted', (r) => ({
  rally: r.readPubkey(),
  targetType: r.readU8(),
  target: r.readPubkey(),
  success: r.readBool(),
  totalDamage: r.readU64(),
  lootCash: r.readU64(),
  lootNovi: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyReturnProcessed', (r) => ({
  rally: r.readPubkey(),
  player: r.readPubkey(),
  cashReceived: r.readU64(),
  noviReceived: r.readU64(),
  timestamp: r.readI64(),
}));

// Reinforcement
EVENT_PARSERS.set('ReinforcementSent', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  senderName: r.readName48(),
  recipient: r.readPubkey(),
  recipientName: r.readName48(),
  defensive1: r.readU64(),
  defensive2: r.readU64(),
  defensive3: r.readU64(),
  arrivalTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementArrived', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  recipient: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementRecalled', (r) => ({
  reinforcement: r.readPubkey(),
  recalledBy: r.readPubkey(),
  returnTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementRelieved', (r) => ({
  reinforcement: r.readPubkey(),
  relievedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementReturned', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  timestamp: r.readI64(),
}));

// Expedition
EVENT_PARSERS.set('ExpeditionStarted', (r) => ({
  expedition: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  expeditionType: r.readU8(),
  tier: r.readU8(),
  operatives: r.readU64(),
  endTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionStrike', (r) => ({
  expedition: r.readPubkey(),
  player: r.readPubkey(),
  gemsCollected: r.readU64(),
  produceCollected: r.readU64(),
  fragmentsCollected: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionClaimed', (r) => ({
  expedition: r.readPubkey(),
  player: r.readPubkey(),
  totalGems: r.readU64(),
  totalProduce: r.readU64(),
  totalFragments: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionAborted', (r) => ({
  expedition: r.readPubkey(),
  player: r.readPubkey(),
  timestamp: r.readI64(),
}));

// Loot
EVENT_PARSERS.set('LootClaimed', (r) => ({
  loot: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  cashClaimed: r.readU64(),
  noviClaimed: r.readU64(),
  gemsClaimed: r.readU64(),
  produceClaimed: r.readU64(),
  fragmentsClaimed: r.readU64(),
  timestamp: r.readI64(),
}));

// Progression
EVENT_PARSERS.set('DailyRewardClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  day: r.readU8(),
  cashReward: r.readU64(),
  noviReward: r.readU64(),
  gemsReward: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerLeveledUp', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  newLevel: r.readU8(),
  timestamp: r.readI64(),
}));

// Estate
EVENT_PARSERS.set('EstateCreated', (r) => ({
  player: r.readPubkey(),
  estate: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BuildingConstructed', (r) => ({
  player: r.readPubkey(),
  estate: r.readPubkey(),
  buildingType: r.readU8(),
  level: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BuildingUpgraded', (r) => ({
  player: r.readPubkey(),
  estate: r.readPubkey(),
  buildingType: r.readU8(),
  newLevel: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlotPurchased', (r) => ({
  player: r.readPubkey(),
  estate: r.readPubkey(),
  plotCount: r.readU8(),
  cost: r.readU64(),
  timestamp: r.readI64(),
}));

// Forge
EVENT_PARSERS.set('CraftStarted', (r) => ({
  player: r.readPubkey(),
  equipmentType: r.readU8(),
  qualityTier: r.readU8(),
  totalStages: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CraftStrike', (r) => ({
  player: r.readPubkey(),
  currentStage: r.readU8(),
  totalStages: r.readU8(),
  success: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CraftCompleted', (r) => ({
  player: r.readPubkey(),
  equipmentType: r.readU8(),
  qualityTier: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CraftAbandoned', (r) => ({
  player: r.readPubkey(),
  equipmentType: r.readU8(),
  materialsRefunded: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EquipmentEquipped', (r) => ({
  player: r.readPubkey(),
  equipmentType: r.readU8(),
  qualityTier: r.readU8(),
  timestamp: r.readI64(),
}));

// Research
EVENT_PARSERS.set('ResearchStarted', (r) => ({
  player: r.readPubkey(),
  researchId: r.readU8(),
  level: r.readU8(),
  completionTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ResearchCompleted', (r) => ({
  player: r.readPubkey(),
  researchId: r.readU8(),
  level: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ResearchCancelled', (r) => ({
  player: r.readPubkey(),
  researchId: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('AscensionCompleted', (r) => ({
  player: r.readPubkey(),
  newTier: r.readU8(),
  timestamp: r.readI64(),
}));

// Sanctuary
EVENT_PARSERS.set('MeditationStarted', (r) => ({
  player: r.readPubkey(),
  heroMint: r.readPubkey(),
  heroSlot: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('MeditationClaimed', (r) => ({
  player: r.readPubkey(),
  heroMint: r.readPubkey(),
  xpGained: r.readU64(),
  timestamp: r.readI64(),
}));

// Hero
EVENT_PARSERS.set('HeroMinted', (r) => ({
  player: r.readPubkey(),
  heroMint: r.readPubkey(),
  templateId: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroLocked', (r) => ({
  player: r.readPubkey(),
  heroMint: r.readPubkey(),
  slot: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroUnlocked', (r) => ({
  player: r.readPubkey(),
  heroMint: r.readPubkey(),
  slot: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroLeveledUp', (r) => ({
  player: r.readPubkey(),
  heroMint: r.readPubkey(),
  newLevel: r.readU8(),
  timestamp: r.readI64(),
}));

// Shop
EVENT_PARSERS.set('ItemPurchased', (r) => ({
  player: r.readPubkey(),
  itemId: r.readU32(),
  quantity: r.readU16(),
  totalPrice: r.readU64(),
  paymentType: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BundlePurchased', (r) => ({
  player: r.readPubkey(),
  bundleId: r.readU32(),
  totalPrice: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('FlashSalePurchased', (r) => ({
  player: r.readPubkey(),
  flashSaleId: r.readU32(),
  itemsReceived: r.readU16(),
  price: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('NoviPurchased', (r) => ({
  buyer: r.readPubkey(),
  user: r.readPubkey(),
  packageIndex: r.readU8(),
  baseAmount: r.readU64(),
  bonusAmount: r.readU64(),
  totalReceived: r.readU64(),
  costLamports: r.readU64(),
  streakDay: r.readU16(),
  subscriptionTier: r.readU8(),
  timestamp: r.readI64(),
}));

// Initialization
EVENT_PARSERS.set('GameEngineInitialized', (r) => ({
  gameEngine: r.readPubkey(),
  daoAuthority: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerInitialized', (r) => ({
  player: r.readPubkey(),
  owner: r.readPubkey(),
  city: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CityInitialized', (r) => ({
  city: r.readPubkey(),
  cityId: r.readU16(),
  cityType: r.readU8(),
  timestamp: r.readI64(),
}));

// Name
EVENT_PARSERS.set('PlayerNameSet', (r) => ({
  player: r.readPubkey(),
  name: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamNameSet', (r) => ({
  team: r.readPubkey(),
  name: r.readName32(),
  timestamp: r.readI64(),
}));

// Token
EVENT_PARSERS.set('LockedNoviUpdated', (r) => ({
  player: r.readPubkey(),
  oldAmount: r.readU64(),
  newAmount: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReservedWithdrawn', (r) => ({
  player: r.readPubkey(),
  amount: r.readU64(),
  timestamp: r.readI64(),
}));

// Arena
EVENT_PARSERS.set('ArenaSeasonCreated', (r) => ({
  season: r.readPubkey(),
  seasonId: r.readU16(),
  startTime: r.readI64(),
  endTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ArenaJoined', (r) => ({
  season: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ArenaChallenge', (r) => ({
  season: r.readPubkey(),
  challenger: r.readPubkey(),
  challengerName: r.readName48(),
  defender: r.readPubkey(),
  defenderName: r.readName48(),
  challengerWon: r.readBool(),
  ratingChange: r.readI16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ArenaSeasonClosed', (r) => ({
  season: r.readPubkey(),
  seasonId: r.readU16(),
  timestamp: r.readI64(),
}));

// Game Event
EVENT_PARSERS.set('GameEventCreated', (r) => ({
  event: r.readPubkey(),
  eventId: r.readU32(),
  eventType: r.readU8(),
  startTime: r.readI64(),
  endTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GameEventJoined', (r) => ({
  event: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GameEventFinalized', (r) => ({
  event: r.readPubkey(),
  eventId: r.readU32(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GameEventPrizeClaimed', (r) => ({
  event: r.readPubkey(),
  player: r.readPubkey(),
  rank: r.readU16(),
  prizeAmount: r.readU64(),
  timestamp: r.readI64(),
}));

// Dungeon
EVENT_PARSERS.set('DungeonEntered', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  templateId: r.readU16(),
  heroMint: r.readPubkey(),
  entryCost: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonRoomCleared', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  floor: r.readU8(),
  roomType: r.readU8(),
  goldCollected: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonRelicChosen', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  relicId: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonFloorCompleted', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  floor: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonCompleted', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  templateId: r.readU16(),
  floorsCleared: r.readU8(),
  totalGold: r.readU64(),
  totalRewards: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonFailed', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  floor: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonFled', (r) => ({
  player: r.readPubkey(),
  dungeonRun: r.readPubkey(),
  floor: r.readU8(),
  goldKept: r.readU64(),
  timestamp: r.readI64(),
}));

// Castle
EVENT_PARSERS.set('CastleCreated', (r) => ({
  castle: r.readPubkey(),
  city: r.readPubkey(),
  tier: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleClaimed', (r) => ({
  castle: r.readPubkey(),
  king: r.readPubkey(),
  kingName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleUpgradeInitiated', (r) => ({
  castle: r.readPubkey(),
  upgradeType: r.readU8(),
  completionTime: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleUpgradeCompleted', (r) => ({
  castle: r.readPubkey(),
  upgradeType: r.readU8(),
  newLevel: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CourtAppointed', (r) => ({
  castle: r.readPubkey(),
  appointee: r.readPubkey(),
  appointeeName: r.readName48(),
  position: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CourtDismissed', (r) => ({
  castle: r.readPubkey(),
  member: r.readPubkey(),
  position: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GarrisonJoined', (r) => ({
  castle: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  defensive1: r.readU64(),
  defensive2: r.readU64(),
  defensive3: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GarrisonLeft', (r) => ({
  castle: r.readPubkey(),
  player: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleAttacked', (r) => ({
  castle: r.readPubkey(),
  attacker: r.readPubkey(),
  attackerName: r.readName48(),
  damageDealt: r.readU64(),
  wallsRemaining: r.readU64(),
  success: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleConquered', (r) => ({
  castle: r.readPubkey(),
  oldKing: r.readPubkey(),
  newKing: r.readPubkey(),
  newKingName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleRewardsClaimed', (r) => ({
  castle: r.readPubkey(),
  claimer: r.readPubkey(),
  cashReceived: r.readU64(),
  noviReceived: r.readU64(),
  timestamp: r.readI64(),
}));

// Kingdom
EVENT_PARSERS.set('KingdomCreated', (r) => ({
  kingdomId: r.readU16(),
  kingdomName: r.readName32(),
  theme: r.readU8(),
  startTime: r.readI64(),
  registrationClosesAt: r.readI64(),
  createdBy: r.readPubkey(),
  createdAt: r.readI64(),
}));

EVENT_PARSERS.set('KingdomRegistrationClosed', (r) => ({
  kingdomId: r.readU16(),
  gameEngine: r.readPubkey(),
  totalPlayers: r.readU64(),
  closedAt: r.readI64(),
}));

EVENT_PARSERS.set('PlayerJoinedKingdom', (r) => ({
  kingdomId: r.readU16(),
  gameEngine: r.readPubkey(),
  player: r.readPubkey(),
  owner: r.readPubkey(),
  joinedAt: r.readI64(),
}));

EVENT_PARSERS.set('KingdomEventCreated', (r) => ({
  kingdomId: r.readU16(),
  gameEngine: r.readPubkey(),
  eventId: r.readU64(),
  eventType: r.readU8(),
  startTime: r.readI64(),
  endTime: r.readI64(),
  prizePool: r.readU64(),
}));

EVENT_PARSERS.set('KingdomArenaSeasonStarted', (r) => ({
  kingdomId: r.readU16(),
  gameEngine: r.readPubkey(),
  seasonId: r.readU32(),
  startTime: r.readI64(),
  endTime: r.readI64(),
  prizePool: r.readU64(),
}));

EVENT_PARSERS.set('KingdomDungeonLeaderboardCreated', (r) => ({
  kingdomId: r.readU16(),
  gameEngine: r.readPubkey(),
  dungeonId: r.readU16(),
  weekNumber: r.readU16(),
  prizePool: r.readU64(),
}));

EVENT_PARSERS.set('KingdomCitiesInitialized', (r) => ({
  kingdomId: r.readU16(),
  gameEngine: r.readPubkey(),
  startCityId: r.readU16(),
  citiesCount: r.readU8(),
  initializedAt: r.readI64(),
}));

// ============================================================
// Main Parser Functions
// ============================================================

/**
 * Parse a single event from raw bytes.
 *
 * @param data - Raw event data (8-byte discriminator + payload)
 * @returns Parsed event or null if unknown discriminator
 */
export function parseNovusMundusEvent(data: Buffer | Uint8Array): NovusMundusEvent | null {
  if (data.length < 8) {
    return null;
  }

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const discriminator = buffer.subarray(0, 8);
  const discHex = discriminatorToHex(new Uint8Array(discriminator));

  const eventName = EVENT_DISCRIMINATORS.get(discHex);
  if (!eventName) {
    return null;
  }

  const parser = EVENT_PARSERS.get(eventName);
  if (!parser) {
    return null;
  }

  const reader = new EventBufferReader(buffer.subarray(8));
  const parsedData = parser(reader);

  return {
    name: eventName,
    data: parsedData,
  } as NovusMundusEvent;
}

/**
 * Parse events from base64-encoded log data.
 *
 * @param base64Data - Base64-encoded event data from transaction logs
 * @returns Parsed event or null
 */
export function parseEventFromBase64(base64Data: string): NovusMundusEvent | null {
  const buffer = Buffer.from(base64Data, 'base64');
  return parseNovusMundusEvent(buffer);
}

/**
 * Parse all events from transaction logs.
 *
 * Looks for program log entries that contain base64 event data.
 *
 * @param logs - Array of log strings from transaction
 * @returns Array of parsed events
 */
export function parseEventsFromLogs(logs: string[]): NovusMundusEvent[] {
  const events: NovusMundusEvent[] = [];

  // Look for "Program data:" log entries which contain base64 event data
  for (const log of logs) {
    if (log.startsWith('Program data: ')) {
      const base64 = log.substring(14).trim();
      const event = parseEventFromBase64(base64);
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}

/**
 * Get the event name for a discriminator.
 *
 * @param discriminator - 8-byte discriminator
 * @returns Event name or undefined
 */
export function getEventName(discriminator: Uint8Array): string | undefined {
  const hex = discriminatorToHex(discriminator);
  return EVENT_DISCRIMINATORS.get(hex);
}

/**
 * Check if a discriminator matches a known event.
 *
 * @param discriminator - 8-byte discriminator
 * @param eventName - Expected event name
 * @returns true if discriminator matches event
 */
export function isEventType(discriminator: Uint8Array, eventName: string): boolean {
  return discriminatorToHex(discriminator) === discriminatorToHex(computeEventDiscriminator(eventName));
}
