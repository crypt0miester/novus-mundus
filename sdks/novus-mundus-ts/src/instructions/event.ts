/**
 * Event Instructions
 *
 * Instructions for event system:
 * - Create event (admin)
 * - Join event
 * - Finalize event (admin)
 * - Claim prize
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { ByteWriter, createInstructionData } from '../utils/serialize';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveEventPda,
  deriveEventParticipationPda,
} from '../pda';
import { getAssociatedTokenAddressAsyncForPda, ASSOCIATED_TOKEN_PROGRAM_ID } from '../utils/token';

// Create Event (Admin)

export interface CreateEventAccounts {
  /** Authority (DAO) */
  authority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Event ID */
  eventId: number;
}

export interface CreateEventParams {
  /** Event name (max 64 chars) */
  name: string;
  /** Start timestamp */
  startTime: number | bigint;
  /** End timestamp */
  endTime: number | bigint;
  /** Event type */
  eventType: number;
  /** Minimum level to participate */
  minLevel: number;
  /** Minimum reputation to participate */
  minReputation: number | bigint;
  /** Required subscription tier (0 = any) */
  requiredSubscriptionTier: number;
  /** Prize type (0=LockedNovi, 1=Gems, 2=Cash, 3=SPLToken) */
  prizeType: number;
  /** Prize amount */
  prizeAmount: number | bigint;
  /** Prize token mint (if SPL token) */
  prizeTokenMint?: PublicKey;
  /** Auto-activate on start time */
  autoActivate: boolean;
}

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
): Promise<TransactionInstruction> {
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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Add optional prize token mint
  if (params.prizeTokenMint) {
    keys.push({ pubkey: params.prizeTokenMint, isSigner: false, isWritable: false });
  }

  const nameBytes = new TextEncoder().encode(params.name);
  if (nameBytes.length > 64) {
    throw new Error('Event name too long (max 64 bytes)');
  }

  // Instruction data
  const writer = new ByteWriter(200);
  writer.writeU64(accounts.eventId);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(nameBytes);
  writer.writeI64(params.startTime);
  writer.writeI64(params.endTime);
  writer.writeU8(params.eventType);
  writer.writeU8(params.minLevel);
  writer.writeU64(params.minReputation);
  writer.writeU8(params.requiredSubscriptionTier);
  writer.writeU8(params.prizeType);
  writer.writeU64(params.prizeAmount);
  // Prize token mint (32 bytes, zeroed for non-SPL prizes)
  if (params.prizeTokenMint) {
    writer.writeBytes(params.prizeTokenMint.toBytes());
  } else {
    writer.writeZeros(32);
  }
  writer.writeBool(params.autoActivate);

  const data = createInstructionData(DISCRIMINATORS.EVENT_CREATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Join Event

export interface JoinEventAccounts {
  /** Payer for account creation (can be backend for free joins) */
  payer: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Player's wallet */
  playerOwner: PublicKey;
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
): Promise<TransactionInstruction> {
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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.EVENT_JOIN);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Leave Event

export interface LeaveEventAccounts {
  /** Payer for transaction fees (can be backend for gas-less leaves) */
  payer: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Player's wallet (also the rent-refund recipient) */
  playerOwner: PublicKey;
  /** Event ID */
  eventId: number;
}

/** ~5,000 CU */
/**
 * Leave a finalized or cancelled event.
 *
 * Frees the player's one-event slot so non-winners (who never call claim_prize)
 * aren't locked out of every future event. Closes the EventParticipation PDA and
 * refunds its rent to playerOwner.
 *
 * Requirements:
 * - Event must be finalized (2) or cancelled (3) (can't bail mid-competition)
 * - Player must currently be in this event
 * - Top-10 winners of a finalized event must claim their prize first
 *
 * Note: Payer can be different from playerOwner (allows backend to pay fees).
 */
export async function createLeaveEventInstruction(
  accounts: LeaveEventAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
  const [participation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.playerOwner);

  // Rust account order:
  // 0. payer (SIGNER, WRITE) - pays tx fees
  // 1. player_account (WRITE)
  // 2. event_account (READ)
  // 3. event_participation_account (WRITE) - will be closed
  // 4. player_owner (WRITE) - rent refund recipient
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: event, isSigner: false, isWritable: false },
    { pubkey: participation, isSigner: false, isWritable: true },
    { pubkey: accounts.playerOwner, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.EVENT_LEAVE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Finalize Event (Permissionless)

export interface FinalizeEventAccounts {
  /** GameEngine PDA */
  gameEngine: PublicKey;
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
): Promise<TransactionInstruction> {
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);

  // Rust account order:
  // 0. event_account (WRITE)
  const keys = [
    { pubkey: event, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.EVENT_FINALIZE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Prize

export interface ClaimPrizeAccounts {
  /** Payer for transaction fees (can be backend for gas-less claims) */
  payer: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Winner's wallet */
  winnerOwner: PublicKey;
  /** Event ID */
  eventId: number;
  /** Event vault (optional, only for SPLToken prizes) */
  eventVault?: PublicKey;
  /** Winner's SPL token account (optional, only for SPLToken prizes) */
  winnerSplTokenAccount?: PublicKey;
  /** SPL prize token mint (optional, only for SPLToken prizes) */
  prizeTokenMint?: PublicKey;
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
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.winnerOwner);
  const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
  const [participation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.winnerOwner);
  const [noviMint] = await deriveNoviMintPda();
  const [estate] = await deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

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
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    keys.push({ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(DISCRIMINATORS.EVENT_CLAIM_PRIZE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
