/**
 * PlayerAccount (PlayerCore)
 *
 * Lean PlayerCore (~528 B) + optional section structs appended after CORE
 * based on the `extensions` bitmap.
 *
 * Section unlock order: RESEARCH → INVENTORY → TEAM → RALLY → HEROES → COSMETICS → COURT
 *
 * For backward compatibility, the deserializer reads any unlocked sections
 * and projects their fields onto the flat `PlayerCore` interface (defaults
 * to 0 / false / NULL_PUBKEY when a section is not present).
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { PublicKey as PK } from '@solana/web3.js';
import BNCtor from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize';
import { TravelType, SubscriptionTier } from '../types/enums';

// Extension Flags

export const ExtensionFlags = {
  RESEARCH: 1 << 0,
  HEROES: 1 << 1,
  INVENTORY: 1 << 2,
  RALLY: 1 << 3,
  TEAM: 1 << 4,
  COSMETICS: 1 << 5,
  COURT: 1 << 6,
} as const;

// Section Sizes & Offsets — must mirror programs/novus_mundus/src/state/player.rs

export const CORE_SIZE = 528;
export const RESEARCH_SIZE = 48;
export const INVENTORY_SIZE = 144;
export const TEAM_SIZE = 112;
export const RALLY_SIZE = 80;
export const HEROES_SIZE = 208;
export const COSMETICS_SIZE = 80;
export const COURT_SIZE = 48;

export const CORE_OFFSET = 0;
export const RESEARCH_OFFSET = CORE_SIZE;
export const INVENTORY_OFFSET = RESEARCH_OFFSET + RESEARCH_SIZE;
export const TEAM_OFFSET = INVENTORY_OFFSET + INVENTORY_SIZE;
export const RALLY_OFFSET = TEAM_OFFSET + TEAM_SIZE;
export const HEROES_OFFSET = RALLY_OFFSET + RALLY_SIZE;
export const COSMETICS_OFFSET = HEROES_OFFSET + HEROES_SIZE;
export const COURT_OFFSET = COSMETICS_OFFSET + COSMETICS_SIZE;
export const MAX_SIZE = COURT_OFFSET + COURT_SIZE;

const NULL_PUBKEY: PublicKey = new PK(new Uint8Array(32));
const BN0 = new BNCtor(0);

// Rally Stats & Caps

export interface RallyStats {
  currentRalliesJoined: number;
  ralliesCreatedToday: number;
  lastRallyCreationReset: BN;
  totalRalliesJoined: BN;
  totalRalliesCreated: BN;
  totalRalliesWon: BN;
  totalRalliesLost: BN;
  totalRallyLootEarned: BN;
  totalRallyDamageDealt: BN;
}

export interface PlayerRallyCaps {
  maxConcurrentRallies: number;
  maxRalliesPerDay: number;
}

function defaultRallyStats(): RallyStats {
  return {
    currentRalliesJoined: 0,
    ralliesCreatedToday: 0,
    lastRallyCreationReset: BN0.clone(),
    totalRalliesJoined: BN0.clone(),
    totalRalliesCreated: BN0.clone(),
    totalRalliesWon: BN0.clone(),
    totalRalliesLost: BN0.clone(),
    totalRallyLootEarned: BN0.clone(),
    totalRallyDamageDealt: BN0.clone(),
  };
}

function defaultRallyCaps(): PlayerRallyCaps {
  return { maxConcurrentRallies: 3, maxRalliesPerDay: 5 };
}

// PlayerCore — lean + projected section fields

export interface PlayerCore {
  // Kingdom Reference
  gameEngine: PublicKey;

  // Identity
  owner: PublicKey;
  createdAt: BN;
  bump: number;
  version: number;

  // Name
  name: string;

  // Extensions bitmap
  extensions: number;

  // Locked NOVI
  lockedNovi: BN;
  lastUpdatedTokensAt: BN;

  // Units
  defensiveUnit1: BN;
  defensiveUnit2: BN;
  defensiveUnit3: BN;
  operativeUnit1: BN;
  operativeUnit2: BN;
  operativeUnit3: BN;

  // Equipment
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
  armorPieces: BN;
  produce: BN;
  vehicles: BN;

  // Cash
  cashOnHand: BN;
  cashInVault: BN;

  // Happiness
  happinessDefensive: number;
  happinessOperative: number;

  // Location
  currentLat: number;
  currentLong: number;
  travelingToLat: number;
  travelingToLong: number;
  arrivalTime: BN;
  currentCity: number;
  travelType: TravelType;
  originCity: number;
  destinationCity: number;
  departureTime: BN;
  travelSpeedLocked: number;

  // Subscription
  subscriptionTier: SubscriptionTier;
  subscriptionEnd: BN;

  // Progression
  level: number;
  currentXp: BN;
  reputation: BN;
  networth: BN;

  // Stamina
  encounterStamina: BN;
  maxEncounterStamina: BN;
  lastStaminaUpdate: BN;

  // Event
  currentEvent: BN;

  // Resources
  gems: BN;
  fragments: BN;

  // Stats
  totalAttacks: BN;
  totalDefenses: BN;
  totalAttackPower: BN;
  totalEncounterAttacks: BN;
  totalLockedNoviAcquired: BN;
  totalSent: BN;
  totalReceived: BN;

  // Protection & Flags
  newPlayerProtectionUntil: BN;
  flaggedByGovernance: boolean;

  // Loot Counter
  lootCounter: BN;

  // === SECTION PROJECTIONS (default 0/false/NULL if section not unlocked) ===

  // Research
  researchAttackBps: number;
  researchDefenseBps: number;
  researchCritChanceBps: number;
  researchCritDamageBps: number;
  researchLootBonusBps: number;
  researchEncounterSuccessBps: number;
  researchSynchronyBonusBps: number;
  researchReputationBonusBps: number;
  researchStaminaBonusBps: number;
  researchCollectionBonusBps: number;
  researchLootMagnetismBps: number;
  researchDailyRewardBps: number;
  hasDailyRewards: boolean;
  hasMining: boolean;
  hasFishing: boolean;
  hasFragmentDrops: boolean;
  hasGemDrops: boolean;
  researchBuffVersion: number;
  lastDailyClaim: BN;

  // Heroes
  activeHeroes: PublicKey[];
  defensiveHeroSlot: number;
  meditatingHeroSlot: number;
  heroAttackBps: number;
  heroDefenseBps: number;
  heroEconomyBps: number;
  heroXpGainBps: number;
  heroTrainingCostReductionBps: number;
  heroCollectionRateBps: number;
  heroRallyCapacityBps: number;
  heroStaminaRegenBps: number;
  heroProduceGenerationBps: number;
  heroWeaponEfficiencyBps: number;
  heroArmorEfficiencyBps: number;
  heroCritChanceBps: number;
  heroEncounterDamageBps: number;
  heroLootBonusBps: number;
  heroSynchronyBonusBps: number;
  heroResourceCapacityBps: number;
  heroUnitCapacityBps: number;
  blessedHeroBonusBps: number;
  slotLocationBonus: number[];
  meditationStartedAt: BN;
  // Ability state
  abilityLastUsedAt: BN[];        // per slot
  pendingEffectKind: number;       // 0=none, else AbilityKind discriminant
  pendingEffectStat: number;       // BuffStat for BuffNext
  pendingEffectParam: number;      // bps for BuffNext
  pendingEffectExpiresAt: BN;      // 0 if not set

  // Team + Reinforcement
  team: PublicKey;
  teamSlotIndex: number;
  reinforcementDef1: BN;
  reinforcementDef2: BN;
  reinforcementDef3: BN;
  reinforcementMelee: BN;
  reinforcementRanged: BN;
  reinforcementSiege: BN;
  reinforcementOriginalUnits: BN;
  reinforcementOriginalWeapons: BN;
  reinforcementHeroDefenseBps: number;
  reinforcementHeroWeaponEffBps: number;
  reinforcementHeroArmorEffBps: number;
  reinforcementSourceCount: number;

  // Inventory: consumables
  staminaPotions: number;
  xpBoosters: number;
  lootMagnets: number;
  shieldTokens: number;
  speedElixirs: number;
  attackBoosters: number;
  defenseBoosters: number;
  collectionBoosters: number;
  rallyHorns: number;
  teleportScrolls: number;
  mysteryKeys: number;
  // Inventory: materials
  commonMaterials: BN;
  uncommonMaterials: BN;
  rareMaterials: BN;
  epicMaterials: BN;
  legendaryMaterials: BN;
  // Inventory: equipped
  equippedWeaponBonusBps: number;
  equippedArmorBonusBps: number;
  // Inventory: shop state
  totalShopSpent: BN;
  milestoneTier: number;
  loyaltyStreak: number;
  dailyPurchaseCount: number;
  flashClaimsToday: number;
  lastPurchaseDay: number;
  lastDailyReset: BN;
  // Inventory: transfer tracking
  dailyTransferCount: number;
  dailyTransferred: BN;
  lastTransferReset: BN;

  // Rally
  rallyCaps: PlayerRallyCaps;
  rallyStats: RallyStats;
}

export type PlayerAccount = PlayerCore;

/** PlayerCore (lean) size in bytes */
export const PLAYER_CORE_SIZE = CORE_SIZE;

