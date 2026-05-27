/**
 * Castle System Accounts
 *
 * CastleAccount - Primary castle state (320 bytes)
 * KingRegistryAccount - Track which castle a king owns (72 bytes)
 * CourtPositionAccount - Court advisor positions (104 bytes)
 * GarrisonContribution - Individual garrison contributions (88 bytes)
 * TeamCastleRewardAccount - Team member reward tracking (80 bytes)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize';
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

  // Location — anchor corner of the N×N footprint, microdegrees.
  latitude: number;
  longitude: number;
  /** N for the castle's N×N footprint (1..=4). Cells extend at
   * positive offsets from the anchor; matches Rust
   * `CastleAccount.footprint_size`. */
  footprintSize: number;

  // Ruler Info
  king: PublicKey;
  team: PublicKey;
  claimedAt: BN;
  contestEndAt: BN;

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
  upgradeEndAt: BN;

  // DAO Configuration - Eligibility
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  protectionDuration: BN;

  // DAO Configuration - Reward Rates
  tierMultiplierBps: number;
  kingLootCutBps: number;
  kingNoviPerDay: BN;
  kingCashPerDay: BN;
  courtNoviPerDay: BN;
  courtCashPerDay: BN;
  memberNoviPerDay: BN;
  memberCashPerDay: BN;

  // Statistics
  timesClaimed: number;
  successfulDefenses: number;
  failedDefenses: number;
  totalRewardsDistributed: BN;

  // Transition Progress
  transitionGarrisonCleaned: number;
  transitionCourtCleaned: boolean;
  transitionRewardsCleaned: number;
  transitionNewKing: PublicKey;

  // Activation
  activatesAt: BN;

  // Computed helpers
  isVacant: boolean;
  hasKing: boolean;
}

// King Registry Account

export interface KingRegistryAccount {
  king: PublicKey;
  castle: PublicKey;
  bump: number;
}

// Court Position Account

export interface CourtPositionAccount {
  castle: PublicKey;
  holder: PublicKey;
  position: CourtPosition;
  appointedAt: BN;
  lastClaimedAt: BN;
  bump: number;
}

// Garrison Contribution Account

export interface GarrisonContributionAccount {
  castle: PublicKey;
  contributor: PublicKey;
  du1: BN;
  du2: BN;
  du3: BN;
  joinedAt: BN;
  lastClaimedAt: BN;
  bump: number;
}

// Team Castle Reward Account

export interface TeamCastleRewardAccount {
  castle: PublicKey;
  team: PublicKey;
  member: PublicKey;
  lastClaimedAt: BN;
  bump: number;
}

// Deserialization

export function deserializeCastle(data: Uint8Array | Buffer): CastleAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(32); // game_engine
  reader.skip(1); // implicit padding for u16 alignment

  // Identity (8 bytes)
  const castleId = reader.readU16();
  const cityId = reader.readU16();
  const tier = reader.readU8() as CastleTier;
  const status = reader.readU8() as CastleStatus;
  const bump = reader.readU8();
  reader.skip(1); // _padding1

  // Name (36 bytes)
  const nameBytes = reader.readBytes(32);
  const nameLen = reader.readU8();
  reader.skip(3); // _padding2
  reader.skip(2); // implicit padding for i32 alignment
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen)).replace(/\0/g, '');

  // Location (16 bytes)
  const latitude = reader.readI32();
  const longitude = reader.readI32();
  // Pre-cut castles stored a zeroed byte where footprint_size now
  // lives (consumed one byte of the original _padding_loc[8]); chain
  // attack_castle reads 0 as 1×1 for backwards compatibility. Apply
  // the same fold here so downstream code never sees a 0 and doesn't
  // need its own ?? / Math.max(1, …) shim.
  const footprintSizeRaw = reader.readU8();
  const footprintSize = footprintSizeRaw === 0 ? 1 : footprintSizeRaw;
  reader.skip(7); // _padding_loc (now 7 bytes)

  // Ruler Info (80 bytes)
  const king = reader.readPubkey();
  const team = reader.readPubkey();
  const claimedAt = reader.readI64();
  const contestEndAt = reader.readI64();

  // Garrison Tracking (4 bytes)
  const garrisonCount = reader.readU8();
  const maxGarrison = reader.readU8();
  reader.skip(2); // _padding3

  // Court Tracking (4 bytes)
  const courtCount = reader.readU8();
  const maxCourt = reader.readU8();
  const courtAppointmentCooldown = reader.readU16();

  // Upgrade Levels (8 bytes)
  const fortificationLevel = reader.readU8();
  const treasuryLevel = reader.readU8();
  const chambersLevel = reader.readU8();
  const watchtowerLevel = reader.readU8();
  const armoryLevel = reader.readU8();
  reader.skip(3); // _padding4

  // Upgrade In Progress (16 bytes)
  const upgradeType = reader.readU8();
  const upgradeTargetLevel = reader.readU8();
  reader.skip(6); // _padding5
  const upgradeEndAt = reader.readI64();

  // DAO Configuration - Eligibility (16 bytes)
  const minLevel = reader.readU8();
  const minNetworthMillions = reader.readU8();
  const minTroopsThousands = reader.readU8();
  reader.skip(5); // _padding6
  const protectionDuration = reader.readI64();

  // DAO Configuration - Reward Rates (48 bytes)
  const tierMultiplierBps = reader.readU16();
  const kingLootCutBps = reader.readU16();
  reader.skip(4); // _padding7
  const kingNoviPerDay = reader.readU64();
  const kingCashPerDay = reader.readU64();
  const courtNoviPerDay = reader.readU64();
  const courtCashPerDay = reader.readU64();
  const memberNoviPerDay = reader.readU64();
  const memberCashPerDay = reader.readU64();

  // Statistics (24 bytes)
  const timesClaimed = reader.readU32();
  const successfulDefenses = reader.readU32();
  const failedDefenses = reader.readU32();
  reader.skip(4); // _padding8
  const totalRewardsDistributed = reader.readU64();

  // Transition Progress (48 bytes)
  const transitionGarrisonCleaned = reader.readU8();
  const transitionCourtCleaned = reader.readBool();
  const transitionRewardsCleaned = reader.readU8();
  reader.skip(5); // _transition_padding
  const transitionNewKing = reader.readPubkey();
  reader.skip(8); // _transition_reserved

  // Activation (16 bytes)
  const activatesAt = reader.readI64();
  // reader.skip(8); // _activation_padding
  // reader.skip(16); // _reserved

  const isVacant = isNullPubkey(king);
  const hasKing = !isVacant;

  return {
    castleId,
    cityId,
    tier,
    status,
    bump,
    name,
    latitude,
    longitude,
    footprintSize,
    king,
    team,
    claimedAt,
    contestEndAt,
    garrisonCount,
    maxGarrison,
    courtCount,
    maxCourt,
    courtAppointmentCooldown,
    fortificationLevel,
    treasuryLevel,
    chambersLevel,
    watchtowerLevel,
    armoryLevel,
    upgradeType,
    upgradeTargetLevel,
    upgradeEndAt,
    minLevel,
    minNetworthMillions,
    minTroopsThousands,
    protectionDuration,
    tierMultiplierBps,
    kingLootCutBps,
    kingNoviPerDay,
    kingCashPerDay,
    courtNoviPerDay,
    courtCashPerDay,
    memberNoviPerDay,
    memberCashPerDay,
    timesClaimed,
    successfulDefenses,
    failedDefenses,
    totalRewardsDistributed,
    transitionGarrisonCleaned,
    transitionCourtCleaned,
    transitionRewardsCleaned,
    transitionNewKing,
    activatesAt,
    isVacant,
    hasKing,
  };
}

