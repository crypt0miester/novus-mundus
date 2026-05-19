/**
 * Event Instructions
 *
 * Instructions for event system:
 * - Create event (admin)
 * - Join event
 * - Finalize event (admin)
 * - Claim prize
 */

import type { Address, Instruction, ReadonlyUint8Array } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { addressBytes } from '../crypto';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u64, i64, bool, bytes } from '../utils/codec';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveEventPda,
  deriveEventParticipationPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda, ASSOCIATED_TOKEN_PROGRAM_ID } from '../utils/token';

// Create Event (Admin)

export interface CreateEventAccounts {
  /** Authority (DAO) */
  authority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Event ID */
  eventId: number;
}

export interface CreateEventParams {
  /** Event name (max 64 chars) */
  name: string;
  /** Start timestamp */
  startTime: bigint | number;
  /** End timestamp */
  endTime: bigint | number;
  /** Event type */
  eventType: number;
  /** Minimum level to participate */
  minLevel: number;
  /** Minimum reputation to participate */
  minReputation: bigint | number;
  /** Required subscription tier (0 = any) */
  requiredSubscriptionTier: number;
  /** Prize type (0=LockedNovi, 1=Gems, 2=Cash, 3=SPLToken) */
  prizeType: number;
  /** Prize amount */
  prizeAmount: bigint | number;
  /** Prize token mint (if SPL token) */
  prizeTokenMint?: Address;
  /** Auto-activate on start time */
  autoActivate: boolean;
}

/**
 * CreateEvent has VARIABLE-LENGTH data (the name section length depends on the
 * runtime name), so it cannot be a single fixed `packed` codec. The payload is
 * assembled from a fixed head codec + variable name bytes + fixed tail codec.
 */
/** CreateEvent head (9 bytes): event_id (u64), name_len (u8) */
const createEventHead = packed<{ eventId: bigint; nameLen: number }>([
  ['eventId', u64],
  ['nameLen', u8],
], 9);

/** CreateEvent tail (69 bytes): everything after the variable name section */
const createEventTail = packed<{
  startTime: bigint;
  endTime: bigint;
  eventType: number;
  minLevel: number;
  minReputation: bigint;
  requiredSubscriptionTier: number;
  prizeType: number;
  prizeAmount: bigint;
  prizeTokenMint: ReadonlyUint8Array;
  autoActivate: boolean;
}>([
  ['startTime', i64],
  ['endTime', i64],
  ['eventType', u8],
  ['minLevel', u8],
  ['minReputation', u64],
  ['requiredSubscriptionTier', u8],
  ['prizeType', u8],
  ['prizeAmount', u64],
  ['prizeTokenMint', bytes(32)],
  ['autoActivate', bool],
], 69);

/** ~10,000 CU */
/**
 * Create a new event.
 *
 * Events track player actions and reward top performers.
 * Types: MostNoviConsumed, MostEncountersKilled, etc.
 */
export async function createCreateEventInstruction(
  accounts: CreateEventAccounts,
  params: CreateEventParams
): Promise<Instruction> {
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);

  // Rust account order:
  // 0. payer (SIGNER, WRITE)
  // 1. game_engine (READ)
  // 2. event (WRITE)
  // 3. dao_authority (SIGNER)
  // 4. system_program (READ)
  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: event, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Add optional prize token mint
  if (params.prizeTokenMint) {
    keys.push({ pubkey: params.prizeTokenMint, isSigner: false, isWritable: false });
  }

  const nameBytes = new TextEncoder().encode(params.name);
  if (nameBytes.length > 64) {
    throw new Error('Event name too long (max 64 bytes)');
  }

  // Variable-length instruction data: fixed head + variable name + fixed tail.
  const head = createEventHead.encode({
    eventId: BigInt(accounts.eventId),
    nameLen: nameBytes.length,
  });
  // Prize token mint: 32 bytes, zeroed for non-SPL prizes.
  const prizeTokenMint = params.prizeTokenMint
    ? addressBytes(params.prizeTokenMint)
    : new Uint8Array(32);
  const tail = createEventTail.encode({
    startTime: BigInt(params.startTime),
    endTime: BigInt(params.endTime),
    eventType: params.eventType,
    minLevel: params.minLevel,
    minReputation: BigInt(params.minReputation),
    requiredSubscriptionTier: params.requiredSubscriptionTier,
    prizeType: params.prizeType,
    prizeAmount: BigInt(params.prizeAmount),
    prizeTokenMint,
    autoActivate: params.autoActivate,
  });

  const payload = new Uint8Array(head.length + nameBytes.length + tail.length);
  payload.set(head, 0);
  payload.set(nameBytes, head.length);
  payload.set(tail, head.length + nameBytes.length);

  const data = createInstructionData(DISCRIMINATORS.EVENT_CREATE, payload);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Join Event

