/**
 * ReinforcementAccount
 *
 * Tracks units/weapons/hero sent to defend another player or castle.
 * Size: 256 bytes
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize';
import { ReinforcementStatus } from '../types/enums';

// ============================================================
// Reinforcement Target Type
// ============================================================

export enum ReinforcementTargetType {
  Player = 0,
  Castle = 1,
}

// ============================================================
// Reinforcement Account Interface
// ============================================================

export interface ReinforcementAccount {
  // Identity
  sender: PublicKey;
  destination: PublicKey;

  // Type & Location
  destinationType: ReinforcementTargetType;
  bump: number;
  senderCity: number;
  destinationCity: number;

  // Units sent
  unitsDef1: BN;
  unitsDef2: BN;
  unitsDef3: BN;

  // Weapons sent
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;

  // Hero
  hero: PublicKey;
  heroDefenseBps: number;
  heroWeaponEffBps: number;
  heroArmorEffBps: number;

  // Travel timing
  sentAt: BN;
  travelDuration: number;
  arrivesAt: BN;

  // Return timing
  returnStartedAt: BN;
  returnDuration: number;

  // Wounded tracking (set during recall, transferred to estate on return)
  woundedDef1: number;
  woundedDef2: number;
  woundedDef3: number;

  // Status
  status: ReinforcementStatus;
  relievedByDestination: boolean;

  // Stats
  combatsParticipated: BN;
}

/** ReinforcementAccount size in bytes (repr(C) layout including account_key + game_engine) */
export const REINFORCEMENT_ACCOUNT_SIZE = 256;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize ReinforcementAccount from raw bytes */
export function deserializeReinforcement(data: Uint8Array | Buffer): ReinforcementAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator

  // Kingdom Reference (32 bytes)
  reader.readPubkey(); // game_engine (skip, not in interface)

  // Identity (64 bytes)
  const sender = reader.readPubkey();
  const destination = reader.readPubkey();

  // Type & Location
  const destinationTypeValue = reader.readU8();
  const destinationType = destinationTypeValue as ReinforcementTargetType;
  const bump = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment (offset 99 -> 100)
  const senderCity = reader.readU16();
  const destinationCity = reader.readU16();
  reader.skip(2); // explicit _padding_loc
  reader.skip(6); // implicit padding for u64 alignment (offset 106 -> 112)

  // Units (24 bytes)
  const unitsDef1 = reader.readU64();
  const unitsDef2 = reader.readU64();
  const unitsDef3 = reader.readU64();

  // Weapons (24 bytes)
  const meleeWeapons = reader.readU64();
  const rangedWeapons = reader.readU64();
  const siegeWeapons = reader.readU64();

  // Hero (40 bytes)
  const hero = reader.readPubkey();
  const heroDefenseBps = reader.readU16();
  const heroWeaponEffBps = reader.readU16();
  const heroArmorEffBps = reader.readU16();
  reader.skip(2); // padding

  // Travel timing (24 bytes)
  const sentAt = reader.readI64();
  const travelDuration = reader.readI32();
  const woundedDef1 = reader.readU32(); // was padding
  const arrivesAt = reader.readI64();

  // Return timing (16 bytes)
  const returnStartedAt = reader.readI64();
  const returnDuration = reader.readI32();
  const woundedDef2 = reader.readU32(); // was padding

  // Status (8 bytes)
  const statusValue = reader.readU8();
  const status = statusValue as ReinforcementStatus;
  const relievedByDestination = reader.readBool();
  reader.skip(2); // padding
  const woundedDef3 = reader.readU32(); // was padding

  // Stats (8 bytes)
  const combatsParticipated = reader.readU64();

  return {
    sender,
    destination,
    destinationType,
    bump,
    senderCity,
    destinationCity,
    unitsDef1,
    unitsDef2,
    unitsDef3,
    meleeWeapons,
    rangedWeapons,
    siegeWeapons,
    hero,
    heroDefenseBps,
    heroWeaponEffBps,
    heroArmorEffBps,
    sentAt,
    travelDuration,
    arrivesAt,
    returnStartedAt,
    returnDuration,
    woundedDef1,
    woundedDef2,
    woundedDef3,
    status,
    relievedByDestination,
    combatsParticipated,
  };
}

/** Parse ReinforcementAccount from account info */
export function parseReinforcement(accountInfo: AccountInfo<Buffer>): ReinforcementAccount | null {
  if (!accountInfo.data || accountInfo.data.length < REINFORCEMENT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeReinforcement(accountInfo.data);
}

// ============================================================
// Helper Functions
// ============================================================

/** Get total units sent */
export function getReinforcementTotalUnits(r: ReinforcementAccount): BN {
  return r.unitsDef1.add(r.unitsDef2).add(r.unitsDef3);
}

/** Get total weapons sent */
export function getReinforcementTotalWeapons(r: ReinforcementAccount): BN {
  return r.meleeWeapons.add(r.rangedWeapons).add(r.siegeWeapons);
}

/** Check if reinforcement has hero */
export function reinforcementHasHero(r: ReinforcementAccount): boolean {
  return !isNullPubkey(r.hero);
}

/** Check if reinforcement is traveling */
export function isReinforcementTraveling(r: ReinforcementAccount): boolean {
  return r.status === ReinforcementStatus.Traveling;
}

/** Check if reinforcement is active */
export function isReinforcementActive(r: ReinforcementAccount): boolean {
  return r.status === ReinforcementStatus.Active;
}

/** Check if reinforcement is returning */
export function isReinforcementReturning(r: ReinforcementAccount): boolean {
  return r.status === ReinforcementStatus.Returning;
}

/** Check if reinforcement is completed */
export function isReinforcementCompleted(r: ReinforcementAccount): boolean {
  return r.status === ReinforcementStatus.Completed;
}

/** Check if reinforcement has arrived at destination */
export function hasReinforcementArrived(r: ReinforcementAccount, nowSeconds: number): boolean {
  return nowSeconds >= r.arrivesAt.toNumber();
}

/** Check if reinforcement has returned to sender */
export function hasReinforcementReturned(r: ReinforcementAccount, nowSeconds: number): boolean {
  if (r.returnStartedAt.toNumber() === 0) {
    return false;
  }
  return nowSeconds >= r.returnStartedAt.toNumber() + r.returnDuration;
}

/** Get return completion timestamp */
export function getReinforcementReturnCompletesAt(r: ReinforcementAccount): number {
  return r.returnStartedAt.toNumber() + r.returnDuration;
}