// Deserialization

function deserializeRallyStats(reader: BufferReader): RallyStats {
  const currentRalliesJoined = reader.readU8();
  const ralliesCreatedToday = reader.readU8();
  reader.skip(6);
  const lastRallyCreationReset = reader.readI64();
  const totalRalliesJoined = reader.readU64();
  const totalRalliesCreated = reader.readU64();
  const totalRalliesWon = reader.readU64();
  const totalRalliesLost = reader.readU64();
  const totalRallyLootEarned = reader.readU64();
  const totalRallyDamageDealt = reader.readU64();
  reader.skip(8);
  return {
    currentRalliesJoined,
    ralliesCreatedToday,
    lastRallyCreationReset,
    totalRalliesJoined,
    totalRalliesCreated,
    totalRalliesWon,
    totalRalliesLost,
    totalRallyLootEarned,
    totalRallyDamageDealt,
  };
}

function deserializePlayerRallyCaps(reader: BufferReader): PlayerRallyCaps {
  const maxConcurrentRallies = reader.readU8();
  const maxRalliesPerDay = reader.readU8();
  reader.skip(6);
  return { maxConcurrentRallies, maxRalliesPerDay };
}

// Section deserializers

interface ResearchSection {
  researchAttackBps: number;
  researchDefenseBps: number;
  researchCritChanceBps: number;
  researchCritDamageBps: number;
  researchLootBonusBps: number;
  researchEncounterSuccessBps: number;
  researchSynchronyBonusBps: number;
  researchReputationBonusBps: number;
  researchStaminaBonusBps: number;
  researchCollectionBonusBps: number;
  researchLootMagnetismBps: number;
  researchDailyRewardBps: number;
  hasDailyRewards: boolean;
  hasMining: boolean;
  hasFishing: boolean;
  hasFragmentDrops: boolean;
  hasGemDrops: boolean;
  researchBuffVersion: number;
  lastDailyClaim: BN;
}

