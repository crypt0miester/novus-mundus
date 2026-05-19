/**
 * LootAccount
 *
 * Physical rewards from encounters/PvP/rallies.
 * Size: 200 bytes
 */

import type { Address } from '@solana/kit';
import { reprC, pad, u8, u64, i64, bool, pubkey } from '../utils/codec';

// Loot Source Type

export enum LootSourceType {
  Encounter = 0,
  PvP = 1,
  Rally = 2,
}

// Loot Account Interface

export interface LootAccount {
  // Identity & Security
  owner: Address;
  creator: Address;
  lootId: bigint;
  bump: number;
  sourceType: LootSourceType;
  claimed: boolean;

  // Timestamps
  createdAt: bigint;
  expiresAt: bigint;

  // Source metadata
  sourceId: bigint;
  contribution: bigint;
  sourceLevel: number;
  sourceRarity: number;

  // Physical rewards
  cash: bigint;
  reservedNovi: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  produce: bigint;
  vehicles: bigint;
  fragments: bigint;
  gems: bigint;
}

/** LootAccount size in bytes */
export const LOOT_ACCOUNT_SIZE = 200;

/** Loot expiration duration (30 days in seconds) */
export const LOOT_EXPIRATION_DURATION = 30 * 86400;

// Codec

/** LootAccount `#[repr(C)]` codec */
const lootCodec = reprC<LootAccount>([
  pad(1), // account_key discriminator
  ['owner', pubkey],
  ['creator', pubkey],
  ['lootId', u64],
  ['bump', u8],
  ['sourceType', u8],
  ['claimed', bool],
  ['createdAt', i64],
  ['expiresAt', i64],
  ['sourceId', u64],
  ['contribution', u64],
  ['sourceLevel', u8],
  ['sourceRarity', u8],
  ['cash', u64],
  ['reservedNovi', u64],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['produce', u64],
  ['vehicles', u64],
  ['fragments', u64],
  ['gems', u64],
], LOOT_ACCOUNT_SIZE);

// Deserialization

/** Deserialize LootAccount from raw bytes */
export function deserializeLoot(data: Uint8Array): LootAccount {
  return lootCodec.decode(data);
}

/** Parse LootAccount from account info */
export function parseLoot(accountInfo: { data: Uint8Array }): LootAccount | null {
  if (!accountInfo.data || accountInfo.data.length < LOOT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeLoot(accountInfo.data);
}

// Helper Functions

/** Check if loot has any rewards */
export function lootHasRewards(loot: LootAccount): boolean {
  return (
    loot.cash > 0n ||
    loot.reservedNovi > 0n ||
    loot.meleeWeapons > 0n ||
    loot.rangedWeapons > 0n ||
    loot.siegeWeapons > 0n ||
    loot.produce > 0n ||
    loot.vehicles > 0n ||
    loot.fragments > 0n ||
    loot.gems > 0n
  );
}

/** Get total weapons */
export function getLootTotalWeapons(loot: LootAccount): bigint {
  return (loot.meleeWeapons + loot.rangedWeapons + loot.siegeWeapons);
}

/** Check if loot has expired */
export function isLootExpired(loot: LootAccount, nowSeconds: number): boolean {
  return nowSeconds >= Number(loot.expiresAt);
}

/** Count number of reward types (for UI display) */
export function countLootRewardTypes(loot: LootAccount): number {
  let count = 0;
  if (loot.cash > 0n) count++;
  if (loot.reservedNovi > 0n) count++;
  if (loot.meleeWeapons > 0n) count++;
  if (loot.rangedWeapons > 0n) count++;
  if (loot.siegeWeapons > 0n) count++;
  if (loot.produce > 0n) count++;
  if (loot.vehicles > 0n) count++;
  if (loot.fragments > 0n) count++;
  if (loot.gems > 0n) count++;
  return count;
}
