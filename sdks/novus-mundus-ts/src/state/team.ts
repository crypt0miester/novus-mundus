/**
 * Team Accounts
 *
 * TeamAccount - Team metadata and configuration (280 bytes)
 * TeamMemberSlot - Individual member slot PDA (104 bytes)
 * TeamInviteAccount - Pending invite PDA (136 bytes)
 * TreasuryRequest - Pending withdrawal request (112 bytes)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader, isNullPubkey } from '../utils/deserialize';
import { TeamMemberRank } from '../types/enums';

// ============================================================
// Team Settings & Permissions
// ============================================================

/** Team settings bitfield */
export const TeamSettings = {
  PUBLIC: 1 << 0,
  AUTO_ACCEPT: 1 << 1,
} as const;

/** Team permission bitfield */
export const TeamPermissions = {
  INVITE: 1 << 0,
  KICK: 1 << 1,
  MOTD: 1 << 2,
  PROMOTE: 1 << 3,
  TREASURY: 1 << 4,
  SETTINGS: 1 << 5,
} as const;

// ============================================================
// Team Account Interface
// ============================================================

export interface TeamAccount {
  id: BN;
  leader: PublicKey;
  bump: number;
  disbanded: boolean;
  name: string;
  memberCount: number;
  maxMembers: number;
  createdAt: BN;
  lastActivity: BN;
  treasury: BN;
  settings: number;
  minLevelToJoin: number;
  rolePermissions: number[];
  motd: string;
  treasuryInstantLimit: BN[];
  treasuryDailyCap: BN[];
  treasuryCooldownHours: number;
}

/** TeamAccount size in bytes */
export const TEAM_ACCOUNT_SIZE = 280;

// ============================================================
// Team Member Slot Interface
// ============================================================

export interface TeamMemberSlot {
  team: PublicKey;
  player: PublicKey;
  joinedAt: BN;
  slotIndex: number;
  bump: number;
  rank: TeamMemberRank;
  treasuryWithdrawnToday: BN;
  lastTreasuryDay: number;
}

/** TeamMemberSlot size in bytes */
export const TEAM_MEMBER_SLOT_SIZE = 104;

// ============================================================
// Team Invite Account Interface
// ============================================================

export interface TeamInviteAccount {
  team: PublicKey;
  invitee: PublicKey;
  bump: number;
  inviter: PublicKey;
  createdAt: BN;
  expiresAt: BN;
}

/** TeamInviteAccount size in bytes */
export const TEAM_INVITE_ACCOUNT_SIZE = 136;

// ============================================================
// Treasury Request Interface
// ============================================================

export interface TreasuryRequest {
  team: PublicKey;
  requester: PublicKey;
  amount: BN;
  createdAt: BN;
  executableAt: BN;
  bump: number;
}

/** TreasuryRequest size in bytes */
export const TREASURY_REQUEST_SIZE = 112;

// ============================================================
// Deserialization Functions
// ============================================================

/** Deserialize TeamAccount from raw bytes */
export function deserializeTeam(data: Uint8Array | Buffer): TeamAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key
  reader.skip(32); // game_engine
  reader.skip(7); // implicit padding for u64 alignment

  const id = reader.readU64();
  const leader = reader.readPubkey();
  const bump = reader.readU8();
  const disbanded = reader.readBool();
  reader.skip(6); // padding

  const nameBytes = reader.readBytes(32);
  const nameLen = reader.readU8();
  const name = new TextDecoder().decode(nameBytes.slice(0, nameLen));
  reader.skip(7); // padding

  const memberCount = reader.readU16();
  const maxMembers = reader.readU16();
  reader.skip(4); // padding

  const createdAt = reader.readI64();
  const lastActivity = reader.readI64();
  const treasury = reader.readU64();

  const settings = reader.readU8();
  const minLevelToJoin = reader.readU8();
  const rolePermissions: number[] = [];
  for (let i = 0; i < 5; i++) {
    rolePermissions.push(reader.readU8());
  }
  reader.skip(1); // padding

  const motdBytes = reader.readBytes(32);
  const motdLen = reader.readU8();
  const motd = new TextDecoder().decode(motdBytes.slice(0, motdLen));
  reader.skip(7); // padding

  const treasuryInstantLimit = reader.readU64Array(4);
  const treasuryDailyCap = reader.readU64Array(4);
  const treasuryCooldownHours = reader.readU8();
  reader.skip(7); // _treasury_reserved

  return {
    id,
    leader,
    bump,
    disbanded,
    name,
    memberCount,
    maxMembers,
    createdAt,
    lastActivity,
    treasury,
    settings,
    minLevelToJoin,
    rolePermissions,
    motd,
    treasuryInstantLimit,
    treasuryDailyCap,
    treasuryCooldownHours,
  };
}

