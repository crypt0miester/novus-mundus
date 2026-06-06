/**
 * Arena Accounts
 *
 * ArenaSeasonAccount - Season state and leaderboard (608 bytes with repr(C) padding)
 * ArenaParticipantAccount - Per-player, per-season state (536 bytes with repr(C) padding)
 * ArenaLoadoutAccount - Player's configured loadout (168 bytes with repr(C) padding)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import { ByteReader, isNullPubkey } from '../utils/deserialize';
import { ArenaSeasonStatus } from '../types/enums';

// Arena Leaderboard Entry

export interface ArenaLeaderboardEntry {
  player: PublicKey;
  totalPoints: bigint;
}

// Arena Season Account Interface

export interface ArenaSeasonAccount {
  seasonId: number;
  cityId: number;
  authority: PublicKey;
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
  player: PublicKey;
  seasonId: number;
  battleTimestamps: bigint[];
  battleOpponents: PublicKey[];
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
  player: PublicKey;
  bump: number;
  arenaHero: PublicKey;
  defensiveUnits: bigint[];
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armorPieces: bigint;
}

/** ArenaLoadoutAccount size in bytes (with repr(C) alignment padding) */
export const ARENA_LOADOUT_ACCOUNT_SIZE = 168;

// Deserialization

/**
 * Deserialize ArenaSeasonAccount from raw bytes.
 *
 * Rust repr(C) layout (608 bytes):
 *   0: account_key u8 (1)
 *   1: game_engine Pubkey (32)
 *  33: PADDING (3) -- align u32
 *  36: season_id u32 (4)
 *  40: city_id u16 (2)
 *  42: authority Pubkey (32)
 *  74: PADDING (6) -- align i64
 *  80: start_time i64 (8)
 *  88: end_time i64 (8)
 *  96: claim_deadline i64 (8)
 * 104: status u8 (1)
 * 105: PADDING (7) -- align ArenaLeaderboardEntry (8)
 * 112: leaderboard [ArenaLeaderboardEntry; 10] (400)
 * 512: leaderboard_count u8 (1)
 * 513: leaderboard_claimed [bool; 10] (10)
 * 523: PADDING (5) -- align u64
 * 528: master_prize_pool u64 (8)
 * 536: daily_prize_pool u64 (8)
 * 544: daily_distribution_cap u64 (8)
 * 552: distributed_today u64 (8)
 * 560: last_distribution_day u32 (4)
 * 564: _padding1 [u8; 4] (4)
 * 568: prize_remaining u64 (8)
 * 576: min_level_required u8 (1)
 * 577: _padding2 [u8; 7] (7)
 * 584: min_points_for_leaderboard u64 (8)
 * 592: total_battles u64 (8)
 * 600: bump u8 (1)
 * 601: _reserved [u8; 7] (7)
 * 608: END
 */
