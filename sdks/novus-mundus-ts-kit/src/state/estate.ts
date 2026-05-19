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

import type { Address } from '@solana/kit';
import { reprC, struct, custom, pad, u8, u16, u32, u64, i64, pubkey } from '../utils/codec';
import { BuildingType } from '../types/enums';

/** u32 value with alignment 1 — for Rust `[u8; 4]` fields read as numbers. */
const u32le1 = custom(u32.codec, 1);

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
  constructionStarted: bigint;
  constructionEnds: bigint;
  totalNoviInvested: bigint;
}

// Estate Account Interface

export interface EstateAccount {
  // Identity
  owner: Address;
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
  dawnTimestamp: bigint;
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
  blessedHero: Address;
  citadelStance: number;

  // Timestamps
  createdAt: bigint;
  lastActivity: bigint;

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

// Codecs

/** BuildingSlot `#[repr(C)]` codec (40 bytes) */
const buildingSlotCodec = struct<BuildingSlot>([
  ['buildingType', u8],
  ['status', u8],
  ['level', u8],
  ['masteryLevel', u8],
  ['masteryXp', u32],
  ['constructionStarted', i64],
  ['constructionEnds', i64],
  ['totalNoviInvested', u64],
  pad(4), // _padding [u8; 4]
], BUILDING_SLOT_SIZE);

/** EstateAccount fixed-header fields (excludes dynamic/computed members) */
type EstateHeader = Omit<EstateAccount, 'buildings' | 'maxSlots' | 'activeBuildings'>;

/** EstateAccount fixed-header `#[repr(C)]` codec */
const estateHeaderCodec = reprC<EstateHeader>([
  pad(1), // account_key discriminator
  ['owner', pubkey],
  ['cityId', u16],
  ['bump', u8],
  ['estateLevel', u8],
  ['plotsOwned', u8],
  ['totalBuildings', u8],
  ['currentSlots', u8],
  // Cached buffs (14 x u16)
  ['attackBps', u16],
  ['defenseBps', u16],
  ['resourceGenBps', u16],
  ['xpGainBps', u16],
  ['storageBps', u16],
  ['trainingSpeedBps', u16],
  ['researchSpeedBps', u16],
  ['craftSuccessBps', u16],
  ['tradeDiscountBps', u16],
  ['noviCapBonusBps', u16],
  ['lootBonusBps', u16],
  ['prizeBonusBps', u16],
  ['rallyCapacityBonusBps', u16],
  ['pvpDamageBps', u16],
  // Daily activity tracking
  ['lastLoginDate', u16],
  ['loginStreak', u16],
  ['longestLoginStreak', u16],
  ['permanentBonusBps', u16],
  ['dailyDate', u16],
  ['dawnTimestamp', i64],
  ['windowsCompleted', u8],
  ['dawnBuildings', u16],
  ['middayBuildings', u16],
  ['duskBuildings', u16],
  // Active daily buffs
  ['unitEffectivenessBps', u16],
  ['masteryBonusBps', u16],
  ['arenaDamageBps', u16],
  ['dailyLootBonusBps', u16],
  ['marketDiscountBps', u16],
  ['blessedHero', pubkey],
  ['citadelStance', u8],
  // Timestamps
  ['createdAt', i64],
  ['lastActivity', i64],
  // Daily buffs from expansion buildings
  ['campDiscountBps', u16],
  ['stablesSpeedBps', u16],
  ['infirmaryRecoveryDailyBps', u16],
  ['expansionDaily', u8],
  // Wounded units — stored on-chain as [u8; 4], align 1
  ['woundedDef1', u32le1],
  ['woundedDef2', u32le1],
  ['woundedDef3', u32le1],
  ['woundedOp1', u32le1],
  ['woundedOp2', u32le1],
  ['woundedOp3', u32le1],
  pad(1), // _reserved [u8; 1]
], ESTATE_HEADER_SIZE);

// Deserialization

/** Deserialize a single BuildingSlot from raw bytes at the given offset (40 bytes) */
export function deserializeBuildingSlot(data: Uint8Array, offset: number): BuildingSlot {
  return buildingSlotCodec.codec.decode(data.subarray(offset, offset + BUILDING_SLOT_SIZE));
}

/** Deserialize EstateAccount from raw bytes */
export function deserializeEstate(data: Uint8Array): EstateAccount {
  const header = estateHeaderCodec.decode(data);

  // Buildings array (starts at ESTATE_HEADER_SIZE, each slot = 40 bytes)
  const remainingBytes = data.length - ESTATE_HEADER_SIZE;
  const slotsInData = Math.floor(remainingBytes / BUILDING_SLOT_SIZE);
  const slotsToRead = Math.min(Math.max(slotsInData, 0), MAX_BUILDING_SLOTS);

  const buildings: BuildingSlot[] = [];
  for (let i = 0; i < slotsToRead; i++) {
    buildings.push(deserializeBuildingSlot(data, ESTATE_HEADER_SIZE + i * BUILDING_SLOT_SIZE));
  }

  // Computed helpers
  const maxSlots = header.plotsOwned * SLOTS_PER_PLOT;
  const activeBuildings = buildings.filter(
    (b) => b.status === BuildingStatus.Active || b.status === BuildingStatus.Upgrading,
  ).length;

  return { ...header, buildings, maxSlots, activeBuildings };
}

// Parse Functions

/** Parse EstateAccount from account info */
export function parseEstate(accountInfo: { data: Uint8Array }): EstateAccount | null {
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
    nowSeconds >= Number(building.constructionEnds);
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
