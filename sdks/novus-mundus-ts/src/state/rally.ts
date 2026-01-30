/**
 * Rally Accounts
 *
 * RallyAccount - Team attack coordination (304 bytes)
 * RallyParticipant - Per-joiner state (312 bytes)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize.ts';
import { RallyStatus, RallyTargetType } from '../types/enums.ts';

// ============================================================
// Rally Account Interface
// ============================================================

export interface RallyAccount {
  // Identity
  id: BN;
  creator: PublicKey;
  team: PublicKey;

  // Location
  rallyCity: number;
  targetCity: number;
  targetType: RallyTargetType;

  // Target
  target: PublicKey;

  // Timing
  createdAt: BN;
  gatherAt: BN;
  executeAt: BN;
  marchStartedAt: BN;
  arriveAt: BN;
  marchDuration: number;

  // Leader buffs
  leaderResearchAttackBps: number;
  leaderResearchCritChanceBps: number;
  leaderResearchCritDamageBps: number;
  leaderHeroAttackBps: number;
  leaderHeroWeaponEfficiencyBps: number;
  leaderHeroCritChanceBps: number;
  leaderEquippedWeaponBonusBps: number;

  // Participants
  minParticipants: number;
  maxParticipants: number;
  participantCount: number;
  arrivedCount: number;
  marchedCount: number;
  returnedCount: number;

  // Aggregated totals
  totalUnits: BN;
  totalMeleeWeapons: BN;
  totalRangedWeapons: BN;
  totalSiegeWeapons: BN;
  totalPower: BN;

  // Combat results
  totalCasualties: BN;
  attackDamageDealt: BN;
  defenseDamageReceived: BN;

  // Resource loot
  totalLootCash: BN;
  totalLootLockedNovi: BN;

  // Weapon loot
  totalLootMelee: BN;
  totalLootRanged: BN;
  totalLootSiege: BN;

  // Other loot
  totalLootProduce: BN;
  totalLootVehicles: BN;
  totalLootFragments: BN;
  totalLootGems: BN;

  // Status
  status: RallyStatus;
  fallbackTriggered: boolean;
  attackerWon: boolean;
  bump: number;
}

/** RallyAccount size in bytes */
export const RALLY_ACCOUNT_SIZE = 304;

// ============================================================
// Rally Participant Interface
// ============================================================

export interface RallyParticipant {
  // Identity
  rallyId: BN;
  rallyCreator: PublicKey;
  participant: PublicKey;

  // Home location
  homeCity: number;

  // Units committed
  unitsCommitted1: BN;
  unitsCommitted2: BN;
  unitsCommitted3: BN;

  // Weapons committed
  meleeWeaponsCommitted: BN;
  rangedWeaponsCommitted: BN;
  siegeWeaponsCommitted: BN;

  // Buffs snapshotted
  researchAttackBps: number;
  researchCritChanceBps: number;
  researchCritDamageBps: number;
  heroAttackBps: number;
  heroWeaponEfficiencyBps: number;
  heroCritChanceBps: number;
  equippedWeaponBonusBps: number;

  // Hero
  hero: PublicKey;
  heroPowerContribution: BN;

  // Travel to rally
  travelStartedAt: BN;
  arrivesAtRally: BN;
  travelDuration: number;

  // Status flags
  arrivedAtRally: boolean;
  includedInMarch: boolean;
  returned: boolean;
  isLeader: boolean;

  // Casualties
  casualties1: BN;
  casualties2: BN;
  casualties3: BN;

  // Resource loot share
  lootCash: BN;
  lootLockedNovi: BN;

  // Weapon loot share
  lootMelee: BN;
  lootRanged: BN;
  lootSiege: BN;

  // Other loot share
  lootProduce: BN;
  lootVehicles: BN;
  lootFragments: BN;
  lootGems: BN;

  // Return journey
  returnStartedAt: BN;
  returnDuration: number;

  // Contribution tracking
  contributionPower: BN;
  contributionBps: number;
  bump: number;
}

/** RallyParticipant size in bytes */
export const RALLY_PARTICIPANT_SIZE = 312;

// ============================================================
// Deserialization
// ============================================================