function deserializeResearchSection(buf: Uint8Array | Buffer): ResearchSection {
  const reader = new BufferReader(buf);
  const researchAttackBps = reader.readU16();
  const researchDefenseBps = reader.readU16();
  const researchCritChanceBps = reader.readU16();
  const researchCritDamageBps = reader.readU16();
  const researchLootBonusBps = reader.readU16();
  const researchEncounterSuccessBps = reader.readU16();
  const researchSynchronyBonusBps = reader.readU16();
  const researchReputationBonusBps = reader.readU16();
  const researchStaminaBonusBps = reader.readU16();
  const researchCollectionBonusBps = reader.readU16();
  const researchLootMagnetismBps = reader.readU16();
  const researchDailyRewardBps = reader.readU16();
  const hasDailyRewards = reader.readBool();
  const hasMining = reader.readBool();
  const hasFishing = reader.readBool();
  const hasFragmentDrops = reader.readBool();
  const hasGemDrops = reader.readBool();
  reader.skip(3);
  const researchBuffVersion = reader.readU32();
  reader.skip(4);
  const lastDailyClaim = reader.readI64();
  return {
    researchAttackBps, researchDefenseBps, researchCritChanceBps, researchCritDamageBps,
    researchLootBonusBps, researchEncounterSuccessBps,
    researchSynchronyBonusBps, researchReputationBonusBps, researchStaminaBonusBps,
    researchCollectionBonusBps, researchLootMagnetismBps, researchDailyRewardBps,
    hasDailyRewards, hasMining, hasFishing, hasFragmentDrops, hasGemDrops,
    researchBuffVersion, lastDailyClaim,
  };
}

interface InventorySection {
  staminaPotions: number; xpBoosters: number; lootMagnets: number; shieldTokens: number;
  speedElixirs: number; attackBoosters: number; defenseBoosters: number; collectionBoosters: number;
  rallyHorns: number; teleportScrolls: number; mysteryKeys: number;
  commonMaterials: BN; uncommonMaterials: BN; rareMaterials: BN; epicMaterials: BN; legendaryMaterials: BN;
  equippedWeaponBonusBps: number; equippedArmorBonusBps: number;
  totalShopSpent: BN; milestoneTier: number; loyaltyStreak: number;
  dailyPurchaseCount: number; flashClaimsToday: number; lastPurchaseDay: number; lastDailyReset: BN;
  dailyTransferCount: number; dailyTransferred: BN; lastTransferReset: BN;
}

