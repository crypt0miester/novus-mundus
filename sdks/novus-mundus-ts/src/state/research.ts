/**
 * Research Accounts
 *
 * ResearchTemplate - DAO controlled configuration for each research node (32 bytes)
 * ResearchProgress - Per-player research state (144 bytes)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import { ByteReader } from '../utils/deserialize';

// Research Template Interface

export interface ResearchTemplateAccount {
  researchType: number;
  category: number;
  maxLevel: number;
  baseTimeSeconds: number;
  baseNoviCost: bigint;
  buffType: number;
  buffPerLevelBps: number;
  prerequisiteResearch: number;
  prerequisiteLevel: number;
  gemCostPerMinute: number;
  isActive: boolean;
}

/** ResearchTemplate size in bytes (repr(C) layout with alignment padding) */
export const RESEARCH_TEMPLATE_SIZE = 32;

// Research Progress Interface

export interface ResearchProgressAccount {
  player: PublicKey;
  currentResearch: number;
  currentLevel: number;
  startedAt: bigint;
  completesAt: bigint;
  completedLevels: number[];
  totalGemsSpent: bigint;
  totalNoviSpent: bigint;
  buffCacheVersion: number;

  // Economy Research Buffs
  productionEfficiencyBps: number;
  resourceCapacityBps: number;
  marketTaxReductionBps: number;
  tradeSpeedBps: number;
  miningOutputBps: number;
  cashGenerationBps: number;
  constructionSpeedBps: number;
  upkeepReductionBps: number;
  blackMarketLevel: number;
  taxCollectionBps: number;

  // Growth Buffs
  fishingEfficiencyBps: number;
  fragmentDropRateBps: number;
  gemDropRateBps: number;

  // Ascension System
  ascendedNodes: number;
  totalAscensions: number;

  bump: number;
}

/** ResearchProgress size in bytes (repr(C) layout with alignment padding) */
export const RESEARCH_PROGRESS_SIZE = 144;

// Deserialization

/** Deserialize ResearchTemplate from raw bytes */
export function deserializeResearchTemplate(data: Uint8Array): ResearchTemplateAccount {
  const reader = new ByteReader(data);

  reader.readU8(); // account_key discriminator
  const researchType = reader.readU8();
  const category = reader.readU8();
  const maxLevel = reader.readU8();
  const baseTimeSeconds = reader.readU32();
  const baseNoviCost = reader.readU64();
  const buffType = reader.readU8();
  reader.skip(1); // implicit padding for u16 alignment (offset 17 -> 18)
  const buffPerLevelBps = reader.readU16();
  const prerequisiteResearch = reader.readU8();
  const prerequisiteLevel = reader.readU8();
  const gemCostPerMinute = reader.readU16();
  const isActive = reader.readBool();
  reader.skip(5); // _padding

  return {
    researchType,
    category,
    maxLevel,
    baseTimeSeconds,
    baseNoviCost,
    buffType,
    buffPerLevelBps,
    prerequisiteResearch,
    prerequisiteLevel,
    gemCostPerMinute,
    isActive,
  };
}

/** Deserialize ResearchProgress from raw bytes */
export function deserializeResearchProgress(data: Uint8Array): ResearchProgressAccount {
  const reader = new ByteReader(data);

  reader.readU8(); // account_key discriminator
  const player = reader.readPubkey();
  const currentResearch = reader.readU8();
  const currentLevel = reader.readU8();
  reader.skip(5); // implicit padding for i64 alignment (offset 35 -> 40)
  const startedAt = reader.readI64();
  const completesAt = reader.readI64();

  // completed_levels: [u8; 30]
  const completedLevels: number[] = [];
  for (let i = 0; i < 30; i++) {
    completedLevels.push(reader.readU8());
  }

  reader.skip(2); // implicit padding for u64 alignment (offset 86 -> 88)
  const totalGemsSpent = reader.readU64();
  const totalNoviSpent = reader.readU64();
  const buffCacheVersion = reader.readU32();

  // Economy Research Buffs
  const productionEfficiencyBps = reader.readU16();
  const resourceCapacityBps = reader.readU16();
  const marketTaxReductionBps = reader.readU16();
  const tradeSpeedBps = reader.readU16();
  const miningOutputBps = reader.readU16();
  const cashGenerationBps = reader.readU16();
  const constructionSpeedBps = reader.readU16();
  const upkeepReductionBps = reader.readU16();
  const blackMarketLevel = reader.readU16();
  const taxCollectionBps = reader.readU16();

  // Growth Buffs
  const fishingEfficiencyBps = reader.readU16();
  const fragmentDropRateBps = reader.readU16();
  const gemDropRateBps = reader.readU16();

  reader.skip(2); // implicit padding for u32 alignment (offset 134 -> 136)

  // Ascension System
  const ascendedNodes = reader.readU32();
  const totalAscensions = reader.readU8();
  const bump = reader.readU8();
  reader.skip(1); // _padding

  return {
    player,
    currentResearch,
    currentLevel,
    startedAt,
    completesAt,
    completedLevels,
    totalGemsSpent,
    totalNoviSpent,
    buffCacheVersion,
    productionEfficiencyBps,
    resourceCapacityBps,
    marketTaxReductionBps,
    tradeSpeedBps,
    miningOutputBps,
    cashGenerationBps,
    constructionSpeedBps,
    upkeepReductionBps,
    blackMarketLevel,
    taxCollectionBps,
    fishingEfficiencyBps,
    fragmentDropRateBps,
    gemDropRateBps,
    ascendedNodes,
    totalAscensions,
    bump,
  };
}

// Parse Functions

/** Parse ResearchTemplate from account info */
export function parseResearchTemplate(accountInfo: AccountInfo<Uint8Array>): ResearchTemplateAccount | null {
  if (!accountInfo.data || accountInfo.data.length < RESEARCH_TEMPLATE_SIZE) {
    return null;
  }
  return deserializeResearchTemplate(accountInfo.data);
}

/** Parse ResearchProgress from account info */
export function parseResearchProgress(accountInfo: AccountInfo<Uint8Array>): ResearchProgressAccount | null {
  if (!accountInfo.data || accountInfo.data.length < RESEARCH_PROGRESS_SIZE) {
    return null;
  }
  return deserializeResearchProgress(accountInfo.data);
}

// Helper Functions

/** Check if currently researching */
export function isResearching(progress: ResearchProgressAccount): boolean {
  return progress.currentResearch !== 255;
}

/** Check if research is complete and ready to claim */
export function isResearchComplete(progress: ResearchProgressAccount, nowSeconds: number): boolean {
  return isResearching(progress) && nowSeconds >= Number(progress.completesAt);
}

/** Get level of a specific research node */
export function getResearchLevel(progress: ResearchProgressAccount, researchType: number): number {
  if (researchType < 0 || researchType >= 30) return 0;
  return progress.completedLevels[researchType] ?? 0;
}

/** Check if a research node is ascended */
export function isResearchAscended(progress: ResearchProgressAccount, researchType: number): boolean {
  if (researchType < 0 || researchType >= 30) return false;
  return (progress.ascendedNodes & (1 << researchType)) !== 0;
}

/** Check if prerequisites are met for a research template */
export function checkResearchPrerequisites(
  progress: ResearchProgressAccount,
  template: ResearchTemplateAccount,
): boolean {
  if (template.prerequisiteResearch === 255) return true;
  const prereqLevel = getResearchLevel(progress, template.prerequisiteResearch);
  return prereqLevel >= template.prerequisiteLevel;
}
