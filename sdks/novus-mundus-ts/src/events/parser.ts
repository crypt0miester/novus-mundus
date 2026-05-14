/**
 * Event Parser
 *
 * Parses on-chain events from transaction logs.
 * Events are emitted via sol_log_data and appear base64-encoded in logs.
 */

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { createHash } from 'crypto';
import type { NovusMundusEvent } from './types';

// Discriminator Computation

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

// Event Discriminator Map

/** Helper to create a discriminator entry */
const d = (name: string): [string, string] => [discriminatorToHex(computeEventDiscriminator(name)), name];

/** All known event discriminators mapped to event names */
export const EVENT_DISCRIMINATORS: Map<string, string> = new Map([
  // Combat
  d('PlayerAttacked'),
  d('EncounterAttacked'),
  d('EncounterDefeated'),

  // Economy
  d('ResourcesCollected'),
  d('UnitsHired'),
  d('CashTransferred'),
  d('NoviLocked'),
  d('EquipmentPurchased'),
  d('StaminaPurchased'),
  d('VaultTransfer'),

  // Team
  d('TeamCreated'),
  d('TeamJoined'),
  d('TeamLeft'),
  d('MemberKicked'),
  d('LeadershipTransferred'),
  d('TeamDisbanded'),
  d('TreasuryDeposit'),
  d('TreasuryWithdraw'),
  d('MemberRankChanged'),
  d('InviteSent'),
  d('InviteAccepted'),
  d('InviteDeclined'),
  d('InviteCancelled'),
  d('MotdUpdated'),
  d('TeamSettingsUpdated'),
  d('TreasurySettingsUpdated'),
  d('TreasuryWithdrawRequested'),
  d('TreasuryRequestApproved'),
  d('TreasuryRequestRejected'),
  d('TreasuryRequestExecuted'),
  d('TreasuryRequestCancelled'),

  // Travel
  d('IntercityTravelStarted'),
  d('IntercityTravelCompleted'),
  d('PlayerTeleported'),
  d('IntracityTravelStarted'),
  d('IntracityTravelCompleted'),
  d('TravelCancelled'),
  d('TravelSpeedup'),

  // Rally
  d('RallyCreated'),
  d('RallyJoined'),
  d('RallyExecuted'),
  d('RallyCancelled'),
  d('RallyLeft'),
  d('RallyClosed'),
  d('RallySpeedup'),
  d('RallyParticipantReturned'),

  // Reinforcement
  d('ReinforcementSent'),
  d('ReinforcementArrived'),
  d('ReinforcementRecalled'),
  d('ReinforcementRelieved'),
  d('ReinforcementReturned'),
  d('ReinforcementSpeedup'),

  // Expedition
  d('ExpeditionStarted'),
  d('ExpeditionStrike'),
  d('ExpeditionClaimed'),
  d('ExpeditionAborted'),
  d('ExpeditionSpeedup'),

  // Loot
  d('LootClaimed'),
  d('EncounterSpawned'),

  // Progression
  d('DailyRewardClaimed'),
  d('SubscriptionPurchased'),
  d('XpGained'),
  d('PlayerLeveledUp'),
  d('EventPrizeClaimed'),
  d('SubscriptionTierUpdated'),
  d('SubscriptionExpired'),

  // Estate
  d('EstateCreated'),
  d('BuildingStarted'),
  d('BuildingCompleted'),
  d('BuildingUpgradeStarted'),
  d('PlotPurchased'),
  d('EstateDailyClaimed'),

  // Forge
  d('CraftStarted'),
  d('CraftStrike'),
  d('CraftCompleted'),
  d('CraftAbandoned'),
  d('ItemEquipped'),

  // Research
  d('ResearchStarted'),
  d('ResearchCompleted'),
  d('ResearchCancelled'),
  d('ResearchSpeedup'),
  d('ResearchAscended'),
  d('PlayerAscended'),

  // Sanctuary
  d('MeditationStarted'),
  d('MeditationClaimed'),

  // Hero
  d('HeroMinted'),
  d('HeroLocked'),
  d('HeroUnlocked'),
  d('HeroLeveledUp'),
  d('HeroAssignedDefensive'),
  d('HeroBurned'),
  d('SupplyCapUpdated'),

  // Shop
  d('ItemPurchased'),
  d('BundlePurchased'),
  d('FlashSalePurchased'),
  d('NoviPurchased'),

  // Initialization
  d('PlayerCreated'),
  d('UserCreated'),
  d('CityInitialized'),
  d('GameEngineInitialized'),

  // Name
  d('PlayerNameSet'),
  d('PlayerNameRemoved'),
  d('PlayerNameUpdated'),
  d('TeamNameSet'),
  d('TeamNameRemoved'),
  d('TeamNameUpdated'),

  // Token
  d('NoviReservedToLocked'),
  d('NoviWithdrawn'),

  // Dungeon
  d('DungeonEntered'),
  d('DungeonRoomCleared'),
  d('DungeonFloorCompleted'),
  d('DungeonRelicChosen'),
  d('DungeonBossFight'),
  d('DungeonFailed'),
  d('DungeonFled'),
  d('DungeonCompleted'),
  d('DungeonResumed'),
  d('DungeonLeaderboardPrizeClaimed'),

  // Castle
  d('CastleCreated'),
  d('CastleClaimed'),
  d('CastleConquered'),
  d('CastleDefended'),
  d('CourtAppointed'),
  d('CourtDismissed'),
  d('GarrisonJoined'),
  d('GarrisonLeft'),
  d('GarrisonLootClaimed'),
  d('CastleUpgradeStarted'),
  d('CastleUpgradeCompleted'),
  d('CastleUpgradeCancelled'),
  d('CastleRewardsClaimed'),
  d('CastleProtectionExpired'),
  d('KingForceRemoved'),
  d('CastleTransitionProgress'),
  d('CastleStatusChanged'),
  d('CastleAttacked'),

  // Game Event
  d('GameEventCreated'),
  d('GameEventJoined'),
  d('GameEventFinalized'),
  d('EventScoreUpdated'),

  // Kingdom
  d('KingdomCreated'),
  d('KingdomRegistrationClosed'),
  d('PlayerJoinedKingdom'),
  d('KingdomEventCreated'),
  d('KingdomArenaSeasonStarted'),
  d('KingdomDungeonLeaderboardCreated'),
  d('KingdomCitiesInitialized'),
]);

