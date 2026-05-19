/**
 * ExpeditionAccount
 *
 * Temporary PDA for active mining/fishing expeditions.
 * Size: 112 bytes
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, pad, u8, u16, u64, i64, pubkey } from '../utils/codec';
import { ExpeditionType } from '../types/enums';
import {
  MINING_DURATION_HOURS,
  FISHING_DURATION_HOURS,
  SECONDS_PER_HOUR,
} from '../constants';

// Mining/Fishing Tiers

export enum MiningTier {
  Surface = 0,
  Shallow = 1,
  Deep = 2,
  Volcanic = 3,
  Abyssal = 4,
}

export enum FishingTier {
  Shore = 0,
  River = 1,
  Lake = 2,
  DeepSea = 3,
  Abyss = 4,
}

// Expedition Account Interface

export interface ExpeditionAccount {
  player: Address;
  heroMint: Address;
  expeditionType: ExpeditionType;
  tier: number;
  strikes: number;
  bump: number;
  score: number;
  cityId: number;
  startTime: bigint;
  operativeUnit1: bigint;
  operativeUnit2: bigint;
  operativeUnit3: bigint;
}

/** ExpeditionAccount size in bytes */
export const EXPEDITION_ACCOUNT_SIZE = 112;

// Codec

/** ExpeditionAccount `#[repr(C)]` codec */
const expeditionCodec = reprC<ExpeditionAccount>([
  pad(1), // account_key discriminator
  ['player', pubkey],
  ['heroMint', pubkey],
  ['expeditionType', u8],
  ['tier', u8],
  ['strikes', u8],
  ['bump', u8],
  ['score', u16],
  ['cityId', u16],
  ['startTime', i64],
  ['operativeUnit1', u64],
  ['operativeUnit2', u64],
  ['operativeUnit3', u64],
], EXPEDITION_ACCOUNT_SIZE);

// Deserialization

/** Deserialize ExpeditionAccount from raw bytes */
export function deserializeExpedition(data: Uint8Array): ExpeditionAccount {
  return expeditionCodec.decode(data);
}

/** Parse ExpeditionAccount from account info */
export function parseExpedition(accountInfo: { data: Uint8Array }): ExpeditionAccount | null {
  if (!accountInfo.data || accountInfo.data.length < EXPEDITION_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeExpedition(accountInfo.data);
}

// Helper Functions

/** Check if expedition has a hero assigned */
export function expeditionHasHero(expedition: ExpeditionAccount): boolean {
  return !isNullPubkey(expedition.heroMint);
}

/** Get total operatives locked */
export function getExpeditionTotalOperatives(expedition: ExpeditionAccount): bigint {
  return (expedition.operativeUnit1 + expedition.operativeUnit2 + expedition.operativeUnit3);
}

/** Get expedition duration in seconds */
export function getExpeditionDurationSeconds(expedition: ExpeditionAccount): number {
  const hours =
    expedition.expeditionType === ExpeditionType.Mining
      ? MINING_DURATION_HOURS[expedition.tier] ?? 1
      : FISHING_DURATION_HOURS[expedition.tier] ?? 1;
  return hours * SECONDS_PER_HOUR;
}

/** Get expedition end time */
export function getExpeditionEndTime(expedition: ExpeditionAccount): number {
  return Number(expedition.startTime) + getExpeditionDurationSeconds(expedition);
}

/** Check if expedition is complete */
export function isExpeditionComplete(expedition: ExpeditionAccount, nowSeconds: number): boolean {
  return nowSeconds >= getExpeditionEndTime(expedition);
}

/** Get maximum strikes allowed */
export function getExpeditionMaxStrikes(expedition: ExpeditionAccount): number {
  return expedition.expeditionType === ExpeditionType.Mining
    ? MINING_DURATION_HOURS[expedition.tier] ?? 1
    : FISHING_DURATION_HOURS[expedition.tier] ?? 1;
}

/** Check if another strike can be performed */
export function canExpeditionStrike(expedition: ExpeditionAccount): boolean {
  return expedition.strikes < getExpeditionMaxStrikes(expedition);
}

/** Get next strike window time */
export function getExpeditionNextStrikeTime(expedition: ExpeditionAccount): number {
  return Number(expedition.startTime) + expedition.strikes * SECONDS_PER_HOUR;
}

/** Check if strike is ready */
export function isExpeditionStrikeReady(expedition: ExpeditionAccount, nowSeconds: number): boolean {
  return canExpeditionStrike(expedition) && nowSeconds >= getExpeditionNextStrikeTime(expedition);
}

/** Get average score */
export function getExpeditionAverageScore(expedition: ExpeditionAccount): number {
  if (expedition.strikes === 0) return 0;
  return Math.min(100, Math.floor(expedition.score / expedition.strikes));
}

/** Check if mining expedition */
export function isExpeditionMining(expedition: ExpeditionAccount): boolean {
  return expedition.expeditionType === ExpeditionType.Mining;
}

/** Check if fishing expedition */
export function isExpeditionFishing(expedition: ExpeditionAccount): boolean {
  return expedition.expeditionType === ExpeditionType.Fishing;
}
