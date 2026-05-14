/**
 * UserAccount
 *
 * Tracks reserved NOVI and event participation.
 * Size: 112 bytes
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';

// User Account Interface

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

/** UserAccount size in bytes (repr(C) with account_key discriminator) */
export const USER_ACCOUNT_SIZE = 152;

// Deserialization

/** Deserialize UserAccount from raw bytes */
export function deserializeUser(data: Uint8Array | Buffer): UserAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  const owner = reader.readPubkey();                 // offset 1   (32 bytes)
  const player = reader.readPubkey();                // offset 33  (32 bytes)
  const bump = reader.readU8();                      // offset 65  (1 byte)
  reader.skip(7); // _padding1                       // offset 66  (7 bytes)
  reader.skip(7); // implicit padding for u64 align  // offset 73  (7 bytes → offset 80)

  const reservedNovi = reader.readU64();             // offset 80  (8 bytes)
  const reservedNoviEarnedAt = reader.readI64();     // offset 88  (8 bytes)
  const totalEventsParticipated = reader.readU64();  // offset 96  (8 bytes)
  const totalEventsWon = reader.readU64();           // offset 104 (8 bytes)
  const totalReservedEarned = reader.readU64();      // offset 112 (8 bytes)
  const lastWithdrawal = reader.readI64();           // offset 120 (8 bytes)

  // NOVI purchase tracking
  const noviPurchaseStreak = reader.readU16();       // offset 128 (2 bytes)
  reader.skip(2); // implicit padding for u32 align  // offset 130 (2 bytes)
  const noviLastPurchaseDay = reader.readU32();      // offset 132 (4 bytes)
  const noviPurchasedToday = reader.readU64();       // offset 136 (8 bytes)
  reader.skip(2); // _padding2                       // offset 144 (2 bytes)
  reader.skip(6); // struct trailing padding (align 8) // offset 146 (6 bytes → offset 152)

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
