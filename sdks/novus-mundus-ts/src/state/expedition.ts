/**
 * ExpeditionAccount
 *
 * Temporary PDA for active mining/fishing expeditions.
 * Size: 112 bytes
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize';
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
  player: PublicKey;
  heroMint: PublicKey;
  expeditionType: ExpeditionType;
  tier: number;
  strikes: number;
  bump: number;
  score: number;
  cityId: number;
  startTime: BN;
  operativeUnit1: BN;
  operativeUnit2: BN;
  operativeUnit3: BN;
}

/** ExpeditionAccount size in bytes */
export const EXPEDITION_ACCOUNT_SIZE = 112;

// Deserialization

/** Deserialize ExpeditionAccount from raw bytes */
export function deserializeExpedition(data: Uint8Array | Buffer): ExpeditionAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key discriminator
  const player = reader.readPubkey();
  const heroMint = reader.readPubkey();
  const expeditionTypeValue = reader.readU8();
  const expeditionType = expeditionTypeValue as ExpeditionType;
  const tier = reader.readU8();
  const strikes = reader.readU8();
  const bump = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment (offset 69 -> 70)
  const score = reader.readU16();
  const cityId = reader.readU16();
  reader.skip(6); // implicit padding for i64 alignment (offset 74 -> 80)
  const startTime = reader.readI64();
  const operativeUnit1 = reader.readU64();
  const operativeUnit2 = reader.readU64();
  const operativeUnit3 = reader.readU64();

  return {
    player,
    heroMint,
    expeditionType,
    tier,
    strikes,
    bump,
    score,
    cityId,
    startTime,
    operativeUnit1,
    operativeUnit2,
    operativeUnit3,
  };
}

/** Parse ExpeditionAccount from account info */
export function parseExpedition(accountInfo: AccountInfo<Buffer>): ExpeditionAccount | null {
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
export function getExpeditionTotalOperatives(expedition: ExpeditionAccount): BN {
  return expedition.operativeUnit1.add(expedition.operativeUnit2).add(expedition.operativeUnit3);
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
  return expedition.startTime.toNumber() + getExpeditionDurationSeconds(expedition);
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
  return expedition.startTime.toNumber() + expedition.strikes * SECONDS_PER_HOUR;
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
