/**
 * Estate System Accounts
 *
 * EstateAccount - Player's personal estate with buildings
 * BuildingSlot - Individual building within the estate
 *
 * Layout: #[repr(C)] with pinocchio Pubkey ([u8;32], align=1)
 * Header: 192 bytes (before buildings array)
 * BuildingSlot: 40 bytes each (36 data + 4 struct alignment padding)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';
import { BuildingType } from '../types/enums';

// Building Status (local enum matching Rust)

export enum BuildingStatus {
  Empty = 0,
  Building = 1,
  Active = 2,
  Upgrading = 3,
}

// Building Slot Interface

export interface BuildingSlot {
  buildingType: number;
  status: number;
  level: number;
  masteryLevel: number;
  masteryXp: number;
  constructionStarted: BN;
  constructionEnds: BN;
  totalNoviInvested: BN;
}

// Estate Account Interface

export interface EstateAccount {
  // Identity
  owner: PublicKey;
  cityId: number;
  bump: number;

  // Progression
  estateLevel: number;
  plotsOwned: number;
  totalBuildings: number;
  currentSlots: number;

  // Cached buffs (14 x u16)
  attackBps: number;
  defenseBps: number;
  resourceGenBps: number;
  xpGainBps: number;
  storageBps: number;
  trainingSpeedBps: number;
  researchSpeedBps: number;
  craftSuccessBps: number;
  tradeDiscountBps: number;
  noviCapBonusBps: number;
  lootBonusBps: number;
  prizeBonusBps: number;
  rallyCapacityBonusBps: number;
  pvpDamageBps: number;

  // Daily activity tracking
  lastLoginDate: number;
  loginStreak: number;
  longestLoginStreak: number;
  permanentBonusBps: number;
  dailyDate: number;
  dawnTimestamp: BN;
  windowsCompleted: number;
  dawnBuildings: number;
  middayBuildings: number;
  duskBuildings: number;

  // Active daily buffs
  unitEffectivenessBps: number;
  masteryBonusBps: number;
  arenaDamageBps: number;
  dailyLootBonusBps: number;
  marketDiscountBps: number;
  blessedHero: PublicKey;
  citadelStance: number;

  // Timestamps
  createdAt: BN;
  lastActivity: BN;

  // Daily buffs from expansion buildings
  campDiscountBps: number;
  stablesSpeedBps: number;
  infirmaryRecoveryDailyBps: number;
  expansionDaily: number;

  // Wounded units
  woundedDef1: number;
  woundedDef2: number;
  woundedDef3: number;
  woundedOp1: number;
  woundedOp2: number;
  woundedOp3: number;

  // Buildings
  buildings: BuildingSlot[];

  // Computed helpers
  maxSlots: number;
  activeBuildings: number;
}

/** Maximum building slots per estate */
export const MAX_BUILDING_SLOTS = 20;

/** Building slots per plot */
export const SLOTS_PER_PLOT = 4;

/** BuildingSlot size in bytes (40 = 36 data + 4 struct alignment padding) */
export const BUILDING_SLOT_SIZE = 40;

/** EstateAccount header size (before buildings array) */
export const ESTATE_HEADER_SIZE = 192;

// Deserialization

/** Deserialize a single BuildingSlot from the reader (40 bytes) */
export function deserializeBuildingSlot(reader: BufferReader): BuildingSlot {
  const buildingType = reader.readU8();
  const status = reader.readU8();
  const level = reader.readU8();
  const masteryLevel = reader.readU8();
  const masteryXp = reader.readU32();
  const constructionStarted = reader.readI64();
  const constructionEnds = reader.readI64();
  const totalNoviInvested = reader.readU64();
  reader.skip(4); // _padding [u8; 4]
  reader.skip(4); // struct alignment padding (align 8, 36 -> 40)

  return {
    buildingType,
    status,
    level,
    masteryLevel,
    masteryXp,
    constructionStarted,
    constructionEnds,
    totalNoviInvested,
  };
}