export interface JoinEventAccounts {
  /** Payer for account creation (can be backend for free joins) */
  payer: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Player's wallet */
  playerOwner: Address;
  /** Event ID */
  eventId: number;
}

/** ~10,000 CU */
/**
 * Join an event to start tracking progress.
 *
 * Requirements:
 * - Event must be active
 * - Player meets min level/reputation
 * - Player has required subscription tier
 * - Player has EXT_RESEARCH extension (understands game)
 *
 * Note: Payer can be different from playerOwner (allows backend to pay for joins)
 */
export async function createJoinEventInstruction(
  accounts: JoinEventAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
  const [participation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.playerOwner);

  // Rust account order:
  // 0. payer (SIGNER, WRITE) - pays for account creation
  // 1. player_account (WRITE)
  // 2. event_account (WRITE)
  // 3. event_participation_account (WRITE)
  // 4. player_owner (WRITE)
  // 5. system_program (READ)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: event, isSigner: false, isWritable: true },
    { pubkey: participation, isSigner: false, isWritable: true },
    { pubkey: accounts.playerOwner, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.EVENT_JOIN);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Finalize Event (Permissionless)

export interface FinalizeEventAccounts {
  /** GameEngine PDA */
  gameEngine: Address;
  /** Event ID */
  eventId: number;
}

/** ~5,000 CU */
/**
 * Finalize an event after it ends.
 *
 * Permissionless - anyone can call after event end_time has passed.
 * Locks the leaderboard and enables prize claims.
 */
export async function createFinalizeEventInstruction(
  accounts: FinalizeEventAccounts
): Promise<Instruction> {
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);

  // Rust account order:
  // 0. event_account (WRITE)
  const keys = [
    { pubkey: event, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.EVENT_FINALIZE);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Prize

export interface ClaimPrizeAccounts {
  /** Payer for transaction fees (can be backend for gas-less claims) */
  payer: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Winner's wallet */
  winnerOwner: Address;
  /** Event ID */
  eventId: number;
  /** Event vault (optional, only for SPLToken prizes) */
  eventVault?: Address;
  /** Winner's SPL token account (optional, only for SPLToken prizes) */
  winnerSplTokenAccount?: Address;
  /** SPL prize token mint (optional, only for SPLToken prizes) */
  prizeTokenMint?: Address;
}

/** ~10,000 CU */
/**
 * Claim event prize for leaderboard placement.
 *
 * Only top 10 can claim prizes.
 * Prize distribution: 40%, 20%, 13%, 9%, 6%, 4%, 3%, 2%, 2%, 1%
 *
 * Anti-Sybil Checks (tiered by prize value):
 * - Transfer ratio (prevents consolidation bots)
 * - Account age (prevents new bot accounts)
 * - Activity requirement (prevents passive farming)
 *
 * Building Bonuses (Treasury):
 * - Lv 5-9: +10% prize bonus
 * - Lv 10-14: +25% prize bonus
 * - Lv 15-19: +40% prize bonus
 * - Lv 20+: +50% prize bonus
 */
export async function createClaimPrizeInstruction(
  accounts: ClaimPrizeAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.winnerOwner);
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
  const [participation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.winnerOwner);
  const [noviMint] = await deriveNoviMintPda();
  const [estate] = await deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Rust account order:
  // 0. payer (SIGNER, WRITE) - pays tx fees
  // 1. winner_player (WRITE)
  // 2. event (WRITE)
  // 3. event_participation (WRITE) - will be closed
  // 4. winner_owner (WRITE)
  // 5. winner_novi_ata (WRITE)
  // 6. novi_mint (WRITE)
  // 7. game_engine (READ)
  // 8. token_program (READ)
  // 9. winner_estate (READ)
  // 10. [optional] event_vault (WRITE)
  // 11. [optional] winner_spl_token_account (WRITE)
  // 12. [optional] prize_token_mint (READ)
  // 13. [optional] system_program (READ)
  // 14. [optional] associated_token_program (READ)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: event, isSigner: false, isWritable: true },
    { pubkey: participation, isSigner: false, isWritable: true },
    { pubkey: accounts.winnerOwner, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Add optional SPL token accounts (all-or-nothing for SPLToken prizes).
  // The on-chain handler creates the winner's ATA if missing, so it needs
  // the prize mint, system program, and associated-token program too.
  if (accounts.eventVault) {
    if (!accounts.winnerSplTokenAccount || !accounts.prizeTokenMint) {
      throw new Error(
        'SPLToken prize claim requires eventVault, winnerSplTokenAccount, and prizeTokenMint'
      );
    }
    keys.push({ pubkey: accounts.eventVault, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.winnerSplTokenAccount, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.prizeTokenMint, isSigner: false, isWritable: false });
    keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(DISCRIMINATORS.EVENT_CLAIM_PRIZE);

  return buildInstruction(PROGRAM_ID, keys, data);
}
