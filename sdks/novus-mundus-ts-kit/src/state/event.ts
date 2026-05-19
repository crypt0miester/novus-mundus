/**
 * Event Accounts
 *
 * EventAccount - Game event with leaderboard (~600 bytes)
 * EventParticipation - Per-player event participation (72 bytes)
 */

import type { Address } from '@solana/kit';
import { reprC, struct, pad, u8, u32, u64, i64, bool, pubkey, fixedString, array } from '../utils/codec';

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
  score: bigint;
}

// Event Account Interface

export interface EventAccount {
  gameEngine: Address;
  id: bigint;
  name: string;
  startTime: bigint;
  endTime: bigint;
  status: EventStatus;
  autoActivate: boolean;
  eventType: number;
  minLevel: number;
  minReputation: bigint;
  requiredSubscriptionTier: number;
  leaderboard: EventLeaderboardEntry[];
  leaderboardCount: number;
  prizeType: EventPrizeType;
  prizeAmount: bigint;
  prizeRemaining: bigint;
  prizeTokenMint: Address;
  participantCount: number;
  bump: number;
}

/** EventAccount size in bytes (1 + 32 + 7pad + 8 + 64+1+7 + 8+8+1+1+6 + 1+7 + 1+7+8+1+7 + 400+1+7 + 1+7+8+8+32 + 4+1+3 = 648) */
export const EVENT_ACCOUNT_SIZE = 648;

// Event Participation Interface

export interface EventParticipation {
  gameEngine: Address;
  eventId: bigint;
  player: Address;
  score: bigint;
  joinedAt: bigint;
  lastUpdate: bigint;
  bump: number;
}

/** EventParticipation size in bytes (1 + 32 + 7pad + 8 + 32 + 8 + 8 + 8 + 1 + 7 = 112) */
export const EVENT_PARTICIPATION_SIZE = 112;

// Codecs

/** EventLeaderboardEntry `#[repr(C)]` codec (40 bytes) */
const eventLeaderboardEntry = struct<EventLeaderboardEntry>([
  ['player', pubkey],
  ['score', u64],
]);

/** EventAccount `#[repr(C)]` codec */
const eventCodec = reprC<EventAccount>([
  pad(1), // account_key discriminator
  ['gameEngine', pubkey],
  ['id', u64],
  ['name', fixedString(64)],
  pad(1), // name_len
  pad(7), // _padding
  ['startTime', i64],
  ['endTime', i64],
  ['status', u8],
  ['autoActivate', bool],
  pad(6), // _padding
  ['eventType', u8],
  pad(7), // _padding
  ['minLevel', u8],
  pad(7), // _padding
  ['minReputation', u64],
  ['requiredSubscriptionTier', u8],
  pad(7), // _padding
  ['leaderboard', array(eventLeaderboardEntry, 10)],
  ['leaderboardCount', u8],
  pad(7), // _padding
  ['prizeType', u8],
  pad(7), // _padding
  ['prizeAmount', u64],
  ['prizeRemaining', u64],
  ['prizeTokenMint', pubkey],
  ['participantCount', u32],
  ['bump', u8],
  pad(3), // _padding
], EVENT_ACCOUNT_SIZE);

/** EventParticipation `#[repr(C)]` codec */
const eventParticipationCodec = reprC<EventParticipation>([
  pad(1), // account_key discriminator
  ['gameEngine', pubkey],
  ['eventId', u64],
  ['player', pubkey],
  ['score', u64],
  ['joinedAt', i64],
  ['lastUpdate', i64],
  ['bump', u8],
  pad(7), // padding
], EVENT_PARTICIPATION_SIZE);

// Deserialization

/** Deserialize EventAccount from raw bytes */
export function deserializeEvent(data: Uint8Array): EventAccount {
  return eventCodec.decode(data);
}

/** Deserialize EventParticipation from raw bytes */
export function deserializeEventParticipation(data: Uint8Array): EventParticipation {
  return eventParticipationCodec.decode(data);
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
