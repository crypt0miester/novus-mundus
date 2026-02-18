/**
 * Team Instructions
 *
 * Instructions for team management (21 total):
 * - Create, join, leave, disband
 * - Invite, accept, decline, cancel invite
 * - Kick, demote, promote, transfer leadership
 * - Set MOTD, update settings
 * - Treasury operations (deposit, withdraw, request, approve, reject, execute, cancel)
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveGameEnginePda,
  deriveNoviMintPda,
  derivePlayerPda,
  deriveTeamPda,
  deriveTeamSlotPda,
  deriveTeamInvitePda,
  deriveTreasuryRequestPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// ============================================================
// Team Create
// ============================================================

export interface TeamCreateAccounts {
  /** Player's wallet (signer, payer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team ID (generated from timestamp + owner hash) */
  teamId: BN | number | bigint;
}

export interface TeamCreateParams {
  name: string;
}

/** ~50,000 CU */
/**
 * Create a new team.
 *
 * Burns team_creation_cost NOVI (DAO configured).
 * Player becomes team leader (rank 0).
 *
 * Prerequisites: Player must have EXT_RALLY unlocked (created/joined a rally first).
 */
export function createTeamCreateInstruction(
  accounts: TeamCreateAccounts,
  params: TeamCreateParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
    const [noviMint] = deriveNoviMintPda();

  // Team ID as u64
  const teamIdBn = typeof accounts.teamId === 'number'
    ? new BN(accounts.teamId)
    : typeof accounts.teamId === 'bigint'
      ? new BN(accounts.teamId.toString())
      : accounts.teamId;

  const teamIdBuffer = teamIdBn.toArrayLike(Buffer, 'le', 8);
  const [team] = PublicKey.findProgramAddressSync(
    [Buffer.from('team'), accounts.gameEngine.toBuffer(), teamIdBuffer],
    PROGRAM_ID
  );

  const [leaderSlot] = deriveTeamSlotPda(team, 0);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: team, isSigner: false, isWritable: true },
    { pubkey: leaderSlot, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: team_id (u64) + name_len (u8) + name (bytes)
  const nameBytes = Buffer.from(params.name, 'utf8');
  if (nameBytes.length > 32) {
    throw new Error('Team name too long (max 32 bytes)');
  }
  const writer = new BufferWriter(8 + 1 + nameBytes.length);
  writer.writeU64(teamIdBn);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(nameBytes);

  const data = createInstructionData(DISCRIMINATORS.TEAM_CREATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Join (Open Teams)
// ============================================================

export interface TeamJoinAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team to join */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Slot index to use */
  slotIndex: number;
}

/** ~5,000 CU */
/**
 * Join an open team (no invite required).
 *
 * Prerequisites: Player must have EXT_RALLY unlocked.
 *
 * On-chain accounts (5):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [writable] team: TeamAccount PDA
 * 2. [writable] member_slot: TeamMemberSlot PDA (to be created)
 * 3. [signer, writable] owner: Player's wallet (pays for slot rent)
 * 4. [] system_program: System Program
 *
 * On-chain data (10 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamJoinInstruction(
  accounts: TeamJoinAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: memberSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(10);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_JOIN, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Leave
// ============================================================

export interface TeamLeaveAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team to leave */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Player's slot index */
  slotIndex: number;
}

/** ~5,000 CU */
/**
 * Leave a team.
 *
 * Leader cannot leave - must transfer leadership or disband first.
 *
 * On-chain accounts (4):
 * 0. [writable] player: PlayerAccount (leaving member)
 * 1. [writable] team: TeamAccount
 * 2. [writable] member_slot: Player's TeamMemberSlot (to be closed)
 * 3. [signer, writable] owner: Player wallet (receives slot rent refund)
 *
 * On-chain data (10 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamLeaveInstruction(
  accounts: TeamLeaveAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: memberSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
  ];

  // Instruction data: team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(10);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_LEAVE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Disband
// ============================================================

export interface TeamDisbandAccounts {
  /** Leader's wallet (signer) */
  leader: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team to disband */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
}

/** ~10,000 CU */
/**
 * Disband a team. Only leader can do this.
 *
 * Team leader dissolves the team. Treasury returns to leader.
 *
 * On-chain accounts (3):
 * 0. [writable] leader_player: PlayerAccount (team leader)
 * 1. [writable] team: TeamAccount (being disbanded)
 * 2. [signer] leader_owner: Leader's wallet
 *
 * On-chain data (8 bytes):
 * - team_id: u64
 */
