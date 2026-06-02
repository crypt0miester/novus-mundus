/**
 * Dungeon System Accounts
 *
 * DungeonTemplate - Dungeon configuration (DAO-created) (~152 bytes)
 * DungeonRun - Active dungeon run state (~368 bytes)
 * DungeonLeaderboard - Weekly leaderboard entries
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import { BufferReader } from '../utils/deserialize';

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
  player: PublicKey;
  heroMint: PublicKey;

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
  player: PublicKey;
  score: bigint;
  timestamp: bigint;
}

export interface DungeonLeaderboardAccount {
  dungeonId: number;
  weekNumber: number;
  bump: number;
  /** Bitmask of claimed ranks: bit N set => rank N (0-indexed) already paid out. */
  claimedMask: number;
  /** Total NOVI prize pool, split across ranks by PRIZE_DISTRIBUTION. */
  prizePool: bigint;
  entries: DungeonLeaderboardEntry[];
}

// Deserialization

export function deserializeDungeonTemplate(data: Uint8Array): DungeonTemplateAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(1); // implicit padding for u16 alignment

  const dungeonId = reader.readU16();
  const theme = reader.readU8() as DungeonTheme;
  const totalFloors = reader.readU8();
  const roomsPerFloor = reader.readU8();
  const checkpointInterval = reader.readU8();
  const minPlayerLevel = reader.readU8();
  const requiredBuildingLevel = reader.readU8();

  const staminaCost = reader.readU16();
  const bossPowerMultiplier = reader.readU16();
  const bump = reader.readU8();
  reader.skip(3); // _padding1

  const nameBytes = reader.readBytes(32);
  const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '');

  reader.skip(2); // implicit padding for u32 alignment

  // Floor power array (10 u32s)
  const floorPower: number[] = [];
  for (let i = 0; i < 10; i++) {
    floorPower.push(reader.readU32());
  }

  const combatWeight = reader.readU16();
  const treasureWeight = reader.readU16();
  const campWeight = reader.readU16();
  const restWeight = reader.readU16();
  const trapWeight = reader.readU16();
  reader.skip(2); // _padding2

  const darknessBaseBps = reader.readU16();
  const darknessPerFloorBps = reader.readU16();

  const timeLimitSeconds = reader.readU32();

  const baseXpPerRoom = reader.readU64();
  const baseNoviPerFloor = reader.readU64();
  const completionBonusBps = reader.readU16();
  const rewardScalingBps = reader.readU16();
  // reader.skip(4); // _padding3

  return {
    dungeonId,
    theme,
    totalFloors,
    roomsPerFloor,
    checkpointInterval,
    minPlayerLevel,
    requiredBuildingLevel,
    staminaCost,
    bossPowerMultiplier,
    bump,
    name,
    floorPower,
    combatWeight,
    treasureWeight,
    campWeight,
    restWeight,
    trapWeight,
    darknessBaseBps,
    darknessPerFloorBps,
    timeLimitSeconds,
    baseXpPerRoom,
    baseNoviPerFloor,
    completionBonusBps,
    rewardScalingBps,
  };
}

