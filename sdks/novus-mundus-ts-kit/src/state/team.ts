/**
 * Team Accounts
 *
 * TeamAccount - Team metadata and configuration (280 bytes)
 * TeamMemberSlot - Individual member slot PDA (104 bytes)
 * TeamInviteAccount - Pending invite PDA (136 bytes)
 * TreasuryRequest - Pending withdrawal request (112 bytes)
 */

import type { Address } from '@solana/kit';
import { createEncoder, createDecoder, combineCodec, type FixedSizeCodec } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import { reprC, pad, u8, u16, u64, i64, bool, pubkey, array, custom } from '../utils/codec';
import { TeamMemberRank } from '../types/enums';

// Length-prefixed-buffer string field: `[u8; n]` content + 1-byte length suffix.
const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

/** A `[u8; n]` name buffer followed by a trailing `u8` length field. */
function nameWithLen(n: number) {
  const codec = combineCodec(
    createEncoder<string>({
      fixedSize: n + 1,
      write: (value, dst, base) => {
        const src = utf8Encoder.encode(value);
        const len = Math.min(src.length, n);
        dst.set(src.subarray(0, len), base);
        dst[base + n] = len;
        return base + n + 1;
      },
    }),
    createDecoder<string>({
      fixedSize: n + 1,
      read: (src, base) => {
        const len = src[base + n] ?? 0;
        return [
          utf8Decoder.decode(src.subarray(base, base + Math.min(len, n))),
          base + n + 1,
        ];
      },
    })
  ) as FixedSizeCodec<string>;
  return custom(codec, 1);
}

// Team Settings & Permissions

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

// Team Account Interface

export interface TeamAccount {
  id: bigint;
  leader: Address;
  bump: number;
  disbanded: boolean;
  name: string;
  memberCount: number;
  maxMembers: number;
  createdAt: bigint;
  lastActivity: bigint;
  treasury: bigint;
  settings: number;
  minLevelToJoin: number;
  rolePermissions: number[];
  motd: string;
  treasuryInstantLimit: bigint[];
  treasuryDailyCap: bigint[];
  treasuryCooldownHours: number;
}

/** TeamAccount size in bytes */
export const TEAM_ACCOUNT_SIZE = 280;

// Team Member Slot Interface

export interface TeamMemberSlot {
  team: Address;
  player: Address;
  joinedAt: bigint;
  slotIndex: number;
  bump: number;
  rank: TeamMemberRank;
  treasuryWithdrawnToday: bigint;
  lastTreasuryDay: number;
}

/** TeamMemberSlot size in bytes */
export const TEAM_MEMBER_SLOT_SIZE = 104;

// Team Invite Account Interface

export interface TeamInviteAccount {
  team: Address;
  invitee: Address;
  bump: number;
  inviter: Address;
  createdAt: bigint;
  expiresAt: bigint;
}

/** TeamInviteAccount size in bytes */
export const TEAM_INVITE_ACCOUNT_SIZE = 136;

// Treasury Request Interface

export interface TreasuryRequest {
  team: Address;
  requester: Address;
  amount: bigint;
  createdAt: bigint;
  executableAt: bigint;
  bump: number;
}

/** TreasuryRequest size in bytes */
export const TREASURY_REQUEST_SIZE = 112;

// Codecs

/** TeamAccount `#[repr(C)]` codec */
const teamCodec = reprC<TeamAccount>([
  pad(1), // account_key
  pad(32), // game_engine (not in interface)
  ['id', u64],
  ['leader', pubkey],
  ['bump', u8],
  ['disbanded', bool],
  pad(6), // _padding
  ['name', nameWithLen(32)],
  pad(7), // _padding
  ['memberCount', u16],
  ['maxMembers', u16],
  ['createdAt', i64],
  ['lastActivity', i64],
  ['treasury', u64],
  ['settings', u8],
  ['minLevelToJoin', u8],
  ['rolePermissions', array(u8, 5)],
  pad(1), // _padding
  ['motd', nameWithLen(32)],
  ['treasuryInstantLimit', array(u64, 4)],
  ['treasuryDailyCap', array(u64, 4)],
  ['treasuryCooldownHours', u8],
  pad(7), // _treasury_reserved
], TEAM_ACCOUNT_SIZE);

