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

import type { Address, ReadonlyUint8Array } from '@solana/kit';
import { isNullPubkey, NULL_PUBKEY } from '../utils/deserialize';
import {
  reprC, struct, pad, u8, u16, u32, u64, i64, f32, f64, bool, pubkey, array, bytes,
} from '../utils/codec';
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
export const HEROES_SIZE = 168;
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

// Rally Stats & Caps

export interface RallyStats {
  currentRalliesJoined: number;
  ralliesCreatedToday: number;
  lastRallyCreationReset: bigint;
  totalRalliesJoined: bigint;
  totalRalliesCreated: bigint;
  totalRalliesWon: bigint;
  totalRalliesLost: bigint;
  totalRallyLootEarned: bigint;
  totalRallyDamageDealt: bigint;
}

export interface PlayerRallyCaps {
  maxConcurrentRallies: number;
  maxRalliesPerDay: number;
}

function defaultRallyStats(): RallyStats {
  return {
    currentRalliesJoined: 0,
    ralliesCreatedToday: 0,
    lastRallyCreationReset: 0n,
    totalRalliesJoined: 0n,
    totalRalliesCreated: 0n,
    totalRalliesWon: 0n,
    totalRalliesLost: 0n,
    totalRallyLootEarned: 0n,
    totalRallyDamageDealt: 0n,
  };
}

function defaultRallyCaps(): PlayerRallyCaps {
  return { maxConcurrentRallies: 3, maxRalliesPerDay: 5 };
}

// PlayerCore — lean + projected section fields

export interface PlayerCore {
  // Kingdom Reference
  gameEngine: Address;

  // Identity
  owner: Address;
  createdAt: bigint;
  bump: number;
  version: number;

  // Name
  name: string;

  // Extensions bitmap
  extensions: number;

  // Locked NOVI
  lockedNovi: bigint;
  lastUpdatedTokensAt: bigint;

  // Units
  defensiveUnit1: bigint;
  defensiveUnit2: bigint;
  defensiveUnit3: bigint;
  operativeUnit1: bigint;
  operativeUnit2: bigint;
  operativeUnit3: bigint;

  // Equipment
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armorPieces: bigint;
  produce: bigint;
  vehicles: bigint;

  // Cash
  cashOnHand: bigint;
  cashInVault: bigint;

  // Happiness
  happinessDefensive: number;
  happinessOperative: number;

  // Location
  currentLat: number;
  currentLong: number;
  travelingToLat: number;
  travelingToLong: number;
  arrivalTime: bigint;
  currentCity: number;
  travelType: TravelType;
  originCity: number;
  destinationCity: number;
  departureTime: bigint;
  travelSpeedLocked: number;

  // Subscription
  subscriptionTier: SubscriptionTier;
  subscriptionEnd: bigint;

  // Progression
  level: number;
  currentXp: bigint;
  reputation: bigint;
  networth: bigint;

  // Stamina
  encounterStamina: bigint;
  maxEncounterStamina: bigint;
  lastStaminaUpdate: bigint;

  // Event
  currentEvent: bigint;

  // Resources
  gems: bigint;
  fragments: bigint;

  // Stats
  totalAttacks: bigint;
  totalDefenses: bigint;
  totalAttackPower: bigint;
  totalEncounterAttacks: bigint;
  totalLockedNoviAcquired: bigint;
  totalSent: bigint;
  totalReceived: bigint;

  // Protection & Flags
  newPlayerProtectionUntil: bigint;
  flaggedByGovernance: boolean;

  // Loot Counter
  lootCounter: bigint;

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
  lastDailyClaim: bigint;

  // Heroes
  activeHeroes: Address[];
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
  meditationStartedAt: bigint;

  // Team + Reinforcement
  team: Address;
  teamSlotIndex: number;
  reinforcementDef1: bigint;
  reinforcementDef2: bigint;
  reinforcementDef3: bigint;
  reinforcementMelee: bigint;
  reinforcementRanged: bigint;
  reinforcementSiege: bigint;
  reinforcementOriginalUnits: bigint;
  reinforcementOriginalWeapons: bigint;
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
  commonMaterials: bigint;
  uncommonMaterials: bigint;
  rareMaterials: bigint;
  epicMaterials: bigint;
  legendaryMaterials: bigint;
  // Inventory: equipped
  equippedWeaponBonusBps: number;
  equippedArmorBonusBps: number;
  // Inventory: shop state
  totalShopSpent: bigint;
  milestoneTier: number;
  loyaltyStreak: number;
  dailyPurchaseCount: number;
  flashClaimsToday: number;
  lastPurchaseDay: number;
  lastDailyReset: bigint;
  // Inventory: transfer tracking
  dailyTransferCount: number;
  dailyTransferred: bigint;
  lastTransferReset: bigint;