/** Deserialize RallyAccount from raw bytes */
export function deserializeRally(data: Uint8Array | Buffer): RallyAccount {
  const reader = new BufferReader(data);

  // Identity (48 bytes)
  const id = reader.readU64();
  const creator = reader.readPubkey();
  const team = reader.readPubkey();

  // Location (8 bytes)
  const rallyCity = reader.readU16();
  const targetCity = reader.readU16();
  const targetTypeValue = reader.readU8();
  const targetType = targetTypeValue as RallyTargetType;
  reader.skip(3); // padding

  // Target (32 bytes)
  const target = reader.readPubkey();

  // Timing (48 bytes)
  const createdAt = reader.readI64();
  const gatherAt = reader.readI64();
  const executeAt = reader.readI64();
  const marchStartedAt = reader.readI64();
  const arriveAt = reader.readI64();
  const marchDuration = reader.readI32();
  reader.skip(4); // padding

  // Leader buffs (16 bytes)
  const leaderResearchAttackBps = reader.readU16();
  const leaderResearchCritChanceBps = reader.readU16();
  const leaderResearchCritDamageBps = reader.readU16();
  const leaderHeroAttackBps = reader.readU16();
  const leaderHeroWeaponEfficiencyBps = reader.readU16();
  const leaderHeroCritChanceBps = reader.readU16();
  const leaderEquippedWeaponBonusBps = reader.readU16();
  reader.skip(2); // padding

  // Participants (8 bytes)
  const minParticipants = reader.readU8();
  const maxParticipants = reader.readU8();
  const participantCount = reader.readU8();
  const arrivedCount = reader.readU8();
  const marchedCount = reader.readU8();
  const returnedCount = reader.readU8();
  reader.skip(2); // padding

  // Aggregated totals (40 bytes)
  const totalUnits = reader.readU64();
  const totalMeleeWeapons = reader.readU64();
  const totalRangedWeapons = reader.readU64();
  const totalSiegeWeapons = reader.readU64();
  const totalPower = reader.readU64();

  // Combat results (24 bytes)
  const totalCasualties = reader.readU64();
  const attackDamageDealt = reader.readU64();
  const defenseDamageReceived = reader.readU64();

  // Resource loot (16 bytes)
  const totalLootCash = reader.readU64();
  const totalLootLockedNovi = reader.readU64();

  // Weapon loot (24 bytes)
  const totalLootMelee = reader.readU64();
  const totalLootRanged = reader.readU64();
  const totalLootSiege = reader.readU64();

  // Other loot (32 bytes)
  const totalLootProduce = reader.readU64();
  const totalLootVehicles = reader.readU64();
  const totalLootFragments = reader.readU64();
  const totalLootGems = reader.readU64();

  // Status (8 bytes)
  const statusValue = reader.readU8();
  const status = statusValue as RallyStatus;
  const fallbackTriggered = reader.readBool();
  const attackerWon = reader.readBool();
  const bump = reader.readU8();
  reader.skip(4); // padding

  return {
    id,
    creator,
    team,
    rallyCity,
    targetCity,
    targetType,
    target,
    createdAt,
    gatherAt,
    executeAt,
    marchStartedAt,
    arriveAt,
    marchDuration,
    leaderResearchAttackBps,
    leaderResearchCritChanceBps,
    leaderResearchCritDamageBps,
    leaderHeroAttackBps,
    leaderHeroWeaponEfficiencyBps,
    leaderHeroCritChanceBps,
    leaderEquippedWeaponBonusBps,
    minParticipants,
    maxParticipants,
    participantCount,
    arrivedCount,
    marchedCount,
    returnedCount,
    totalUnits,
    totalMeleeWeapons,
    totalRangedWeapons,
    totalSiegeWeapons,
    totalPower,
    totalCasualties,
    attackDamageDealt,
    defenseDamageReceived,
    totalLootCash,
    totalLootLockedNovi,
    totalLootMelee,
    totalLootRanged,
    totalLootSiege,
    totalLootProduce,
    totalLootVehicles,
    totalLootFragments,
    totalLootGems,
    status,
    fallbackTriggered,
    attackerWon,
    bump,
  };
}

