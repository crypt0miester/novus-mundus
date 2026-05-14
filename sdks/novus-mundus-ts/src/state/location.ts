/**
 * LocationAccount
 *
 * Grid-based location account for cell occupancy.
 * Each grid cell is approximately 11 meters x 11 meters (0.0001 degrees).
 * Only ONE entity (player or encounter) can occupy a cell at a time.
 *
 * Size: 128 bytes (repr(C) layout)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize';

// Occupant Type Constants

export const OCCUPANT_NONE = 0;
export const OCCUPANT_PLAYER = 1;
export const OCCUPANT_ENCOUNTER = 2;

// Location Account Interface

export interface LocationAccount {
  gameEngine: PublicKey;
  gridLat: number;
  gridLong: number;
  cityId: number;
  bump: number;
  occupantType: number;
  occupant: PublicKey;
  occupiedSince: BN;
  locationCreator: PublicKey;
  reservedArrivalTime: BN;
}

/** LocationAccount size in bytes (repr(C) layout with alignment padding) */
export const LOCATION_ACCOUNT_SIZE = 128;

// Deserialization

/** Deserialize LocationAccount from raw bytes */
export function deserializeLocation(data: Uint8Array | Buffer): LocationAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  const gameEngine = reader.readPubkey();
  reader.skip(3); // implicit padding for i32 alignment (offset 33 -> 36)
  const gridLat = reader.readI32();
  const gridLong = reader.readI32();
  const cityId = reader.readU16();
  const bump = reader.readU8();
  const occupantType = reader.readU8();
  const occupant = reader.readPubkey();
  const occupiedSince = reader.readI64();
  const locationCreator = reader.readPubkey();
  const reservedArrivalTime = reader.readI64();

  return {
    gameEngine,
    gridLat,
    gridLong,
    cityId,
    bump,
    occupantType,
    occupant,
    occupiedSince,
    locationCreator,
    reservedArrivalTime,
  };
}

/** Parse LocationAccount from account info */
export function parseLocation(accountInfo: AccountInfo<Buffer>): LocationAccount | null {
  if (!accountInfo.data || accountInfo.data.length < LOCATION_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeLocation(accountInfo.data);
}

// Helper Functions

/** Check if cell is currently occupied (by anyone) */
export function isLocationOccupied(location: LocationAccount): boolean {
  return location.occupantType !== OCCUPANT_NONE && !isNullPubkey(location.occupant);
}

/** Check if cell is occupied by a player */
export function isPlayerOccupied(location: LocationAccount): boolean {
  return location.occupantType === OCCUPANT_PLAYER && !isNullPubkey(location.occupant);
}

/** Check if cell is occupied by an encounter */
export function isEncounterOccupied(location: LocationAccount): boolean {
  return location.occupantType === OCCUPANT_ENCOUNTER && !isNullPubkey(location.occupant);
}

/** Check if occupant is still traveling (hasn't arrived yet) */
export function isLocationTraveling(location: LocationAccount): boolean {
  return location.reservedArrivalTime.toNumber() > 0;
}