  // Rally
  rallyCaps: PlayerRallyCaps;
  rallyStats: RallyStats;
}

export type PlayerAccount = PlayerCore;

/** PlayerCore (lean) size in bytes */
export const PLAYER_CORE_SIZE = CORE_SIZE;

// Deserialization

/** RallyStats `#[repr(C)]` codec */
const rallyStatsCodec = struct<RallyStats>([
  ['currentRalliesJoined', u8],
  ['ralliesCreatedToday', u8],
  pad(6),
  ['lastRallyCreationReset', i64],
  ['totalRalliesJoined', u64],
  ['totalRalliesCreated', u64],
  ['totalRalliesWon', u64],
  ['totalRalliesLost', u64],
  ['totalRallyLootEarned', u64],
  ['totalRallyDamageDealt', u64],
  pad(8),
]);

/** PlayerRallyCaps `#[repr(C)]` codec */
const playerRallyCapsCodec = struct<PlayerRallyCaps>([
  ['maxConcurrentRallies', u8],
  ['maxRalliesPerDay', u8],
  pad(6),
]);

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
  lastDailyClaim: bigint;
}

/** Research section `#[repr(C)]` codec */
const researchSectionCodec = reprC<ResearchSection>([
  ['researchAttackBps', u16],
  ['researchDefenseBps', u16],
  ['researchCritChanceBps', u16],
  ['researchCritDamageBps', u16],
  ['researchLootBonusBps', u16],
  ['researchEncounterSuccessBps', u16],
  ['researchSynchronyBonusBps', u16],
  ['researchReputationBonusBps', u16],
  ['researchStaminaBonusBps', u16],
  ['researchCollectionBonusBps', u16],
  ['researchLootMagnetismBps', u16],
  ['researchDailyRewardBps', u16],
  ['hasDailyRewards', bool],
  ['hasMining', bool],
  ['hasFishing', bool],
  ['hasFragmentDrops', bool],
  ['hasGemDrops', bool],
  pad(3),
  ['researchBuffVersion', u32],
  pad(4),
  ['lastDailyClaim', i64],
], RESEARCH_SIZE);

function deserializeResearchSection(buf: Uint8Array): ResearchSection {
  return researchSectionCodec.decode(buf);
}

interface InventorySection {
  staminaPotions: number; xpBoosters: number; lootMagnets: number; shieldTokens: number;
  speedElixirs: number; attackBoosters: number; defenseBoosters: number; collectionBoosters: number;
  rallyHorns: number; teleportScrolls: number; mysteryKeys: number;
  commonMaterials: bigint; uncommonMaterials: bigint; rareMaterials: bigint; epicMaterials: bigint; legendaryMaterials: bigint;
  equippedWeaponBonusBps: number; equippedArmorBonusBps: number;
  totalShopSpent: bigint; milestoneTier: number; loyaltyStreak: number;
  dailyPurchaseCount: number; flashClaimsToday: number; lastPurchaseDay: number; lastDailyReset: bigint;
  dailyTransferCount: number; dailyTransferred: bigint; lastTransferReset: bigint;
}

/** Inventory section `#[repr(C)]` codec */
const inventorySectionCodec = reprC<InventorySection>([
  ['staminaPotions', u16],
  ['xpBoosters', u16],
  ['lootMagnets', u16],
  ['shieldTokens', u16],
  ['speedElixirs', u16],
  ['attackBoosters', u16],
  ['defenseBoosters', u16],
  ['collectionBoosters', u16],
  ['rallyHorns', u16],
  ['teleportScrolls', u16],
  ['mysteryKeys', u16],
  pad(10), // _reserved_consumables
  ['commonMaterials', u64],
  ['uncommonMaterials', u64],
  ['rareMaterials', u64],
  ['epicMaterials', u64],
  ['legendaryMaterials', u64],
  ['equippedWeaponBonusBps', u16],
  ['equippedArmorBonusBps', u16],
  pad(4),
  ['totalShopSpent', u64],
  ['milestoneTier', u8],
  ['loyaltyStreak', u8],
  ['dailyPurchaseCount', u8],
  ['flashClaimsToday', u8],
  pad(4),
  ['lastPurchaseDay', u32],
  pad(4),
  ['lastDailyReset', i64],
  ['dailyTransferCount', u16],
  pad(6),
  ['dailyTransferred', u64],
  ['lastTransferReset', i64],
  pad(8), // _reserved
], INVENTORY_SIZE);

