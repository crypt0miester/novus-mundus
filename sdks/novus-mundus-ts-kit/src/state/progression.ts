/**
 * ProgressionAccount
 *
 * Per-player progression tracking (level and XP).
 *
 * Size: 56 bytes (repr(C) layout)
 */

import type { Address } from '@solana/kit';
import { reprC, pad, u8, u64, pubkey } from '../utils/codec';

// Progression Account Interface

export interface ProgressionAccount {
  player: Address;
  level: number;
  xp: bigint;
  bump: number;
}

/** ProgressionAccount size in bytes (repr(C) layout with alignment padding) */
export const PROGRESSION_ACCOUNT_SIZE = 56;

// Codec

/** ProgressionAccount `#[repr(C)]` codec */
const progressionCodec = reprC<ProgressionAccount>([
  pad(1), // account_key discriminator
  ['player', pubkey],
  ['level', u8],
  ['xp', u64],
  ['bump', u8],
  pad(6), // _padding
], PROGRESSION_ACCOUNT_SIZE);

// Deserialization

/** Deserialize ProgressionAccount from raw bytes */
export function deserializeProgression(data: Uint8Array): ProgressionAccount {
  return progressionCodec.decode(data);
}

/** Parse ProgressionAccount from account info */
export function parseProgression(accountInfo: { data: Uint8Array }): ProgressionAccount | null {
  if (!accountInfo.data || accountInfo.data.length < PROGRESSION_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeProgression(accountInfo.data);
}
