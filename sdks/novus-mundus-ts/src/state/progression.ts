/**
 * ProgressionAccount
 *
 * Per-player progression tracking (level and XP).
 *
 * Size: 56 bytes (repr(C) layout)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';

// ============================================================
// Progression Account Interface
// ============================================================

export interface ProgressionAccount {
  player: PublicKey;
  level: number;
  xp: BN;
  bump: number;
}

/** ProgressionAccount size in bytes (repr(C) layout with alignment padding) */
export const PROGRESSION_ACCOUNT_SIZE = 56;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize ProgressionAccount from raw bytes */
export function deserializeProgression(data: Uint8Array | Buffer): ProgressionAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  const player = reader.readPubkey();
  const level = reader.readU8();
  reader.skip(6); // implicit padding for u64 alignment (offset 34 -> 40)
  const xp = reader.readU64();
  const bump = reader.readU8();
  reader.skip(6); // _padding

  return {
    player,
    level,
    xp,
    bump,
  };
}

/** Parse ProgressionAccount from account info */
export function parseProgression(accountInfo: AccountInfo<Buffer>): ProgressionAccount | null {
  if (!accountInfo.data || accountInfo.data.length < PROGRESSION_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeProgression(accountInfo.data);
}
