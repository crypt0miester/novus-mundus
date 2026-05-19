/**
 * Dungeon System Accounts
 *
 * DungeonTemplate - Dungeon configuration (DAO-created) (~152 bytes)
 * DungeonRun - Active dungeon run state (~368 bytes)
 * DungeonLeaderboard - Weekly leaderboard entries
 */

import type { Address } from '@solana/kit';
import { bytesToAddress } from '../crypto';
import { reprC, struct, pad, u8, u16, u32, u64, i64, bool, pubkey, fixedString, array } from '../utils/codec';

// Dungeon Enums (local definitions matching Rust state)
// Note: These differ from types/enums.ts which has simplified versions

/** Dungeon run status (matches Rust DungeonStatus) */
export enum DungeonStatus {
  Active = 0,
  AwaitingRelic = 1,
  BossFight = 2,
  Completed = 3,
  Failed = 4,
  Fled = 5,
}

/** Room type in dungeon (matches Rust RoomType) */
export enum RoomType {
  Combat = 0,
  Treasure = 1,
  Camp = 2,
  Rest = 3,
  Trap = 4,
}

/**
 * Dungeon mechanical category (matches Rust DungeonTheme).
 * Theme-flavored display names ("Crypts", "Server Farms", "Voidspace",
 * "Fab Plant") are mapped at the UI layer per kingdom theme.
 */
export enum DungeonTheme {
  RadiantWeakness = 0,
  FastMobs = 1,
  DarknessVulnerable = 2,
  ArmoredMobs = 3,
}

/** Hero specialization for dungeon (matches Rust HeroSpecialization) */
export enum HeroSpecialization {
  Warrior = 0,
  Guardian = 1,
  Scout = 2,
  Tactician = 3,
}

// Dungeon Template Account

export interface DungeonTemplateAccount {
  dungeonId: number;
  theme: DungeonTheme;
  totalFloors: number;
  roomsPerFloor: number;
  checkpointInterval: number;
  minPlayerLevel: number;
  requiredBuildingLevel: number;

  staminaCost: number;
  bossPowerMultiplier: number;
  bump: number;

  name: string;

  // Precomputed enemy power per floor (floors 1-10)
  floorPower: number[];

  // Room type weights (basis points)
  combatWeight: number;
  treasureWeight: number;
  campWeight: number;
  restWeight: number;
  trapWeight: number;

  // Darkness configuration
  darknessBaseBps: number;
  darknessPerFloorBps: number;

  // Time limit (0 = unlimited)
  timeLimitSeconds: number;

  // Reward configuration
  baseXpPerRoom: bigint;
  baseNoviPerFloor: bigint;
  completionBonusBps: number;
  rewardScalingBps: number;
}

// Dungeon Run Account

export interface DungeonRunAccount {
  player: Address;
  heroMint: Address;

  dungeonId: number;
  status: DungeonStatus;
  currentFloor: number;
  currentRoom: number;
  roomType: RoomType;
  lastCheckpoint: number;
  bump: number;

  // Enemy state
  enemyHealth: bigint;
  enemyMaxHealth: bigint;
  enemyPower: number;
  enemyDefense: number;
  isBoss: boolean;

  // Context
  timePeriod: number;
  dungeonTheme: DungeonTheme;
  heroSpecialization: HeroSpecialization;

  // Boss mechanics
  bossWrath: number;
  bossAbilityActive: boolean;
  bossAbilityCounter: number;
  bossShield: bigint;

  // Units [tier1, tier2, tier3]
  remainingUnits: bigint[];
  originalUnits: bigint[];

  // Weapons [melee, ranged, siege]
  remainingWeapons: bigint[];

  // Relics & synergies
  relicMask: number;
  synergyMask: number;
  darknessLevel: number;
  darknessMitigation: number;

  // Pending rewards
  pendingXp: bigint;
  pendingNovi: bigint;
  pendingGems: bigint;
  pendingMaterials: number;

  // Checkpoint rewards
  checkpointXp: bigint;
  checkpointNovi: bigint;
  checkpointGems: bigint;

  // Stats
  totalDamageDealt: bigint;
  totalDamageTaken: bigint;
  enemiesKilled: number;
  relicsCollected: number;
  roomsCleared: number;

  // Timestamps
  startedAt: bigint;

  // Camp buff
  campBonusBps: number;
  campExpiresFloor: number;
  resumeCount: number;

  // Building bonuses
  xpBuildingBonusBps: number;
  noviBuildingBonusBps: number;

  // Computed helpers
  isActive: boolean;
  isEnded: boolean;
  isWiped: boolean;
}

// Dungeon Leaderboard Entry

export interface DungeonLeaderboardEntry {
  player: Address;
  score: bigint;
  timestamp: bigint;
}

export interface DungeonLeaderboardAccount {
  dungeonId: number;
  weekNumber: number;
  bump: number;
  entries: DungeonLeaderboardEntry[];
}

// Codecs

/** DungeonTemplate `#[repr(C)]` codec */
const dungeonTemplateCodec = reprC<DungeonTemplateAccount>([
  pad(1), // account_key
  ['dungeonId', u16],
  ['theme', u8],
  ['totalFloors', u8],
  ['roomsPerFloor', u8],
  ['checkpointInterval', u8],
  ['minPlayerLevel', u8],
  ['requiredBuildingLevel', u8],
  ['staminaCost', u16],
  ['bossPowerMultiplier', u16],
  ['bump', u8],
  pad(3), // _padding1
  ['name', fixedString(32)],
  ['floorPower', array(u32, 10)],
  ['combatWeight', u16],
  ['treasureWeight', u16],
  ['campWeight', u16],
  ['restWeight', u16],
  ['trapWeight', u16],
  pad(2), // _padding2
  ['darknessBaseBps', u16],
  ['darknessPerFloorBps', u16],
  ['timeLimitSeconds', u32],
  ['baseXpPerRoom', u64],
  ['baseNoviPerFloor', u64],
  ['completionBonusBps', u16],
  ['rewardScalingBps', u16],
]);