/** Deserialize TeamMemberSlot from raw bytes */
export function deserializeTeamMemberSlot(data: Uint8Array | Buffer): TeamMemberSlot {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const team = reader.readPubkey();
  const player = reader.readPubkey();
  reader.skip(7); // implicit padding for i64 alignment
  const joinedAt = reader.readI64();
  const slotIndex = reader.readU16();
  const bump = reader.readU8();
  const rank = reader.readU8() as TeamMemberRank;
  reader.skip(4); // _reserved

  const treasuryWithdrawnToday = reader.readU64();
  const lastTreasuryDay = reader.readU16();
  reader.skip(6); // padding

  return {
    team,
    player,
    joinedAt,
    slotIndex,
    bump,
    rank,
    treasuryWithdrawnToday,
    lastTreasuryDay,
  };
}

/** Deserialize TeamInviteAccount from raw bytes */
export function deserializeTeamInvite(data: Uint8Array | Buffer): TeamInviteAccount {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const team = reader.readPubkey();
  const invitee = reader.readPubkey();
  const bump = reader.readU8();
  reader.skip(7); // _padding0

  const inviter = reader.readPubkey();
  reader.skip(7); // implicit padding for i64 alignment
  const createdAt = reader.readI64();
  const expiresAt = reader.readI64();
  reader.skip(8); // _reserved

  return {
    team,
    invitee,
    bump,
    inviter,
    createdAt,
    expiresAt,
  };
}

/** Deserialize TreasuryRequest from raw bytes */
export function deserializeTreasuryRequest(data: Uint8Array | Buffer): TreasuryRequest {
  const reader = new BufferReader(data);

  reader.readU8(); // account_key

  const team = reader.readPubkey();
  const requester = reader.readPubkey();
  reader.skip(7); // implicit padding for u64 alignment
  const amount = reader.readU64();
  const createdAt = reader.readI64();
  const executableAt = reader.readI64();
  const bump = reader.readU8();
  reader.skip(15); // _reserved

  return {
    team,
    requester,
    amount,
    createdAt,
    executableAt,
    bump,
  };
}

// ============================================================
// Parse Functions
// ============================================================

/** Parse TeamAccount from account info */
export function parseTeam(accountInfo: AccountInfo<Buffer>): TeamAccount | null {
  if (!accountInfo.data || accountInfo.data.length < TEAM_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeTeam(accountInfo.data);
}

/** Parse TeamMemberSlot from account info */
export function parseTeamMemberSlot(accountInfo: AccountInfo<Buffer>): TeamMemberSlot | null {
  if (!accountInfo.data || accountInfo.data.length < TEAM_MEMBER_SLOT_SIZE) {
    return null;
  }
  return deserializeTeamMemberSlot(accountInfo.data);
}

/** Parse TeamInviteAccount from account info */
export function parseTeamInvite(accountInfo: AccountInfo<Buffer>): TeamInviteAccount | null {
  if (!accountInfo.data || accountInfo.data.length < TEAM_INVITE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeTeamInvite(accountInfo.data);
}

/** Parse TreasuryRequest from account info */
export function parseTreasuryRequest(accountInfo: AccountInfo<Buffer>): TreasuryRequest | null {
  if (!accountInfo.data || accountInfo.data.length < TREASURY_REQUEST_SIZE) {
    return null;
  }
  return deserializeTreasuryRequest(accountInfo.data);
}

// ============================================================
// Helper Functions
// ============================================================

/** Check if team is active (not disbanded and has valid leader) */
export function isTeamActive(team: TeamAccount): boolean {
  return !team.disbanded && !isNullPubkey(team.leader);
}

/** Check if team is public */
export function isTeamPublic(team: TeamAccount): boolean {
  return (team.settings & TeamSettings.PUBLIC) !== 0;
}

/** Check if team is full */
export function isTeamFull(team: TeamAccount): boolean {
  return team.memberCount >= team.maxMembers;
}

/** Check if rank has specific permission */
export function rankHasPermission(team: TeamAccount, rank: number, perm: number): boolean {
  if (rank >= 5) return false;
  return (team.rolePermissions[rank]! & perm) !== 0;
}

/** Check if invite has expired */
export function isInviteExpired(invite: TeamInviteAccount, nowSeconds: number): boolean {
  const expiresAt = invite.expiresAt.toNumber();
  return expiresAt > 0 && nowSeconds >= expiresAt;
}

/** Check if treasury request is executable */
export function isTreasuryRequestExecutable(request: TreasuryRequest, nowSeconds: number): boolean {
  return nowSeconds >= request.executableAt.toNumber();
}

/** Check if member is leader */
export function isMemberLeader(slot: TeamMemberSlot): boolean {
  return slot.rank === TeamMemberRank.Leader;
}
