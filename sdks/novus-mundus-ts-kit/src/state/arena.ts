/**
 * Arena Accounts
 *
 * ArenaSeasonAccount - Season state and leaderboard (608 bytes with repr(C) padding)
 * ArenaParticipantAccount - Per-player, per-season state (536 bytes with repr(C) padding)
 * ArenaLoadoutAccount - Player's configured loadout (168 bytes with repr(C) padding)
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, struct, pad, u8, u16, u32, u64, i64, bool, pubkey, array } from '../utils/codec';
import { ArenaSeasonStatus } from '../types/enums';

// Arena Leaderboard Entry

export interface ArenaLeaderboardEntry {
  player: Address;
  totalPoints: bigint;
}

// Arena Season Account Interface

export interface ArenaSeasonAccount {
  seasonId: number;
  cityId: number;
  authority: Address;
  startTime: bigint;
  endTime: bigint;
  claimDeadline: bigint;
  status: ArenaSeasonStatus;
  leaderboard: ArenaLeaderboardEntry[];
  leaderboardCount: number;
  leaderboardClaimed: boolean[];
  masterPrizePool: bigint;
  dailyPrizePool: bigint;
  dailyDistributionCap: bigint;
  distributedToday: bigint;
  lastDistributionDay: number;
  prizeRemaining: bigint;
  minLevelRequired: number;
  minPointsForLeaderboard: bigint;
  totalBattles: bigint;
  bump: number;
}

/** ArenaSeasonAccount size in bytes (with repr(C) alignment padding) */
export const ARENA_SEASON_ACCOUNT_SIZE = 608;

// Arena Participant Account Interface

export interface ArenaParticipantAccount {
  player: Address;
  seasonId: number;
  battleTimestamps: bigint[];
  battleOpponents: Address[];
  battleIndex: number;
  lastMatchId: bigint;
  dailyRewardClaimedDay: number;
  eloRating: number;
  totalPoints: bigint;
  wins: number;
  losses: number;
  masterRewardClaimed: boolean;
  bump: number;
}

/** ArenaParticipantAccount size in bytes (with repr(C) alignment padding) */
export const ARENA_PARTICIPANT_ACCOUNT_SIZE = 536;

// Arena Loadout Account Interface

export interface ArenaLoadoutAccount {
  player: Address;
  bump: number;
  arenaHero: Address;
  defensiveUnits: bigint[];
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armorPieces: bigint;
}

/** ArenaLoadoutAccount size in bytes (with repr(C) alignment padding) */
export const ARENA_LOADOUT_ACCOUNT_SIZE = 168;

// Codecs

/** ArenaLeaderboardEntry `#[repr(C)]` codec (40 bytes) */
const arenaLeaderboardEntry = struct<ArenaLeaderboardEntry>([
  ['player', pubkey],
  ['totalPoints', u64],
]);

/** ArenaSeasonAccount `#[repr(C)]` codec */
const arenaSeasonCodec = reprC<ArenaSeasonAccount>([
  pad(1), // account_key discriminator
  pad(32), // game_engine
  ['seasonId', u32],
  ['cityId', u16],
  ['authority', pubkey],
  ['startTime', i64],
  ['endTime', i64],
  ['claimDeadline', i64],
  ['status', u8],
  ['leaderboard', array(arenaLeaderboardEntry, 10)],
  ['leaderboardCount', u8],
  ['leaderboardClaimed', array(bool, 10)],
  ['masterPrizePool', u64],
  ['dailyPrizePool', u64],
  ['dailyDistributionCap', u64],
  ['distributedToday', u64],
  ['lastDistributionDay', u32],
  pad(4), // _padding1
  ['prizeRemaining', u64],
  ['minLevelRequired', u8],
  pad(7), // _padding2
  ['minPointsForLeaderboard', u64],
  ['totalBattles', u64],
  ['bump', u8],
  pad(7), // _reserved
], ARENA_SEASON_ACCOUNT_SIZE);

