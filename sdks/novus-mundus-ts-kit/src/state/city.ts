/**
 * CityAccount
 *
 * Fixed city locations where players gather and travel between.
 * repr(C) layout with terrain extension. Total fixed size: 152 bytes
 * (plus anchor_count * 8 bytes of trailing anchor data).
 */

import type { Address } from '@solana/kit';
import { reprC, pad, u8, u16, u32, u64, f32, f64, i64, pubkey, fixedString } from '../utils/codec';
import { CityType } from '../types/enums';
import {
  type Anchor,
  type CityTerrain,
  ANCHOR_SIZE,
} from '../calculators/terrain';

// City Account Interface

export interface CityAccount {
  /** Game engine pubkey (kingdom reference) */
  gameEngine: Address;
  /** Unique city identifier (0-65535 cities possible) */
  cityId: number;
  /** City name (UTF-8 encoded) */
  name: string;
  /** Geographic center point (latitude in degrees) */
  latitude: number;
  /** Geographic center point (longitude in degrees) */
  longitude: number;
  /** City radius in kilometers for boundary validation */
  radiusKm: number;
  /** Type of city (Capital, Resource, Combat, Trade) */
  cityType: CityType;
  /** Current number of players present in this city */
  playersPresent: number;
  /** Total PvP attacks initiated in this city (all-time) */
  activeEncounters: bigint;
  /** Total PvE encounters spawned in this city (all-time) */
  totalEncountersSpawned: bigint;
  /** Unix timestamp when city was founded */
  foundedAt: bigint;
  /** Minimum encounter level for this city */
  minEncounterLevel: number;
  /** Maximum encounter level for this city */
  maxEncounterLevel: number;
  /** PDA bump seed */
  bump: number;
  /** Current arena season ID for this city */
  arenaSeasonId: number;

  // ─── Terrain ───────────────────────────────────────────────
  /** Deterministic seed for terrain noise */
  terrainSeed: number;
  /** Elevation at or below this is water (impassable) */
  waterLine: number;
  /** Elevation at or above this is mountain (impassable) */
  peakLine: number;
  /** Number of terrain anchors */
  anchorCount: number;
  /** Terrain data format version */
  terrainVersion: number;
  /** Parsed terrain anchors (from trailing account data) */
  anchors: Anchor[];
}

/** CityAccount fixed size in bytes (repr(C) layout, excluding trailing anchors) */
export const CITY_ACCOUNT_SIZE = 152;

// Codec

/** CityAccount fixed-header fields (excludes the dynamic `anchors` array) */
type CityHeader = Omit<CityAccount, 'anchors'>;

/** CityAccount fixed-header `#[repr(C)]` codec — see programs/novus_mundus/src/state/city.rs */
const cityHeaderCodec = reprC<CityHeader>([
  pad(1), // account_key discriminator
  ['gameEngine', pubkey],
  ['cityId', u16],
  ['name', fixedString(32)],
  ['latitude', f64],
  ['longitude', f64],
  ['radiusKm', f32],
  ['cityType', u8],
  ['playersPresent', u32],
  ['activeEncounters', u64],
  ['totalEncountersSpawned', u64],
  ['foundedAt', i64],
  ['minEncounterLevel', u8],
  ['maxEncounterLevel', u8],
  ['bump', u8],
  pad(1), // _padding1
  ['arenaSeasonId', u32],
  // Terrain header
  ['terrainSeed', u32],
  ['waterLine', u8],
  ['peakLine', u8],
  ['anchorCount', u16],
  ['terrainVersion', u8],
  pad(7), // _terrain_reserved
], CITY_ACCOUNT_SIZE);

// Deserialization

/**
 * Deserialize CityAccount from raw account bytes.
 * Matches the on-chain repr(C) layout exactly, including padding.
 * The fixed header is decoded via the codec; trailing anchors are read after.
 */
export function deserializeCity(data: Uint8Array): CityAccount {
  const header = cityHeaderCodec.decode(data);

  // Trailing anchor data (starts at CITY_ACCOUNT_SIZE)
  const view = new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  );
  const anchors: Anchor[] = [];
  for (let i = 0; i < header.anchorCount; i++) {
    const base = CITY_ACCOUNT_SIZE + i * ANCHOR_SIZE;
    anchors.push({
      x: view.getInt16(base, true),
      y: view.getInt16(base + 2, true),
      mass: view.getUint8(base + 4),
      lift: view.getUint8(base + 5),
      pushX: view.getInt8(base + 6),
      pushY: view.getInt8(base + 7),
      moisture: view.getUint8(base + 8),
    });
  }

  return { ...header, anchors };
}

/** Build a CityTerrain view from a deserialized CityAccount */
export function cityTerrain(city: CityAccount): CityTerrain {
  return {
    seed: city.terrainSeed,
    waterLine: city.waterLine,
    peakLine: city.peakLine,
    anchorCount: city.anchorCount,
    version: city.terrainVersion,
    anchors: city.anchors,
  };
}

/** Parse CityAccount from account info */
export function parseCity(accountInfo: { data: Uint8Array }): CityAccount | null {
  if (!accountInfo.data || accountInfo.data.length < CITY_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeCity(accountInfo.data);
}
