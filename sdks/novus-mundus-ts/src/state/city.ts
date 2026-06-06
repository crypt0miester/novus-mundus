/**
 * CityAccount
 *
 * Fixed city locations where players gather and travel between.
 * repr(C) layout, fixed 152 bytes — no trailing variable-length data
 * after the flat-strategy cut (biome is a pure function of biomeSeed
 * sampled at the point of use; see calculators/biome.ts).
 */

import type { AccountInfo, PublicKey } from '@solana/web3.js';
import { ByteReader } from '../utils/deserialize';
import { CityType } from '../types/enums';
import type { BiomeKnobs } from '../calculators/biome';

// City Account Interface.

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
  /** Deterministic seed for biome noise channels */
  biomeSeed: number;
  /** Square plot X extent in grid units (centred AABB) */
  widthGrid: number;
  /** Square plot Y extent in grid units (centred AABB) */
  heightGrid: number;
  /** Layout discriminator — bumped to 2 at the flat-strategy cut. */
  layoutVersion: number;
  /** Signed delta added to the global WATER_THRESHOLD. 0 = procedural default. */
  waterLevelDelta: number;
  /** Signed shift on temperature noise. 0 = procedural default. */
  tempBias: number;
  /** Signed shift on moisture noise. 0 = procedural default. */
  moistureBias: number;
  /** Coastal-gradient bearing. 0 = none; 1..=8 = N/NE/E/SE/S/SW/W/NW. */
  coast: number;
  /** Landmass mask seed. 0 = no mask; >0 carves organic islands. */
  landmassSeed: number;
}

/** CityAccount fixed size in bytes (repr(C) layout, no trailing data). */
export const CITY_ACCOUNT_SIZE = 144;

/** Current on-chain layout version. Bumped at the flat-strategy cut so
 * pre-cut variable-length accounts (which had radius_km + terrain
 * anchors and lacked this field) are rejected at parse time rather
 * than silently misparsed against the new offsets. */
export const CITY_LAYOUT_VERSION = 2;

// Deserialization.

/**
 * Deserialize CityAccount from raw account bytes.
 * Matches the on-chain repr(C) layout exactly, including padding.
 */
export function deserializeCity(data: Uint8Array): CityAccount {
  const reader = new ByteReader(data);

  // repr(C) layout — see programs/novus_mundus/src/state/city.rs
  reader.readU8();                                     // offset 0   account_key
  const gameEngine = reader.readPubkey();              // offset 1   32 bytes
  reader.skip(1);                                      // offset 33  padding for u16 align
  const cityId = reader.readU16();                     // offset 34  2 bytes
  const nameBytes = reader.readBytes(32);              // offset 36  32 bytes
  const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '');
  reader.skip(4);                                      // offset 68  padding for f64 align
  const latitude = reader.readF64();                   // offset 72  8 bytes
  const longitude = reader.readF64();                  // offset 80  8 bytes
  const cityTypeValue = reader.readU8();               // offset 88  1 byte
  const cityType = cityTypeValue as CityType;
  reader.skip(3);                                      // offset 89  padding for u32 align
  const playersPresent = reader.readU32();             // offset 92  4 bytes
  // No padding here — players_present ends at 96 which is u64-aligned.
  // (Pre-cut layout had radius_km: f32 between longitude and city_type,
  // which shifted everything below by 8 bytes and forced a 4-byte pad
  // here for u64 align. Post-flat-strategy the pad collapses.)
  const activeEncounters = reader.readU64();           // offset 96  8 bytes
  const totalEncountersSpawned = reader.readU64();     // offset 104 8 bytes
  const foundedAt = reader.readI64();                  // offset 112 8 bytes
  const minEncounterLevel = reader.readU8();           // offset 120 1 byte
  const maxEncounterLevel = reader.readU8();           // offset 121 1 byte
  const bump = reader.readU8();                        // offset 122 1 byte
  reader.skip(1);                                      // offset 123 _padding1
  const arenaSeasonId = reader.readU32();              // offset 124 4 bytes
  // Biome layout fields (replaces pre-cut terrain block + radiusKm).
  const biomeSeed = reader.readU32();                  // offset 128 4 bytes
  const widthGrid = reader.readU16();                  // offset 132 2 bytes
  const heightGrid = reader.readU16();                 // offset 134 2 bytes
  const layoutVersion = reader.readU8();               // offset 136 1 byte
  if (layoutVersion !== CITY_LAYOUT_VERSION) {
    throw new Error(
      `CityAccount layout_version mismatch: expected ${CITY_LAYOUT_VERSION}, got ${layoutVersion}. ` +
        `Pre-cut accounts (without biome layout) must be reinitialised after the flat-strategy cut.`,
    );
  }
  // Biome knob bytes — see logic/biome.rs::BiomeKnobs.
  const waterLevelDelta = reader.readI8();             // offset 137 1 byte
  const tempBias = reader.readI8();                    // offset 138 1 byte
  const moistureBias = reader.readI8();                // offset 139 1 byte
  const coast = reader.readU8();                       // offset 140 1 byte
  const landmassSeed = reader.readU8();                // offset 141 1 byte
  reader.skip(2);                                      // offset 142 _biome_reserved (2 bytes)
  // now at offset 144 (matches CITY_ACCOUNT_SIZE)

  return {
    gameEngine,
    cityId,
    name,
    latitude,
    longitude,
    cityType,
    playersPresent,
    activeEncounters,
    totalEncountersSpawned,
    foundedAt,
    minEncounterLevel,
    maxEncounterLevel,
    bump,
    arenaSeasonId,
    biomeSeed,
    widthGrid,
    heightGrid,
    layoutVersion,
    waterLevelDelta,
    tempBias,
    moistureBias,
    coast,
    landmassSeed,
  };
}

/** Parse CityAccount from account info. Returns null for malformed accounts
 * (wrong size or unparseable layout) so bulk fetches can skip stragglers
 * from older deploys instead of crashing the caller. */
export function parseCity(accountInfo: AccountInfo<Uint8Array>): CityAccount | null {
  if (!accountInfo.data || accountInfo.data.length < CITY_ACCOUNT_SIZE) {
    return null;
  }
  try {
    return deserializeCity(accountInfo.data);
  } catch {
    return null;
  }
}

/** Project a CityAccount onto the BiomeKnobs tuple consumed by the
 * biome sampler. Single source of truth so every caller (web, CLI,
 * tests) reads the same knobs from the same fields. */
export function biomeKnobsFromCity(city: CityAccount): BiomeKnobs {
  return {
    waterLevelDelta: city.waterLevelDelta,
    tempBias: city.tempBias,
    moistureBias: city.moistureBias,
    coast: city.coast,
    landmassSeed: city.landmassSeed,
  };
}