function deserializeInventorySection(buf: Uint8Array | Buffer): InventorySection {
  const reader = new BufferReader(buf);
  const staminaPotions = reader.readU16();
  const xpBoosters = reader.readU16();
  const lootMagnets = reader.readU16();
  const shieldTokens = reader.readU16();
  const speedElixirs = reader.readU16();
  const attackBoosters = reader.readU16();
  const defenseBoosters = reader.readU16();
  const collectionBoosters = reader.readU16();
  const rallyHorns = reader.readU16();
  const teleportScrolls = reader.readU16();
  const mysteryKeys = reader.readU16();
  reader.skip(10); // _reserved_consumables
  const commonMaterials = reader.readU64();
  const uncommonMaterials = reader.readU64();
  const rareMaterials = reader.readU64();
  const epicMaterials = reader.readU64();
  const legendaryMaterials = reader.readU64();
  const equippedWeaponBonusBps = reader.readU16();
  const equippedArmorBonusBps = reader.readU16();
  reader.skip(4);
  const totalShopSpent = reader.readU64();
  const milestoneTier = reader.readU8();
  const loyaltyStreak = reader.readU8();
  const dailyPurchaseCount = reader.readU8();
  const flashClaimsToday = reader.readU8();
  reader.skip(4);
  const lastPurchaseDay = reader.readU32();
  reader.skip(4);
  const lastDailyReset = reader.readI64();
  const dailyTransferCount = reader.readU16();
  reader.skip(6);
  const dailyTransferred = reader.readU64();
  const lastTransferReset = reader.readI64();
  // 8 bytes _reserved at end — not read
  return {
    staminaPotions, xpBoosters, lootMagnets, shieldTokens, speedElixirs,
    attackBoosters, defenseBoosters, collectionBoosters, rallyHorns, teleportScrolls, mysteryKeys,
    commonMaterials, uncommonMaterials, rareMaterials, epicMaterials, legendaryMaterials,
    equippedWeaponBonusBps, equippedArmorBonusBps,
    totalShopSpent, milestoneTier, loyaltyStreak, dailyPurchaseCount, flashClaimsToday,
    lastPurchaseDay, lastDailyReset,
    dailyTransferCount, dailyTransferred, lastTransferReset,
  };
}

interface TeamSection {
  team: PublicKey;
  teamSlotIndex: number;
  reinforcementDef1: BN; reinforcementDef2: BN; reinforcementDef3: BN;
  reinforcementMelee: BN; reinforcementRanged: BN; reinforcementSiege: BN;
  reinforcementOriginalUnits: BN; reinforcementOriginalWeapons: BN;
  reinforcementHeroDefenseBps: number; reinforcementHeroWeaponEffBps: number;
  reinforcementHeroArmorEffBps: number; reinforcementSourceCount: number;
}

function deserializeTeamSection(buf: Uint8Array | Buffer): TeamSection {
  const reader = new BufferReader(buf);
  const team = reader.readPubkey();
  const teamSlotIndex = reader.readU16();
  reader.skip(6);
  const reinforcementDef1 = reader.readU64();
  const reinforcementDef2 = reader.readU64();
  const reinforcementDef3 = reader.readU64();
  const reinforcementMelee = reader.readU64();
  const reinforcementRanged = reader.readU64();
  const reinforcementSiege = reader.readU64();
  const reinforcementOriginalUnits = reader.readU64();
  const reinforcementOriginalWeapons = reader.readU64();
  const reinforcementHeroDefenseBps = reader.readU16();
  const reinforcementHeroWeaponEffBps = reader.readU16();
  const reinforcementHeroArmorEffBps = reader.readU16();
  const reinforcementSourceCount = reader.readU8();
  reader.skip(1);
  return {
    team, teamSlotIndex,
    reinforcementDef1, reinforcementDef2, reinforcementDef3,
    reinforcementMelee, reinforcementRanged, reinforcementSiege,
    reinforcementOriginalUnits, reinforcementOriginalWeapons,
    reinforcementHeroDefenseBps, reinforcementHeroWeaponEffBps,
    reinforcementHeroArmorEffBps, reinforcementSourceCount,
  };
}

interface RallySection {
  rallyCaps: PlayerRallyCaps;
  rallyStats: RallyStats;
}