/** Deserialize EstateAccount from raw bytes */
export function deserializeEstate(data: Uint8Array | Buffer): EstateAccount {
  const reader = new BufferReader(data);

  // offset 0: account_key (u8)
  reader.readU8(); // account_key discriminator

  // offset 1: owner (Pubkey, [u8;32], align 1 - no padding needed)
  const owner = reader.readPubkey();

  // offset 33: city_id (u16, align 2) - 1 byte implicit padding
  reader.skip(1); // implicit padding for u16 alignment
  const cityId = reader.readU16();

  // offset 36: bump (u8)
  const bump = reader.readU8();

  // Progression (4 bytes)
  const estateLevel = reader.readU8();
  const plotsOwned = reader.readU8();
  const totalBuildings = reader.readU8();
  const currentSlots = reader.readU8();

  // offset 41: attack_bps (u16, align 2) - 1 byte implicit padding
  reader.skip(1); // implicit padding for u16 alignment

  // Cached buffs (14 x u16 = 28 bytes, offset 42-69)
  const attackBps = reader.readU16();
  const defenseBps = reader.readU16();
  const resourceGenBps = reader.readU16();
  const xpGainBps = reader.readU16();
  const storageBps = reader.readU16();
  const trainingSpeedBps = reader.readU16();
  const researchSpeedBps = reader.readU16();
  const craftSuccessBps = reader.readU16();
  const tradeDiscountBps = reader.readU16();
  const noviCapBonusBps = reader.readU16();
  const lootBonusBps = reader.readU16();
  const prizeBonusBps = reader.readU16();
  const rallyCapacityBonusBps = reader.readU16();
  const pvpDamageBps = reader.readU16();

  // Daily activity tracking (offset 70)
  const lastLoginDate = reader.readU16();
  const loginStreak = reader.readU16();
  const longestLoginStreak = reader.readU16();
  const permanentBonusBps = reader.readU16();
  const dailyDate = reader.readU16();

  // offset 80: dawn_timestamp (i64, align 8) - offset 80 is 8-aligned, no padding
  const dawnTimestamp = reader.readI64();

  // offset 88: windows_completed (u8)
  const windowsCompleted = reader.readU8();

  // offset 89: dawn_buildings (u16, align 2) - 1 byte implicit padding
  reader.skip(1); // implicit padding for u16 alignment
  const dawnBuildings = reader.readU16();
  const middayBuildings = reader.readU16();
  const duskBuildings = reader.readU16();

  // Active daily buffs (offset 96)
  const unitEffectivenessBps = reader.readU16();
  const masteryBonusBps = reader.readU16();
  const arenaDamageBps = reader.readU16();
  const dailyLootBonusBps = reader.readU16();
  const marketDiscountBps = reader.readU16();

  // offset 106: blessed_hero (Pubkey, [u8;32], align 1 - no padding)
  const blessedHero = reader.readPubkey();

  // offset 138: citadel_stance (u8)
  const citadelStance = reader.readU8();

  // offset 139: created_at (i64, align 8) - need 5 bytes padding to reach 144
  reader.skip(5); // implicit padding for i64 alignment

  // Timestamps (offset 144)
  const createdAt = reader.readI64();
  const lastActivity = reader.readI64();

  // Daily buffs from expansion buildings (offset 160)
  const campDiscountBps = reader.readU16();
  const stablesSpeedBps = reader.readU16();
  const infirmaryRecoveryDailyBps = reader.readU16();
  const expansionDaily = reader.readU8();

  // Wounded units (stored as [u8;4], align 1 - no padding needed, offset 167)
  const woundedDef1 = reader.readU32();
  const woundedDef2 = reader.readU32();
  const woundedDef3 = reader.readU32();
  const woundedOp1 = reader.readU32();
  const woundedOp2 = reader.readU32();
  const woundedOp3 = reader.readU32();

  // Reserved (offset 191)
  reader.skip(1); // _reserved [u8; 1]

  // Buildings array (offset 192, each slot = 40 bytes)
  // Read based on how many slots exist in the data
  const remainingBytes = reader.remaining();
  const slotsInData = Math.floor(remainingBytes / BUILDING_SLOT_SIZE);
  const slotsToRead = Math.min(slotsInData, MAX_BUILDING_SLOTS);

  const buildings: BuildingSlot[] = [];
  for (let i = 0; i < slotsToRead; i++) {
    buildings.push(deserializeBuildingSlot(reader));
  }

  // Computed helpers
  const maxSlots = plotsOwned * SLOTS_PER_PLOT;
  const activeBuildings = buildings.filter(
    (b) => b.status === BuildingStatus.Active || b.status === BuildingStatus.Upgrading,
  ).length;

  return {
    owner,
    cityId,
    bump,
    estateLevel,
    plotsOwned,
    totalBuildings,
    currentSlots,
    attackBps,
    defenseBps,
    resourceGenBps,
    xpGainBps,
    storageBps,
    trainingSpeedBps,
    researchSpeedBps,
    craftSuccessBps,
    tradeDiscountBps,
    noviCapBonusBps,
    lootBonusBps,
    prizeBonusBps,
    rallyCapacityBonusBps,
    pvpDamageBps,
    lastLoginDate,
    loginStreak,
    longestLoginStreak,
    permanentBonusBps,
    dailyDate,
    dawnTimestamp,
    windowsCompleted,
    dawnBuildings,
    middayBuildings,
    duskBuildings,
    unitEffectivenessBps,
    masteryBonusBps,
    arenaDamageBps,
    dailyLootBonusBps,
    marketDiscountBps,
    blessedHero,
    citadelStance,
    createdAt,
    lastActivity,
    campDiscountBps,
    stablesSpeedBps,
    infirmaryRecoveryDailyBps,
    expansionDaily,
    woundedDef1,
    woundedDef2,
    woundedDef3,
    woundedOp1,
    woundedOp2,
    woundedOp3,
    buildings,
    maxSlots,
    activeBuildings,
  };
}

