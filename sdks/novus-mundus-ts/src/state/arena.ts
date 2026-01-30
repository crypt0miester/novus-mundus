/**
 * Arena Accounts
 *
 * ArenaSeasonAccount - Season state and leaderboard (560 bytes)
 * ArenaParticipantAccount - Per-player, per-season state (488 bytes)
 * ArenaLoadoutAccount - Player's configured loadout (128 bytes)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize.ts';
import { ArenaSeasonStatus } from '../types/enums.ts';

// ============================================================
// Arena Leaderboard Entry
// ============================================================

export interface ArenaLeaderboardEntry {
  player: PublicKey;
  totalPoints: BN;
}

// ============================================================
// Arena Season Account Interface
// ============================================================

export interface ArenaSeasonAccount {
  seasonId: number;
  cityId: number;
  authority: PublicKey;
  startTime: BN;
  endTime: BN;
  claimDeadline: BN;
  status: ArenaSeasonStatus;
  leaderboard: ArenaLeaderboardEntry[];
  leaderboardCount: number;
  leaderboardClaimed: boolean[];
  masterPrizePool: BN;
  dailyPrizePool: BN;
  dailyDistributionCap: BN;
  distributedToday: BN;
  lastDistributionDay: number;
  prizeRemaining: BN;
  minLevelRequired: number;
  minPointsForLeaderboard: BN;
  totalBattles: BN;
  bump: number;
}

/** ArenaSeasonAccount size in bytes */
export const ARENA_SEASON_ACCOUNT_SIZE = 560;

// ============================================================
// Arena Participant Account Interface
// ============================================================

export interface ArenaParticipantAccount {
  player: PublicKey;
  seasonId: number;
  battleTimestamps: BN[];
  battleOpponents: PublicKey[];
  battleIndex: number;
  lastMatchId: BN;
  dailyRewardClaimedDay: number;
  eloRating: number;
  totalPoints: BN;
  wins: number;
  losses: number;
  masterRewardClaimed: boolean;
  bump: number;
}

/** ArenaParticipantAccount size in bytes */
export const ARENA_PARTICIPANT_ACCOUNT_SIZE = 488;

// ============================================================
// Arena Loadout Account Interface
// ============================================================

export interface ArenaLoadoutAccount {
  player: PublicKey;
  bump: number;
  arenaHero: PublicKey;
  defensiveUnits: BN[];
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
  armorPieces: BN;
}

/** ArenaLoadoutAccount size in bytes */
export const ARENA_LOADOUT_ACCOUNT_SIZE = 128;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize ArenaSeasonAccount from raw bytes */
export function deserializeArenaSeason(data: Uint8Array | Buffer): ArenaSeasonAccount {
  const reader = new BufferReader(data);

  // Identity
  const seasonId = reader.readU32();
  const cityId = reader.readU16();
  const authority = reader.readPubkey();

  // Timing
  const startTime = reader.readI64();
  const endTime = reader.readI64();
  const claimDeadline = reader.readI64();
  const statusValue = reader.readU8();
  const status = statusValue as ArenaSeasonStatus;

  // Leaderboard
  const leaderboard: ArenaLeaderboardEntry[] = [];
  for (let i = 0; i < 10; i++) {
    const player = reader.readPubkey();
    const totalPoints = reader.readU64();
    leaderboard.push({ player, totalPoints });
  }
  const leaderboardCount = reader.readU8();
  const leaderboardClaimed: boolean[] = [];
  for (let i = 0; i < 10; i++) {
    leaderboardClaimed.push(reader.readBool());
  }

  // Prize pool
  const masterPrizePool = reader.readU64();
  const dailyPrizePool = reader.readU64();
  const dailyDistributionCap = reader.readU64();
  const distributedToday = reader.readU64();
  const lastDistributionDay = reader.readU32();
  reader.skip(4); // padding
  const prizeRemaining = reader.readU64();

  // Thresholds
  const minLevelRequired = reader.readU8();
  reader.skip(7); // padding
  const minPointsForLeaderboard = reader.readU64();
  const totalBattles = reader.readU64();
  const bump = reader.readU8();
  reader.skip(7); // _reserved

  return {
    seasonId,
    cityId,
    authority,
    startTime,
    endTime,
    claimDeadline,
    status,
    leaderboard,
    leaderboardCount,
    leaderboardClaimed,
    masterPrizePool,
    dailyPrizePool,
    dailyDistributionCap,
    distributedToday,
    lastDistributionDay,
    prizeRemaining,
    minLevelRequired,
    minPointsForLeaderboard,
    totalBattles,
    bump,
  };
}