// Event Buffer Reader

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

// Event Parsers

type EventParser = (reader: EventBufferReader) => Record<string, unknown>;

const EVENT_PARSERS = new Map<string, EventParser>();

// ── Combat ──

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

// ── Economy ──

EVENT_PARSERS.set('ResourcesCollected', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  collectionType: r.readU8(),
  noviConsumed: r.readU64(),
  baseOutput: r.readU64(),
  finalOutput: r.readU64(),
  gemsEarned: r.readU64(),
  fragmentsEarned: r.readU64(),
  xpGained: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('UnitsHired', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  unitType: r.readU8(),
  baseQuantity: r.readU64(),
  finalQuantity: r.readU64(),
  noviBurned: r.readU64(),
  timeBonusBps: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CashTransferred', (r) => ({
  from: r.readPubkey(),
  fromName: r.readName48(),
  to: r.readPubkey(),
  toName: r.readName48(),
  amount: r.readU64(),
  fee: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('NoviLocked', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  amount: r.readU64(),
  totalLocked: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EquipmentPurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  slot: r.readU8(),
  tier: r.readU8(),
  noviBurned: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('StaminaPurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  stamina: r.readU64(),
  gemsSpent: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('VaultTransfer', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  amount: r.readU64(),
  toVault: r.readBool(),
  vaultBalance: r.readU64(),
  timestamp: r.readI64(),
}));

// ── Team ──

EVENT_PARSERS.set('TeamCreated', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  founder: r.readPubkey(),
  noviBurned: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamJoined', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  memberCount: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamLeft', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  memberCount: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('MemberKicked', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  kicked: r.readPubkey(),
  kickedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('LeadershipTransferred', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  oldLeader: r.readPubkey(),
  newLeader: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamDisbanded', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  leader: r.readPubkey(),
  treasuryDistributed: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryDeposit', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  depositor: r.readPubkey(),
  amount: r.readU64(),
  newBalance: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryWithdraw', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  withdrawer: r.readPubkey(),
  amount: r.readU64(),
  newBalance: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('MemberRankChanged', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  member: r.readPubkey(),
  oldRank: r.readU8(),
  newRank: r.readU8(),
  changedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('InviteSent', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  invitee: r.readPubkey(),
  inviter: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('InviteAccepted', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  memberCount: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('InviteDeclined', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('InviteCancelled', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  invitee: r.readPubkey(),
  cancelledBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('MotdUpdated', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  updatedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamSettingsUpdated', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  updatedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasurySettingsUpdated', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  updatedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryWithdrawRequested', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  requester: r.readPubkey(),
  amount: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryRequestApproved', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  approver: r.readPubkey(),
  requester: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryRequestRejected', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  rejector: r.readPubkey(),
  requester: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryRequestExecuted', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  executor: r.readPubkey(),
  requester: r.readPubkey(),
  amount: r.readU64(),
  newBalance: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TreasuryRequestCancelled', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  requester: r.readPubkey(),
  timestamp: r.readI64(),
}));

// ── Travel ──

EVENT_PARSERS.set('IntercityTravelStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  fromCity: r.readPubkey(),
  toCity: r.readPubkey(),
  arrivalAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('IntercityTravelCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  city: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerTeleported', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  fromCity: r.readPubkey(),
  toCity: r.readPubkey(),
  gemsSpent: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('IntracityTravelStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  city: r.readPubkey(),
  destX: r.readI32(),
  destY: r.readI32(),
  arrivalAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('IntracityTravelCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  x: r.readI32(),
  y: r.readI32(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TravelCancelled', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  isIntercity: r.readBool(),
  wasBumped: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TravelSpeedup', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  isIntercity: r.readBool(),
  speedupTier: r.readU8(),
  gemsSpent: r.readU64(),
  newEta: r.readI64(),
  timestamp: r.readI64(),
}));

// ── Rally ──

EVENT_PARSERS.set('RallyCreated', (r) => ({
  rally: r.readPubkey(),
  team: r.readPubkey(),
  teamName: r.readName32(),
  leader: r.readPubkey(),
  target: r.readPubkey(),
  gatherAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyJoined', (r) => ({
  rally: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  participantCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyExecuted', (r) => ({
  rally: r.readPubkey(),
  teamName: r.readName32(),
  target: r.readPubkey(),
  damageDealt: r.readU64(),
  damageReceived: r.readU64(),
  lootCaptured: r.readU64(),
  participantCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyCancelled', (r) => ({
  rally: r.readPubkey(),
  teamName: r.readName32(),
  cancelledBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyLeft', (r) => ({
  rally: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  participantCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyClosed', (r) => ({
  rally: r.readPubkey(),
  rallyId: r.readU64(),
  teamName: r.readName32(),
  leader: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallySpeedup', (r) => ({
  rally: r.readPubkey(),
  teamName: r.readName32(),
  payer: r.readPubkey(),
  speedupType: r.readU8(),
  gemsSpent: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('RallyParticipantReturned', (r) => ({
  rally: r.readPubkey(),
  teamName: r.readName32(),
  player: r.readPubkey(),
  participatedInCombat: r.readBool(),
  unitsReturned: [r.readU64(), r.readU64(), r.readU64()],
  lootReceived: r.readU64(),
  timestamp: r.readI64(),
}));

// ── Reinforcement ──

EVENT_PARSERS.set('ReinforcementSent', (r) => ({
  sender: r.readPubkey(),
  senderName: r.readName48(),
  receiver: r.readPubkey(),
  receiverName: r.readName48(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  arrivesAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementArrived', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  senderName: r.readName48(),
  receiver: r.readPubkey(),
  receiverName: r.readName48(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementRecalled', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  senderName: r.readName48(),
  receiver: r.readPubkey(),
  receiverName: r.readName48(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementRelieved', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  senderName: r.readName48(),
  receiver: r.readPubkey(),
  receiverName: r.readName48(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementReturned', (r) => ({
  sender: r.readPubkey(),
  senderName: r.readName48(),
  units: [r.readU64(), r.readU64(), r.readU64()],
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ReinforcementSpeedup', (r) => ({
  reinforcement: r.readPubkey(),
  sender: r.readPubkey(),
  senderName: r.readName48(),
  receiver: r.readPubkey(),
  speedupType: r.readU8(),
  gemsSpent: r.readU64(),
  newEta: r.readI64(),
  timestamp: r.readI64(),
}));

// ── Expedition ──

EVENT_PARSERS.set('ExpeditionStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  expeditionType: r.readU8(),
  nodeId: r.readU8(),
  duration: r.readU32(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionStrike', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  strikeNum: r.readU8(),
  yieldAmount: r.readU64(),
  quality: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  expeditionType: r.readU8(),
  totalYield: r.readU64(),
  bonusYield: r.readU64(),
  xpEarned: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionAborted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  expeditionType: r.readU8(),
  partialYield: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ExpeditionSpeedup', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  speedupSeconds: r.readU64(),
  gemsSpent: r.readU64(),
  newEta: r.readI64(),
  timestamp: r.readI64(),
}));

// ── Loot ──

EVENT_PARSERS.set('LootClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  cash: r.readU64(),
  items: [r.readU16(), r.readU16(), r.readU16(), r.readU16()],
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EncounterSpawned', (r) => ({
  encounter: r.readPubkey(),
  city: r.readPubkey(),
  encounterType: r.readU8(),
  level: r.readU8(),
  x: r.readI32(),
  y: r.readI32(),
  timestamp: r.readI64(),
}));

// ── Progression ──

EVENT_PARSERS.set('DailyRewardClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  cash: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('SubscriptionPurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  tier: r.readU8(),
  durationDays: r.readU16(),
  noviPaid: r.readU64(),
  expiresAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('XpGained', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  amount: r.readU64(),
  source: r.readU8(),
  totalXp: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerLeveledUp', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  oldLevel: r.readU16(),
  newLevel: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EventPrizeClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  event: r.readPubkey(),
  rank: r.readU16(),
  prizeAmount: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('SubscriptionTierUpdated', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  oldTier: r.readU8(),
  newTier: r.readU8(),
  expiresAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('SubscriptionExpired', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  oldTier: r.readU8(),
  timestamp: r.readI64(),
}));

// ── Estate ──

EVENT_PARSERS.set('EstateCreated', (r) => ({
  estate: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BuildingStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  buildingType: r.readU8(),
  plot: r.readU8(),
  completesAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BuildingCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  buildingType: r.readU8(),
  level: r.readU8(),
  plot: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BuildingUpgradeStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  buildingType: r.readU8(),
  fromLevel: r.readU8(),
  toLevel: r.readU8(),
  completesAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlotPurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  plot: r.readU8(),
  cost: r.readU64(),
  totalPlots: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EstateDailyClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  materials: r.readU64(),
  streak: r.readU16(),
  timestamp: r.readI64(),
}));

// ── Forge ──

EVENT_PARSERS.set('CraftStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  itemType: r.readU8(),
  qualityTier: r.readU8(),
  materialsUsed: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CraftStrike', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  stage: r.readU8(),
  quality: r.readU8(),
  score: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CraftCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  itemType: r.readU8(),
  quality: r.readU8(),
  score: r.readU16(),
  inventorySlot: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CraftAbandoned', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  itemType: r.readU8(),
  stageReached: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ItemEquipped', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  slot: r.readU8(),
  quality: r.readU8(),
  fromInventory: r.readU8(),
  timestamp: r.readI64(),
}));

// ── Research ──

EVENT_PARSERS.set('ResearchStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  researchId: r.readU16(),
  level: r.readU8(),
  completesAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ResearchCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  researchId: r.readU16(),
  level: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ResearchCancelled', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  researchId: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ResearchSpeedup', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  researchId: r.readU16(),
  speedupSeconds: r.readI64(),
  gemsSpent: r.readU64(),
  newEta: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('ResearchAscended', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  researchTree: r.readU16(),
  newAscensionLevel: r.readU8(),
  masteryCost: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerAscended', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  ascensionLevel: r.readU8(),
  masteryGained: r.readU16(),
  timestamp: r.readI64(),
}));

// ── Sanctuary ──

EVENT_PARSERS.set('MeditationStarted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  durationHours: r.readU8(),
  completesAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('MeditationClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  xpEarned: r.readU32(),
  levelsGained: r.readU8(),
  timestamp: r.readI64(),
}));

// ── Hero ──

EVENT_PARSERS.set('HeroMinted', (r) => ({
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  templateId: r.readU16(),
  rarity: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroLocked', (r) => ({
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  slot: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroUnlocked', (r) => ({
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroLeveledUp', (r) => ({
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  oldLevel: r.readU32(),
  newLevel: r.readU32(),
  xpSpent: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroAssignedDefensive', (r) => ({
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  assigned: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('HeroBurned', (r) => ({
  heroMint: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  templateId: r.readU16(),
  heroLevel: r.readU32(),
  tier: r.readU8(),
  noviReward: r.readU64(),
  newMintedCount: r.readU32(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('SupplyCapUpdated', (r) => ({
  templateId: r.readU16(),
  oldSupplyCap: r.readU32(),
  newSupplyCap: r.readU32(),
  timestamp: r.readI64(),
}));

// ── Shop ──

EVENT_PARSERS.set('ItemPurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  itemId: r.readU32(),
  quantity: r.readU16(),
  price: r.readU64(),
  currency: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('BundlePurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  bundleId: r.readU32(),
  price: r.readU64(),
  currency: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('FlashSalePurchased', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  saleId: r.readU64(),
  originalPrice: r.readU64(),
  pricePaid: r.readU64(),
  currency: r.readU8(),
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

// ── Initialization ──

EVENT_PARSERS.set('PlayerCreated', (r) => ({
  player: r.readPubkey(),
  user: r.readPubkey(),
  city: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('UserCreated', (r) => ({
  user: r.readPubkey(),
  wallet: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CityInitialized', (r) => ({
  city: r.readPubkey(),
  cityIndex: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GameEngineInitialized', (r) => ({
  gameEngine: r.readPubkey(),
  authority: r.readPubkey(),
  timestamp: r.readI64(),
}));

// ── Name ──

EVENT_PARSERS.set('PlayerNameSet', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  domainHash: r.readBytes(32),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerNameRemoved', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('PlayerNameUpdated', (r) => ({
  player: r.readPubkey(),
  oldName: r.readName48(),
  newName: r.readName48(),
  newDomainHash: r.readBytes(32),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamNameSet', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  domainHash: r.readBytes(32),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamNameRemoved', (r) => ({
  team: r.readPubkey(),
  teamName: r.readName32(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('TeamNameUpdated', (r) => ({
  team: r.readPubkey(),
  oldName: r.readName32(),
  newName: r.readName32(),
  newDomainHash: r.readBytes(32),
  timestamp: r.readI64(),
}));

// ── Token ──

EVENT_PARSERS.set('NoviReservedToLocked', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  amount: r.readU64(),
  newLocked: r.readU64(),
  remainingReserved: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('NoviWithdrawn', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  amount: r.readU64(),
  remainingReserved: r.readU64(),
  timestamp: r.readI64(),
}));

// ── Dungeon ──

EVENT_PARSERS.set('DungeonEntered', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  heroMint: r.readPubkey(),
  heroName: r.readName32(),
  staminaSpent: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonRoomCleared', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  floor: r.readU8(),
  room: r.readU8(),
  xpGained: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonFloorCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  floor: r.readU8(),
  noviGained: r.readU64(),
  isCheckpoint: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonRelicChosen', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  floor: r.readU8(),
  relicId: r.readU8(),
  totalRelics: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonBossFight', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  floor: r.readU8(),
  bossPower: r.readU32(),
  bossHealth: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonFailed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  floor: r.readU8(),
  room: r.readU8(),
  enemiesKilled: r.readU16(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonFled', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  floor: r.readU8(),
  enemiesKilled: r.readU16(),
  xpGained: r.readU64(),
  noviGained: r.readU64(),
  gemsGained: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonCompleted', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  victory: r.readBool(),
  finalFloor: r.readU8(),
  enemiesKilled: r.readU16(),
  roomsCleared: r.readU8(),
  relicsCollected: r.readU8(),
  xpGained: r.readU64(),
  noviGained: r.readU64(),
  gemsGained: r.readU64(),
  materialsGained: r.readU32(),
  totalDamageDealt: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonResumed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  checkpointFloor: r.readU8(),
  resumeFloor: r.readU8(),
  gemCost: r.readU64(),
  resumeCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('DungeonLeaderboardPrizeClaimed', (r) => ({
  player: r.readPubkey(),
  playerName: r.readName48(),
  dungeonId: r.readU16(),
  weekNumber: r.readU16(),
  rank: r.readU8(),
  score: r.readU64(),
  prizeAmount: r.readU64(),
  timestamp: r.readI64(),
}));

// ── Castle ──

EVENT_PARSERS.set('CastleCreated', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  cityId: r.readU16(),
  castleId: r.readU16(),
  tier: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleClaimed', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  king: r.readPubkey(),
  kingName: r.readName48(),
  team: r.readPubkey(),
  tier: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleConquered', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  previousKing: r.readPubkey(),
  newKing: r.readPubkey(),
  newKingName: r.readName48(),
  newTeam: r.readPubkey(),
  rallyId: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleDefended', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  king: r.readPubkey(),
  rallyId: r.readU64(),
  damageDealt: r.readU64(),
  weaponsCaptured: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CourtAppointed', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  appointee: r.readPubkey(),
  appointeeName: r.readName48(),
  positionType: r.readU8(),
  appointedBy: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CourtDismissed', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  dismissed: r.readPubkey(),
  dismissedName: r.readName48(),
  positionType: r.readU8(),
  dismissedBy: r.readPubkey(),
  resigned: r.readBool(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GarrisonJoined', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  contributor: r.readPubkey(),
  contributorName: r.readName48(),
  units1: r.readU64(),
  units2: r.readU64(),
  units3: r.readU64(),
  weapons: r.readU64(),
  heroMint: r.readPubkey(),
  garrisonCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GarrisonLeft', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  contributor: r.readPubkey(),
  contributorName: r.readName48(),
  units1: r.readU64(),
  units2: r.readU64(),
  units3: r.readU64(),
  weapons: r.readU64(),
  heroMint: r.readPubkey(),
  relieved: r.readBool(),
  garrisonCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GarrisonLootClaimed', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  claimer: r.readPubkey(),
  claimerName: r.readName48(),
  melee: r.readU64(),
  ranged: r.readU64(),
  siege: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleUpgradeStarted', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  king: r.readPubkey(),
  upgradeType: r.readU8(),
  currentLevel: r.readU8(),
  targetLevel: r.readU8(),
  noviCost: r.readU64(),
  completesAt: r.readI64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleUpgradeCompleted', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  upgradeType: r.readU8(),
  newLevel: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleUpgradeCancelled', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  upgradeType: r.readU8(),
  noviRefunded: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleRewardsClaimed', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  claimer: r.readPubkey(),
  claimerName: r.readName48(),
  role: r.readU8(),
  days: r.readU8(),
  novi: r.readU64(),
  cash: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleProtectionExpired', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  king: r.readPubkey(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('KingForceRemoved', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  removedKing: r.readPubkey(),
  removedKingName: r.readName48(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleTransitionProgress', (r) => ({
  castle: r.readPubkey(),
  phase: r.readU8(),
  cleanedCount: r.readU8(),
  totalCount: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleStatusChanged', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  oldStatus: r.readU8(),
  newStatus: r.readU8(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('CastleAttacked', (r) => ({
  castle: r.readPubkey(),
  castleName: r.readName32(),
  attacker: r.readPubkey(),
  attackerName: r.readName48(),
  king: r.readPubkey(),
  damageDealt: r.readU64(),
  damageReceived: r.readU64(),
  attackerCasualties: r.readU64(),
  garrisonCasualties: r.readU64(),
  attackerWon: r.readBool(),
  timestamp: r.readI64(),
}));

// ── Game Event ──

EVENT_PARSERS.set('GameEventCreated', (r) => ({
  event: r.readPubkey(),
  eventType: r.readU8(),
  startTime: r.readI64(),
  endTime: r.readI64(),
  prizePool: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GameEventJoined', (r) => ({
  event: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  entryFee: r.readU64(),
  participantCount: r.readU32(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('GameEventFinalized', (r) => ({
  event: r.readPubkey(),
  totalParticipants: r.readU32(),
  totalPrizes: r.readU64(),
  timestamp: r.readI64(),
}));

EVENT_PARSERS.set('EventScoreUpdated', (r) => ({
  event: r.readPubkey(),
  player: r.readPubkey(),
  playerName: r.readName48(),
  scoreDelta: r.readI64(),
  newScore: r.readU64(),
  timestamp: r.readI64(),
}));

// ── Kingdom ──

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

// Main Parser Functions

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
  } as unknown as NovusMundusEvent;
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
