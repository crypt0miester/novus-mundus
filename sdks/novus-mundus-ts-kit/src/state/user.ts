/**
 * UserAccount
 *
 * Tracks reserved NOVI and event participation.
 * Size: 112 bytes
 */

import type { Address } from '@solana/kit';
import { reprC, pad, u8, u16, u32, u64, i64, pubkey } from '../utils/codec';

// User Account Interface

export interface UserAccount {
  /** Wallet owner */
  owner: Address;
  /** Associated player account */
  player: Address;
  /** PDA bump */
  bump: number;
  /** Reserved NOVI balance (withdrawable) */
  reservedNovi: bigint;
  /** Timestamp when reserved NOVI was earned */
  reservedNoviEarnedAt: bigint;
  /** Total events participated in */
  totalEventsParticipated: bigint;
  /** Total events won */
  totalEventsWon: bigint;
  /** Total reserved NOVI earned (lifetime) */
  totalReservedEarned: bigint;
  /** Last withdrawal timestamp */
  lastWithdrawal: bigint;
  /** NOVI purchase streak (consecutive days) */
  noviPurchaseStreak: number;
  /** Last NOVI purchase day (day number since epoch) */
  noviLastPurchaseDay: number;
  /** NOVI purchased today (with 1 decimal) */
  noviPurchasedToday: bigint;
}

/** UserAccount size in bytes (repr(C) with account_key discriminator) */
export const USER_ACCOUNT_SIZE = 152;

// Codec

/** UserAccount `#[repr(C)]` codec */
const userCodec = reprC<UserAccount>([
  pad(1), // account_key discriminator
  ['owner', pubkey],
  ['player', pubkey],
  ['bump', u8],
  pad(7), // _padding1
  ['reservedNovi', u64],
  ['reservedNoviEarnedAt', i64],
  ['totalEventsParticipated', u64],
  ['totalEventsWon', u64],
  ['totalReservedEarned', u64],
  ['lastWithdrawal', i64],
  ['noviPurchaseStreak', u16],
  ['noviLastPurchaseDay', u32],
  ['noviPurchasedToday', u64],
  pad(2), // _padding2
], USER_ACCOUNT_SIZE);

// Deserialization

/** Deserialize UserAccount from raw bytes */
export function deserializeUser(data: Uint8Array): UserAccount {
  return userCodec.decode(data);
}

/** Parse UserAccount from account info */
export function parseUser(accountInfo: { data: Uint8Array }): UserAccount | null {
  if (!accountInfo.data || accountInfo.data.length < USER_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeUser(accountInfo.data);
}
