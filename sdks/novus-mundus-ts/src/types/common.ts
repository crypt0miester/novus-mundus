/**
 * Common Type Definitions
 *
 * Shared types used throughout the SDK.
 */

import type { PublicKey } from '@solana/web3.js';
import type BN from 'bn.js';

// Null Pubkey Constant

/** 32-byte null public key (all zeros) */
export const NULL_PUBKEY_BYTES = new Uint8Array(32);

// Account Info Types

/** Generic account with pubkey */
export interface AccountWithPubkey<T> {
  pubkey: PublicKey;
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
  tier1: BN;
  tier2: BN;
  tier3: BN;
}

export interface OperativeUnits {
  tier1: BN;
  tier2: BN;
  tier3: BN;
}

export interface AllUnits {
  defensive: DefensiveUnits;
  operative: OperativeUnits;
}

// Resources

export interface Resources {
  lockedNovi: BN;
  reservedNovi: BN;
  cash: BN;
  gems: BN;
  weapons: BN;
  produce: BN;
  vehicles: BN;
  fragments: BN;
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
  xp: BN;
  attackBuff: number;
  defenseBuff: number;
  critBuff: number;
  speedBuff: number;
  economyBuff: number;
}

// Time Ranges

export interface TimeRange {
  start: BN;
  end: BN;
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
  price: BN;
  confidence: BN;
  exponent: number;
  timestamp: number;
}

// Leaderboard Entry

export interface LeaderboardEntry<T> {
  rank: number;
  pubkey: PublicKey;
  data: T;
  score: BN;
}

// Callback Types

export type AccountChangeCallback<T> = (
  previous: T | null,
  current: T,
  changes: Partial<T>
) => void;

export type ErrorCallback = (error: Error) => void;

// Type Guards

/** Check if a value is a BN instance */
export function isBN(value: unknown): value is BN {
  return (
    value !== null &&
    typeof value === 'object' &&
    'toNumber' in value &&
    'toString' in value &&
    'toArray' in value
  );
}

// isNullPubkey is exported from utils/deserialize.ts
