/**
 * Rally Accounts
 *
 * RallyAccount - Team attack coordination (368 bytes)
 * RallyParticipant - Per-joiner state (352 bytes)
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, pad, u8, u16, u64, i32, i64, bool, pubkey } from '../utils/codec';
import { RallyStatus, RallyTargetType } from '../types/enums';

// Rally Account Interface

export interface RallyAccount {
  // Identity
  id: bigint;
  creator: Address;
  team: Address;

  // Location
  rallyCity: number;
  targetCity: number;
  targetType: RallyTargetType;

  // Target
  target: Address;

  // Timing
  createdAt: bigint;
  gatherAt: bigint;
  executeAt: bigint;
  marchStartedAt: bigint;
  arriveAt: bigint;
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
  totalUnits: bigint;
  totalMeleeWeapons: bigint;
  totalRangedWeapons: bigint;
  totalSiegeWeapons: bigint;
  totalPower: bigint;

  // Combat results
  totalCasualties: bigint;
  attackDamageDealt: bigint;
  defenseDamageReceived: bigint;

  // Resource loot
  totalLootCash: bigint;
  totalLootLockedNovi: bigint;

  // Weapon loot
  totalLootMelee: bigint;
  totalLootRanged: bigint;
  totalLootSiege: bigint;

  // Other loot
  totalLootProduce: bigint;
  totalLootVehicles: bigint;
  totalLootFragments: bigint;
  totalLootGems: bigint;

  // Status
  status: RallyStatus;
  fallbackTriggered: boolean;
  attackerWon: boolean;
  bump: number;
}

/** RallyAccount size in bytes (repr(C) layout with alignment padding) */
export const RALLY_ACCOUNT_SIZE = 368;

// Rally Participant Interface

export interface RallyParticipant {
  // Identity
  rallyId: bigint;
  rallyCreator: Address;
  participant: Address;

  // Home location
  homeCity: number;

  // Units committed
  unitsCommitted1: bigint;
  unitsCommitted2: bigint;
  unitsCommitted3: bigint;

  // Weapons committed
  meleeWeaponsCommitted: bigint;
  rangedWeaponsCommitted: bigint;
  siegeWeaponsCommitted: bigint;

  // Buffs snapshotted
  researchAttackBps: number;
  researchCritChanceBps: number;
  researchCritDamageBps: number;
  heroAttackBps: number;
  heroWeaponEfficiencyBps: number;
  heroCritChanceBps: number;
  equippedWeaponBonusBps: number;

  // Hero
  hero: Address;
  heroPowerContribution: bigint;

  // Travel to rally
  travelStartedAt: bigint;
  arrivesAtRally: bigint;
  travelDuration: number;

  // Status flags
  arrivedAtRally: boolean;
  includedInMarch: boolean;
  returned: boolean;
  isLeader: boolean;

  // Casualties
  casualties1: bigint;
  casualties2: bigint;
  casualties3: bigint;

  // Resource loot share
  lootCash: bigint;
  lootLockedNovi: bigint;

  // Weapon loot share
  lootMelee: bigint;
  lootRanged: bigint;
  lootSiege: bigint;

  // Other loot share
  lootProduce: bigint;
  lootVehicles: bigint;
  lootFragments: bigint;
  lootGems: bigint;

  // Return journey
  returnStartedAt: bigint;
  returnDuration: number;

  // Contribution tracking
  contributionPower: bigint;
  contributionBps: number;
  bump: number;
}

/** RallyParticipant size in bytes (repr(C) layout with alignment padding) */
export const RALLY_PARTICIPANT_SIZE = 352;

// Codecs

/** RallyAccount `#[repr(C)]` codec */
const rallyCodec = reprC<RallyAccount>([
  pad(1), // account_key discriminator
  pad(32), // game_engine (not in interface)
  ['id', u64],
  ['creator', pubkey],
  ['team', pubkey],
  ['rallyCity', u16],
  ['targetCity', u16],
  ['targetType', u8],
  pad(3), // _padding
  ['target', pubkey],
  ['createdAt', i64],
  ['gatherAt', i64],
  ['executeAt', i64],
  ['marchStartedAt', i64],
  ['arriveAt', i64],
  ['marchDuration', i32],
  pad(4), // _padding
  ['leaderResearchAttackBps', u16],
  ['leaderResearchCritChanceBps', u16],
  ['leaderResearchCritDamageBps', u16],
  ['leaderHeroAttackBps', u16],
  ['leaderHeroWeaponEfficiencyBps', u16],
  ['leaderHeroCritChanceBps', u16],
  ['leaderEquippedWeaponBonusBps', u16],
  pad(2), // _padding
  ['minParticipants', u8],
  ['maxParticipants', u8],
  ['participantCount', u8],
  ['arrivedCount', u8],
  ['marchedCount', u8],
  ['returnedCount', u8],
  ['totalUnits', u64],
  ['totalMeleeWeapons', u64],
  ['totalRangedWeapons', u64],
  ['totalSiegeWeapons', u64],
  ['totalPower', u64],
  ['totalCasualties', u64],
  ['attackDamageDealt', u64],
  ['defenseDamageReceived', u64],
  ['totalLootCash', u64],
  ['totalLootLockedNovi', u64],
  ['totalLootMelee', u64],
  ['totalLootRanged', u64],
  ['totalLootSiege', u64],
  ['totalLootProduce', u64],
  ['totalLootVehicles', u64],
  ['totalLootFragments', u64],
  ['totalLootGems', u64],
  ['status', u8],
  ['fallbackTriggered', bool],
  ['attackerWon', bool],
  ['bump', u8],
], RALLY_ACCOUNT_SIZE);

