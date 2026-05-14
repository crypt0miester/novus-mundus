/**
 * LootAccount
 *
 * Physical rewards from encounters/PvP/rallies.
 * Size: 200 bytes
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';

// Loot Source Type

export enum LootSourceType {
  Encounter = 0,
  PvP = 1,
  Rally = 2,
}

// Loot Account Interface

export interface LootAccount {
  // Identity & Security
  owner: PublicKey;
  creator: PublicKey;
  lootId: BN;
  bump: number;
  sourceType: LootSourceType;
  claimed: boolean;

  // Timestamps
  createdAt: BN;
  expiresAt: BN;

  // Source metadata
  sourceId: BN;
  contribution: BN;
  sourceLevel: number;
  sourceRarity: number;

  // Physical rewards
  cash: BN;
  reservedNovi: BN;
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
  produce: BN;
  vehicles: BN;
  fragments: BN;
  gems: BN;
}

/** LootAccount size in bytes */
export const LOOT_ACCOUNT_SIZE = 200;

/** Loot expiration duration (30 days in seconds) */
export const LOOT_EXPIRATION_DURATION = 30 * 86400;

// Deserialization

/** Deserialize LootAccount from raw bytes */
export function deserializeLoot(data: Uint8Array | Buffer): LootAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator

  // Identity & Security
  const owner = reader.readPubkey();
  const creator = reader.readPubkey();
  reader.skip(7); // implicit padding for u64 alignment (offset 65 -> 72)
  const lootId = reader.readU64();
  const bump = reader.readU8();
  const sourceTypeValue = reader.readU8();
  const sourceType = sourceTypeValue as LootSourceType;
  const claimed = reader.readBool();
  reader.skip(5); // padding

  // Timestamps (16 bytes)
  const createdAt = reader.readI64();
  const expiresAt = reader.readI64();

  // Source metadata (24 bytes)
  const sourceId = reader.readU64();
  const contribution = reader.readU64();
  const sourceLevel = reader.readU8();
  const sourceRarity = reader.readU8();
  reader.skip(6); // padding

  // Physical rewards (72 bytes)
  const cash = reader.readU64();
  const reservedNovi = reader.readU64();
  const meleeWeapons = reader.readU64();
  const rangedWeapons = reader.readU64();
  const siegeWeapons = reader.readU64();
  const produce = reader.readU64();
  const vehicles = reader.readU64();
  const fragments = reader.readU64();
  const gems = reader.readU64();

  return {
    owner,
    creator,
    lootId,
    bump,
    sourceType,
    claimed,
    createdAt,
    expiresAt,
    sourceId,
    contribution,
    sourceLevel,
    sourceRarity,
    cash,
    reservedNovi,
    meleeWeapons,
    rangedWeapons,
    siegeWeapons,
    produce,
    vehicles,
    fragments,
    gems,
  };
}

/** Parse LootAccount from account info */
export function parseLoot(accountInfo: AccountInfo<Buffer>): LootAccount | null {
  if (!accountInfo.data || accountInfo.data.length < LOOT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeLoot(accountInfo.data);
}

// Helper Functions

/** Check if loot has any rewards */
export function lootHasRewards(loot: LootAccount): boolean {
  return (
    loot.cash.gtn(0) ||
    loot.reservedNovi.gtn(0) ||
    loot.meleeWeapons.gtn(0) ||
    loot.rangedWeapons.gtn(0) ||
    loot.siegeWeapons.gtn(0) ||
    loot.produce.gtn(0) ||
    loot.vehicles.gtn(0) ||
    loot.fragments.gtn(0) ||
    loot.gems.gtn(0)
  );
}

/** Get total weapons */
export function getLootTotalWeapons(loot: LootAccount): BN {
  return loot.meleeWeapons.add(loot.rangedWeapons).add(loot.siegeWeapons);
}

/** Check if loot has expired */
export function isLootExpired(loot: LootAccount, nowSeconds: number): boolean {
  return nowSeconds >= loot.expiresAt.toNumber();
}

/** Count number of reward types (for UI display) */
export function countLootRewardTypes(loot: LootAccount): number {
  let count = 0;
  if (loot.cash.gtn(0)) count++;
  if (loot.reservedNovi.gtn(0)) count++;
  if (loot.meleeWeapons.gtn(0)) count++;
  if (loot.rangedWeapons.gtn(0)) count++;
  if (loot.siegeWeapons.gtn(0)) count++;
  if (loot.produce.gtn(0)) count++;
  if (loot.vehicles.gtn(0)) count++;
  if (loot.fragments.gtn(0)) count++;
  if (loot.gems.gtn(0)) count++;
  return count;
}
