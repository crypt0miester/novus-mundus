/**
 * UserAccount
 *
 * Tracks reserved NOVI and event participation.
 * Size: 112 bytes
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize.ts';

// ============================================================
// User Account Interface
// ============================================================

export interface UserAccount {
  /** Wallet owner */
  owner: PublicKey;
  /** Associated player account */
  player: PublicKey;
  /** PDA bump */
  bump: number;
  /** Reserved NOVI balance (withdrawable) */
  reservedNovi: BN;
  /** Timestamp when reserved NOVI was earned */
  reservedNoviEarnedAt: BN;
  /** Total events participated in */
  totalEventsParticipated: BN;
  /** Total events won */
  totalEventsWon: BN;
  /** Total reserved NOVI earned (lifetime) */
  totalReservedEarned: BN;
  /** Last withdrawal timestamp */
  lastWithdrawal: BN;
  /** NOVI purchase streak (consecutive days) */
  noviPurchaseStreak: number;
  /** Last NOVI purchase day (day number since epoch) */
  noviLastPurchaseDay: number;
  /** NOVI purchased today (with 1 decimal) */
  noviPurchasedToday: BN;
}

/** UserAccount size in bytes (112 + 16 = 128) */
export const USER_ACCOUNT_SIZE = 128;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize UserAccount from raw bytes */
export function deserializeUser(data: Uint8Array | Buffer): UserAccount {
  const reader = new BufferReader(data);

  const owner = reader.readPubkey();
  const player = reader.readPubkey();
  const bump = reader.readU8();
  reader.skip(7); // padding

  const reservedNovi = reader.readU64();
  const reservedNoviEarnedAt = reader.readI64();
  const totalEventsParticipated = reader.readU64();
  const totalEventsWon = reader.readU64();
  const totalReservedEarned = reader.readU64();
  const lastWithdrawal = reader.readI64();

  // NOVI purchase tracking
  const noviPurchaseStreak = reader.readU16();
  const noviLastPurchaseDay = reader.readU32();
  const noviPurchasedToday = reader.readU64();
  reader.skip(2); // padding2

  return {
    owner,
    player,
    bump,
    reservedNovi,
    reservedNoviEarnedAt,
    totalEventsParticipated,
    totalEventsWon,
    totalReservedEarned,
    lastWithdrawal,
    noviPurchaseStreak,
    noviLastPurchaseDay,
    noviPurchasedToday,
  };
}

/** Parse UserAccount from account info */
export function parseUser(accountInfo: AccountInfo<Buffer>): UserAccount | null {
  if (!accountInfo.data || accountInfo.data.length < USER_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeUser(accountInfo.data);
}
