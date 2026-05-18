/**
 * Event Accounts
 *
 * EventAccount - Game event with leaderboard (~600 bytes)
 * EventParticipation - Per-player event participation (72 bytes)
 */

import type { Address } from '@solana/kit';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';

// Event Enums

export enum EventStatus {
  Pending = 0,
  Active = 1,
  Finalized = 2,
  Cancelled = 3,
}

export enum EventPrizeType {
  LockedNovi = 0,
  Gems = 1,
  Cash = 2,
  SPLToken = 3,
}

// Event Leaderboard Entry

export interface EventLeaderboardEntry {
  player: Address;
  score: BN;
}

// Event Account Interface

export interface EventAccount {
  gameEngine: Address;
  id: BN;
  name: string;
  startTime: BN;
  endTime: BN;
  status: EventStatus;
  autoActivate: boolean;
  eventType: number;
  minLevel: number;
  minReputation: BN;
  requiredSubscriptionTier: number;
  leaderboard: EventLeaderboardEntry[];
  leaderboardCount: number;
  prizeType: EventPrizeType;
  prizeAmount: BN;
  prizeRemaining: BN;
  prizeTokenMint: Address;
  participantCount: number;
  bump: number;
}

/** EventAccount size in bytes (1 + 32 + 7pad + 8 + 64+1+7 + 8+8+1+1+6 + 1+7 + 1+7+8+1+7 + 400+1+7 + 1+7+8+8+32 + 4+1+3 = 648) */
export const EVENT_ACCOUNT_SIZE = 648;

// Event Participation Interface

export interface EventParticipation {
  gameEngine: Address;
  eventId: BN;
  player: Address;
  score: BN;
  joinedAt: BN;
  lastUpdate: BN;
  bump: number;
}

/** EventParticipation size in bytes (1 + 32 + 7pad + 8 + 32 + 8 + 8 + 8 + 1 + 7 = 112) */
export const EVENT_PARTICIPATION_SIZE = 112;

// Deserialization

/** Deserialize EventAccount from raw bytes */
export function deserializeEvent(data: Uint8Array | Buffer): EventAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  const gameEngine = reader.readPubkey();
  reader.skip(7); // implicit padding for u64 alignment (offset 33 -> 40)
  const id = reader.readU64();
  const nameBytes = reader.readBytes(64);
  const nameLen = reader.readU8();
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen));
  reader.skip(7); // padding

  const startTime = reader.readI64();
  const endTime = reader.readI64();
  const statusValue = reader.readU8();
  const status = statusValue as EventStatus;
  const autoActivate = reader.readBool();
  reader.skip(6); // padding

  const eventType = reader.readU8();
  reader.skip(7); // padding

  const minLevel = reader.readU8();
  reader.skip(7); // padding
  const minReputation = reader.readU64();
  const requiredSubscriptionTier = reader.readU8();
  reader.skip(7); // padding

  // Leaderboard
  const leaderboard: EventLeaderboardEntry[] = [];
  for (let i = 0; i < 10; i++) {
    const player = reader.readPubkey();
    const score = reader.readU64();
    leaderboard.push({ player, score });
  }
  const leaderboardCount = reader.readU8();
  reader.skip(7); // padding

  // Prize pool
  const prizeTypeValue = reader.readU8();
  const prizeType = prizeTypeValue as EventPrizeType;
  reader.skip(7); // padding
  const prizeAmount = reader.readU64();
  const prizeRemaining = reader.readU64();
  const prizeTokenMint = reader.readPubkey();

  const participantCount = reader.readU32();
  const bump = reader.readU8();
  reader.skip(3); // padding

  return {
    gameEngine,
    id,
    name,
    startTime,
    endTime,
    status,
    autoActivate,
    eventType,
    minLevel,
    minReputation,
    requiredSubscriptionTier,
    leaderboard,
    leaderboardCount,
    prizeType,
    prizeAmount,
    prizeRemaining,
    prizeTokenMint,
    participantCount,
    bump,
  };
}

/** Deserialize EventParticipation from raw bytes */
export function deserializeEventParticipation(data: Uint8Array | Buffer): EventParticipation {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  const gameEngine = reader.readPubkey();
  reader.skip(7); // implicit padding for u64 alignment (offset 33 -> 40)
  const eventId = reader.readU64();
  const player = reader.readPubkey();
  const score = reader.readU64();
  const joinedAt = reader.readI64();
  const lastUpdate = reader.readI64();
  const bump = reader.readU8();
  reader.skip(7); // padding

  return {
    gameEngine,
    eventId,
    player,
    score,
    joinedAt,
    lastUpdate,
    bump,
  };
}

// Parse Functions

/** Parse EventAccount from account info */
export function parseEvent(accountInfo: { data: Uint8Array }): EventAccount | null {
  if (!accountInfo.data || accountInfo.data.length < EVENT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeEvent(accountInfo.data);
}

/** Parse EventParticipation from account info */
export function parseEventParticipation(accountInfo: { data: Uint8Array }): EventParticipation | null {
  if (!accountInfo.data || accountInfo.data.length < EVENT_PARTICIPATION_SIZE) {
    return null;
  }
  return deserializeEventParticipation(accountInfo.data);
}

// Helper Functions

/** Check if event is active */
export function isEventActive(event: EventAccount): boolean {
  return event.status === EventStatus.Active;
}

/** Check if event is finalized */
export function isEventFinalized(event: EventAccount): boolean {
  return event.status === EventStatus.Finalized;
}

/** Get active leaderboard entries */
export function getEventLeaderboard(event: EventAccount): EventLeaderboardEntry[] {
  return event.leaderboard.slice(0, event.leaderboardCount);
}

/** Find player rank in leaderboard (0-indexed, null if not in top 10) */
export function findPlayerRank(event: EventAccount, player: Address): number | null {
  for (let i = 0; i < event.leaderboardCount; i++) {
    if (event.leaderboard[i]!.player === player) {
      return i;
    }
  }
  return null;
}