/** TeamMemberSlot `#[repr(C)]` codec */
const teamMemberSlotCodec = reprC<TeamMemberSlot>([
  pad(1), // account_key
  ['team', pubkey],
  ['player', pubkey],
  ['joinedAt', i64],
  ['slotIndex', u16],
  ['bump', u8],
  ['rank', u8],
  pad(4), // _reserved
  ['treasuryWithdrawnToday', u64],
  ['lastTreasuryDay', u16],
], TEAM_MEMBER_SLOT_SIZE);

/** TeamInviteAccount `#[repr(C)]` codec */
const teamInviteCodec = reprC<TeamInviteAccount>([
  pad(1), // account_key
  ['team', pubkey],
  ['invitee', pubkey],
  ['bump', u8],
  pad(7), // _padding0
  ['inviter', pubkey],
  ['createdAt', i64],
  ['expiresAt', i64],
  pad(8), // _reserved
], TEAM_INVITE_ACCOUNT_SIZE);

/** TreasuryRequest `#[repr(C)]` codec */
const treasuryRequestCodec = reprC<TreasuryRequest>([
  pad(1), // account_key
  ['team', pubkey],
  ['requester', pubkey],
  ['amount', u64],
  ['createdAt', i64],
  ['executableAt', i64],
  ['bump', u8],
  pad(15), // _reserved
], TREASURY_REQUEST_SIZE);

// Deserialization Functions

/** Deserialize TeamAccount from raw bytes */
export function deserializeTeam(data: Uint8Array): TeamAccount {
  return teamCodec.decode(data);
}

/** Deserialize TeamMemberSlot from raw bytes */
export function deserializeTeamMemberSlot(data: Uint8Array): TeamMemberSlot {
  return teamMemberSlotCodec.decode(data);
}

/** Deserialize TeamInviteAccount from raw bytes */
export function deserializeTeamInvite(data: Uint8Array): TeamInviteAccount {
  return teamInviteCodec.decode(data);
}

/** Deserialize TreasuryRequest from raw bytes */
export function deserializeTreasuryRequest(data: Uint8Array): TreasuryRequest {
  return treasuryRequestCodec.decode(data);
}

// Parse Functions

/** Parse TeamAccount from account info */
export function parseTeam(accountInfo: { data: Uint8Array }): TeamAccount | null {
  if (!accountInfo.data || accountInfo.data.length < TEAM_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeTeam(accountInfo.data);
}

/** Parse TeamMemberSlot from account info */
export function parseTeamMemberSlot(accountInfo: { data: Uint8Array }): TeamMemberSlot | null {
  if (!accountInfo.data || accountInfo.data.length < TEAM_MEMBER_SLOT_SIZE) {
    return null;
  }
  return deserializeTeamMemberSlot(accountInfo.data);
}

/** Parse TeamInviteAccount from account info */
export function parseTeamInvite(accountInfo: { data: Uint8Array }): TeamInviteAccount | null {
  if (!accountInfo.data || accountInfo.data.length < TEAM_INVITE_ACCOUNT_SIZE) {
    return null;
  }
  return deserializeTeamInvite(accountInfo.data);
}

/** Parse TreasuryRequest from account info */
export function parseTreasuryRequest(accountInfo: { data: Uint8Array }): TreasuryRequest | null {
  if (!accountInfo.data || accountInfo.data.length < TREASURY_REQUEST_SIZE) {
    return null;
  }
  return deserializeTreasuryRequest(accountInfo.data);
}

// Helper Functions

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
  const expiresAt = Number(invite.expiresAt);
  return expiresAt > 0 && nowSeconds >= expiresAt;
}

/** Check if treasury request is executable */
export function isTreasuryRequestExecutable(request: TreasuryRequest, nowSeconds: number): boolean {
  return nowSeconds >= Number(request.executableAt);
}

/** Check if member is leader */
export function isMemberLeader(slot: TeamMemberSlot): boolean {
  return slot.rank === TeamMemberRank.Leader;
}