/** Decoded DungeonRun fields (excludes computed `isActive`/`isEnded`/`isWiped`) */
type DungeonRunDecoded = Omit<DungeonRunAccount, 'isActive' | 'isEnded' | 'isWiped'>;

/** DungeonRun `#[repr(C)]` codec */
const dungeonRunCodec = reprC<DungeonRunDecoded>([
  pad(1), // account_key
  ['player', pubkey],
  ['heroMint', pubkey],
  ['dungeonId', u16],
  ['status', u8],
  ['currentFloor', u8],
  ['currentRoom', u8],
  ['roomType', u8],
  ['lastCheckpoint', u8],
  ['bump', u8],
  ['enemyHealth', u64],
  ['enemyMaxHealth', u64],
  ['enemyPower', u32],
  ['enemyDefense', u16],
  ['isBoss', bool],
  ['timePeriod', u8],
  ['dungeonTheme', u8],
  ['heroSpecialization', u8],
  pad(1), // _spec_padding
  ['bossWrath', u8],
  ['bossAbilityActive', bool],
  ['bossAbilityCounter', u8],
  pad(3), // _boss_padding
  ['bossShield', u64],
  ['remainingUnits', array(u64, 3)],
  ['originalUnits', array(u64, 3)],
  ['remainingWeapons', array(u64, 3)],
  ['relicMask', u32],
  ['synergyMask', u8],
  ['darknessLevel', u8],
  ['darknessMitigation', u16],
  ['pendingXp', u64],
  ['pendingNovi', u64],
  ['pendingGems', u64],
  ['pendingMaterials', u32],
  pad(4), // _padding2
  ['checkpointXp', u64],
  ['checkpointNovi', u64],
  ['checkpointGems', u64],
  ['totalDamageDealt', u64],
  ['totalDamageTaken', u64],
  ['enemiesKilled', u16],
  ['relicsCollected', u8],
  ['roomsCleared', u8],
  pad(4), // _padding3
  ['startedAt', i64],
  ['campBonusBps', u16],
  ['campExpiresFloor', u8],
  ['resumeCount', u8],
  ['xpBuildingBonusBps', u16],
  ['noviBuildingBonusBps', u16],
]);

/** DungeonLeaderboard fixed-header fields (excludes the dynamic `entries` array) */
type DungeonLeaderboardHeader = Omit<DungeonLeaderboardAccount, 'entries'> & {
  entryCount: number;
};

/** DungeonLeaderboard base size in bytes (before trailing entries) */
const DUNGEON_LEADERBOARD_HEADER_SIZE = 56;

/** DungeonLeaderboard fixed-header `#[repr(C)]` codec */
const dungeonLeaderboardHeaderCodec = reprC<DungeonLeaderboardHeader>([
  pad(1), // account_key
  pad(32), // game_engine
  ['dungeonId', u16],
  ['weekNumber', u16],
  ['entryCount', u8],
  ['bump', u8],
  pad(2), // claimed_mask u16 (not in interface)
  pad(6), // implicit padding before prize_pool u64
  pad(8), // prize_pool u64 (not in interface)
], DUNGEON_LEADERBOARD_HEADER_SIZE);

// Deserialization

export function deserializeDungeonTemplate(data: Uint8Array): DungeonTemplateAccount {
  return dungeonTemplateCodec.decode(data);
}

export function deserializeDungeonRun(data: Uint8Array): DungeonRunAccount {
  const decoded = dungeonRunCodec.decode(data);
  const isActive = decoded.status === DungeonStatus.Active ||
                   decoded.status === DungeonStatus.BossFight ||
                   decoded.status === DungeonStatus.AwaitingRelic;
  const isEnded = decoded.status === DungeonStatus.Completed ||
                  decoded.status === DungeonStatus.Failed ||
                  decoded.status === DungeonStatus.Fled;
  const totalUnits = decoded.remainingUnits.reduce((a, b) => a + b);
  const isWiped = totalUnits === 0n;
  return { ...decoded, isActive, isEnded, isWiped };
}

export function deserializeDungeonLeaderboard(data: Uint8Array): DungeonLeaderboardAccount {
  const header = dungeonLeaderboardHeaderCodec.decode(data);

  // Entries are stored as a trailing array (pubkey + u64 = 40 bytes each)
  const entries: DungeonLeaderboardEntry[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < header.entryCount; i++) {
    const base = DUNGEON_LEADERBOARD_HEADER_SIZE + i * 40;
    const player = bytesToAddress(data.subarray(base, base + 32));
    const score = view.getBigUint64(base + 32, true);
    // LeaderboardEntry only has player+score; timestamp for compatibility
    entries.push({ player, score, timestamp: score });
  }

  return {
    dungeonId: header.dungeonId,
    weekNumber: header.weekNumber,
    bump: header.bump,
    entries,
  };
}

// Parse Functions

/** Parse DungeonTemplateAccount from account info */
export function parseDungeonTemplate(accountInfo: { data: Uint8Array }): DungeonTemplateAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeDungeonTemplate(accountInfo.data);
}

/** Parse DungeonRunAccount from account info */
export function parseDungeonRun(accountInfo: { data: Uint8Array }): DungeonRunAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeDungeonRun(accountInfo.data);
}

/** Parse DungeonLeaderboardAccount from account info */
export function parseDungeonLeaderboard(accountInfo: { data: Uint8Array }): DungeonLeaderboardAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeDungeonLeaderboard(accountInfo.data);
}