export function createTeamDisbandInstruction(
  accounts: TeamDisbandAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.leader);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.leader, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64)
  const writer = new BufferWriter(8);
  writer.writeU64(accounts.teamId);

  const data = createInstructionData(DISCRIMINATORS.TEAM_DISBAND, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Invite
// ============================================================

export interface TeamInviteAccounts {
  /** Inviter's wallet (signer) - must have PERM_INVITE */
  inviter: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Inviter's slot index */
  inviterSlotIndex: number;
  /** Player to invite (PlayerAccount PDA) */
  inviteePlayer: PublicKey;
}

export interface TeamInviteParams {
  /** Optional custom expiry time in seconds (0 = use default 7 days) */
  expiresInSeconds?: BN | number | bigint;
}

/** ~30,000 CU */
/**
 * Invite a player to join the team.
 *
 * Member with PERM_INVITE permission can invite players.
 * Creates a TeamInviteAccount PDA that expires after 7 days by default.
 *
 * On-chain accounts (7):
 * 0. [] inviter_player: PlayerAccount (member sending invite)
 * 1. [] inviter_slot: TeamMemberSlot (for rank verification)
 * 2. [] invitee_player: PlayerAccount (player being invited)
 * 3. [] team: TeamAccount
 * 4. [writable] invite: TeamInviteAccount PDA (to be created)
 * 5. [signer, writable] inviter_owner: Inviter's wallet (pays for invite rent)
 * 6. [] system_program: System program
 *
 * On-chain data (10-18 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 * - expires_in_seconds: i64 (8) - optional, 0 = default
 */
export function createTeamInviteInstruction(
  accounts: TeamInviteAccounts,
  params?: TeamInviteParams
): TransactionInstruction {
  const [inviterPlayer] = derivePlayerPda(accounts.gameEngine, accounts.inviter);
  const [inviterSlot] = deriveTeamSlotPda(accounts.team, accounts.inviterSlotIndex);
  const [invite] = deriveTeamInvitePda(accounts.team, accounts.inviteePlayer);

  const keys = [
    { pubkey: inviterPlayer, isSigner: false, isWritable: false },
    { pubkey: inviterSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.inviteePlayer, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: invite, isSigner: false, isWritable: true },
    { pubkey: accounts.inviter, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: team_id (u64) + slot_index (u16) + optional expires_in_seconds (i64)
  const hasExpiry = params?.expiresInSeconds !== undefined && params.expiresInSeconds !== 0;
  const dataLen = hasExpiry ? 18 : 10;
  const writer = new BufferWriter(dataLen);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.inviterSlotIndex);
  if (hasExpiry) {
    writer.writeI64(params!.expiresInSeconds!);
  }

  const data = createInstructionData(DISCRIMINATORS.TEAM_INVITE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Accept Invite
// ============================================================

export interface TeamAcceptInviteAccounts {
  /** Invitee's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Slot index to use */
  slotIndex: number;
  /** Account to receive invite rent refund (usually inviter's wallet) */
  inviteRefund: PublicKey;
}

/** ~35,000 CU */
/**
 * Accept a team invite.
 *
 * Player accepts pending team invite and joins the team.
 * Creates a TeamMemberSlot and closes the TeamInviteAccount.
 * Invite must not be expired.
 *
 * On-chain accounts (7):
 * 0. [writable] player: PlayerAccount (accepting invite)
 * 1. [writable] team: TeamAccount (team being joined)
 * 2. [writable] invite: TeamInviteAccount PDA (to be closed)
 * 3. [writable] member_slot: TeamMemberSlot PDA (to be created)
 * 4. [writable] invite_refund: Account to receive invite rent refund (usually inviter)
 * 5. [signer, writable] owner: Player wallet (pays for slot rent)
 * 6. [] system_program: System program
 *
 * On-chain data (10 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamAcceptInviteInstruction(
  accounts: TeamAcceptInviteAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [invite] = deriveTeamInvitePda(accounts.team, player);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: invite, isSigner: false, isWritable: true },
    { pubkey: memberSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.inviteRefund, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(10);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_ACCEPT_INVITE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Decline Invite
// ============================================================

export interface TeamDeclineInviteAccounts {
  /** Invitee's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Account to receive invite rent refund (usually inviter's wallet) */
  inviterRefund: PublicKey;
}

/** ~5,000 CU */
/**
 * Decline a team invite.
 *
 * Invitee can decline an invite they received.
 * Closes the TeamInviteAccount and refunds rent to the inviter.
 *
 * On-chain accounts (5):
 * 0. [] player: PlayerAccount (invitee)
 * 1. [writable] invite: TeamInviteAccount PDA (to be closed)
 * 2. [] team: Team account (for PDA derivation)
 * 3. [writable] inviter_refund: Account to receive rent refund (usually inviter's wallet)
 * 4. [signer] owner: Invitee's wallet
 *
 * On-chain data: None
 */
export function createTeamDeclineInviteInstruction(
  accounts: TeamDeclineInviteAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [invite] = deriveTeamInvitePda(accounts.team, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: invite, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: accounts.inviterRefund, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.TEAM_DECLINE_INVITE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Cancel Invite
// ============================================================

export interface TeamCancelInviteAccounts {
  /** Member's wallet (signer) - must have PERM_INVITE */
  member: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Member's slot index */
  memberSlotIndex: number;
  /** Player whose invite to cancel (PlayerAccount PDA) */
  inviteePlayer: PublicKey;
}

/** ~5,000 CU */
/**
 * Cancel a pending team invite.
 *
 * Member with PERM_INVITE can cancel an invite.
 * Closes the TeamInviteAccount and refunds rent to caller.
 *
 * On-chain accounts (6):
 * 0. [] member_player: PlayerAccount (member with invite permission)
 * 1. [] member_slot: TeamMemberSlot (for rank verification)
 * 2. [] team: TeamAccount
 * 3. [writable] invite: TeamInviteAccount PDA (to be closed)
 * 4. [] invitee_player: PlayerAccount of invitee (for PDA derivation)
 * 5. [signer, writable] member_owner: Member's wallet (receives rent refund)
 *
 * On-chain data (10 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamCancelInviteInstruction(
  accounts: TeamCancelInviteAccounts
): TransactionInstruction {
  const [memberPlayer] = derivePlayerPda(accounts.gameEngine, accounts.member);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.memberSlotIndex);
  const [invite] = deriveTeamInvitePda(accounts.team, accounts.inviteePlayer);

  const keys = [
    { pubkey: memberPlayer, isSigner: false, isWritable: false },
    { pubkey: memberSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: invite, isSigner: false, isWritable: true },
    { pubkey: accounts.inviteePlayer, isSigner: false, isWritable: false },
    { pubkey: accounts.member, isSigner: true, isWritable: true },
  ];

  // Instruction data: team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(10);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.memberSlotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_CANCEL_INVITE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Kick Member
// ============================================================

export interface TeamKickMemberAccounts {
  /** Kicker's wallet (signer) - must have PERM_KICK */
  kicker: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Kicker's slot index */
  kickerSlotIndex: number;
  /** Member to kick (PlayerAccount PDA) */
  kickedPlayer: PublicKey;
  /** Kicked member's slot index */
  kickedSlotIndex: number;
  /** Kicked player's wallet (receives slot rent refund) */
  kickedOwner: PublicKey;
}

/** ~5,000 CU */
/**
 * Kick a member from the team.
 *
 * Any member with KICK permission can remove members of lower rank.
 * Cannot kick yourself or someone of equal/higher rank.
 * Kicked member's slot is closed and rent refunded to kicked player's wallet.
 *
 * On-chain accounts (7):
 * 0. [] kicker_player: PlayerAccount (member doing the kicking)
 * 1. [] kicker_slot: Kicker's TeamMemberSlot (to verify rank)
 * 2. [writable] kicked_player: PlayerAccount (member being kicked)
 * 3. [writable] team: TeamAccount
 * 4. [writable] kicked_slot: Kicked player's TeamMemberSlot (to be closed)
 * 5. [signer] kicker_owner: Kicker's wallet
 * 6. [writable] kicked_owner: Kicked player's wallet (receives slot rent refund)
 *
 * On-chain data (12 bytes):
 * - team_id: u64 (8)
 * - kicker_slot_index: u16 (2)
 * - kicked_slot_index: u16 (2)
 */
export function createTeamKickMemberInstruction(
  accounts: TeamKickMemberAccounts
): TransactionInstruction {
  const [kickerPlayer] = derivePlayerPda(accounts.gameEngine, accounts.kicker);
  const [kickerSlot] = deriveTeamSlotPda(accounts.team, accounts.kickerSlotIndex);
  const [kickedSlot] = deriveTeamSlotPda(accounts.team, accounts.kickedSlotIndex);

  const keys = [
    { pubkey: kickerPlayer, isSigner: false, isWritable: false },
    { pubkey: kickerSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.kickedPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: kickedSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.kicker, isSigner: true, isWritable: false },
    { pubkey: accounts.kickedOwner, isSigner: false, isWritable: true },
  ];

  // Instruction data: team_id (u64) + kicker_slot_index (u16) + kicked_slot_index (u16)
  const writer = new BufferWriter(12);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.kickerSlotIndex);
  writer.writeU16(accounts.kickedSlotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_KICK_MEMBER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Promote Member
// ============================================================

export interface TeamPromoteMemberAccounts {
  /** Promoter's wallet (signer) - must have PERM_PROMOTE and outrank target */
  promoter: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Promoter's slot index */
  promoterSlotIndex: number;
  /** Target member's slot index */
  targetSlotIndex: number;
}

export interface TeamPromoteMemberParams {
  /** New rank for target (1-4, cannot promote to 0=leader) */
  newRank: number;
}

/** ~5,000 CU */
/**
 * Promote a team member to a higher rank.
 *
 * Promoter must have PERM_PROMOTE and outrank the target rank.
 * Cannot promote to RANK_0 (leader transfer is separate).
 *
 * On-chain accounts (5):
 * 0. [] promoter_player: PlayerAccount (promoter)
 * 1. [] promoter_slot: TeamMemberSlot (for promoter rank)
 * 2. [writable] target_slot: TeamMemberSlot (member being promoted)
 * 3. [writable] team: TeamAccount
 * 4. [signer] promoter_owner: Promoter's wallet
 *
 * On-chain data (13 bytes):
 * - team_id: u64 (8)
 * - promoter_slot_index: u16 (2)
 * - target_slot_index: u16 (2)
 * - new_rank: u8 (1)
 */
export function createTeamPromoteMemberInstruction(
  accounts: TeamPromoteMemberAccounts,
  params: TeamPromoteMemberParams
): TransactionInstruction {
  const [promoterPlayer] = derivePlayerPda(accounts.gameEngine, accounts.promoter);
  const [promoterSlot] = deriveTeamSlotPda(accounts.team, accounts.promoterSlotIndex);
  const [targetSlot] = deriveTeamSlotPda(accounts.team, accounts.targetSlotIndex);

  const keys = [
    { pubkey: promoterPlayer, isSigner: false, isWritable: false },
    { pubkey: promoterSlot, isSigner: false, isWritable: false },
    { pubkey: targetSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.promoter, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + promoter_slot_index (u16) + target_slot_index (u16) + new_rank (u8)
  const writer = new BufferWriter(13);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.promoterSlotIndex);
  writer.writeU16(accounts.targetSlotIndex);
  writer.writeU8(params.newRank);

  const data = createInstructionData(DISCRIMINATORS.TEAM_PROMOTE_MEMBER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Demote Member
// ============================================================

export interface TeamDemoteMemberAccounts {
  /** Demoter's wallet (signer) - must outrank target's current rank */
  demoter: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Demoter's slot index */
  demoterSlotIndex: number;
  /** Target member's slot index */
  targetSlotIndex: number;
}

export interface TeamDemoteMemberParams {
  /** New rank for target (must be > current rank, i.e., lower position) */
  newRank: number;
}

/** ~5,000 CU */
/**
 * Demote a team member to a lower rank.
 *
 * Demoter must outrank the target's current rank.
 * Cannot demote the leader (RANK_0).
 *
 * On-chain accounts (5):
 * 0. [] demoter_player: PlayerAccount (demoter)
 * 1. [] demoter_slot: TeamMemberSlot (for demoter rank)
 * 2. [writable] target_slot: TeamMemberSlot (member being demoted)
 * 3. [writable] team: TeamAccount
 * 4. [signer] demoter_owner: Demoter's wallet
 *
 * On-chain data (13 bytes):
 * - team_id: u64 (8)
 * - demoter_slot_index: u16 (2)
 * - target_slot_index: u16 (2)
 * - new_rank: u8 (1)
 */
export function createTeamDemoteMemberInstruction(
  accounts: TeamDemoteMemberAccounts,
  params: TeamDemoteMemberParams
): TransactionInstruction {
  const [demoterPlayer] = derivePlayerPda(accounts.gameEngine, accounts.demoter);
  const [demoterSlot] = deriveTeamSlotPda(accounts.team, accounts.demoterSlotIndex);
  const [targetSlot] = deriveTeamSlotPda(accounts.team, accounts.targetSlotIndex);

  const keys = [
    { pubkey: demoterPlayer, isSigner: false, isWritable: false },
    { pubkey: demoterSlot, isSigner: false, isWritable: false },
    { pubkey: targetSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.demoter, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + demoter_slot_index (u16) + target_slot_index (u16) + new_rank (u8)
  const writer = new BufferWriter(13);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.demoterSlotIndex);
  writer.writeU16(accounts.targetSlotIndex);
  writer.writeU8(params.newRank);

  const data = createInstructionData(DISCRIMINATORS.TEAM_DEMOTE_MEMBER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Transfer Leadership
// ============================================================

export interface TeamTransferLeadershipAccounts {
  /** Current leader's wallet (signer) */
  leader: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Current leader's slot index */
  currentSlotIndex: number;
  /** New leader (PlayerAccount PDA) */
  newLeaderPlayer: PublicKey;
  /** New leader's slot index */
  newSlotIndex: number;
}

/** ~5,000 CU */
/**
 * Transfer team leadership to another member.
 *
 * Current leader passes leadership to another team member.
 * Old leader becomes RANK_1, new leader becomes RANK_0.
 *
 * On-chain accounts (6):
 * 0. [] current_leader_player: PlayerAccount (current leader)
 * 1. [writable] current_leader_slot: Current leader's TeamMemberSlot
 * 2. [] new_leader_player: PlayerAccount (new leader)
 * 3. [writable] new_leader_slot: New leader's TeamMemberSlot
 * 4. [writable] team: TeamAccount
 * 5. [signer] current_leader_owner: Current leader's wallet
 *
 * On-chain data (12 bytes):
 * - team_id: u64 (8)
 * - current_slot_index: u16 (2)
 * - new_slot_index: u16 (2)
 */
export function createTeamTransferLeadershipInstruction(
  accounts: TeamTransferLeadershipAccounts
): TransactionInstruction {
  const [leaderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [currentLeaderSlot] = deriveTeamSlotPda(accounts.team, accounts.currentSlotIndex);
  const [newLeaderSlot] = deriveTeamSlotPda(accounts.team, accounts.newSlotIndex);

  const keys = [
    { pubkey: leaderPlayer, isSigner: false, isWritable: false },
    { pubkey: currentLeaderSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.newLeaderPlayer, isSigner: false, isWritable: false },
    { pubkey: newLeaderSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.leader, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + current_slot_index (u16) + new_slot_index (u16)
  const writer = new BufferWriter(12);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.currentSlotIndex);
  writer.writeU16(accounts.newSlotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_TRANSFER_LEADERSHIP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Set MOTD
// ============================================================

export interface TeamSetMotdAccounts {
  /** Member's wallet (signer) - must have PERM_MOTD */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Member's slot index */
  slotIndex: number;
}

export interface TeamSetMotdParams {
  motd: string;
}

/** ~15,000 CU */
/**
 * Set the team's Message of the Day.
 *
 * Member with PERM_MOTD can set a message visible to all members.
 * Max 32 bytes UTF-8.
 *
 * On-chain accounts (4):
 * 0. [] member_player: PlayerAccount (member with MOTD permission)
 * 1. [] member_slot: TeamMemberSlot (for rank verification)
 * 2. [writable] team: TeamAccount
 * 3. [signer] member_owner: Member's wallet
 *
 * On-chain data (11+ bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 * - motd_len: u8 (1)
 * - motd: [u8; N]
 */
export function createTeamSetMotdInstruction(
  accounts: TeamSetMotdAccounts,
  params: TeamSetMotdParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: memberSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + slot_index (u16) + motd_len (u8) + motd (bytes)
  const motdBytes = Buffer.from(params.motd, 'utf8');
  if (motdBytes.length > 32) {
    throw new Error('MOTD too long (max 32 bytes)');
  }
  const writer = new BufferWriter(11 + motdBytes.length);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);
  writer.writeU8(motdBytes.length);
  writer.writeBytes(motdBytes);

  const data = createInstructionData(DISCRIMINATORS.TEAM_SET_MOTD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Update Settings
// ============================================================

export interface TeamUpdateSettingsAccounts {
  /** Member's wallet (signer) - must have PERM_SETTINGS */
  member: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Member's slot index */
  slotIndex: number;
}

export interface TeamUpdateSettingsParams {
  /**
   * Settings bitfield:
   * - Bit 0: SETTING_PUBLIC - Anyone can join without invite
   * - Bit 1: SETTING_AUTO_ACCEPT - Auto-accept join requests (future use)
   */
  settings: number;
  /** Minimum player level to join (1-255) */
  minLevelToJoin: number;
}

/** ~15,000 CU */
/**
 * Update team settings (public/private, min level).
 *
 * Member with PERM_SETTINGS can update team settings.
 *
 * On-chain accounts (4):
 * 0. [] member_player: PlayerAccount (member with settings permission)
 * 1. [] member_slot: TeamMemberSlot (for rank verification)
 * 2. [writable] team: TeamAccount
 * 3. [signer] member_owner: Member's wallet
 *
 * On-chain data (12 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 * - settings: u8 (1)
 * - min_level_to_join: u8 (1)
 */
export function createTeamUpdateSettingsInstruction(
  accounts: TeamUpdateSettingsAccounts,
  params: TeamUpdateSettingsParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.member);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: memberSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.member, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + slot_index (u16) + settings (u8) + min_level_to_join (u8)
  const writer = new BufferWriter(12);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);
  writer.writeU8(params.settings);
  writer.writeU8(params.minLevelToJoin);

  const data = createInstructionData(DISCRIMINATORS.TEAM_UPDATE_SETTINGS, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Deposit Treasury
// ============================================================

export interface TeamDepositTreasuryAccounts {
  /** Member's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
}

export interface TeamDepositTreasuryParams {
  amount: BN | number | bigint;
}

/** ~10,000 CU */
/**
 * Deposit cash into the team treasury.
 *
 * Team members can contribute cash to shared treasury.
 *
 * On-chain accounts (3):
 * 0. [writable] player: PlayerAccount (depositor)
 * 1. [writable] team: TeamAccount
 * 2. [signer] owner: Player wallet
 *
 * On-chain data (16 bytes):
 * - amount: u64 (8)
 * - team_id: u64 (8)
 */
export function createTeamDepositTreasuryInstruction(
  accounts: TeamDepositTreasuryAccounts,
  params: TeamDepositTreasuryParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
  ];

  // Instruction data: amount (u64) + team_id (u64)
  const writer = new BufferWriter(16);
  writer.writeU64(params.amount);
  writer.writeU64(accounts.teamId);

  const data = createInstructionData(DISCRIMINATORS.TEAM_DEPOSIT_TREASURY, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Withdraw Treasury (Instant - within limits)
// ============================================================

export interface TeamWithdrawTreasuryAccounts {
  /** Withdrawer's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Member's slot index */
  slotIndex: number;
}

export interface TeamWithdrawTreasuryParams {
  amount: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Withdraw cash from team treasury (instant - within limits).
 *
 * For amounts within instant_limit and daily_cap, withdraw immediately.
 * For larger amounts, use treasury_request_withdraw instead.
 *
 * On-chain accounts (4):
 * 0. [writable] player: PlayerAccount (withdrawer)
 * 1. [writable] member_slot: TeamMemberSlot (for rank and daily tracking)
 * 2. [writable] team: TeamAccount
 * 3. [signer] owner: Player's wallet
 *
 * On-chain data (18 bytes):
 * - amount: u64 (8)
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamWithdrawTreasuryInstruction(
  accounts: TeamWithdrawTreasuryAccounts,
  params: TeamWithdrawTreasuryParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: memberSlot, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
  ];

  // Instruction data: amount (u64) + team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(18);
  writer.writeU64(params.amount);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_WITHDRAW_TREASURY, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Treasury Request Withdraw
// ============================================================

export interface TeamTreasuryRequestWithdrawAccounts {
  /** Requester's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Member's slot index */
  slotIndex: number;
}

export interface TeamTreasuryRequestWithdrawParams {
  amount: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Request a treasury withdrawal (requires approval).
 *
 * Creates a TreasuryRequest PDA with cooldown period.
 * After cooldown, requester can execute. Higher rank can approve early or reject.
 * Only one pending request per member at a time.
 *
 * On-chain accounts (6):
 * 0. [] player: PlayerAccount (requester)
 * 1. [] member_slot: TeamMemberSlot (for rank verification)
 * 2. [] team: TeamAccount
 * 3. [writable] request: TreasuryRequest PDA (to be created)
 * 4. [signer, writable] owner: Player's wallet (pays for request PDA)
 * 5. [] system_program: System program
 *
 * On-chain data (18 bytes):
 * - amount: u64 (8)
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamTreasuryRequestWithdrawInstruction(
  accounts: TeamTreasuryRequestWithdrawAccounts,
  params: TeamTreasuryRequestWithdrawParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);
  const [request] = deriveTreasuryRequestPda(accounts.team, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: memberSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: request, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: amount (u64) + team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(18);
  writer.writeU64(params.amount);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_TREASURY_REQUEST_WITHDRAW, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Treasury Approve Request
// ============================================================

export interface TeamTreasuryApproveRequestAccounts {
  /** Approver's wallet (signer) - must outrank requester */
  approver: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Approver's slot index */
  approverSlotIndex: number;
  /** Requester's player account (receives funds) */
  requesterPlayer: PublicKey;
  /** Account to receive request rent refund (usually requester's wallet) */
  requesterRefund: PublicKey;
}

/** ~5,000 CU */
/**
 * Approve a treasury withdrawal request.
 *
 * Higher ranked member approves a pending request, executing it immediately.
 * Approver must outrank the requester (lower rank number).
 * Request PDA is closed, rent returned to requester.
 *
 * On-chain accounts (7):
 * 0. [] approver_player: PlayerAccount (approver)
 * 1. [] approver_slot: TeamMemberSlot (for approver rank)
 * 2. [writable] requester_player: PlayerAccount (receives funds)
 * 3. [writable] team: TeamAccount
 * 4. [writable] request: TreasuryRequest PDA (to be closed)
 * 5. [writable] requester_refund: Account to receive request rent refund
 * 6. [signer] approver_owner: Approver's wallet
 *
 * On-chain data (10 bytes):
 * - team_id: u64 (8)
 * - approver_slot_index: u16 (2)
 */
export function createTeamTreasuryApproveRequestInstruction(
  accounts: TeamTreasuryApproveRequestAccounts
): TransactionInstruction {
  const [approverPlayer] = derivePlayerPda(accounts.gameEngine, accounts.approver);
  const [approverSlot] = deriveTeamSlotPda(accounts.team, accounts.approverSlotIndex);
  const [request] = deriveTreasuryRequestPda(accounts.team, accounts.requesterPlayer);

  const keys = [
    { pubkey: approverPlayer, isSigner: false, isWritable: false },
    { pubkey: approverSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.requesterPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: request, isSigner: false, isWritable: true },
    { pubkey: accounts.requesterRefund, isSigner: false, isWritable: true },
    { pubkey: accounts.approver, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + approver_slot_index (u16)
  const writer = new BufferWriter(10);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.approverSlotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_TREASURY_APPROVE_REQUEST, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Treasury Reject Request
// ============================================================

export interface TeamTreasuryRejectRequestAccounts {
  /** Rejecter's wallet (signer) - must outrank requester (RANK_0 or RANK_1) */
  rejecter: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Rejecter's slot index */
  rejecterSlotIndex: number;
  /** Requester's player account (for PDA derivation) */
  requesterPlayer: PublicKey;
  /** Account to receive request rent refund (usually requester's wallet) */
  requesterRefund: PublicKey;
}

/** ~5,000 CU */
/**
 * Reject a treasury withdrawal request.
 *
 * Higher ranked member rejects a pending request.
 * Request PDA is closed, rent returned to requester.
 * Only leader (RANK_0) or high rank (RANK_1) can reject requests.
 *
 * On-chain accounts (6):
 * 0. [] rejecter_player: PlayerAccount (rejecter)
 * 1. [] rejecter_slot: TeamMemberSlot (for rejecter rank)
 * 2. [] team: TeamAccount
 * 3. [writable] request: TreasuryRequest PDA (to be closed)
 * 4. [writable] requester_refund: Account to receive request rent refund
 * 5. [signer] rejecter_owner: Rejecter's wallet
 *
 * On-chain data (42 bytes):
 * - team_id: u64 (8)
 * - rejecter_slot_index: u16 (2)
 * - requester_pubkey: Pubkey (32)
 */
export function createTeamTreasuryRejectRequestInstruction(
  accounts: TeamTreasuryRejectRequestAccounts
): TransactionInstruction {
  const [rejecterPlayer] = derivePlayerPda(accounts.gameEngine, accounts.rejecter);
  const [rejecterSlot] = deriveTeamSlotPda(accounts.team, accounts.rejecterSlotIndex);
  const [request] = deriveTreasuryRequestPda(accounts.team, accounts.requesterPlayer);

  const keys = [
    { pubkey: rejecterPlayer, isSigner: false, isWritable: false },
    { pubkey: rejecterSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: request, isSigner: false, isWritable: true },
    { pubkey: accounts.requesterRefund, isSigner: false, isWritable: true },
    { pubkey: accounts.rejecter, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + rejecter_slot_index (u16) + requester_pubkey (Pubkey)
  const writer = new BufferWriter(42);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.rejecterSlotIndex);
  writer.writeBytes(accounts.requesterPlayer.toBuffer());

  const data = createInstructionData(DISCRIMINATORS.TEAM_TREASURY_REJECT_REQUEST, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Treasury Execute Request
// ============================================================

export interface TeamTreasuryExecuteRequestAccounts {
  /** Requester's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Member's slot index */
  slotIndex: number;
}

/** ~5,000 CU */
/**
 * Execute a treasury withdrawal request after cooldown.
 *
 * Requester executes their own request after cooldown period has passed.
 * Validates requester still has treasury permission and is in team.
 * Request PDA is closed, rent returned to requester.
 *
 * On-chain accounts (5):
 * 0. [writable] player: PlayerAccount (requester, receives funds)
 * 1. [] member_slot: TeamMemberSlot (to verify still has permission)
 * 2. [writable] team: TeamAccount
 * 3. [writable] request: TreasuryRequest PDA (to be closed)
 * 4. [signer, writable] owner: Player's wallet (receives request rent refund)
 *
 * On-chain data (10 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 */
export function createTeamTreasuryExecuteRequestInstruction(
  accounts: TeamTreasuryExecuteRequestAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [memberSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);
  const [request] = deriveTreasuryRequestPda(accounts.team, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: memberSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: request, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
  ];

  // Instruction data: team_id (u64) + slot_index (u16)
  const writer = new BufferWriter(10);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.TEAM_TREASURY_EXECUTE_REQUEST, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Treasury Cancel Request
// ============================================================

export interface TeamTreasuryCancelRequestAccounts {
  /** Requester's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Cancel own pending treasury withdrawal request.
 *
 * Requester can cancel their own pending request at any time.
 * Request PDA is closed, rent returned to requester.
 *
 * On-chain accounts (4):
 * 0. [] player: PlayerAccount (requester)
 * 1. [] team: TeamAccount
 * 2. [writable] request: TreasuryRequest PDA (to be closed)
 * 3. [signer, writable] owner: Player's wallet (receives request rent refund)
 *
 * On-chain data (8 bytes):
 * - team_id: u64
 */
export function createTeamTreasuryCancelRequestInstruction(
  accounts: TeamTreasuryCancelRequestAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [request] = deriveTreasuryRequestPda(accounts.team, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: request, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
  ];

  // Instruction data: team_id (u64)
  const writer = new BufferWriter(8);
  writer.writeU64(accounts.teamId);

  const data = createInstructionData(DISCRIMINATORS.TEAM_TREASURY_CANCEL_REQUEST, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Team Update Treasury Settings
// ============================================================

export interface TeamUpdateTreasurySettingsAccounts {
  /** Leader's wallet (signer) */
  leader: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Team */
  team: PublicKey;
  /** Team ID (u64) for PDA validation */
  teamId: BN | number | bigint;
  /** Leader's slot index */
  slotIndex: number;
}

export interface TeamUpdateTreasurySettingsParams {
  /** Instant withdrawal limits per rank (4 values for ranks 1-4) */
  instantLimits: [BN | number | bigint, BN | number | bigint, BN | number | bigint, BN | number | bigint];
  /** Daily withdrawal caps per rank (4 values for ranks 1-4) */
  dailyCaps: [BN | number | bigint, BN | number | bigint, BN | number | bigint, BN | number | bigint];
  /** Cooldown hours for large withdrawals (1-72 hours) */
  cooldownHours: number;
}

/** ~5,000 CU */
/**
 * Update team treasury security settings (leader only).
 *
 * Leader can configure withdrawal limits, daily caps, and cooldown period.
 *
 * On-chain accounts (4):
 * 0. [] leader_player: PlayerAccount (leader)
 * 1. [] leader_slot: TeamMemberSlot (to verify leader rank)
 * 2. [writable] team: TeamAccount
 * 3. [signer] leader_owner: Leader's wallet
 *
 * On-chain data (75 bytes):
 * - team_id: u64 (8)
 * - slot_index: u16 (2)
 * - instant_limits: [u64; 4] (32)
 * - daily_caps: [u64; 4] (32)
 * - cooldown_hours: u8 (1)
 */
export function createTeamUpdateTreasurySettingsInstruction(
  accounts: TeamUpdateTreasurySettingsAccounts,
  params: TeamUpdateTreasurySettingsParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.leader);
  const [leaderSlot] = deriveTeamSlotPda(accounts.team, accounts.slotIndex);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: leaderSlot, isSigner: false, isWritable: false },
    { pubkey: accounts.team, isSigner: false, isWritable: true },
    { pubkey: accounts.leader, isSigner: true, isWritable: false },
  ];

  // Instruction data: team_id (u64) + slot_index (u16) + instant_limits ([u64;4]) + daily_caps ([u64;4]) + cooldown_hours (u8)
  const writer = new BufferWriter(75);
  writer.writeU64(accounts.teamId);
  writer.writeU16(accounts.slotIndex);
  for (const limit of params.instantLimits) {
    writer.writeU64(limit);
  }
  for (const cap of params.dailyCaps) {
    writer.writeU64(cap);
  }
  writer.writeU8(params.cooldownHours);

  const data = createInstructionData(DISCRIMINATORS.TEAM_UPDATE_TREASURY_SETTINGS, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