/** Deserialize RallyParticipant from raw bytes */
export function deserializeRallyParticipant(data: Uint8Array | Buffer): RallyParticipant {
  const reader = new BufferReader(data);

  // Identity (48 bytes)
  const rallyId = reader.readU64();
  const rallyCreator = reader.readPubkey();
  const participant = reader.readPubkey();

  // Home location (4 bytes)
  const homeCity = reader.readU16();
  reader.skip(2); // padding

  // Units committed (24 bytes)
  const unitsCommitted1 = reader.readU64();
  const unitsCommitted2 = reader.readU64();
  const unitsCommitted3 = reader.readU64();

  // Weapons committed (24 bytes)
  const meleeWeaponsCommitted = reader.readU64();
  const rangedWeaponsCommitted = reader.readU64();
  const siegeWeaponsCommitted = reader.readU64();

  // Buffs (16 bytes)
  const researchAttackBps = reader.readU16();
  const researchCritChanceBps = reader.readU16();
  const researchCritDamageBps = reader.readU16();
  const heroAttackBps = reader.readU16();
  const heroWeaponEfficiencyBps = reader.readU16();
  const heroCritChanceBps = reader.readU16();
  const equippedWeaponBonusBps = reader.readU16();
  reader.skip(2); // padding

  // Hero (40 bytes)
  const hero = reader.readPubkey();
  const heroPowerContribution = reader.readU64();

  // Travel (24 bytes)
  const travelStartedAt = reader.readI64();
  const arrivesAtRally = reader.readI64();
  const travelDuration = reader.readI32();
  reader.skip(4); // padding

  // Status flags (8 bytes)
  const arrivedAtRally = reader.readBool();
  const includedInMarch = reader.readBool();
  const returned = reader.readBool();
  const isLeader = reader.readBool();
  reader.skip(4); // padding

  // Casualties (24 bytes)
  const casualties1 = reader.readU64();
  const casualties2 = reader.readU64();
  const casualties3 = reader.readU64();

  // Resource loot (16 bytes)
  const lootCash = reader.readU64();
  const lootLockedNovi = reader.readU64();

  // Weapon loot (24 bytes)
  const lootMelee = reader.readU64();
  const lootRanged = reader.readU64();
  const lootSiege = reader.readU64();

  // Other loot (32 bytes)
  const lootProduce = reader.readU64();
  const lootVehicles = reader.readU64();
  const lootFragments = reader.readU64();
  const lootGems = reader.readU64();

  // Return journey (16 bytes)
  const returnStartedAt = reader.readI64();
  const returnDuration = reader.readI32();
  reader.skip(4); // padding

  // Contribution (16 bytes)
  const contributionPower = reader.readU64();
  const contributionBps = reader.readU16();
  const bump = reader.readU8();
  reader.skip(5); // padding

  return {
    rallyId,
    rallyCreator,
    participant,
    homeCity,
    unitsCommitted1,
    unitsCommitted2,
    unitsCommitted3,
    meleeWeaponsCommitted,
    rangedWeaponsCommitted,
    siegeWeaponsCommitted,
    researchAttackBps,
    researchCritChanceBps,
    researchCritDamageBps,
    heroAttackBps,
    heroWeaponEfficiencyBps,
    heroCritChanceBps,
    equippedWeaponBonusBps,
    hero,
    heroPowerContribution,
    travelStartedAt,
    arrivesAtRally,
    travelDuration,
    arrivedAtRally,
    includedInMarch,
    returned,
    isLeader,
    casualties1,
    casualties2,
    casualties3,
    lootCash,
    lootLockedNovi,
    lootMelee,
    lootRanged,
    lootSiege,
    lootProduce,
    lootVehicles,
    lootFragments,
    lootGems,
    returnStartedAt,
    returnDuration,
    contributionPower,
    contributionBps,
    bump,
  };
}

// ============================================================
// Parse Functions
// ============================================================

/** Parse RallyAccount from account info */
export function parseRally(accountInfo: AccountInfo<Buffer>): RallyAccount | null {
  if (!accountInfo.data || accountInfo.data.length < RALLY_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeRally(accountInfo.data);
}

/** Parse RallyParticipant from account info */
export function parseRallyParticipant(accountInfo: AccountInfo<Buffer>): RallyParticipant | null {
  if (!accountInfo.data || accountInfo.data.length < RALLY_PARTICIPANT_SIZE) {
    return null;
  }
  return deserializeRallyParticipant(accountInfo.data);
}

// ============================================================
// Helper Functions
// ============================================================

/** Check if rally is gathering */
export function isRallyGathering(rally: RallyAccount): boolean {
  return rally.status === RallyStatus.Gathering;
}

/** Check if rally is marching */
export function isRallyMarching(rally: RallyAccount): boolean {
  return rally.status === RallyStatus.Marching;
}

/** Check if rally is returning */
export function isRallyReturning(rally: RallyAccount): boolean {
  return rally.status === RallyStatus.Returning;
}

/** Check if rally is completed */
export function isRallyCompleted(rally: RallyAccount): boolean {
  return rally.status === RallyStatus.Completed;
}

/** Check if rally can be closed */
export function canCloseRally(rally: RallyAccount): boolean {
  return (
    (rally.status === RallyStatus.Completed || rally.status === RallyStatus.Cancelled) &&
    rally.returnedCount >= rally.participantCount
  );
}

/** Get total weapons for rally */
export function getRallyTotalWeapons(rally: RallyAccount): BN {
  return rally.totalMeleeWeapons.add(rally.totalRangedWeapons).add(rally.totalSiegeWeapons);
}

/** Check if participant has hero committed */
export function participantHasHero(participant: RallyParticipant): boolean {
  return !isNullPubkey(participant.hero);
}

/** Get participant total committed units */
export function getParticipantTotalUnits(participant: RallyParticipant): BN {
  return participant.unitsCommitted1.add(participant.unitsCommitted2).add(participant.unitsCommitted3);
}

/** Get participant total casualties */
export function getParticipantTotalCasualties(participant: RallyParticipant): BN {
  return participant.casualties1.add(participant.casualties2).add(participant.casualties3);
}
