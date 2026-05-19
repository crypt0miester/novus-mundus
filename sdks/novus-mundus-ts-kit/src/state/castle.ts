/**
 * Castle System Accounts
 *
 * CastleAccount - Primary castle state (320 bytes)
 * KingRegistryAccount - Track which castle a king owns (72 bytes)
 * CourtPositionAccount - Court advisor positions (104 bytes)
 * GarrisonContribution - Individual garrison contributions (88 bytes)
 * TeamCastleRewardAccount - Team member reward tracking (80 bytes)
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, pad, u8, u16, u32, u64, i32, i64, bool, pubkey, fixedString } from '../utils/codec';
import { CastleTier, CastleStatus, CourtPosition } from '../types/enums';

// Castle Account Interface

export interface CastleAccount {
  // Identity
  castleId: number;
  cityId: number;
  tier: CastleTier;
  status: CastleStatus;
  bump: number;

  // Name
  name: string;

  // Location
  latitude: number;
  longitude: number;

  // Ruler Info
  king: Address;
  team: Address;
  claimedAt: bigint;
  contestEndAt: bigint;

  // Garrison Tracking
  garrisonCount: number;
  maxGarrison: number;

  // Court Tracking
  courtCount: number;
  maxCourt: number;
  courtAppointmentCooldown: number;

  // Upgrade Levels
  fortificationLevel: number;
  treasuryLevel: number;
  chambersLevel: number;
  watchtowerLevel: number;
  armoryLevel: number;

  // Upgrade In Progress
  upgradeType: number;
  upgradeTargetLevel: number;
  upgradeEndAt: bigint;

  // DAO Configuration - Eligibility
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  protectionDuration: bigint;

  // DAO Configuration - Reward Rates
  tierMultiplierBps: number;
  kingLootCutBps: number;
  kingNoviPerDay: bigint;
  kingCashPerDay: bigint;
  courtNoviPerDay: bigint;
  courtCashPerDay: bigint;
  memberNoviPerDay: bigint;
  memberCashPerDay: bigint;

  // Statistics
  timesClaimed: number;
  successfulDefenses: number;
  failedDefenses: number;
  totalRewardsDistributed: bigint;

  // Transition Progress
  transitionGarrisonCleaned: number;
  transitionCourtCleaned: boolean;
  transitionRewardsCleaned: number;
  transitionNewKing: Address;

  // Activation
  activatesAt: bigint;

  // Computed helpers
  isVacant: boolean;
  hasKing: boolean;
}

// King Registry Account

export interface KingRegistryAccount {
  king: Address;
  castle: Address;
  bump: number;
}

// Court Position Account

export interface CourtPositionAccount {
  castle: Address;
  holder: Address;
  position: CourtPosition;
  appointedAt: bigint;
  lastClaimedAt: bigint;
  bump: number;
}

// Garrison Contribution Account

export interface GarrisonContributionAccount {
  castle: Address;
  contributor: Address;
  du1: bigint;
  du2: bigint;
  du3: bigint;
  joinedAt: bigint;
  lastClaimedAt: bigint;
  bump: number;
}

// Team Castle Reward Account

export interface TeamCastleRewardAccount {
  castle: Address;
  team: Address;
  member: Address;
  lastClaimedAt: bigint;
  bump: number;
}

// Codecs

/** Decoded CastleAccount fields (excludes computed `isVacant`/`hasKing`) */
type CastleDecoded = Omit<CastleAccount, 'isVacant' | 'hasKing'>;

/** CastleAccount `#[repr(C)]` codec */
const castleCodec = reprC<CastleDecoded>([
  pad(1), // account_key
  pad(32), // game_engine
  ['castleId', u16],
  ['cityId', u16],
  ['tier', u8],
  ['status', u8],
  ['bump', u8],
  pad(1), // _padding1
  ['name', fixedString(32)],
  pad(1), // name_len
  pad(3), // _padding2
  ['latitude', i32],
  ['longitude', i32],
  pad(8), // _padding_loc
  ['king', pubkey],
  ['team', pubkey],
  ['claimedAt', i64],
  ['contestEndAt', i64],
  ['garrisonCount', u8],
  ['maxGarrison', u8],
  pad(2), // _padding3
  ['courtCount', u8],
  ['maxCourt', u8],
  ['courtAppointmentCooldown', u16],
  ['fortificationLevel', u8],
  ['treasuryLevel', u8],
  ['chambersLevel', u8],
  ['watchtowerLevel', u8],
  ['armoryLevel', u8],
  pad(3), // _padding4
  ['upgradeType', u8],
  ['upgradeTargetLevel', u8],
  pad(6), // _padding5
  ['upgradeEndAt', i64],
  ['minLevel', u8],
  ['minNetworthMillions', u8],
  ['minTroopsThousands', u8],
  pad(5), // _padding6
  ['protectionDuration', i64],
  ['tierMultiplierBps', u16],
  ['kingLootCutBps', u16],
  pad(4), // _padding7
  ['kingNoviPerDay', u64],
  ['kingCashPerDay', u64],
  ['courtNoviPerDay', u64],
  ['courtCashPerDay', u64],
  ['memberNoviPerDay', u64],
  ['memberCashPerDay', u64],
  ['timesClaimed', u32],
  ['successfulDefenses', u32],
  ['failedDefenses', u32],
  pad(4), // _padding8
  ['totalRewardsDistributed', u64],
  ['transitionGarrisonCleaned', u8],
  ['transitionCourtCleaned', bool],
  ['transitionRewardsCleaned', u8],
  pad(5), // _transition_padding
  ['transitionNewKing', pubkey],
  pad(8), // _transition_reserved
  ['activatesAt', i64],
]);