function deserializeRallySection(buf: Uint8Array | Buffer): RallySection {
  const reader = new BufferReader(buf);
  const rallyCaps = deserializePlayerRallyCaps(reader);
  const rallyStats = deserializeRallyStats(reader);
  return { rallyCaps, rallyStats };
}

interface HeroesSection {
  activeHeroes: PublicKey[];
  defensiveHeroSlot: number;
  meditatingHeroSlot: number;
  heroAttackBps: number; heroDefenseBps: number; heroEconomyBps: number;
  heroXpGainBps: number; heroTrainingCostReductionBps: number;
  heroCollectionRateBps: number; heroRallyCapacityBps: number;
  heroStaminaRegenBps: number; heroProduceGenerationBps: number;
  heroWeaponEfficiencyBps: number; heroArmorEfficiencyBps: number;
  heroCritChanceBps: number; heroEncounterDamageBps: number;
  heroLootBonusBps: number; heroSynchronyBonusBps: number;
  heroResourceCapacityBps: number; heroUnitCapacityBps: number;
  blessedHeroBonusBps: number;
  slotLocationBonus: number[];
  meditationStartedAt: BN;
  // Ability state (new — must match on-chain HeroesSection layout)
  abilityLastUsedAt: BN[];
  pendingEffectKind: number;
  pendingEffectStat: number;
  pendingEffectParam: number;
  pendingEffectExpiresAt: BN;
}

function deserializeHeroesSection(buf: Uint8Array | Buffer): HeroesSection {
  const reader = new BufferReader(buf);
  const activeHeroes = reader.readPubkeyArray(3);
  const defensiveHeroSlot = reader.readU8();
  const meditatingHeroSlot = reader.readU8();
  reader.skip(6);
  const heroAttackBps = reader.readU16();
  const heroDefenseBps = reader.readU16();
  const heroEconomyBps = reader.readU16();
  const heroXpGainBps = reader.readU16();
  const heroTrainingCostReductionBps = reader.readU16();
  const heroCollectionRateBps = reader.readU16();
  const heroRallyCapacityBps = reader.readU16();
  const heroStaminaRegenBps = reader.readU16();
  const heroProduceGenerationBps = reader.readU16();
  const heroWeaponEfficiencyBps = reader.readU16();
  const heroArmorEfficiencyBps = reader.readU16();
  const heroCritChanceBps = reader.readU16();
  const heroEncounterDamageBps = reader.readU16();
  const heroLootBonusBps = reader.readU16();
  const heroSynchronyBonusBps = reader.readU16();
  const heroResourceCapacityBps = reader.readU16();
  const heroUnitCapacityBps = reader.readU16();
  const blessedHeroBonusBps = reader.readU16();
  const slotLocationBonus = reader.readU16Array(3);
  // _pad_bonus[2] + 4 bytes implicit padding that 8-byte-aligns the i64 below.
  reader.skip(6);
  const meditationStartedAt = reader.readI64();
  // _reserved[4], then 4 bytes of implicit repr(C) padding that 8-byte-aligns
  // the i64 array below — without skipping it the whole ability block is read
  // 4 bytes early and decodes to garbage.
  reader.skip(8);
  // Ability state (40 bytes: 3×i64 + u8 + u8 + u16 + 4 padding + i64)
  const abilityLastUsedAt = [reader.readI64(), reader.readI64(), reader.readI64()];
  const pendingEffectKind = reader.readU8();
  const pendingEffectStat = reader.readU8();
  const pendingEffectParam = reader.readU16();
  reader.skip(4); // _pending_pad
  const pendingEffectExpiresAt = reader.readI64();
  return {
    activeHeroes, defensiveHeroSlot, meditatingHeroSlot,
    heroAttackBps, heroDefenseBps, heroEconomyBps, heroXpGainBps,
    heroTrainingCostReductionBps, heroCollectionRateBps, heroRallyCapacityBps,
    heroStaminaRegenBps, heroProduceGenerationBps, heroWeaponEfficiencyBps,
    heroArmorEfficiencyBps, heroCritChanceBps, heroEncounterDamageBps,
    heroLootBonusBps, heroSynchronyBonusBps, heroResourceCapacityBps,
    heroUnitCapacityBps, blessedHeroBonusBps,
    slotLocationBonus, meditationStartedAt,
    abilityLastUsedAt, pendingEffectKind, pendingEffectStat,
    pendingEffectParam, pendingEffectExpiresAt,
  };
}

// Default projections for unlocked-but-uninitialized sections.