export function deserializeKingRegistry(data: Uint8Array | Buffer): KingRegistryAccount {
  const reader = new BufferReader(data);
  reader.readU8(); // account_key
  const king = reader.readPubkey();
  const castle = reader.readPubkey();
  const bump = reader.readU8();

  return { king, castle, bump };
}

export function deserializeCourtPosition(data: Uint8Array | Buffer): CourtPositionAccount {
  const reader = new BufferReader(data);
  reader.readU8(); // account_key
  const castle = reader.readPubkey();
  const position = reader.readU8() as CourtPosition;
  const bump = reader.readU8();
  reader.skip(6); // _padding1
  const holder = reader.readPubkey();
  reader.skip(7); // implicit padding for i64 alignment
  const appointedAt = reader.readI64();
  const lastClaimedAt = appointedAt; // Not in Rust struct; using appointedAt for compatibility

  return { castle, holder, position, appointedAt, lastClaimedAt, bump };
}

export function deserializeGarrisonContribution(data: Uint8Array | Buffer): GarrisonContributionAccount {
  const reader = new BufferReader(data);
  reader.readU8(); // account_key
  const castle = reader.readPubkey();
  const contributor = reader.readPubkey();
  const bump = reader.readU8();
  reader.skip(1); // is_king
  reader.skip(6); // _padding1
  reader.skip(7); // implicit padding for i64 alignment
  const joinedAt = reader.readI64(); // contributed_at
  const du1 = reader.readU64(); // units_1
  const du2 = reader.readU64(); // units_2
  const du3 = reader.readU64(); // units_3
  reader.skip(24); // melee_weapons, ranged_weapons, siege_weapons
  reader.skip(32); // hero_mint
  reader.skip(8); // hero_defense_bps, hero_weapon_eff_bps, _padding2
  reader.skip(24); // loot_melee, loot_ranged, loot_siege
  reader.skip(8); // loot_claimed, _padding3
  const lastClaimedAt = joinedAt; // Not in Rust struct; using joinedAt for compatibility

  return { castle, contributor, du1, du2, du3, joinedAt, lastClaimedAt, bump };
}

export function deserializeTeamCastleReward(data: Uint8Array | Buffer): TeamCastleRewardAccount {
  const reader = new BufferReader(data);
  reader.readU8(); // account_key
  const castle = reader.readPubkey();
  const member = reader.readPubkey();
  const bump = reader.readU8();
  reader.skip(7); // _padding1
  reader.skip(7); // implicit padding for i64 alignment
  const lastClaimedAt = reader.readI64();
  reader.skip(8); // total_claimed_novi (not in interface)
  const team = castle; // team not in Rust struct; placeholder for interface compatibility

  return { castle, team, member, lastClaimedAt, bump };
}

// Parse Functions

/** Parse CastleAccount from account info */
export function parseCastle(accountInfo: AccountInfo<Buffer>): CastleAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeCastle(accountInfo.data);
}

/** Parse KingRegistryAccount from account info */
export function parseKingRegistry(accountInfo: AccountInfo<Buffer>): KingRegistryAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeKingRegistry(accountInfo.data);
}

/** Parse CourtPositionAccount from account info */
export function parseCourtPosition(accountInfo: AccountInfo<Buffer>): CourtPositionAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeCourtPosition(accountInfo.data);
}

/** Parse GarrisonContributionAccount from account info */
export function parseGarrisonContribution(accountInfo: AccountInfo<Buffer>): GarrisonContributionAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeGarrisonContribution(accountInfo.data);
}

/** Parse TeamCastleRewardAccount from account info */
export function parseTeamCastleReward(accountInfo: AccountInfo<Buffer>): TeamCastleRewardAccount | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeTeamCastleReward(accountInfo.data);
}