export function deserializeDungeonRun(data: Uint8Array): DungeonRunAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const player = reader.readPubkey();
  const heroMint = reader.readPubkey();

  reader.skip(1); // implicit padding for u16 alignment
  const dungeonId = reader.readU16();
  const status = reader.readU8() as DungeonStatus;
  const currentFloor = reader.readU8();
  const currentRoom = reader.readU8();
  const roomType = reader.readU8() as RoomType;
  const lastCheckpoint = reader.readU8();
  const bump = reader.readU8();
  reader.skip(6); // implicit padding for u64 alignment

  const enemyHealth = reader.readU64();
  const enemyMaxHealth = reader.readU64();
  const enemyPower = reader.readU32();
  const enemyDefense = reader.readU16();
  const isBoss = reader.readBool();

  const timePeriod = reader.readU8();
  const dungeonTheme = reader.readU8() as DungeonTheme;
  const heroSpecialization = reader.readU8() as HeroSpecialization;
  reader.skip(1); // _spec_padding

  const bossWrath = reader.readU8();
  const bossAbilityActive = reader.readBool();
  const bossAbilityCounter = reader.readU8();
  reader.skip(3); // _boss_padding
  reader.skip(7); // implicit padding for u64 alignment
  const bossShield = reader.readU64();

  // Units arrays
  const remainingUnits: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    remainingUnits.push(reader.readU64());
  }

  const originalUnits: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    originalUnits.push(reader.readU64());
  }

  const remainingWeapons: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    remainingWeapons.push(reader.readU64());
  }

  const relicMask = reader.readU32();
  const synergyMask = reader.readU8();
  const darknessLevel = reader.readU8();
  const darknessMitigation = reader.readU16();

  const pendingXp = reader.readU64();
  const pendingNovi = reader.readU64();
  const pendingGems = reader.readU64();
  const pendingMaterials = reader.readU32();
  reader.skip(4); // _padding2

  const checkpointXp = reader.readU64();
  const checkpointNovi = reader.readU64();
  const checkpointGems = reader.readU64();

  const totalDamageDealt = reader.readU64();
  const totalDamageTaken = reader.readU64();
  const enemiesKilled = reader.readU16();
  const relicsCollected = reader.readU8();
  const roomsCleared = reader.readU8();
  reader.skip(4); // _padding3

  const startedAt = reader.readI64();
  const campBonusBps = reader.readU16();
  const campExpiresFloor = reader.readU8();
  const resumeCount = reader.readU8();

  const xpBuildingBonusBps = reader.readU16();
  const noviBuildingBonusBps = reader.readU16();

  // Computed helpers
  const isActive = status === DungeonStatus.Active ||
                   status === DungeonStatus.BossFight ||
                   status === DungeonStatus.AwaitingRelic;
  const isEnded = status === DungeonStatus.Completed ||
                  status === DungeonStatus.Failed ||
                  status === DungeonStatus.Fled;
  const totalUnits = remainingUnits.reduce((a, b) => a + b);
  const isWiped = totalUnits === 0n;

  return {
    player,
    heroMint,
    dungeonId,
    status,
    currentFloor,
    currentRoom,
    roomType,
    lastCheckpoint,
    bump,
    enemyHealth,
    enemyMaxHealth,
    enemyPower,
    enemyDefense,
    isBoss,
    timePeriod,
    dungeonTheme,
    heroSpecialization,
    bossWrath,
    bossAbilityActive,
    bossAbilityCounter,
    bossShield,
    remainingUnits,
    originalUnits,
    remainingWeapons,
    relicMask,
    synergyMask,
    darknessLevel,
    darknessMitigation,
    pendingXp,
    pendingNovi,
    pendingGems,
    pendingMaterials,
    checkpointXp,
    checkpointNovi,
    checkpointGems,
    totalDamageDealt,
    totalDamageTaken,
    enemiesKilled,
    relicsCollected,
    roomsCleared,
    startedAt,
    campBonusBps,
    campExpiresFloor,
    resumeCount,
    xpBuildingBonusBps,
    noviBuildingBonusBps,
    isActive,
    isEnded,
    isWiped,
  };
}

export function deserializeDungeonLeaderboard(data: Uint8Array): DungeonLeaderboardAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(32); // game_engine
  reader.skip(1); // implicit padding for u16 alignment

  const dungeonId = reader.readU16();
  const weekNumber = reader.readU16();
  const entryCount = reader.readU8();
  const bump = reader.readU8();
  const claimedMask = reader.readU16();
  reader.skip(6); // implicit padding for u64 alignment
  const prizePool = reader.readU64();

  const entries: DungeonLeaderboardEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const player = reader.readPubkey();
    const score = reader.readU64();
    const timestamp = score; // LeaderboardEntry only has player+score; timestamp for compatibility
    entries.push({ player, score, timestamp });
  }

  return { dungeonId, weekNumber, bump, claimedMask, prizePool, entries };
}

// Parse Functions

/** Parse DungeonTemplateAccount from account info */
export function parseDungeonTemplate(accountInfo: AccountInfo<Uint8Array>): DungeonTemplateAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeDungeonTemplate(accountInfo.data);
}

/** Parse DungeonRunAccount from account info */
export function parseDungeonRun(accountInfo: AccountInfo<Uint8Array>): DungeonRunAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeDungeonRun(accountInfo.data);
}

/** Parse DungeonLeaderboardAccount from account info */
export function parseDungeonLeaderboard(accountInfo: AccountInfo<Uint8Array>): DungeonLeaderboardAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeDungeonLeaderboard(accountInfo.data);
}
