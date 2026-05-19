/**
 * Common Type Definitions
 *
 * Shared types used throughout the SDK.
 */

import type { Address } from '@solana/kit';

// Null Pubkey Constant

/** 32-byte null public key (all zeros) */
export const NULL_PUBKEY_BYTES = new Uint8Array(32);

// Account Info Types

/** Generic account with pubkey */
export interface AccountWithPubkey<T> {
  pubkey: Address;
  account: T;
}

/** Result of fetching multiple accounts */
export type MultiAccountResult<T> = Map<string, T>;

/** Ordered result of fetching multiple accounts */
export type OrderedAccountResult<T> = (T | null)[];

// Coordinates

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface CoordinatesWithCity extends Coordinates {
  cityId: number;
}

// Unit Counts

export interface DefensiveUnits {
  tier1: bigint;
  tier2: bigint;
  tier3: bigint;
}

export interface OperativeUnits {
  tier1: bigint;
  tier2: bigint;
  tier3: bigint;
}

export interface AllUnits {
  defensive: DefensiveUnits;
  operative: OperativeUnits;
}

// Resources

export interface Resources {
  lockedNovi: bigint;
  reservedNovi: bigint;
  cash: bigint;
  gems: bigint;
  weapons: bigint;
  produce: bigint;
  vehicles: bigint;
  fragments: bigint;
}

// Crafted Equipment

export interface CraftedEquipment {
  meleeWeapon: number;
  rangedWeapon: number;
  siegeWeapon: number;
  armor: number;
}

// Hero Stats

export interface HeroStats {
  level: number;
  xp: bigint;
  attackBuff: number;
  defenseBuff: number;
  critBuff: number;
  speedBuff: number;
  economyBuff: number;
}

// Time Ranges

export interface TimeRange {
  start: bigint;
  end: bigint;
}

// Pagination

export interface PaginationParams {
  offset?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// Eligibility Result

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  errorCode?: number;
}

// Transaction Result

export interface TransactionResult {
  signature: string;
  slot: number;
  success: boolean;
  error?: string;
}

// Price Info

export interface PriceInfo {
  price: bigint;
  confidence: bigint;
  exponent: number;
  timestamp: number;
}

// Leaderboard Entry

export interface LeaderboardEntry<T> {
  rank: number;
  pubkey: Address;
  data: T;
  score: bigint;
}

// Callback Types

export type AccountChangeCallback<T> = (
  previous: T | null,
  current: T,
  changes: Partial<T>
) => void;

export type ErrorCallback = (error: Error) => void;

// isNullPubkey is exported from utils/deserialize.ts