function defaultResearchProjection() {
  return {
    researchAttackBps: 0, researchDefenseBps: 0, researchCritChanceBps: 0, researchCritDamageBps: 0,
    researchLootBonusBps: 0, researchEncounterSuccessBps: 0,
    researchSynchronyBonusBps: 0, researchReputationBonusBps: 0, researchStaminaBonusBps: 0,
    researchCollectionBonusBps: 0, researchLootMagnetismBps: 0, researchDailyRewardBps: 0,
    hasDailyRewards: false, hasMining: false, hasFishing: false,
    hasFragmentDrops: false, hasGemDrops: false,
    researchBuffVersion: 0, lastDailyClaim: BN0.clone(),
  };
}

function defaultHeroesProjection() {
  return {
    activeHeroes: [NULL_PUBKEY, NULL_PUBKEY, NULL_PUBKEY],
    defensiveHeroSlot: 0,
    meditatingHeroSlot: 255,
    heroAttackBps: 0, heroDefenseBps: 0, heroEconomyBps: 0, heroXpGainBps: 0,
    heroTrainingCostReductionBps: 0, heroCollectionRateBps: 0, heroRallyCapacityBps: 0,
    heroStaminaRegenBps: 0, heroProduceGenerationBps: 0, heroWeaponEfficiencyBps: 0,
    heroArmorEfficiencyBps: 0, heroCritChanceBps: 0, heroEncounterDamageBps: 0,
    heroLootBonusBps: 0, heroSynchronyBonusBps: 0, heroResourceCapacityBps: 0,
    heroUnitCapacityBps: 0, blessedHeroBonusBps: 0,
    slotLocationBonus: [0, 0, 0],
    meditationStartedAt: BN0.clone(),
    abilityLastUsedAt: [BN0.clone(), BN0.clone(), BN0.clone()],
    pendingEffectKind: 0,
    pendingEffectStat: 0,
    pendingEffectParam: 0,
    pendingEffectExpiresAt: BN0.clone(),
  };
}

function defaultTeamProjection() {
  return {
    team: NULL_PUBKEY, teamSlotIndex: 0,
    reinforcementDef1: BN0.clone(), reinforcementDef2: BN0.clone(), reinforcementDef3: BN0.clone(),
    reinforcementMelee: BN0.clone(), reinforcementRanged: BN0.clone(), reinforcementSiege: BN0.clone(),
    reinforcementOriginalUnits: BN0.clone(), reinforcementOriginalWeapons: BN0.clone(),
    reinforcementHeroDefenseBps: 0, reinforcementHeroWeaponEffBps: 0,
    reinforcementHeroArmorEffBps: 0, reinforcementSourceCount: 0,
  };
}

function defaultInventoryProjection() {
  return {
    staminaPotions: 0, xpBoosters: 0, lootMagnets: 0, shieldTokens: 0, speedElixirs: 0,
    attackBoosters: 0, defenseBoosters: 0, collectionBoosters: 0, rallyHorns: 0,
    teleportScrolls: 0, mysteryKeys: 0,
    commonMaterials: BN0.clone(), uncommonMaterials: BN0.clone(), rareMaterials: BN0.clone(),
    epicMaterials: BN0.clone(), legendaryMaterials: BN0.clone(),
    equippedWeaponBonusBps: 0, equippedArmorBonusBps: 0,
    totalShopSpent: BN0.clone(),
    milestoneTier: 0, loyaltyStreak: 0, dailyPurchaseCount: 0, flashClaimsToday: 0,
    lastPurchaseDay: 0, lastDailyReset: BN0.clone(),
    dailyTransferCount: 0, dailyTransferred: BN0.clone(), lastTransferReset: BN0.clone(),
  };
}

function defaultRallyProjection() {
  return { rallyCaps: defaultRallyCaps(), rallyStats: defaultRallyStats() };
}

