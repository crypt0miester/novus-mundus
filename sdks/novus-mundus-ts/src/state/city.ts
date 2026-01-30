/**
 * CityAccount
 *
 * Fixed city locations where players gather and travel between.
 * Size: 91 bytes
 */

import type { AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize.ts';
import { CityType } from '../types/enums.ts';

// ============================================================
// City Account Interface
// ============================================================

export interface CityAccount {
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
}

/** CityAccount size in bytes */
export const CITY_ACCOUNT_SIZE = 91;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize CityAccount from raw bytes */
export function deserializeCity(data: Uint8Array | Buffer): CityAccount {
  const reader = new BufferReader(data);

  const cityId = reader.readU16();
  const nameBytes = reader.readBytes(32);
  const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '');
  const latitude = reader.readF64();
  const longitude = reader.readF64();
  const radiusKm = reader.readF32();
  const cityTypeValue = reader.readU8();
  const cityType = cityTypeValue as CityType;
  const playersPresent = reader.readU32();
  const activeEncounters = reader.readU64();
  const totalEncountersSpawned = reader.readU64();
  const foundedAt = reader.readI64();
  const minEncounterLevel = reader.readU8();
  const maxEncounterLevel = reader.readU8();
  const bump = reader.readU8();
  reader.skip(1); // padding
  const arenaSeasonId = reader.readU32();

  return {
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
  };
}

/** Parse CityAccount from account info */
export function parseCity(accountInfo: AccountInfo<Buffer>): CityAccount | null {
  if (!accountInfo.data || accountInfo.data.length < CITY_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeCity(accountInfo.data);
}