function deserializeInventorySection(buf: Uint8Array): InventorySection {
  return inventorySectionCodec.decode(buf);
}

interface TeamSection {
  team: Address;
  teamSlotIndex: number;
  reinforcementDef1: bigint; reinforcementDef2: bigint; reinforcementDef3: bigint;
  reinforcementMelee: bigint; reinforcementRanged: bigint; reinforcementSiege: bigint;
  reinforcementOriginalUnits: bigint; reinforcementOriginalWeapons: bigint;
  reinforcementHeroDefenseBps: number; reinforcementHeroWeaponEffBps: number;
  reinforcementHeroArmorEffBps: number; reinforcementSourceCount: number;
}

/** Team section `#[repr(C)]` codec */
const teamSectionCodec = reprC<TeamSection>([
  ['team', pubkey],
  ['teamSlotIndex', u16],
  pad(6),
  ['reinforcementDef1', u64],
  ['reinforcementDef2', u64],
  ['reinforcementDef3', u64],
  ['reinforcementMelee', u64],
  ['reinforcementRanged', u64],
  ['reinforcementSiege', u64],
  ['reinforcementOriginalUnits', u64],
  ['reinforcementOriginalWeapons', u64],
  ['reinforcementHeroDefenseBps', u16],
  ['reinforcementHeroWeaponEffBps', u16],
  ['reinforcementHeroArmorEffBps', u16],
  ['reinforcementSourceCount', u8],
  pad(1),
], TEAM_SIZE);

function deserializeTeamSection(buf: Uint8Array): TeamSection {
  return teamSectionCodec.decode(buf);
}

interface RallySection {
  rallyCaps: PlayerRallyCaps;
  rallyStats: RallyStats;
}

/** Rally section `#[repr(C)]` codec */
const rallySectionCodec = reprC<RallySection>([
  ['rallyCaps', playerRallyCapsCodec],
  ['rallyStats', rallyStatsCodec],
], RALLY_SIZE);

function deserializeRallySection(buf: Uint8Array): RallySection {
  return rallySectionCodec.decode(buf);
}

interface HeroesSection {
  activeHeroes: Address[];
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
  meditationStartedAt: bigint;
}

/** Heroes section `#[repr(C)]` codec */
const heroesSectionCodec = reprC<HeroesSection>([
  ['activeHeroes', array(pubkey, 3)],
  ['defensiveHeroSlot', u8],
  ['meditatingHeroSlot', u8],
  pad(6),
  ['heroAttackBps', u16],
  ['heroDefenseBps', u16],
  ['heroEconomyBps', u16],
  ['heroXpGainBps', u16],
  ['heroTrainingCostReductionBps', u16],
  ['heroCollectionRateBps', u16],
  ['heroRallyCapacityBps', u16],
  ['heroStaminaRegenBps', u16],
  ['heroProduceGenerationBps', u16],
  ['heroWeaponEfficiencyBps', u16],
  ['heroArmorEfficiencyBps', u16],
  ['heroCritChanceBps', u16],
  ['heroEncounterDamageBps', u16],
  ['heroLootBonusBps', u16],
  ['heroSynchronyBonusBps', u16],
  ['heroResourceCapacityBps', u16],
  ['heroUnitCapacityBps', u16],
  ['blessedHeroBonusBps', u16],
  ['slotLocationBonus', array(u16, 3)],
  pad(2), // _pad_bonus[2]
  ['meditationStartedAt', i64],
  pad(8), // _reserved + tail padding
], HEROES_SIZE);

function deserializeHeroesSection(buf: Uint8Array): HeroesSection {
  return heroesSectionCodec.decode(buf);
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
    researchBuffVersion: 0, lastDailyClaim: 0n,
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
    meditationStartedAt: 0n,
  };
}

function defaultTeamProjection() {
  return {
    team: NULL_PUBKEY, teamSlotIndex: 0,
    reinforcementDef1: 0n, reinforcementDef2: 0n, reinforcementDef3: 0n,
    reinforcementMelee: 0n, reinforcementRanged: 0n, reinforcementSiege: 0n,
    reinforcementOriginalUnits: 0n, reinforcementOriginalWeapons: 0n,
    reinforcementHeroDefenseBps: 0, reinforcementHeroWeaponEffBps: 0,
    reinforcementHeroArmorEffBps: 0, reinforcementSourceCount: 0,
  };
}

