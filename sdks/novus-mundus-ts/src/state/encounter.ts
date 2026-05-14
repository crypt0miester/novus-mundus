/**
 * EncounterAccount
 *
 * PvE encounter with dynamic attacker list.
 * Base size: 120 bytes + 32 bytes per attacker
 */

import { PublicKey, type AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize';
import { EncounterType } from '../types/enums';

// Encounter Account Interface

export interface EncounterAccount {
  id: BN;
  cityId: number;
  level: number;
  rarity: EncounterType;
  locationLat: number;
  locationLong: number;
  spawnedAt: BN;
  despawnAt: BN;
  health: BN;
  maxHealth: BN;
  defense: number;
  attackerCount: number;
  bump: number;
  /** Attackers are read dynamically from account data */
  attackers: PublicKey[];
}

/** EncounterAccount base size in bytes (without attackers) */
export const ENCOUNTER_ACCOUNT_BASE_SIZE = 120;

/** Calculate total encounter account size */
export function calculateEncounterAccountSize(attackerCount: number): number {
  return ENCOUNTER_ACCOUNT_BASE_SIZE + attackerCount * 32;
}

// Deserialization

/** Deserialize EncounterAccount from raw bytes */
export function deserializeEncounter(data: Uint8Array | Buffer): EncounterAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  reader.skip(32); // game_engine (Pubkey, not in interface)
  reader.skip(7); // implicit padding for u64 alignment (offset 33 -> 40)
  const id = reader.readU64();
  const cityId = reader.readU16();
  const level = reader.readU8();
  const rarityValue = reader.readU8();
  const rarity = rarityValue as EncounterType;
  reader.skip(4); // padding

  const locationLat = reader.readF64();
  const locationLong = reader.readF64();
  const spawnedAt = reader.readI64();
  const despawnAt = reader.readI64();
  const health = reader.readU64();
  const maxHealth = reader.readU64();
  const defense = reader.readU32();
  reader.skip(4); // padding

  const attackerCount = reader.readU8();
  const bump = reader.readU8();
  reader.skip(6); // padding

  // Read attackers dynamically
  const attackers: PublicKey[] = [];
  for (let i = 0; i < attackerCount; i++) {
    attackers.push(reader.readPubkey());
  }

  return {
    id,
    cityId,
    level,
    rarity,
    locationLat,
    locationLong,
    spawnedAt,
    despawnAt,
    health,
    maxHealth,
    defense,
    attackerCount,
    bump,
    attackers,
  };
}

/** Parse EncounterAccount from account info */
export function parseEncounter(accountInfo: AccountInfo<Buffer>): EncounterAccount | null {
  if (!accountInfo.data || accountInfo.data.length < ENCOUNTER_ACCOUNT_BASE_SIZE) {
    return null;
  }
  return deserializeEncounter(accountInfo.data);
}

// Helper Functions

/** Check if encounter is alive */
export function isEncounterAlive(encounter: EncounterAccount): boolean {
  return encounter.health.gtn(0);
}

/** Check if encounter has despawned */
export function isEncounterDespawned(encounter: EncounterAccount, nowSeconds: number): boolean {
  return nowSeconds >= encounter.despawnAt.toNumber();
}

/** Check if player has already attacked this encounter */
export function hasPlayerAttacked(encounter: EncounterAccount, player: PublicKey): boolean {
  return encounter.attackers.some((p) => p.equals(player));
}

/** Get health percentage (0-100) */
export function getEncounterHealthPercent(encounter: EncounterAccount): number {
  if (encounter.maxHealth.isZero()) return 0;
  return encounter.health.muln(100).div(encounter.maxHealth).toNumber();
}