/** ArenaParticipantAccount `#[repr(C)]` codec */
const arenaParticipantCodec = reprC<ArenaParticipantAccount>([
  pad(1), // account_key discriminator
  pad(32), // game_engine
  ['player', pubkey],
  ['seasonId', u32],
  ['battleTimestamps', array(i64, 10)],
  ['battleOpponents', array(pubkey, 10)],
  ['battleIndex', u8],
  ['lastMatchId', u64],
  ['dailyRewardClaimedDay', u32],
  ['eloRating', u32],
  ['totalPoints', u64],
  ['wins', u32],
  ['losses', u32],
  ['masterRewardClaimed', bool],
  ['bump', u8],
  pad(17), // _reserved
], ARENA_PARTICIPANT_ACCOUNT_SIZE);

/** ArenaLoadoutAccount `#[repr(C)]` codec */
const arenaLoadoutCodec = reprC<ArenaLoadoutAccount>([
  pad(1), // account_key discriminator
  pad(32), // game_engine
  ['player', pubkey],
  ['bump', u8],
  ['arenaHero', pubkey],
  ['defensiveUnits', array(u64, 3)],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['armorPieces', u64],
  pad(7), // _reserved
], ARENA_LOADOUT_ACCOUNT_SIZE);

// Deserialization

/** Deserialize ArenaSeasonAccount from raw bytes */
export function deserializeArenaSeason(data: Uint8Array): ArenaSeasonAccount {
  return arenaSeasonCodec.decode(data);
}

/** Deserialize ArenaParticipantAccount from raw bytes */
export function deserializeArenaParticipant(data: Uint8Array): ArenaParticipantAccount {
  return arenaParticipantCodec.decode(data);
}

/** Deserialize ArenaLoadoutAccount from raw bytes */
export function deserializeArenaLoadout(data: Uint8Array): ArenaLoadoutAccount {
  return arenaLoadoutCodec.decode(data);
}

// Parse Functions

/** Parse ArenaSeasonAccount from account info */
export function parseArenaSeason(accountInfo: { data: Uint8Array }): ArenaSeasonAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_SEASON_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaSeason(accountInfo.data);
}

/** Parse ArenaParticipantAccount from account info */
export function parseArenaParticipant(accountInfo: { data: Uint8Array }): ArenaParticipantAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_PARTICIPANT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaParticipant(accountInfo.data);
}

/** Parse ArenaLoadoutAccount from account info */
export function parseArenaLoadout(accountInfo: { data: Uint8Array }): ArenaLoadoutAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_LOADOUT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaLoadout(accountInfo.data);
}

// Helper Functions

/** Check if season is active */
export function isSeasonActive(season: ArenaSeasonAccount): boolean {
  return season.status === ArenaSeasonStatus.Active;
}

/** Check if season has ended */
export function isSeasonEnded(season: ArenaSeasonAccount): boolean {
  return season.status === ArenaSeasonStatus.Ended || season.status === ArenaSeasonStatus.Finalized;
}

/** Get player rank (1-indexed) or null if not on leaderboard */
export function getPlayerRank(season: ArenaSeasonAccount, player: Address): number | null {
  for (let i = 0; i < season.leaderboardCount; i++) {
    if (season.leaderboard[i]!.player === player) {
      return i + 1;
    }
  }
  return null;
}

/** Get win rate as percentage (0-100) */
export function getWinRate(participant: ArenaParticipantAccount): number {
  const total = participant.wins + participant.losses;
  if (total === 0) return 0;
  return Math.round((participant.wins / total) * 100);
}

/** Count battles within a time window */
export function countBattlesInWindow(
  participant: ArenaParticipantAccount,
  nowSeconds: number,
  windowSeconds: number
): number {
  const cutoff = nowSeconds - windowSeconds;
  let count = 0;
  for (const timestamp of participant.battleTimestamps) {
    if (Number(timestamp) > cutoff) {
      count++;
    }
  }
  return count;
}

/** Get total units in loadout */
export function getLoadoutTotalUnits(loadout: ArenaLoadoutAccount): bigint {
  return (loadout.defensiveUnits[0]! + loadout.defensiveUnits[1]! + loadout.defensiveUnits[2]!);
}

/** Get total weapons in loadout */
export function getLoadoutTotalWeapons(loadout: ArenaLoadoutAccount): bigint {
  return (loadout.meleeWeapons + loadout.rangedWeapons + loadout.siegeWeapons);
}

/** Check if loadout has custom hero set */
export function hasCustomArenaHero(loadout: ArenaLoadoutAccount): boolean {
  return !isNullPubkey(loadout.arenaHero);
}
