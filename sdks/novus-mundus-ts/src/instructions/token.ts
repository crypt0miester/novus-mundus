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
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressSync, getAssociatedTokenAddressSyncForPda } from '../utils/token';

// ============================================================
// Reserved to Locked
// ============================================================

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

// ============================================================
// Withdraw Reserved
// ============================================================

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
 * # Accounts (7 total)
 * 1. user (writable) - UserAccount PDA
 * 2. owner (signer) - Wallet that owns the UserAccount PDA
 * 3. reserved_token_account (writable) - Token account OWNED BY UserAccount PDA
 * 4. user_wallet_token_account (writable) - User's wallet token account (ATA)
 * 5. game_engine - GameEngine PDA
 * 6. novi_mint - NOVI token mint
 * 7. token_program - SPL Token program
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
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userWalletTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