function defaultInventoryProjection() {
  return {
    staminaPotions: 0, xpBoosters: 0, lootMagnets: 0, shieldTokens: 0, speedElixirs: 0,
    attackBoosters: 0, defenseBoosters: 0, collectionBoosters: 0, rallyHorns: 0,
    teleportScrolls: 0, mysteryKeys: 0,
    commonMaterials: 0n, uncommonMaterials: 0n, rareMaterials: 0n,
    epicMaterials: 0n, legendaryMaterials: 0n,
    equippedWeaponBonusBps: 0, equippedArmorBonusBps: 0,
    totalShopSpent: 0n,
    milestoneTier: 0, loyaltyStreak: 0, dailyPurchaseCount: 0, flashClaimsToday: 0,
    lastPurchaseDay: 0, lastDailyReset: 0n,
    dailyTransferCount: 0, dailyTransferred: 0n, lastTransferReset: 0n,
  };
}

function defaultRallyProjection() {
  return { rallyCaps: defaultRallyCaps(), rallyStats: defaultRallyStats() };
}

// Lean core — raw codec output. `name` is stored as a 48-byte field plus a
// `nameLen` byte; the flat `PlayerCore.name` string is derived after decoding.
interface PlayerCoreRaw {
  gameEngine: Address;
  owner: Address;
  bump: number;
  version: number;
  createdAt: bigint;
  nameBytes: ReadonlyUint8Array;
  nameLen: number;
  extensions: number;
  lockedNovi: bigint;
  lastUpdatedTokensAt: bigint;
  defensiveUnit1: bigint;
  defensiveUnit2: bigint;
  defensiveUnit3: bigint;
  operativeUnit1: bigint;
  operativeUnit2: bigint;
  operativeUnit3: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armorPieces: bigint;
  produce: bigint;
  vehicles: bigint;
  cashOnHand: bigint;
  cashInVault: bigint;
  happinessDefensive: number;
  happinessOperative: number;
  currentLat: number;
  currentLong: number;
  travelingToLat: number;
  travelingToLong: number;
  arrivalTime: bigint;
  currentCity: number;
  travelType: number;
  originCity: number;
  destinationCity: number;
  departureTime: bigint;
  travelSpeedLocked: number;
  subscriptionTier: number;
  subscriptionEnd: bigint;
  level: number;
  currentXp: bigint;
  reputation: bigint;
  networth: bigint;
  encounterStamina: bigint;
  maxEncounterStamina: bigint;
  lastStaminaUpdate: bigint;
  currentEvent: bigint;
  gems: bigint;
  fragments: bigint;
  totalAttacks: bigint;
  totalDefenses: bigint;
  totalAttackPower: bigint;
  totalEncounterAttacks: bigint;
  totalLockedNoviAcquired: bigint;
  totalSent: bigint;
  totalReceived: bigint;
  newPlayerProtectionUntil: bigint;
  flaggedByGovernance: boolean;
  lootCounter: bigint;
}

/** Lean PlayerCore `#[repr(C)]` codec (CORE_SIZE bytes). */
const playerCoreCodec = reprC<PlayerCoreRaw>([
  pad(1), // account_key discriminator
  ['gameEngine', pubkey],
  ['owner', pubkey],
  ['bump', u8],
  ['version', u8],
  ['createdAt', i64],
  ['nameBytes', bytes(48)],
  ['nameLen', u8],
  pad(4), // _pad_name
  ['extensions', u32],
  ['lockedNovi', u64],
  ['lastUpdatedTokensAt', i64],
  ['defensiveUnit1', u64],
  ['defensiveUnit2', u64],
  ['defensiveUnit3', u64],
  ['operativeUnit1', u64],
  ['operativeUnit2', u64],
  ['operativeUnit3', u64],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['armorPieces', u64],
  ['produce', u64],
  ['vehicles', u64],
  ['cashOnHand', u64],
  ['cashInVault', u64],
  ['happinessDefensive', f32],
  ['happinessOperative', f32],
  ['currentLat', f64],
  ['currentLong', f64],
  ['travelingToLat', f64],
  ['travelingToLong', f64],
  ['arrivalTime', i64],
  ['currentCity', u16],
  ['travelType', u8],
  pad(4),
  ['originCity', u16],
  ['destinationCity', u16],
  ['departureTime', i64],
  ['travelSpeedLocked', f32],
  pad(4),
  ['subscriptionTier', u8],
  ['subscriptionEnd', i64],
  ['level', u8],
  ['currentXp', u64],
  ['reputation', u64],
  ['networth', u64],
  ['encounterStamina', u64],
  ['maxEncounterStamina', u64],
  ['lastStaminaUpdate', i64],
  ['currentEvent', u64],
  ['gems', u64],
  ['fragments', u64],
  ['totalAttacks', u64],
  ['totalDefenses', u64],
  ['totalAttackPower', u64],
  ['totalEncounterAttacks', u64],
  ['totalLockedNoviAcquired', u64],
  ['totalSent', u64],
  ['totalReceived', u64],
  ['newPlayerProtectionUntil', i64],
  ['flaggedByGovernance', bool],
  ['lootCounter', u64],
], CORE_SIZE);

