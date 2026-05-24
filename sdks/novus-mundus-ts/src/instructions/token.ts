/**
 * Token Instructions
 *
 * Instructions for NOVI token operations:
 * - Reserved to locked conversion
 * - Withdraw reserved NOVI
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
  deriveNoviMintPda,
  derivePlayerPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressSync, getAssociatedTokenAddressSyncForPda, ASSOCIATED_TOKEN_PROGRAM_ID } from '../utils/token';

// Reserved to Locked

export interface ReservedToLockedAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface ReservedToLockedParams {
  /** Amount of reserved NOVI to convert to locked */
  amount: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Convert reserved NOVI to locked NOVI.
 *
 * Reserved NOVI can be withdrawn or converted to locked.
 * Locked NOVI is used for gameplay and cannot be withdrawn directly.
 *
 * # Token Account Ownership
 * - Reserved token account: OWNED BY UserAccount PDA
 * - Locked token account: OWNED BY PlayerAccount PDA
 * - User can only trigger transfer through this instruction
 * - PDAs control the tokens for security
 *
 * # Accounts (8 total)
 * 1. player (writable) - PlayerAccount PDA
 * 2. user (writable) - UserAccount PDA
 * 3. owner (signer) - Wallet that owns both PDAs
 * 4. reserved_token_account (writable) - Token account OWNED BY UserAccount PDA
 * 5. locked_token_account (writable) - Token account OWNED BY PlayerAccount PDA
 * 6. game_engine - GameEngine PDA
 * 7. novi_mint - NOVI token mint
 * 8. token_program - SPL Token program
 */