/** Deserialize PlayerCore from raw bytes (lean core + appended sections). */
export function deserializePlayer(data: Uint8Array | Buffer): PlayerCore {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const reader = new BufferReader(buf);

  // === LEAN CORE ===

  reader.readU8(); // account_key discriminator
  const gameEngine = reader.readPubkey();
  const owner = reader.readPubkey();
  const bump = reader.readU8();
  const version = reader.readU8();
  reader.skip(5); // _pad1, then i64 alignment
  const createdAt = reader.readI64();

  const nameBytes = reader.readBytes(48);
  const nameLen = reader.readU8();
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen));
  reader.skip(7); // _pad_name

  const extensions = reader.readU32();
  reader.skip(4); // _pad_ext

  const lockedNovi = reader.readU64();
  const lastUpdatedTokensAt = reader.readI64();

  const defensiveUnit1 = reader.readU64();
  const defensiveUnit2 = reader.readU64();
  const defensiveUnit3 = reader.readU64();
  const operativeUnit1 = reader.readU64();
  const operativeUnit2 = reader.readU64();
  const operativeUnit3 = reader.readU64();

  const meleeWeapons = reader.readU64();
  const rangedWeapons = reader.readU64();
  const siegeWeapons = reader.readU64();
  const armorPieces = reader.readU64();
  const produce = reader.readU64();
  const vehicles = reader.readU64();

  const cashOnHand = reader.readU64();
  const cashInVault = reader.readU64();

  const happinessDefensive = reader.readF32();
  const happinessOperative = reader.readF32();

  const currentLat = reader.readF64();
  const currentLong = reader.readF64();
  const travelingToLat = reader.readF64();
  const travelingToLong = reader.readF64();
  const arrivalTime = reader.readI64();
  const currentCity = reader.readU16();
  const travelTypeValue = reader.readU8();
  const travelType = travelTypeValue as TravelType;
  reader.skip(5);
  const originCity = reader.readU16();
  const destinationCity = reader.readU16();
  reader.skip(4);
  const departureTime = reader.readI64();
  const travelSpeedLocked = reader.readF32();
  reader.skip(4);

  const subscriptionTierValue = reader.readU8();
  const subscriptionTier = subscriptionTierValue as SubscriptionTier;
  reader.skip(7);
  const subscriptionEnd = reader.readI64();

  const level = reader.readU8();
  reader.skip(7);
  const currentXp = reader.readU64();
  const reputation = reader.readU64();
  const networth = reader.readU64();

  const encounterStamina = reader.readU64();
  const maxEncounterStamina = reader.readU64();
  const lastStaminaUpdate = reader.readI64();

  const currentEvent = reader.readU64();

  const gems = reader.readU64();
  const fragments = reader.readU64();

  const totalAttacks = reader.readU64();
  const totalDefenses = reader.readU64();
  const totalAttackPower = reader.readU64();
  const totalEncounterAttacks = reader.readU64();
  const totalLockedNoviAcquired = reader.readU64();
  const totalSent = reader.readU64();
  const totalReceived = reader.readU64();

  const newPlayerProtectionUntil = reader.readI64();
  const flaggedByGovernance = reader.readBool();
  reader.skip(7);

  const lootCounter = reader.readU64();

  // === SECTIONS (read only if extension bit is set AND bytes exist) ===

  const hasResearch = (extensions & ExtensionFlags.RESEARCH) !== 0 && buf.length >= RESEARCH_OFFSET + RESEARCH_SIZE;
  const hasInventory = (extensions & ExtensionFlags.INVENTORY) !== 0 && buf.length >= INVENTORY_OFFSET + INVENTORY_SIZE;
  const hasTeam = (extensions & ExtensionFlags.TEAM) !== 0 && buf.length >= TEAM_OFFSET + TEAM_SIZE;
  const hasRally = (extensions & ExtensionFlags.RALLY) !== 0 && buf.length >= RALLY_OFFSET + RALLY_SIZE;
  const hasHeroes = (extensions & ExtensionFlags.HEROES) !== 0 && buf.length >= HEROES_OFFSET + HEROES_SIZE;

  const research = hasResearch
    ? deserializeResearchSection(buf.subarray(RESEARCH_OFFSET, RESEARCH_OFFSET + RESEARCH_SIZE))
    : null;
  const inventory = hasInventory
    ? deserializeInventorySection(buf.subarray(INVENTORY_OFFSET, INVENTORY_OFFSET + INVENTORY_SIZE))
    : null;
  const teamSec = hasTeam
    ? deserializeTeamSection(buf.subarray(TEAM_OFFSET, TEAM_OFFSET + TEAM_SIZE))
    : null;
  const rally = hasRally
    ? deserializeRallySection(buf.subarray(RALLY_OFFSET, RALLY_OFFSET + RALLY_SIZE))
    : null;
  const heroes = hasHeroes
    ? deserializeHeroesSection(buf.subarray(HEROES_OFFSET, HEROES_OFFSET + HEROES_SIZE))
    : null;

  // Section fields are named to match the flat PlayerCore shape — spread directly.
  const researchProj = research ?? defaultResearchProjection();
  const heroesProj = heroes ?? defaultHeroesProjection();
  const teamProj = teamSec ?? defaultTeamProjection();
  const inventoryProj = inventory ?? defaultInventoryProjection();
  const rallyProj = rally ?? defaultRallyProjection();

  return {
    // Core
    gameEngine, owner, createdAt, bump, version, name, extensions,
    lockedNovi, lastUpdatedTokensAt,
    defensiveUnit1, defensiveUnit2, defensiveUnit3,
    operativeUnit1, operativeUnit2, operativeUnit3,
    meleeWeapons, rangedWeapons, siegeWeapons, armorPieces, produce, vehicles,
    cashOnHand, cashInVault,
    happinessDefensive, happinessOperative,
    currentLat, currentLong, travelingToLat, travelingToLong, arrivalTime,
    currentCity, travelType, originCity, destinationCity,
    departureTime, travelSpeedLocked,
    subscriptionTier, subscriptionEnd,
    level, currentXp, reputation, networth,
    encounterStamina, maxEncounterStamina, lastStaminaUpdate,
    currentEvent, gems, fragments,
    totalAttacks, totalDefenses, totalAttackPower, totalEncounterAttacks,
    totalLockedNoviAcquired, totalSent, totalReceived,
    newPlayerProtectionUntil, flaggedByGovernance, lootCounter,
    // Sections (projected)
    ...researchProj,
    ...heroesProj,
    ...teamProj,
    ...inventoryProj,
    ...rallyProj,
  };
}

