/**
 * LocationAccount
 *
 * Grid-based location account for cell occupancy.
 * Each grid cell is approximately 11 meters x 11 meters (0.0001 degrees).
 * Only ONE entity (player or encounter) can occupy a cell at a time.
 *
 * Size: 128 bytes (repr(C) layout)
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, pad, u8, u16, i32, i64, pubkey } from '../utils/codec';

// Occupant Type Constants

export const OCCUPANT_NONE = 0;
export const OCCUPANT_PLAYER = 1;
export const OCCUPANT_ENCOUNTER = 2;

// Location Account Interface

export interface LocationAccount {
  gameEngine: Address;
  gridLat: number;
  gridLong: number;
  cityId: number;
  bump: number;
  occupantType: number;
  occupant: Address;
  occupiedSince: bigint;
  locationCreator: Address;
  reservedArrivalTime: bigint;
}

/** LocationAccount size in bytes (repr(C) layout with alignment padding) */
export const LOCATION_ACCOUNT_SIZE = 128;

// Codec

/** LocationAccount `#[repr(C)]` codec */
const locationCodec = reprC<LocationAccount>([
  pad(1), // account_key discriminator
  ['gameEngine', pubkey],
  ['gridLat', i32],
  ['gridLong', i32],
  ['cityId', u16],
  ['bump', u8],
  ['occupantType', u8],
  ['occupant', pubkey],
  ['occupiedSince', i64],
  ['locationCreator', pubkey],
  ['reservedArrivalTime', i64],
], LOCATION_ACCOUNT_SIZE);

// Deserialization

/** Deserialize LocationAccount from raw bytes */
export function deserializeLocation(data: Uint8Array): LocationAccount {
  return locationCodec.decode(data);
}

/** Parse LocationAccount from account info */
export function parseLocation(accountInfo: { data: Uint8Array }): LocationAccount | null {
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
  return Number(location.reservedArrivalTime) > 0;
}

