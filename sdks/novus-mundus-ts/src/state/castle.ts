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
import { BufferReader, isNullPubkey } from '../utils/deserialize.ts';
import { CastleTier, CastleStatus, CourtPosition } from '../types/enums.ts';

// ============================================================
// Castle Account Interface
// ============================================================

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

// ============================================================
// King Registry Account
// ============================================================

export interface KingRegistryAccount {
  king: PublicKey;
  castle: PublicKey;
  bump: number;
}

// ============================================================
// Court Position Account
// ============================================================

export interface CourtPositionAccount {
  castle: PublicKey;
  holder: PublicKey;
  position: CourtPosition;
  appointedAt: BN;
  lastClaimedAt: BN;
  bump: number;
}

// ============================================================
// Garrison Contribution Account
// ============================================================

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

// ============================================================
// Team Castle Reward Account
// ============================================================

export interface TeamCastleRewardAccount {
  castle: PublicKey;
  team: PublicKey;
  member: PublicKey;
  lastClaimedAt: BN;
  bump: number;
}

// ============================================================
// Deserialization
// ============================================================

function deserializeCastle(data: Uint8Array | Buffer): CastleAccount {
  const reader = new BufferReader(data);

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
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen)).replace(/\0/g, '');

  // Location (16 bytes)
  const latitude = reader.readI32();
  const longitude = reader.readI32();
  reader.skip(8); // _padding_loc

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

function deserializeKingRegistry(data: Uint8Array | Buffer): KingRegistryAccount {
  const reader = new BufferReader(data);
  const king = reader.readPubkey();
  const castle = reader.readPubkey();
  const bump = reader.readU8();

  return { king, castle, bump };
}

function deserializeCourtPosition(data: Uint8Array | Buffer): CourtPositionAccount {
  const reader = new BufferReader(data);
  const castle = reader.readPubkey();
  const holder = reader.readPubkey();
  const position = reader.readU8() as CourtPosition;
  reader.skip(7); // padding
  const appointedAt = reader.readI64();
  const lastClaimedAt = reader.readI64();
  const bump = reader.readU8();

  return { castle, holder, position, appointedAt, lastClaimedAt, bump };
}

function deserializeGarrisonContribution(data: Uint8Array | Buffer): GarrisonContributionAccount {
  const reader = new BufferReader(data);
  const castle = reader.readPubkey();
  const contributor = reader.readPubkey();
  const du1 = reader.readU64();
  const du2 = reader.readU64();
  const du3 = reader.readU64();
  const joinedAt = reader.readI64();
  const lastClaimedAt = reader.readI64();
  const bump = reader.readU8();

  return { castle, contributor, du1, du2, du3, joinedAt, lastClaimedAt, bump };
}

function deserializeTeamCastleReward(data: Uint8Array | Buffer): TeamCastleRewardAccount {
  const reader = new BufferReader(data);
  const castle = reader.readPubkey();
  const team = reader.readPubkey();
  const member = reader.readPubkey();
  const lastClaimedAt = reader.readI64();
  const bump = reader.readU8();

  return { castle, team, member, lastClaimedAt, bump };
}

// ============================================================
// Parse Functions
// ============================================================

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