/** Parse PlayerCore from account info */
export function parsePlayer(accountInfo: AccountInfo<Buffer>): PlayerCore | null {
  if (!accountInfo.data || accountInfo.data.length < CORE_SIZE) {
    return null;
  }
  return deserializePlayer(accountInfo.data);
}

// Helper Functions

/** Check if player has extension unlocked */
export function hasExtension(player: PlayerCore, ext: number): boolean {
  return (player.extensions & ext) !== 0;
}

/** Check if player is currently traveling */
export function isTraveling(player: PlayerCore): boolean {
  return player.arrivalTime.toNumber() !== -1;
}

/** Check if player has arrived at destination */
export function hasArrived(player: PlayerCore, nowSeconds: number): boolean {
  const arrival = player.arrivalTime.toNumber();
  return arrival === -1 || nowSeconds >= arrival;
}

/** Get effective subscription tier (0 if expired) */
export function getEffectiveTier(player: PlayerCore, nowSeconds: number): SubscriptionTier {
  if (player.subscriptionEnd.toNumber() > nowSeconds) {
    return Math.min(player.subscriptionTier, 3) as SubscriptionTier;
  }
  return SubscriptionTier.Rookie;
}

/**
 * Check if the subscription is active.
 *
 * Active = `subscription_end > now`. Rookie (tier 0) is a paid charter under
 * the current ladder, so the legacy `tier > 0` gate would mis-classify a
 * paying Rookie as inactive — gone.
 */
export function isSubscriptionActive(player: PlayerCore, nowSeconds: number): boolean {
  return player.subscriptionEnd.toNumber() > nowSeconds;
}

/** Check if player has a team */
export function hasTeam(player: PlayerCore): boolean {
  return !isNullPubkey(player.team);
}

/** Check if player is meditating */
export function isHeroMeditating(player: PlayerCore): boolean {
  return player.meditatingHeroSlot !== 255 && player.meditationStartedAt.toNumber() > 0;
}

/** Get total defensive units (own garrison) */
export function getTotalDefensiveUnits(player: PlayerCore): BN {
  return player.defensiveUnit1.add(player.defensiveUnit2).add(player.defensiveUnit3);
}

/** Get total operative units */
export function getTotalOperativeUnits(player: PlayerCore): BN {
  return player.operativeUnit1.add(player.operativeUnit2).add(player.operativeUnit3);
}

/** Get total units */
export function getTotalUnits(player: PlayerCore): BN {
  return getTotalDefensiveUnits(player).add(getTotalOperativeUnits(player));
}

/** Get total weapons */
export function getTotalWeapons(player: PlayerCore): BN {
  return player.meleeWeapons.add(player.rangedWeapons).add(player.siegeWeapons);
}

/** Get total reinforcement units */
export function getTotalReinforcementUnits(player: PlayerCore): BN {
  return player.reinforcementDef1.add(player.reinforcementDef2).add(player.reinforcementDef3);
}

/** Get total reinforcement weapons */
export function getTotalReinforcementWeapons(player: PlayerCore): BN {
  return player.reinforcementMelee.add(player.reinforcementRanged).add(player.reinforcementSiege);
}

/** Check if player has custom name (not default "Player #X") */
export function hasCustomName(player: PlayerCore): boolean {
  return player.name.length >= 8 && !player.name.startsWith('Player #');
}