export function deserializeArenaSeason(data: Uint8Array): ArenaSeasonAccount {
  const reader = new ByteReader(data);

  reader.readU8(); // account_key

  // Kingdom reference (skip for interface)
  reader.skip(32); // game_engine
  reader.skip(3); // implicit padding for u32 alignment

  // Identity
  const seasonId = reader.readU32();
  const cityId = reader.readU16();
  const authority = reader.readPubkey();

  // repr(C) padding before i64
  reader.skip(6);

  // Timing
  const startTime = reader.readI64();
  const endTime = reader.readI64();
  const claimDeadline = reader.readI64();
  const statusValue = reader.readU8();
  const status = statusValue as ArenaSeasonStatus;

  // repr(C) padding before leaderboard array (align 8)
  reader.skip(7);

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

  // repr(C) padding before u64
  reader.skip(5);

  // Prize pool
  const masterPrizePool = reader.readU64();
  const dailyPrizePool = reader.readU64();
  const dailyDistributionCap = reader.readU64();
  const distributedToday = reader.readU64();
  const lastDistributionDay = reader.readU32();
  reader.skip(4); // _padding1
  const prizeRemaining = reader.readU64();

  // Thresholds
  const minLevelRequired = reader.readU8();
  reader.skip(7); // _padding2
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

/**
 * Deserialize ArenaParticipantAccount from raw bytes.
 *
 * Rust repr(C) layout (536 bytes):
 *   0: account_key u8 (1)
 *   1: game_engine Pubkey (32)
 *  33: player Pubkey (32)
 *  65: PADDING (3) -- align u32
 *  68: season_id u32 (4)
 *  72: battle_timestamps [i64; 10] (80)
 * 152: battle_opponents [Pubkey; 10] (320)
 * 472: battle_index u8 (1)
 * 473: PADDING (7) -- align u64
 * 480: last_match_id u64 (8)
 * 488: daily_reward_claimed_day u32 (4)
 * 492: elo_rating u32 (4)
 * 496: total_points u64 (8)
 * 504: wins u32 (4)
 * 508: losses u32 (4)
 * 512: master_reward_claimed bool (1)
 * 513: bump u8 (1)
 * 514: _reserved [u8; 17] (17)
 * 531: TAIL PADDING (5) -- align struct to 8
 * 536: END
 */
export function deserializeArenaParticipant(data: Uint8Array): ArenaParticipantAccount {
  const reader = new ByteReader(data);

  reader.readU8(); // account_key

  // Kingdom reference (skip for interface)
  reader.skip(32); // game_engine

  const player = reader.readPubkey();

  // implicit padding for u32 alignment
  reader.skip(3);

  const seasonId = reader.readU32();

  // Battle tracking
  const battleTimestamps = reader.readI64Array(10);
  const battleOpponents = reader.readPubkeyArray(10);
  const battleIndex = reader.readU8();

  // repr(C) padding before u64
  reader.skip(7);

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

/**
 * Deserialize ArenaLoadoutAccount from raw bytes.
 *
 * Rust repr(C) layout (168 bytes):
 *   0: account_key u8 (1)
 *   1: game_engine Pubkey (32)
 *  33: player Pubkey (32)
 *  65: bump u8 (1)
 *  66: arena_hero Pubkey (32)
 *  98: PADDING (6) -- align u64
 * 104: defensive_units [u64; 3] (24)
 * 128: melee_weapons u64 (8)
 * 136: ranged_weapons u64 (8)
 * 144: siege_weapons u64 (8)
 * 152: armor_pieces u64 (8)
 * 160: _reserved [u8; 7] (7)
 * 167: TAIL PADDING (1) -- align struct to 8
 * 168: END
 */
export function deserializeArenaLoadout(data: Uint8Array): ArenaLoadoutAccount {
  const reader = new ByteReader(data);

  reader.readU8(); // account_key

  // Kingdom reference (skip for interface)
  reader.skip(32); // game_engine

  const player = reader.readPubkey();
  const bump = reader.readU8();
  const arenaHero = reader.readPubkey();

  // repr(C) padding before u64 array
  reader.skip(6);

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

// Parse Functions

/** Parse ArenaSeasonAccount from account info */
export function parseArenaSeason(accountInfo: AccountInfo<Uint8Array>): ArenaSeasonAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_SEASON_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaSeason(accountInfo.data);
}

/** Parse ArenaParticipantAccount from account info */
export function parseArenaParticipant(accountInfo: AccountInfo<Uint8Array>): ArenaParticipantAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ARENA_PARTICIPANT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeArenaParticipant(accountInfo.data);
}

/** Parse ArenaLoadoutAccount from account info */
export function parseArenaLoadout(accountInfo: AccountInfo<Uint8Array>): ArenaLoadoutAccount | null {
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
    if (Number(timestamp) > cutoff) {
      count++;
    }
  }
  return count;
}

/** Get total units in loadout */
export function getLoadoutTotalUnits(loadout: ArenaLoadoutAccount): bigint {
  return loadout.defensiveUnits[0]! + loadout.defensiveUnits[1]! + loadout.defensiveUnits[2]!;
}

/** Get total weapons in loadout */
export function getLoadoutTotalWeapons(loadout: ArenaLoadoutAccount): bigint {
  return loadout.meleeWeapons + loadout.rangedWeapons + loadout.siegeWeapons;
}

/** Check if loadout has custom hero set */
export function hasCustomArenaHero(loadout: ArenaLoadoutAccount): boolean {
  return !isNullPubkey(loadout.arenaHero);
}
