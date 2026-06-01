/**
 * CraftedEquipmentAccount
 *
 * The player's forge state: per-type quality-count inventories, the active
 * staged-tempering craft (if any), lifetime stats, and the equipped tier per
 * slot. repr(C) packed struct, fixed 224 bytes (see
 * programs/novus_mundus/src/state/estate.rs `CraftedEquipmentAccount`). u64/i64
 * are read as native bigint.
 */

import type { AccountInfo, PublicKey } from '@solana/web3.js';
import { BufferReader } from '../utils/deserialize';
import { EquipmentSlot } from '../types/enums';

/** `active_craft_equipment` sentinel for "no craft in progress". */
export const NO_ACTIVE_CRAFT = 255;

/** Number of quality tiers tracked per equipment type (Common..Divine). */
export const QUALITY_TIER_COUNT = 8;

export interface CraftedEquipmentAccount {
  owner: PublicKey;
  /** Owned item counts per quality tier (index 0..7), one array per slot. */
  meleeWeapons: number[];
  rangedWeapons: number[];
  siegeWeapons: number[];
  armor: number[];

  // Active staged-tempering craft (active when activeCraftEquipment !== 255).
  /** EquipmentSlot being crafted, or 255 when idle. */
  activeCraftEquipment: number;
  /** Quality tier being crafted toward. */
  targetTier: number;
  /** Total tempering stages this craft needs. */
  stagesRequired: number;
  /** 1-indexed stage currently awaiting a strike (0 = not started). */
  currentStage: number;
  /** Stages successfully struck so far. */
  stagesCompleted: number;
  /** Unix seconds: current strike window opens. */
  windowOpensAt: bigint;
  /** Unix seconds: current strike window closes (miss it and the craft fails). */
  windowClosesAt: bigint;
  /** Unix seconds: when this craft was started. */
  craftStartedAt: bigint;
  /** Accumulated precision score (0..10000 avg per stage). */
  precisionScore: number;

  // Lifetime stats.
  totalCrafts: number;
  successfulCrafts: number;
  failedCrafts: number;
  totalNoviSpent: bigint;

  // Equipped tier per slot (0 = none, 1..7 = QualityTier).
  activeMeleeTier: number;
  activeRangedTier: number;
  activeSiegeTier: number;
  activeArmorTier: number;

  bump: number;
}

/** Decode raw account data into a CraftedEquipmentAccount. */
export function deserializeCraftedEquipment(data: Uint8Array): CraftedEquipmentAccount {
  const r = new BufferReader(data);

  const owner = r.readPubkey(); // 32
  const meleeWeapons = r.readU32Array(QUALITY_TIER_COUNT); // 32
  const rangedWeapons = r.readU32Array(QUALITY_TIER_COUNT); // 32
  const siegeWeapons = r.readU32Array(QUALITY_TIER_COUNT); // 32
  const armor = r.readU32Array(QUALITY_TIER_COUNT); // 32

  const activeCraftEquipment = r.readU8();
  const targetTier = r.readU8();
  const stagesRequired = r.readU8();
  const currentStage = r.readU8();
  const stagesCompleted = r.readU8();
  r.skip(3); // pad to i64 alignment

  const windowOpensAt = r.readI64();
  const windowClosesAt = r.readI64();
  const craftStartedAt = r.readI64();
  const precisionScore = r.readU16();
  r.skip(2); // pad to u32 alignment

  const totalCrafts = r.readU32();
  const successfulCrafts = r.readU32();
  const failedCrafts = r.readU32();
  const totalNoviSpent = r.readU64();

  const activeMeleeTier = r.readU8();
  const activeRangedTier = r.readU8();
  const activeSiegeTier = r.readU8();
  const activeArmorTier = r.readU8();
  const bump = r.readU8();

  return {
    owner,
    meleeWeapons,
    rangedWeapons,
    siegeWeapons,
    armor,
    activeCraftEquipment,
    targetTier,
    stagesRequired,
    currentStage,
    stagesCompleted,
    windowOpensAt,
    windowClosesAt,
    craftStartedAt,
    precisionScore,
    totalCrafts,
    successfulCrafts,
    failedCrafts,
    totalNoviSpent,
    activeMeleeTier,
    activeRangedTier,
    activeSiegeTier,
    activeArmorTier,
    bump,
  };
}

/** Convenience: decode from an AccountInfo, or null when the account is absent. */
export function tryDeserializeCraftedEquipment(
  info: AccountInfo<Uint8Array> | null,
): CraftedEquipmentAccount | null {
  if (!info?.data || info.data.length === 0) return null;
  return deserializeCraftedEquipment(info.data);
}

/** True when a staged-tempering craft is in progress. */
export function isCrafting(c: CraftedEquipmentAccount): boolean {
  return c.activeCraftEquipment !== NO_ACTIVE_CRAFT;
}

/** Owned counts-per-tier array for a given EquipmentSlot. */
export function ownedCountsForSlot(
  c: CraftedEquipmentAccount,
  slot: EquipmentSlot | number,
): number[] {
  switch (slot) {
    case EquipmentSlot.MeleeWeapon:
      return c.meleeWeapons;
    case EquipmentSlot.RangedWeapon:
      return c.rangedWeapons;
    case EquipmentSlot.SiegeWeapon:
      return c.siegeWeapons;
    case EquipmentSlot.Armor:
      return c.armor;
    default:
      return [];
  }
}

/** Currently-equipped tier (0 = none) for a given EquipmentSlot. */
export function equippedTierForSlot(
  c: CraftedEquipmentAccount,
  slot: EquipmentSlot | number,
): number {
  switch (slot) {
    case EquipmentSlot.MeleeWeapon:
      return c.activeMeleeTier;
    case EquipmentSlot.RangedWeapon:
      return c.activeRangedTier;
    case EquipmentSlot.SiegeWeapon:
      return c.activeSiegeTier;
    case EquipmentSlot.Armor:
      return c.activeArmorTier;
    default:
      return 0;
  }
}