/** Deserialize ArenaParticipantAccount from raw bytes */
export function deserializeArenaParticipant(data: Uint8Array | Buffer): ArenaParticipantAccount {
  const reader = new BufferReader(data);

  const player = reader.readPubkey();
  const seasonId = reader.readU32();

  // Battle tracking
  const battleTimestamps = reader.readI64Array(10);
  const battleOpponents = reader.readPubkeyArray(10);
  const battleIndex = reader.readU8();

  // Matchmaking
  const lastMatchId = reader.readU64();
  const dailyRewardClaimedDay = reader.readU32();

  // Skill rating
  const eloRating = reader.readU32();

  // Stats
  const totalPoints = reader.readU64();
  const wins = reader.readU32();
  const losses = reader.readU32();

  // Claim tracking
  const masterRewardClaimed = reader.readBool();
  const bump = reader.readU8();
  reader.skip(17); // _reserved

  return {
    player,
    seasonId,
    battleTimestamps,
    battleOpponents,
    battleIndex,
    lastMatchId,
    dailyRewardClaimedDay,
    eloRating,
    totalPoints,
    wins,
    losses,
    masterRewardClaimed,
    bump,
  };
}

/** Deserialize ArenaLoadoutAccount from raw bytes */
export function deserializeArenaLoadout(data: Uint8Array | Buffer): ArenaLoadoutAccount {
  const reader = new BufferReader(data);

  const player = reader.readPubkey();
  const bump = reader.readU8();
  const arenaHero = reader.readPubkey();
  const defensiveUnits = reader.readU64Array(3);
  const meleeWeapons = reader.readU64();
  const rangedWeapons = reader.readU64();
  const siegeWeapons = reader.readU64();
  const armorPieces = reader.readU64();
  reader.skip(7); // _reserved

  return {
    player,
    bump,
    arenaHero,
    defensiveUnits,
    meleeWeapons,
    rangedWeapons,
    siegeWeapons,
    armorPieces,
  };
}

// ============================================================
// Parse Functions
// ============================================================

/** Parse ArenaSeasonAccount from account info */
export function parseArenaSeason(accountInfo: AccountInfo<Buffer>): ArenaSeasonAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_SEASON_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaSeason(accountInfo.data);
}

/** Parse ArenaParticipantAccount from account info */
export function parseArenaParticipant(accountInfo: AccountInfo<Buffer>): ArenaParticipantAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_PARTICIPANT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaParticipant(accountInfo.data);
}

/** Parse ArenaLoadoutAccount from account info */
export function parseArenaLoadout(accountInfo: AccountInfo<Buffer>): ArenaLoadoutAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_LOADOUT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaLoadout(accountInfo.data);
}

// ============================================================
// Helper Functions
// ============================================================

/** Check if season is active */
export function isSeasonActive(season: ArenaSeasonAccount): boolean {
  return season.status === ArenaSeasonStatus.Active;
}

/** Check if season has ended */
export function isSeasonEnded(season: ArenaSeasonAccount): boolean {
  return season.status === ArenaSeasonStatus.Ended || season.status === ArenaSeasonStatus.Finalized;
}

/** Get player rank (1-indexed) or null if not on leaderboard */
export function getPlayerRank(season: ArenaSeasonAccount, player: PublicKey): number | null {
  for (let i = 0; i < season.leaderboardCount; i++) {
    if (season.leaderboard[i]!.player.equals(player)) {
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
    if (timestamp.toNumber() > cutoff) {
      count++;
    }
  }
  return count;
}

/** Get total units in loadout */
export function getLoadoutTotalUnits(loadout: ArenaLoadoutAccount): BN {
  return loadout.defensiveUnits[0]!.add(loadout.defensiveUnits[1]!).add(loadout.defensiveUnits[2]!);
}

/** Get total weapons in loadout */
export function getLoadoutTotalWeapons(loadout: ArenaLoadoutAccount): BN {
  return loadout.meleeWeapons.add(loadout.rangedWeapons).add(loadout.siegeWeapons);
}

/** Check if loadout has custom hero set */
export function hasCustomArenaHero(loadout: ArenaLoadoutAccount): boolean {
  return !isNullPubkey(loadout.arenaHero);
}
