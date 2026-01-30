/**
 * PlayerAccount (PlayerCore)
 *
 * Main player state with optional extension sections.
 * Core: 1016 bytes, Max with all extensions: 1914 bytes
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize.ts';
import { TravelType, SubscriptionTier } from '../types/enums.ts';

// ============================================================
// Extension Flags
// ============================================================

export const ExtensionFlags = {
  RESEARCH: 1 << 0,
  HEROES: 1 << 1,
  INVENTORY: 1 << 2,
  RALLY: 1 << 3,
  TEAM: 1 << 4,
  COSMETICS: 1 << 5,
  COURT: 1 << 6,
} as const;

// ============================================================
// Section Sizes & Offsets
// ============================================================

export const CORE_SIZE = 1048;
export const RESEARCH_SIZE = 96;
export const HEROES_SIZE = 130;
export const INVENTORY_SIZE = 424;
export const RALLY_SIZE = 80;
export const TEAM_SIZE = 40;
export const COSMETICS_SIZE = 80;
export const COURT_SIZE = 48;

export const CORE_OFFSET = 0;
export const RESEARCH_OFFSET = CORE_SIZE;
export const HEROES_OFFSET = RESEARCH_OFFSET + RESEARCH_SIZE;
export const INVENTORY_OFFSET = HEROES_OFFSET + HEROES_SIZE;
export const RALLY_OFFSET = INVENTORY_OFFSET + INVENTORY_SIZE;
export const TEAM_OFFSET = RALLY_OFFSET + RALLY_SIZE;
export const COSMETICS_OFFSET = TEAM_OFFSET + TEAM_SIZE;
export const COURT_OFFSET = COSMETICS_OFFSET + COSMETICS_SIZE;
export const MAX_SIZE = COURT_OFFSET + COURT_SIZE;

// ============================================================
// Rally Stats & Caps
// ============================================================

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

// ============================================================
// Player Core Interface
// ============================================================

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

  // Extensions
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

  // Research buffs (mirrored)
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

  // Research unlock flags
  hasDailyRewards: boolean;
  hasMining: boolean;
  hasFishing: boolean;
  hasFragmentDrops: boolean;
  hasGemDrops: boolean;

  // Research state
  researchBuffVersion: number;
  lastDailyClaim: BN;

  // Hero system (mirrored)
  activeHeroes: PublicKey[];
  defensiveHeroSlot: number;
  meditatingHeroSlot: number;

  // Hero buffs
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

  // Location synergy
  slotLocationBonus: number[];

  // Team (mirrored)
  team: PublicKey;
  teamSlotIndex: number;

  // Transfer tracking
  dailyTransferCount: number;
  dailyTransferred: BN;
  lastTransferReset: BN;

  // Rally caps & stats
  rallyCaps: PlayerRallyCaps;
  rallyStats: RallyStats;

  // Consumables
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

  // Materials
  commonMaterials: BN;
  uncommonMaterials: BN;
  rareMaterials: BN;
  epicMaterials: BN;
  legendaryMaterials: BN;

  // Equipped items
  equippedWeaponBonusBps: number;
  equippedArmorBonusBps: number;

  // Shop state
  totalShopSpent: BN;
  milestoneTier: number;
  loyaltyStreak: number;
  dailyPurchaseCount: number;
  flashClaimsToday: number;
  lastPurchaseDay: number;
  lastDailyReset: BN;

  // Meditation
  meditationStartedAt: BN;

  // Reinforcement system
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
}

// Use PlayerAccount as alias
export type PlayerAccount = PlayerCore;

/** PlayerCore size in bytes */
export const PLAYER_CORE_SIZE = CORE_SIZE;

// ============================================================
// Deserialization
// ============================================================

function deserializeRallyStats(reader: BufferReader): RallyStats {
  const currentRalliesJoined = reader.readU8();
  const ralliesCreatedToday = reader.readU8();
  reader.skip(6); // padding
  const lastRallyCreationReset = reader.readI64();
  const totalRalliesJoined = reader.readU64();
  const totalRalliesCreated = reader.readU64();
  const totalRalliesWon = reader.readU64();
  const totalRalliesLost = reader.readU64();
  const totalRallyLootEarned = reader.readU64();
  const totalRallyDamageDealt = reader.readU64();
  reader.skip(8); // _reserved

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
  reader.skip(6); // padding
  return { maxConcurrentRallies, maxRalliesPerDay };
}

