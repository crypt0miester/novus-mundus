/**
 * Building Template Account
 *
 * BuildingTemplate - DAO-controlled build/upgrade cost & time configuration
 * for one BuildingType (32 bytes). One PDA per building type, so build/upgrade
 * costs are tunable from chain instead of hardcoded in the program.
 */

import type { AccountInfo } from '@solana/web3.js';
import { ByteReader } from '../utils/deserialize';

// Building Template Interface

export interface BuildingTemplateAccount {
  buildingType: number;
  /** Tier 1-3 (informational) */
  tier: number;
  maxLevel: number;
  /** Base construction time in seconds (a level-0 build) */
  baseTimeSeconds: number;
  /** Base NOVI cost (a level-0 build) */
  baseNoviCost: bigint;
  /** Per-level cost growth, in bps of 10_000 (26_180 = x2.618) */
  costGrowthBps: number;
  /** Per-(level/5) time growth, in bps of 10_000 */
  timeGrowthBps: number;
  isActive: boolean;
}

/** BuildingTemplate size in bytes (repr(C) layout, no hidden padding) */
export const BUILDING_TEMPLATE_SIZE = 32;

// Deserialization

/** Deserialize BuildingTemplate from raw bytes */
export function deserializeBuildingTemplate(data: Uint8Array): BuildingTemplateAccount {
  const reader = new ByteReader(data);

  reader.readU8(); // account_key discriminator
  const buildingType = reader.readU8();
  const tier = reader.readU8();
  const maxLevel = reader.readU8();
  const baseTimeSeconds = reader.readU32();
  const baseNoviCost = reader.readU64();
  const costGrowthBps = reader.readU16();
  const timeGrowthBps = reader.readU16();
  const isActive = reader.readBool();
  // bump (u8) + _padding[10] follow — not surfaced

  return {
    buildingType,
    tier,
    maxLevel,
    baseTimeSeconds,
    baseNoviCost,
    costGrowthBps,
    timeGrowthBps,
    isActive,
  };
}

/** Parse a BuildingTemplate account, or null if the data is too small. */
export function parseBuildingTemplate(
  accountInfo: AccountInfo<Uint8Array>
): BuildingTemplateAccount | null {
  if (!accountInfo.data || accountInfo.data.length < BUILDING_TEMPLATE_SIZE) {
    return null;
  }
  return deserializeBuildingTemplate(accountInfo.data);
}