/** RallyParticipant `#[repr(C)]` codec */
const rallyParticipantCodec = reprC<RallyParticipant>([
  pad(1), // account_key discriminator
  ['rallyId', u64],
  ['rallyCreator', pubkey],
  ['participant', pubkey],
  ['homeCity', u16],
  pad(2), // _padding1
  ['unitsCommitted1', u64],
  ['unitsCommitted2', u64],
  ['unitsCommitted3', u64],
  ['meleeWeaponsCommitted', u64],
  ['rangedWeaponsCommitted', u64],
  ['siegeWeaponsCommitted', u64],
  ['researchAttackBps', u16],
  ['researchCritChanceBps', u16],
  ['researchCritDamageBps', u16],
  ['heroAttackBps', u16],
  ['heroWeaponEfficiencyBps', u16],
  ['heroCritChanceBps', u16],
  ['equippedWeaponBonusBps', u16],
  pad(2), // _padding
  ['hero', pubkey],
  ['heroPowerContribution', u64],
  ['travelStartedAt', i64],
  ['arrivesAtRally', i64],
  ['travelDuration', i32],
  pad(4), // _padding
  ['arrivedAtRally', bool],
  ['includedInMarch', bool],
  ['returned', bool],
  ['isLeader', bool],
  ['casualties1', u64],
  ['casualties2', u64],
  ['casualties3', u64],
  ['lootCash', u64],
  ['lootLockedNovi', u64],
  ['lootMelee', u64],
  ['lootRanged', u64],
  ['lootSiege', u64],
  ['lootProduce', u64],
  ['lootVehicles', u64],
  ['lootFragments', u64],
  ['lootGems', u64],
  ['returnStartedAt', i64],
  ['returnDuration', i32],
  ['contributionPower', u64],
  ['contributionBps', u16],
  ['bump', u8],
], RALLY_PARTICIPANT_SIZE);

// Deserialization

/** Deserialize RallyAccount from raw bytes */
export function deserializeRally(data: Uint8Array): RallyAccount {
  return rallyCodec.decode(data);
}

/** Deserialize RallyParticipant from raw bytes */
export function deserializeRallyParticipant(data: Uint8Array): RallyParticipant {
  return rallyParticipantCodec.decode(data);
}

// Parse Functions

/** Parse RallyAccount from account info */
export function parseRally(accountInfo: { data: Uint8Array }): RallyAccount | null {
  if (!accountInfo.data || accountInfo.data.length < RALLY_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeRally(accountInfo.data);
}

/** Parse RallyParticipant from account info */
export function parseRallyParticipant(accountInfo: { data: Uint8Array }): RallyParticipant | null {
  if (!accountInfo.data || accountInfo.data.length < RALLY_PARTICIPANT_SIZE) {
    return null;
  }
  return deserializeRallyParticipant(accountInfo.data);
}

// Helper Functions

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
export function getRallyTotalWeapons(rally: RallyAccount): bigint {
  return (rally.totalMeleeWeapons + rally.totalRangedWeapons + rally.totalSiegeWeapons);
}

/** Check if participant has hero committed */
export function participantHasHero(participant: RallyParticipant): boolean {
  return !isNullPubkey(participant.hero);
}

/** Get participant total committed units */
export function getParticipantTotalUnits(participant: RallyParticipant): bigint {
  return (participant.unitsCommitted1 + participant.unitsCommitted2 + participant.unitsCommitted3);
}

/** Get participant total casualties */
export function getParticipantTotalCasualties(participant: RallyParticipant): bigint {
  return (participant.casualties1 + participant.casualties2 + participant.casualties3);
}