/** Deserialize PlayerCore from raw bytes */
export function deserializePlayer(data: Uint8Array | Buffer): PlayerCore {
  const reader = new BufferReader(data);

  // Kingdom Reference (32 bytes)
  const gameEngine = reader.readPubkey();

  // Identity (48 bytes)
  const owner = reader.readPubkey();
  const createdAt = reader.readI64();
  const bump = reader.readU8();
  const version = reader.readU8();
  reader.skip(6); // padding

  // Name (56 bytes)
  const nameBytes = reader.readBytes(48);
  const nameLen = reader.readU8();
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen));
  reader.skip(7); // padding

  // Extensions (4 bytes + 4 implicit repr(C) padding before u64)
  const extensions = reader.readU32();
  reader.skip(4); // repr(C) alignment padding: u32 → u64

  // Locked NOVI (16 bytes)
  const lockedNovi = reader.readU64();
  const lastUpdatedTokensAt = reader.readI64();

  // Units (48 bytes)
  const defensiveUnit1 = reader.readU64();
  const defensiveUnit2 = reader.readU64();
  const defensiveUnit3 = reader.readU64();
  const operativeUnit1 = reader.readU64();
  const operativeUnit2 = reader.readU64();
  const operativeUnit3 = reader.readU64();

  // Equipment (48 bytes)
  const meleeWeapons = reader.readU64();
  const rangedWeapons = reader.readU64();
  const siegeWeapons = reader.readU64();
  const armorPieces = reader.readU64();
  const produce = reader.readU64();
  const vehicles = reader.readU64();

  // Cash (16 bytes)
  const cashOnHand = reader.readU64();
  const cashInVault = reader.readU64();

  // Happiness (8 bytes)
  const happinessDefensive = reader.readF32();
  const happinessOperative = reader.readF32();

  // Location (56 bytes)
  const currentLat = reader.readF64();
  const currentLong = reader.readF64();
  const travelingToLat = reader.readF64();
  const travelingToLong = reader.readF64();
  const arrivalTime = reader.readI64();
  const currentCity = reader.readU16();
  const travelTypeValue = reader.readU8();
  const travelType = travelTypeValue as TravelType;
  reader.skip(5); // padding
  const originCity = reader.readU16();
  const destinationCity = reader.readU16();
  reader.skip(4); // padding
  const departureTime = reader.readI64();
  const travelSpeedLocked = reader.readF32();
  reader.skip(4); // padding

  // Subscription (16 bytes)
  const subscriptionTierValue = reader.readU8();
  const subscriptionTier = subscriptionTierValue as SubscriptionTier;
  reader.skip(7); // padding
  const subscriptionEnd = reader.readI64();

  // Progression (32 bytes)
  const level = reader.readU8();
  reader.skip(7); // padding
  const currentXp = reader.readU64();
  const reputation = reader.readU64();
  const networth = reader.readU64();

  // Stamina (24 bytes)
  const encounterStamina = reader.readU64();
  const maxEncounterStamina = reader.readU64();
  const lastStaminaUpdate = reader.readI64();

  // Event (8 bytes)
  const currentEvent = reader.readU64();

  // Resources (16 bytes)
  const gems = reader.readU64();
  const fragments = reader.readU64();

  // Stats (56 bytes)
  const totalAttacks = reader.readU64();
  const totalDefenses = reader.readU64();
  const totalAttackPower = reader.readU64();
  const totalEncounterAttacks = reader.readU64();
  const totalLockedNoviAcquired = reader.readU64();
  const totalSent = reader.readU64();
  const totalReceived = reader.readU64();

  // Protection & Flags (16 bytes)
  const newPlayerProtectionUntil = reader.readI64();
  const flaggedByGovernance = reader.readBool();
  reader.skip(7); // padding

  // Loot Counter (8 bytes)
  const lootCounter = reader.readU64();

  // Research buffs (24 bytes)
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

  // Research unlock flags (8 bytes)
  const hasDailyRewards = reader.readBool();
  const hasMining = reader.readBool();
  const hasFishing = reader.readBool();
  const hasFragmentDrops = reader.readBool();
  const hasGemDrops = reader.readBool();
  reader.skip(3); // padding

  // Research state (12 bytes + 4 implicit repr(C) padding before i64)
  const researchBuffVersion = reader.readU32();
  reader.skip(4); // repr(C) alignment padding: u32 → i64
  const lastDailyClaim = reader.readI64();

  // Hero system (104 bytes)
  const activeHeroes = reader.readPubkeyArray(3);
  const defensiveHeroSlot = reader.readU8();
  const meditatingHeroSlot = reader.readU8();
  reader.skip(2); // padding

  // Hero buffs
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

  // Location synergy (6 bytes)
  const slotLocationBonus = reader.readU16Array(3);

  // Team (40 bytes)
  const team = reader.readPubkey();
  const teamSlotIndex = reader.readU16();
  reader.skip(6); // padding

  // Transfer tracking (24 bytes + 2 implicit repr(C) padding before u64)
  const dailyTransferCount = reader.readU16();
  reader.skip(6); // explicit _padding_transfer1
  reader.skip(2); // repr(C) alignment padding: [u8;6] end → u64
  const dailyTransferred = reader.readU64();
  const lastTransferReset = reader.readI64();

  // Rally caps & stats (80 bytes)
  const rallyCaps = deserializePlayerRallyCaps(reader);
  const rallyStats = deserializeRallyStats(reader);

  // Consumables (22 bytes)
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

  // Materials (40 bytes) - 2 bytes implicit repr(C) padding before u64
  reader.skip(2); // repr(C) alignment padding: u16 → u64
  const commonMaterials = reader.readU64();
  const uncommonMaterials = reader.readU64();
  const rareMaterials = reader.readU64();
  const epicMaterials = reader.readU64();
  const legendaryMaterials = reader.readU64();

  // Equipped items (8 bytes)
  const equippedWeaponBonusBps = reader.readU16();
  const equippedArmorBonusBps = reader.readU16();
  reader.skip(4); // padding

  // Shop state (32 bytes)
  const totalShopSpent = reader.readU64();
  const milestoneTier = reader.readU8();
  const loyaltyStreak = reader.readU8();
  const dailyPurchaseCount = reader.readU8();
  const flashClaimsToday = reader.readU8();
  reader.skip(4); // padding
  const lastPurchaseDay = reader.readU32();
  reader.skip(4); // padding
  const lastDailyReset = reader.readI64();

  // Meditation (8 bytes)
  const meditationStartedAt = reader.readI64();

  // Reinforcement system (72 bytes)
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
  reader.skip(1); // padding

  return {
    gameEngine,
    owner,
    createdAt,
    bump,
    version,
    name,
    extensions,
    lockedNovi,
    lastUpdatedTokensAt,
    defensiveUnit1,
    defensiveUnit2,
    defensiveUnit3,
    operativeUnit1,
    operativeUnit2,
    operativeUnit3,
    meleeWeapons,
    rangedWeapons,
    siegeWeapons,
    armorPieces,
    produce,
    vehicles,
    cashOnHand,
    cashInVault,
    happinessDefensive,
    happinessOperative,
    currentLat,
    currentLong,
    travelingToLat,
    travelingToLong,
    arrivalTime,
    currentCity,
    travelType,
    originCity,
    destinationCity,
    departureTime,
    travelSpeedLocked,
    subscriptionTier,
    subscriptionEnd,
    level,
    currentXp,
    reputation,
    networth,
    encounterStamina,
    maxEncounterStamina,
    lastStaminaUpdate,
    currentEvent,
    gems,
    fragments,
    totalAttacks,
    totalDefenses,
    totalAttackPower,
    totalEncounterAttacks,
    totalLockedNoviAcquired,
    totalSent,
    totalReceived,
    newPlayerProtectionUntil,
    flaggedByGovernance,
    lootCounter,
    researchAttackBps,
    researchDefenseBps,
    researchCritChanceBps,
    researchCritDamageBps,
    researchLootBonusBps,
    researchEncounterSuccessBps,
    researchSynchronyBonusBps,
    researchReputationBonusBps,
    researchStaminaBonusBps,
    researchCollectionBonusBps,
    researchLootMagnetismBps,
    researchDailyRewardBps,
    hasDailyRewards,
    hasMining,
    hasFishing,
    hasFragmentDrops,
    hasGemDrops,
    researchBuffVersion,
    lastDailyClaim,
    activeHeroes,
    defensiveHeroSlot,
    meditatingHeroSlot,
    heroAttackBps,
    heroDefenseBps,
    heroEconomyBps,
    heroXpGainBps,
    heroTrainingCostReductionBps,
    heroCollectionRateBps,
    heroRallyCapacityBps,
    heroStaminaRegenBps,
    heroProduceGenerationBps,
    heroWeaponEfficiencyBps,
    heroArmorEfficiencyBps,
    heroCritChanceBps,
    heroEncounterDamageBps,
    heroLootBonusBps,
    heroSynchronyBonusBps,
    heroResourceCapacityBps,
    heroUnitCapacityBps,
    blessedHeroBonusBps,
    slotLocationBonus,
    team,
    teamSlotIndex,
    dailyTransferCount,
    dailyTransferred,
    lastTransferReset,
    rallyCaps,
    rallyStats,
    staminaPotions,
    xpBoosters,
    lootMagnets,
    shieldTokens,
    speedElixirs,
    attackBoosters,
    defenseBoosters,
    collectionBoosters,
    rallyHorns,
    teleportScrolls,
    mysteryKeys,
    commonMaterials,
    uncommonMaterials,
    rareMaterials,
    epicMaterials,
    legendaryMaterials,
    equippedWeaponBonusBps,
    equippedArmorBonusBps,
    totalShopSpent,
    milestoneTier,
    loyaltyStreak,
    dailyPurchaseCount,
    flashClaimsToday,
    lastPurchaseDay,
    lastDailyReset,
    meditationStartedAt,
    reinforcementDef1,
    reinforcementDef2,
    reinforcementDef3,
    reinforcementMelee,
    reinforcementRanged,
    reinforcementSiege,
    reinforcementOriginalUnits,
    reinforcementOriginalWeapons,
    reinforcementHeroDefenseBps,
    reinforcementHeroWeaponEffBps,
    reinforcementHeroArmorEffBps,
    reinforcementSourceCount,
  };
}

/** Parse PlayerCore from account info */
export function parsePlayer(accountInfo: AccountInfo<Buffer>): PlayerCore | null {
  if (!accountInfo.data || accountInfo.data.length < CORE_SIZE) {
    return null;
  }
  return deserializePlayer(accountInfo.data);
}

// ============================================================
// Helper Functions
// ============================================================

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

/** Check if subscription is active */
export function isSubscriptionActive(player: PlayerCore, nowSeconds: number): boolean {
  return player.subscriptionEnd.toNumber() > nowSeconds && player.subscriptionTier > 0;
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
