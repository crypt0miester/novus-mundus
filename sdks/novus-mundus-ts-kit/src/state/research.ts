/**
 * Research Accounts
 *
 * ResearchTemplate - DAO controlled configuration for each research node (32 bytes)
 * ResearchProgress - Per-player research state (144 bytes)
 */

import type { Address } from '@solana/kit';
import { reprC, pad, u8, u16, u32, u64, i64, bool, pubkey, array } from '../utils/codec';

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
  player: Address;
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

// Codecs

/** ResearchTemplate `#[repr(C)]` codec (leading byte is the account-key discriminator) */
const researchTemplateCodec = reprC<ResearchTemplateAccount>([
  pad(1), // account_key discriminator
  ['researchType', u8],
  ['category', u8],
  ['maxLevel', u8],
  ['baseTimeSeconds', u32],
  ['baseNoviCost', u64],
  ['buffType', u8],
  ['buffPerLevelBps', u16],
  ['prerequisiteResearch', u8],
  ['prerequisiteLevel', u8],
  ['gemCostPerMinute', u16],
  ['isActive', bool],
  pad(5), // _padding
], RESEARCH_TEMPLATE_SIZE);

/** ResearchProgress `#[repr(C)]` codec */
const researchProgressCodec = reprC<ResearchProgressAccount>([
  pad(1), // account_key discriminator
  ['player', pubkey],
  ['currentResearch', u8],
  ['currentLevel', u8],
  ['startedAt', i64],
  ['completesAt', i64],
  ['completedLevels', array(u8, 30)],
  ['totalGemsSpent', u64],
  ['totalNoviSpent', u64],
  ['buffCacheVersion', u32],
  ['productionEfficiencyBps', u16],
  ['resourceCapacityBps', u16],
  ['marketTaxReductionBps', u16],
  ['tradeSpeedBps', u16],
  ['miningOutputBps', u16],
  ['cashGenerationBps', u16],
  ['constructionSpeedBps', u16],
  ['upkeepReductionBps', u16],
  ['blackMarketLevel', u16],
  ['taxCollectionBps', u16],
  ['fishingEfficiencyBps', u16],
  ['fragmentDropRateBps', u16],
  ['gemDropRateBps', u16],
  ['ascendedNodes', u32],
  ['totalAscensions', u8],
  ['bump', u8],
  pad(1), // _padding
], RESEARCH_PROGRESS_SIZE);

// Deserialization

/** Deserialize ResearchTemplate from raw bytes */
export function deserializeResearchTemplate(data: Uint8Array): ResearchTemplateAccount {
  return researchTemplateCodec.decode(data);
}

/** Deserialize ResearchProgress from raw bytes */
export function deserializeResearchProgress(data: Uint8Array): ResearchProgressAccount {
  return researchProgressCodec.decode(data);
}

// Parse Functions

/** Parse ResearchTemplate from account info */
export function parseResearchTemplate(accountInfo: { data: Uint8Array }): ResearchTemplateAccount | null {
  if (!accountInfo.data || accountInfo.data.length < RESEARCH_TEMPLATE_SIZE) {
    return null;
  }
  return deserializeResearchTemplate(accountInfo.data);
}

/** Parse ResearchProgress from account info */
export function parseResearchProgress(accountInfo: { data: Uint8Array }): ResearchProgressAccount | null {
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