export function createReservedToLockedInstruction(
  accounts: ReservedToLockedAccounts,
  params: ReservedToLockedParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();

  // Token accounts are owned by PDAs, not the wallet
  const reservedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, user);
  const lockedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: lockedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: amount (u64)
  const writer = new BufferWriter(8);
  writer.writeU64(params.amount);

  const data = createInstructionData(DISCRIMINATORS.RESERVED_TO_LOCKED, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Withdraw Reserved

export interface WithdrawReservedAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface WithdrawReservedParams {
  /** Amount of reserved NOVI to withdraw */
  amount: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Withdraw reserved NOVI to wallet.
 *
 * Transfers NOVI tokens from UserAccount PDA's reserved token account
 * to the user's wallet token account. Subject to 7-day vesting period.
 *
 * # Token Account Ownership
 * - Reserved token account: OWNED BY UserAccount PDA
 * - User wallet token account: OWNED BY user wallet (standard ATA)
 * - UserAccount PDA signs the transfer
 *
 * # Accounts (9 total)
 * 1. user (writable) - UserAccount PDA
 * 2. owner (signer, writable) - Wallet that owns the UserAccount PDA
 * 3. reserved_token_account (writable) - Token account OWNED BY UserAccount PDA
 * 4. user_wallet_token_account (writable) - User's wallet NOVI ATA (created if missing)
 * 5. game_engine - GameEngine PDA
 * 6. novi_mint - NOVI token mint
 * 7. token_program - SPL Token program
 * 8. system_program - System program
 * 9. associated_token_program - Associated Token program
 */
export function createWithdrawReservedInstruction(
  accounts: WithdrawReservedAccounts,
  params: WithdrawReservedParams
): TransactionInstruction {
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();

  // Reserved token account is owned by UserAccount PDA
  const reservedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, user);
  // User wallet token account is owned by user's wallet (standard ATA)
  const userWalletTokenAccount = getAssociatedTokenAddressSync(noviMint, accounts.owner);

  const keys = [
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userWalletTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: amount (u64)
  const writer = new BufferWriter(8);
  writer.writeU64(params.amount);

  const data = createInstructionData(DISCRIMINATORS.WITHDRAW_RESERVED, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Deposit NOVI

export interface DepositNoviAccounts {
  /** Wallet that owns the UserAccount PDA + source ATA (signer) */
  owner: PublicKey;
}

export interface DepositNoviParams {
  /** Gross NOVI to deposit. `credited = amount - ⌊amount * DEPOSIT_FEE_BPS / 10000⌋`. */
  amount: BN | number | bigint;
}

/** ~6,000 CU */
/**
 * Deposit wallet NOVI back into reserved (inverse of `withdraw_reserved`).
 *
 * Burns `fee = ⌊amount * DEPOSIT_FEE_BPS / 10000⌋` from the source ATA and
 * transfers the remainder to the UserAccount PDA's reserved ATA. The
 * `reserved_novi_earned_at` vesting timestamp is NOT touched, so a
 * depositor cannot reset their own 7-day withdraw clock.
 *
 * # Token Account Ownership
 * - Source ATA: OWNED BY the owner wallet (validated on-chain).
 * - Reserved ATA: OWNED BY UserAccount PDA.
 * - The wallet signs both the burn and the transfer.
 *
 * # Accounts (6 total)
 * 1. user (writable) - UserAccount PDA
 * 2. owner (signer, writable) - Wallet
 * 3. source_token_account (writable) - Wallet's NOVI ATA
 * 4. reserved_token_account (writable) - UserAccount PDA-owned reserved ATA
 * 5. novi_mint - NOVI mint
 * 6. token_program - SPL Token program
 */
export function createDepositNoviInstruction(
  accounts: DepositNoviAccounts,
  params: DepositNoviParams
): TransactionInstruction {
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();

  const sourceTokenAccount = getAssociatedTokenAddressSync(noviMint, accounts.owner);
  const reservedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, user);

  const keys = [
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: sourceTokenAccount, isSigner: false, isWritable: true },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
    /* Burn CPI mutates the mint (decrements supply). Must be writable —
     * otherwise the runtime escalates the privilege from the CPI. */
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(8);
  writer.writeU64(params.amount);
  const data = createInstructionData(DISCRIMINATORS.DEPOSIT_NOVI, writer.toBuffer());

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

// Treasury Sweep Untracked NOVI

export enum SweepKind {
  Player = 0,
  User = 1,
}

export interface TreasurySweepUntrackedNoviAccounts {
  /** Wallet that owns the target PDA (signer) — surplus returns here. */
  owner: PublicKey;
}

export interface TreasurySweepUntrackedNoviParams {
  kind: SweepKind;
}

/**
 * Self-recover NOVI sitting in your own program-PDA-owned ATA that has no
 * backing state (mis-sends, partner transfers without the matching
 * `deposit_novi` ix). Compares the live SPL Token balance to the tracked
 * state counter (`player.locked_novi` for kind=0, `user.reserved_novi`
 * for kind=1) and transfers any surplus to the **caller's wallet NOVI
 * ATA**. If `ata_balance <= tracked`, returns silently — no state writes,
 * no error.
 *
 * Permissionless but auth'd: the signer must match the `owner` stored on
 * the target PDA. You can only sweep your own PDAs.
 *
 * Despite the function name, the surplus does not flow to a "treasury" —
 * it flows back to the caller's wallet. The name is preserved for
 * continuity with the design doc; consider renaming in a follow-up.
 *
 * # Accounts (6 total)
 * 1. owner (signer, writable)
 * 2. pda_account - PlayerAccount or UserAccount PDA
 * 3. source_ata (writable) - PDA-owned NOVI ATA
 * 4. wallet_ata (writable) - owner's wallet NOVI ATA (destination)
 * 5. novi_mint
 * 6. token_program
 */
export function createTreasurySweepUntrackedNoviInstruction(
  accounts: TreasurySweepUntrackedNoviAccounts,
  params: TreasurySweepUntrackedNoviParams & {
    /** Optional: pre-derive the GameEngine for the player path. Required for kind=Player. */
    gameEngine?: PublicKey;
  }
): TransactionInstruction {
  const [noviMint] = deriveNoviMintPda();

  /* Derive the PDA + source ATA from owner + kind so callers don't need
   * to thread them through every call. */
  let pdaAccount: PublicKey;
  if (params.kind === SweepKind.Player) {
    if (!params.gameEngine) {
      throw new Error('createTreasurySweepUntrackedNoviInstruction: gameEngine required for kind=Player');
    }
    [pdaAccount] = derivePlayerPda(params.gameEngine, accounts.owner);
  } else {
    [pdaAccount] = deriveUserPda(accounts.owner);
  }
  const sourceAta = getAssociatedTokenAddressSyncForPda(noviMint, pdaAccount);
  const walletAta = getAssociatedTokenAddressSync(noviMint, accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: pdaAccount, isSigner: false, isWritable: false },
    { pubkey: sourceAta, isSigner: false, isWritable: true },
    { pubkey: walletAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.TREASURY_SWEEP_UNTRACKED_NOVI,
    Buffer.from([params.kind]),
  );

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}