// Parse Functions

/** Parse EstateAccount from account info */
export function parseEstate(accountInfo: AccountInfo<Buffer>): EstateAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ESTATE_HEADER_SIZE) {
    return null;
  }
  return deserializeEstate(accountInfo.data);
}

// Helper Functions

/** Find a building by type in the estate */
export function findBuilding(estate: EstateAccount, buildingType: BuildingType): BuildingSlot | null {
  for (const building of estate.buildings) {
    if (building.buildingType === buildingType && building.status !== BuildingStatus.Empty) {
      return building;
    }
  }
  return null;
}

/** Check if estate has a building at minimum level */
export function hasBuildingAtLevel(estate: EstateAccount, buildingType: BuildingType, minLevel: number): boolean {
  const building = findBuilding(estate, buildingType);
  if (!building) return false;
  return (building.status === BuildingStatus.Active || building.status === BuildingStatus.Upgrading) &&
    building.level >= minLevel;
}

/** Check if a building slot's construction is complete */
export function isBuildingConstructionComplete(building: BuildingSlot, nowSeconds: number): boolean {
  return (building.status === BuildingStatus.Building || building.status === BuildingStatus.Upgrading) &&
    nowSeconds >= building.constructionEnds.toNumber();
}

/** Get the number of empty building slots */
export function getEmptySlotCount(estate: EstateAccount): number {
  const usable = Math.min(estate.currentSlots, estate.plotsOwned * SLOTS_PER_PLOT);
  let empty = 0;
  for (let i = 0; i < Math.min(usable, estate.buildings.length); i++) {
    if (estate.buildings[i]!.status === BuildingStatus.Empty) {
      empty++;
    }
  }
  return empty;
}
