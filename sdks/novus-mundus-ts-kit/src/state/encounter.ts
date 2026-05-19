/**
 * EncounterAccount
 *
 * PvE encounter with dynamic attacker list.
 * Base size: 120 bytes + 32 bytes per attacker
 */

import type { Address } from '@solana/kit';
import { bytesToAddress } from '../crypto';
import { reprC, pad, u8, u16, u32, u64, f64, i64, pubkey } from '../utils/codec';
import { EncounterType } from '../types/enums';

// Encounter Account Interface

export interface EncounterAccount {
  id: bigint;
  cityId: number;
  level: number;
  rarity: EncounterType;
  locationLat: number;
  locationLong: number;
  spawnedAt: bigint;
  despawnAt: bigint;
  health: bigint;
  maxHealth: bigint;
  defense: number;
  attackerCount: number;
  bump: number;
  /** Attackers are read dynamically from account data */
  attackers: Address[];
}

/** EncounterAccount base size in bytes (without attackers) */
export const ENCOUNTER_ACCOUNT_BASE_SIZE = 120;

/** Calculate total encounter account size */
export function calculateEncounterAccountSize(attackerCount: number): number {
  return ENCOUNTER_ACCOUNT_BASE_SIZE + attackerCount * 32;
}

// Codec

/** EncounterAccount fixed-header fields (excludes the dynamic `attackers` array) */
type EncounterHeader = Omit<EncounterAccount, 'attackers'>;

/** EncounterAccount fixed-header `#[repr(C)]` codec */
const encounterHeaderCodec = reprC<EncounterHeader>([
  pad(1), // account_key discriminator
  pad(32), // game_engine (Pubkey, not in interface)
  ['id', u64],
  ['cityId', u16],
  ['level', u8],
  ['rarity', u8],
  ['locationLat', f64],
  ['locationLong', f64],
  ['spawnedAt', i64],
  ['despawnAt', i64],
  ['health', u64],
  ['maxHealth', u64],
  ['defense', u32],
  pad(4), // _padding
  ['attackerCount', u8],
  ['bump', u8],
], ENCOUNTER_ACCOUNT_BASE_SIZE);

// Deserialization

/** Deserialize EncounterAccount from raw bytes */
export function deserializeEncounter(data: Uint8Array): EncounterAccount {
  const header = encounterHeaderCodec.decode(data);

  // Attackers are stored as a trailing array of pubkeys (32 bytes each)
  const attackers: Address[] = [];
  for (let i = 0; i < header.attackerCount; i++) {
    const base = ENCOUNTER_ACCOUNT_BASE_SIZE + i * 32;
    attackers.push(bytesToAddress(data.subarray(base, base + 32)));
  }

  return { ...header, attackers };
}

/** Parse EncounterAccount from account info */
export function parseEncounter(accountInfo: { data: Uint8Array }): EncounterAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ENCOUNTER_ACCOUNT_BASE_SIZE) {
    return null;
  }
  return deserializeEncounter(accountInfo.data);
}

// Helper Functions

/** Check if encounter is alive */
export function isEncounterAlive(encounter: EncounterAccount): boolean {
  return encounter.health > 0n;
}

/** Check if encounter has despawned */
export function isEncounterDespawned(encounter: EncounterAccount, nowSeconds: number): boolean {
  return nowSeconds >= Number(encounter.despawnAt);
}

/** Check if player has already attacked this encounter */
export function hasPlayerAttacked(encounter: EncounterAccount, player: Address): boolean {
  return encounter.attackers.some((p) => p === player);
}

/** Get health percentage (0-100) */
export function getEncounterHealthPercent(encounter: EncounterAccount): number {
  if (encounter.maxHealth === 0n) return 0;
  return Number((encounter.health * 100n) / encounter.maxHealth);
}
