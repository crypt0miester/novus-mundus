/**
 * CityAccount
 *
 * Fixed city locations where players gather and travel between.
 * repr(C) layout with terrain extension. Total fixed size: 152 bytes
 * (plus anchor_count * 8 bytes of trailing anchor data).
 */

import type { AccountInfo, PublicKey } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';
import { CityType } from '../types/enums';
import {
  type Anchor,
  type CityTerrain,
  TERRAIN_HEADER_SIZE,
  ANCHOR_SIZE,
} from '../calculators/terrain';

// ============================================================
// City Account Interface
// ============================================================

export interface CityAccount {
  /** Game engine pubkey (kingdom reference) */
  gameEngine: PublicKey;
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
  activeEncounters: BN;
  /** Total PvE encounters spawned in this city (all-time) */
  totalEncountersSpawned: BN;
  /** Unix timestamp when city was founded */
  foundedAt: BN;
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

// ============================================================
// Deserialization
// ============================================================

/**
 * Deserialize CityAccount from raw account bytes.
 * Matches the on-chain repr(C) layout exactly, including padding.
 */
export function deserializeCity(data: Uint8Array | Buffer): CityAccount {
  const reader = new BufferReader(data);

  // repr(C) layout — see programs/novus_mundus/src/state/city.rs
  reader.readU8();                                     // offset 0   (account_key discriminator)
  const gameEngine = reader.readPubkey();              // offset 1   (32 bytes)
  reader.skip(1);                                      // offset 33  (implicit padding for u16 align)
  const cityId = reader.readU16();                     // offset 34  (2 bytes)
  const nameBytes = reader.readBytes(32);              // offset 36  (32 bytes)
  const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '');
  reader.skip(4);                                      // offset 68  (padding for f64 align, reduced from 6)
  const latitude = reader.readF64();                  // offset 72  (8 bytes)
  const longitude = reader.readF64();                 // offset 80  (8 bytes)
  const radiusKm = reader.readF32();                  // offset 88  (4 bytes)
  const cityTypeValue = reader.readU8();              // offset 92  (1 byte)
  const cityType = cityTypeValue as CityType;
  reader.skip(3);                                     // offset 93  (padding for u32 align)
  const playersPresent = reader.readU32();            // offset 96  (4 bytes)
  reader.skip(4);                                     // offset 100 (padding for u64 align)
  const activeEncounters = reader.readU64();          // offset 104 (8 bytes)
  const totalEncountersSpawned = reader.readU64();    // offset 112 (8 bytes)
  const foundedAt = reader.readI64();                 // offset 120 (8 bytes)
  const minEncounterLevel = reader.readU8();          // offset 128 (1 byte)
  const maxEncounterLevel = reader.readU8();          // offset 129 (1 byte)
  const bump = reader.readU8();                       // offset 130 (1 byte)
  reader.skip(1);                                     // offset 131 (_padding1)
  const arenaSeasonId = reader.readU32();             // offset 132 (4 bytes)

  // ─── Terrain header ────────────────────────────────────────
  const terrainSeed = reader.readU32();               // offset 136 (4 bytes)
  const waterLine = reader.readU8();                  // offset 140 (1 byte)
  const peakLine = reader.readU8();                   // offset 141 (1 byte)
  const anchorCount = reader.readU16();               // offset 142 (2 bytes)
  const terrainVersion = reader.readU8();             // offset 144 (1 byte)
  reader.skip(7);                                     // offset 145 (_terrain_reserved)
  // now at offset 152

  // ─── Trailing anchor data ──────────────────────────────────
  const anchors: Anchor[] = [];
  for (let i = 0; i < anchorCount; i++) {
    anchors.push({
      x: reader.readI16(),
      y: reader.readI16(),
      mass: reader.readU8(),
      lift: reader.readU8(),
      pushX: reader.readI8(),
      pushY: reader.readI8(),
      moisture: reader.readU8(),
    });
  }

  return {
    gameEngine,
    cityId,
    name,
    latitude,
    longitude,
    radiusKm,
    cityType,
    playersPresent,
    activeEncounters,
    totalEncountersSpawned,
    foundedAt,
    minEncounterLevel,
    maxEncounterLevel,
    bump,
    arenaSeasonId,
    terrainSeed,
    waterLine,
    peakLine,
    anchorCount,
    terrainVersion,
    anchors,
  };
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
export function parseCity(accountInfo: AccountInfo<Buffer>): CityAccount | null {
  if (!accountInfo.data || accountInfo.data.length < CITY_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeCity(accountInfo.data);
}