/** Deserialize PlayerCore from raw bytes (lean core + appended sections). */
export function deserializePlayer(data: Uint8Array): PlayerCore {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);

  // === LEAN CORE ===

  const core = playerCoreCodec.decode(buf);
  const {
    gameEngine, owner, bump, version, createdAt, nameBytes, nameLen, extensions,
    lockedNovi, lastUpdatedTokensAt,
    defensiveUnit1, defensiveUnit2, defensiveUnit3,
    operativeUnit1, operativeUnit2, operativeUnit3,
    meleeWeapons, rangedWeapons, siegeWeapons, armorPieces, produce, vehicles,
    cashOnHand, cashInVault,
    happinessDefensive, happinessOperative,
    currentLat, currentLong, travelingToLat, travelingToLong, arrivalTime,
    currentCity, originCity, destinationCity,
    departureTime, travelSpeedLocked,
    subscriptionEnd,
    level, currentXp, reputation, networth,
    encounterStamina, maxEncounterStamina, lastStaminaUpdate,
    currentEvent, gems, fragments,
    totalAttacks, totalDefenses, totalAttackPower, totalEncounterAttacks,
    totalLockedNoviAcquired, totalSent, totalReceived,
    newPlayerProtectionUntil, flaggedByGovernance, lootCounter,
  } = core;
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen));
  const travelType = core.travelType as TravelType;
  const subscriptionTier = core.subscriptionTier as SubscriptionTier;

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
export function parsePlayer(accountInfo: { data: Uint8Array }): PlayerCore | null {
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
  return Number(player.arrivalTime) !== -1;
}

/** Check if player has arrived at destination */
export function hasArrived(player: PlayerCore, nowSeconds: number): boolean {
  const arrival = Number(player.arrivalTime);
  return arrival === -1 || nowSeconds >= arrival;
}

/** Get effective subscription tier (0 if expired) */
export function getEffectiveTier(player: PlayerCore, nowSeconds: number): SubscriptionTier {
  if (Number(player.subscriptionEnd) > nowSeconds) {
    return Math.min(player.subscriptionTier, 3) as SubscriptionTier;
  }
  return SubscriptionTier.Rookie;
}

/** Check if subscription is active */
export function isSubscriptionActive(player: PlayerCore, nowSeconds: number): boolean {
  return Number(player.subscriptionEnd) > nowSeconds && player.subscriptionTier > 0;
}

/** Check if player has a team */
export function hasTeam(player: PlayerCore): boolean {
  return !isNullPubkey(player.team);
}

/** Check if player is meditating */
export function isHeroMeditating(player: PlayerCore): boolean {
  return player.meditatingHeroSlot !== 255 && Number(player.meditationStartedAt) > 0;
}

/** Get total defensive units (own garrison) */
export function getTotalDefensiveUnits(player: PlayerCore): bigint {
  return (player.defensiveUnit1 + player.defensiveUnit2 + player.defensiveUnit3);
}

/** Get total operative units */
export function getTotalOperativeUnits(player: PlayerCore): bigint {
  return (player.operativeUnit1 + player.operativeUnit2 + player.operativeUnit3);
}

/** Get total units */
export function getTotalUnits(player: PlayerCore): bigint {
  return (getTotalDefensiveUnits(player) + getTotalOperativeUnits(player));
}

/** Get total weapons */
export function getTotalWeapons(player: PlayerCore): bigint {
  return (player.meleeWeapons + player.rangedWeapons + player.siegeWeapons);
}

/** Get total reinforcement units */
export function getTotalReinforcementUnits(player: PlayerCore): bigint {
  return (player.reinforcementDef1 + player.reinforcementDef2 + player.reinforcementDef3);
}

/** Get total reinforcement weapons */
export function getTotalReinforcementWeapons(player: PlayerCore): bigint {
  return (player.reinforcementMelee + player.reinforcementRanged + player.reinforcementSiege);
}

/** Check if player has custom name (not default "Player #X") */
export function hasCustomName(player: PlayerCore): boolean {
  return player.name.length >= 8 && !player.name.startsWith('Player #');
}