/** KingRegistryAccount `#[repr(C)]` codec */
const kingRegistryCodec = reprC<KingRegistryAccount>([
  pad(1), // account_key
  ['king', pubkey],
  ['castle', pubkey],
  ['bump', u8],
]);

/** Decoded CourtPosition fields (excludes placeholder `lastClaimedAt`) */
type CourtPositionDecoded = Omit<CourtPositionAccount, 'lastClaimedAt'>;

/** CourtPositionAccount `#[repr(C)]` codec */
const courtPositionCodec = reprC<CourtPositionDecoded>([
  pad(1), // account_key
  ['castle', pubkey],
  ['position', u8],
  ['bump', u8],
  pad(6), // _padding1
  ['holder', pubkey],
  ['appointedAt', i64],
]);

/** Decoded GarrisonContribution fields (excludes placeholder `lastClaimedAt`) */
type GarrisonContributionDecoded = Omit<GarrisonContributionAccount, 'lastClaimedAt'>;

/** GarrisonContributionAccount `#[repr(C)]` codec */
const garrisonContributionCodec = reprC<GarrisonContributionDecoded>([
  pad(1), // account_key
  ['castle', pubkey],
  ['contributor', pubkey],
  ['bump', u8],
  pad(1), // is_king
  pad(6), // _padding1
  ['joinedAt', i64], // contributed_at
  ['du1', u64], // units_1
  ['du2', u64], // units_2
  ['du3', u64], // units_3
  pad(24), // melee_weapons, ranged_weapons, siege_weapons
  pad(32), // hero_mint
  pad(8), // hero_defense_bps, hero_weapon_eff_bps, _padding2
  pad(24), // loot_melee, loot_ranged, loot_siege
  pad(8), // loot_claimed, _padding3
]);

/** Decoded TeamCastleReward fields (excludes placeholder `team`) */
type TeamCastleRewardDecoded = Omit<TeamCastleRewardAccount, 'team'>;

/** TeamCastleRewardAccount `#[repr(C)]` codec */
const teamCastleRewardCodec = reprC<TeamCastleRewardDecoded>([
  pad(1), // account_key
  ['castle', pubkey],
  ['member', pubkey],
  ['bump', u8],
  pad(7), // _padding1
  ['lastClaimedAt', i64],
  pad(8), // total_claimed_novi (not in interface)
]);

// Deserialization

export function deserializeCastle(data: Uint8Array): CastleAccount {
  const decoded = castleCodec.decode(data);
  const isVacant = isNullPubkey(decoded.king);
  return { ...decoded, isVacant, hasKing: !isVacant };
}

export function deserializeKingRegistry(data: Uint8Array): KingRegistryAccount {
  return kingRegistryCodec.decode(data);
}

export function deserializeCourtPosition(data: Uint8Array): CourtPositionAccount {
  const decoded = courtPositionCodec.decode(data);
  // lastClaimedAt is not in the Rust struct; using appointedAt for compatibility
  return { ...decoded, lastClaimedAt: decoded.appointedAt };
}

export function deserializeGarrisonContribution(data: Uint8Array): GarrisonContributionAccount {
  const decoded = garrisonContributionCodec.decode(data);
  // lastClaimedAt is not in the Rust struct; using joinedAt for compatibility
  return { ...decoded, lastClaimedAt: decoded.joinedAt };
}

export function deserializeTeamCastleReward(data: Uint8Array): TeamCastleRewardAccount {
  const decoded = teamCastleRewardCodec.decode(data);
  // team is not in the Rust struct; placeholder for interface compatibility
  return { ...decoded, team: decoded.castle };
}

// Parse Functions

/** Parse CastleAccount from account info */
export function parseCastle(accountInfo: { data: Uint8Array }): CastleAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeCastle(accountInfo.data);
}

/** Parse KingRegistryAccount from account info */
export function parseKingRegistry(accountInfo: { data: Uint8Array }): KingRegistryAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeKingRegistry(accountInfo.data);
}

/** Parse CourtPositionAccount from account info */
export function parseCourtPosition(accountInfo: { data: Uint8Array }): CourtPositionAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeCourtPosition(accountInfo.data);
}

/** Parse GarrisonContributionAccount from account info */
export function parseGarrisonContribution(accountInfo: { data: Uint8Array }): GarrisonContributionAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeGarrisonContribution(accountInfo.data);
}

/** Parse TeamCastleRewardAccount from account info */
export function parseTeamCastleReward(accountInfo: { data: Uint8Array }): TeamCastleRewardAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeTeamCastleReward(accountInfo.data);
}
