/**
 * ReinforcementAccount
 *
 * Tracks units/weapons/hero sent to defend another player or castle.
 * Size: 256 bytes
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, pad, u8, u16, u32, u64, i32, i64, bool, pubkey } from '../utils/codec';
import { ReinforcementStatus } from '../types/enums';

// Reinforcement Target Type

export enum ReinforcementTargetType {
  Player = 0,
  Castle = 1,
}

// Reinforcement Account Interface

export interface ReinforcementAccount {
  // Identity
  sender: Address;
  destination: Address;

  // Type & Location
  destinationType: ReinforcementTargetType;
  bump: number;
  senderCity: number;
  destinationCity: number;

  // Units sent
  unitsDef1: bigint;
  unitsDef2: bigint;
  unitsDef3: bigint;

  // Weapons sent
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;

  // Hero
  hero: Address;
  heroDefenseBps: number;
  heroWeaponEffBps: number;
  heroArmorEffBps: number;

  // Travel timing
  sentAt: bigint;
  travelDuration: number;
  arrivesAt: bigint;

  // Return timing
  returnStartedAt: bigint;
  returnDuration: number;

  // Wounded tracking (set during recall, transferred to estate on return)
  woundedDef1: number;
  woundedDef2: number;
  woundedDef3: number;

  // Status
  status: ReinforcementStatus;
  relievedByDestination: boolean;

  // Stats
  combatsParticipated: bigint;
}

/** ReinforcementAccount size in bytes (repr(C) layout including account_key + game_engine) */
export const REINFORCEMENT_ACCOUNT_SIZE = 256;

// Codec

/** ReinforcementAccount `#[repr(C)]` codec */
const reinforcementCodec = reprC<ReinforcementAccount>([
  pad(1), // account_key discriminator
  pad(32), // game_engine (not in interface)
  ['sender', pubkey],
  ['destination', pubkey],
  ['destinationType', u8],
  ['bump', u8],
  ['senderCity', u16],
  ['destinationCity', u16],
  pad(2), // explicit _padding_loc
  ['unitsDef1', u64],
  ['unitsDef2', u64],
  ['unitsDef3', u64],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['hero', pubkey],
  ['heroDefenseBps', u16],
  ['heroWeaponEffBps', u16],
  ['heroArmorEffBps', u16],
  ['sentAt', i64],
  ['travelDuration', i32],
  ['woundedDef1', u32],
  ['arrivesAt', i64],
  ['returnStartedAt', i64],
  ['returnDuration', i32],
  ['woundedDef2', u32],
  ['status', u8],
  ['relievedByDestination', bool],
  ['woundedDef3', u32],
  ['combatsParticipated', u64],
], REINFORCEMENT_ACCOUNT_SIZE);

// Deserialization

/** Deserialize ReinforcementAccount from raw bytes */
export function deserializeReinforcement(data: Uint8Array): ReinforcementAccount {
  return reinforcementCodec.decode(data);
}

/** Parse ReinforcementAccount from account info */
export function parseReinforcement(accountInfo: { data: Uint8Array }): ReinforcementAccount | null {
  if (!accountInfo.data || accountInfo.data.length < REINFORCEMENT_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeReinforcement(accountInfo.data);
}

// Helper Functions

/** Get total units sent */
export function getReinforcementTotalUnits(r: ReinforcementAccount): bigint {
  return (r.unitsDef1 + r.unitsDef2 + r.unitsDef3);
}

/** Get total weapons sent */
export function getReinforcementTotalWeapons(r: ReinforcementAccount): bigint {
  return (r.meleeWeapons + r.rangedWeapons + r.siegeWeapons);
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
  return nowSeconds >= Number(r.arrivesAt);
}

/** Check if reinforcement has returned to sender */
export function hasReinforcementReturned(r: ReinforcementAccount, nowSeconds: number): boolean {
  if (Number(r.returnStartedAt) === 0) {
    return false;
  }
  return nowSeconds >= Number(r.returnStartedAt) + r.returnDuration;
}

/** Get return completion timestamp */
export function getReinforcementReturnCompletesAt(r: ReinforcementAccount): number {
  return Number(r.returnStartedAt) + r.returnDuration;
}
