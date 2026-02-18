/**
 * Transaction Utilities
 *
 * Helpers for sending transactions and parsing results in tests.
 */

import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  PublicKey,
  VersionedTransaction,
  type TransactionSignature,
  type Commitment,
  type ParsedTransactionWithMeta,
  type Finality,
} from '@solana/web3.js';
import BN from 'bn.js';

import { parseEventsFromLogs, parseEventFromBase64, type NovusMundusEvent } from '../../src/events/index';
import { GameError, parseErrorMessage } from '../../src/errors';
import { type TestConfig } from '../fixtures/setup';
import { log } from './logger';

// ============================================================
// Transaction Building
// ============================================================

export interface TransactionOptions {
  /** Additional compute units */
  computeUnits?: number;
  /** Priority fee in microlamports per compute unit */
  priorityFee?: number;
  /** Additional signers beyond the payer */
  additionalSigners?: Keypair[];
  /** Whether to simulate before sending */
  simulate?: boolean;
  /** Commitment level */
  commitment?: Finality;
  /** Skip preflight checks */
  skipPreflight?: boolean;
  /** Label for logging (auto-set by callers) */
  _label?: string;
}

const DEFAULT_TX_OPTIONS: TransactionOptions = {
  computeUnits: 400000,
  priorityFee: 1,
  simulate: false,
  commitment: 'confirmed',
  skipPreflight: true,
};

/**
 * Build a transaction with compute budget instructions.
 */
export function buildTransaction(
  instructions: TransactionInstruction[],
  options: TransactionOptions = {}
): Transaction {
  const opts = { ...DEFAULT_TX_OPTIONS, ...options };
  const tx = new Transaction();

  // Add compute budget if specified
  if (opts.computeUnits) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: opts.computeUnits,
      })
    );
  }

  if (opts.priorityFee) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: opts.priorityFee,
      })
    );
  }

  // Add all instructions
  for (const ix of instructions) {
    tx.add(ix);
  }

  return tx;
}

/**
 * Send a transaction with retries.
 */
export async function sendTransaction(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  options: TransactionOptions = {}
): Promise<TransactionSignature> {
  const opts = { ...DEFAULT_TX_OPTIONS, ...options };
  const label = opts._label ?? 'tx';

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = signers[0]!.publicKey;

  // Optionally simulate first
  if (opts.simulate) {
    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    }
  }

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: opts.skipPreflight ?? true,
      commitment: opts.commitment,
    });
    log.txSuccess(label, sig);
    return sig;
  } catch (error: any) {
    // Try to extract tx logs and resolve error code
    const txLogs = extractLogsFromError(error);
    const code = extractErrorCode(error);
    if (code !== null) {
      const resolved = resolveErrorCode(code);
      log.txFail(label, new Error(resolved), txLogs);
    } else {
      log.txFail(label, error, txLogs);
    }
    throw error;
  }
}

/**
 * Send a single instruction as a transaction.
 */
export async function sendInstruction(
  connection: Connection,
  instruction: TransactionInstruction,
  signers: Keypair[],
  options: TransactionOptions = {}
): Promise<TransactionSignature> {
  const tx = buildTransaction([instruction], options);
  return await sendTransaction(connection, tx, signers, options);
}

/**
 * Send multiple instructions in a single transaction.
 */
export async function sendInstructions(
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  options: TransactionOptions = {}
): Promise<TransactionSignature> {
  const tx = buildTransaction(instructions, options);
  return await sendTransaction(connection, tx, signers, options);
}

// ============================================================
// Transaction Parsing
// ============================================================

/**
 * Get transaction details with logs.
 */
export async function getTransactionDetails(
  connection: Connection,
  signature: TransactionSignature,
  commitment: Finality = 'confirmed'
): Promise<ParsedTransactionWithMeta | null> {
  return await connection.getParsedTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
}

/**
 * Get transaction logs.
 */
export async function getTransactionLogs(
  connection: Connection,
  signature: TransactionSignature
): Promise<string[]> {
  const tx = await getTransactionDetails(connection, signature);
  return tx?.meta?.logMessages ?? [];
}

/**
 * Parse events from transaction signature.
 */
export async function parseEventsFromSignature(
  connection: Connection,
  signature: TransactionSignature
): Promise<NovusMundusEvent[]> {
  const logs = await getTransactionLogs(connection, signature);
  return parseEventsFromLogs(logs);
}

/**
 * Find a specific event type in transaction.
 */
export async function findEventInTransaction<T extends NovusMundusEvent>(
  connection: Connection,
  signature: TransactionSignature,
  eventName: string
): Promise<T | undefined> {
  const events = await parseEventsFromSignature(connection, signature);
  return events.find(e => e.name === eventName) as T | undefined;
}

// ============================================================
// Transaction Result Wrapper
// ============================================================

export interface TransactionResult {
  signature: TransactionSignature;
  success: boolean;
  error?: Error;
  logs: string[];
  events: NovusMundusEvent[];
  slot: number;
  computeUnitsUsed?: number;
}

/**
 * Send transaction and return detailed result.
 */
export async function sendTransactionWithResult(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  const opts = { ...DEFAULT_TX_OPTIONS, ...options };

  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = signers[0]!.publicKey;

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: opts.skipPreflight ?? true,
      commitment: opts.commitment,
    });

    const details = await getTransactionDetails(connection, signature);
    const logs = details?.meta?.logMessages ?? [];
    const events = parseEventsFromLogs(logs);

    return {
      signature,
      success: true,
      logs,
      events,
      slot: details?.slot ?? 0,
      computeUnitsUsed: details?.meta?.computeUnitsConsumed ?? undefined,
    };
  } catch (error: any) {
    return {
      signature: '',
      success: false,
      error,
      logs: [],
      events: [],
      slot: 0,
    };
  }
}

// ============================================================
// Error Handling
// ============================================================

/**
 * Extract transaction logs from a SendTransactionError.
 */
function extractLogsFromError(error: any): string[] {
  // @solana/web3.js SendTransactionError has logs property
  if (error?.logs && Array.isArray(error.logs)) {
    return error.logs;
  }
  // Some errors embed logs in the message
  const msg = error?.message ?? '';
  const logMatch = msg.match(/Transaction simulation failed.*\n([\s\S]*)/);
  if (logMatch?.[1]) {
    return logMatch[1].split('\n').filter((l: string) => l.trim());
  }
  return [];
}

/**
 * Extract program error code from transaction error.
 */
export function extractErrorCode(error: Error): number | null {
  const msg = error.message;

  // Match "custom program error: 0xNNNN" (from logs or preflight)
  const hexMatch = msg.match(/custom program error: (0x[0-9a-fA-F]+)/);
  if (hexMatch?.[1]) {
    return parseInt(hexMatch[1], 16);
  }

  // Match "custom program error: NNNN" (decimal)
  const decimalMatch = msg.match(/custom program error: (\d+)/);
  if (decimalMatch?.[1]) {
    return parseInt(decimalMatch[1], 10);
  }

  // Match JSON format from SendTransactionError: {"Custom":NNNN}
  const jsonMatch = msg.match(/"Custom"\s*:\s*(\d+)/);
  if (jsonMatch?.[1]) {
    return parseInt(jsonMatch[1], 10);
  }

  // Check transactionMessage property (SendTransactionError)
  const txMsg = (error as any).transactionMessage;
  if (typeof txMsg === 'string') {
    const txJsonMatch = txMsg.match(/"Custom"\s*:\s*(\d+)/);
    if (txJsonMatch?.[1]) {
      return parseInt(txJsonMatch[1], 10);
    }
  }

  // Check error logs for hex error code
  const logs: string[] = (error as any).logs ?? [];
  for (const log of logs) {
    const logMatch = log.match(/custom program error: (0x[0-9a-fA-F]+)/);
    if (logMatch?.[1]) {
      return parseInt(logMatch[1], 16);
    }
  }

  return null;
}

/**
 * Resolve an error code to its GameError enum name and message.
 * e.g. 6127 → "UserAccountNotCreated: Must create user account before player"
 */
export function resolveErrorCode(code: number): string {
  const name = GameError[code]; // reverse lookup enum name
  const message = parseErrorMessage(code);
  if (name) {
    return `${name} (${code}): ${message}`;
  }
  return `Custom:${code} - ${message}`;
}

/**
 * Check if error is a specific program error.
 */
export function isErrorCode(error: Error, expectedCode: number): boolean {
  const actualCode = extractErrorCode(error);
  return actualCode === expectedCode;
}

/**
 * Assert transaction fails with specific error code.
 */
export async function expectTransactionToFail(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  expectedErrorCode?: number,
  label?: string
): Promise<Error> {
  const tag = label ?? 'tx (expect fail)';
  try {
    await sendTransaction(connection, tx, signers, { _label: tag });
    throw new Error('Transaction should have failed');
  } catch (error: any) {
    if (error.message === 'Transaction should have failed') {
      log.txFail(tag, new Error('Transaction succeeded but was expected to fail'));
      throw error;
    }

    if (expectedErrorCode !== undefined) {
      const actualCode = extractErrorCode(error);
      if (actualCode !== expectedErrorCode) {
        const txLogs = extractLogsFromError(error);
        const expected = resolveErrorCode(expectedErrorCode);
        const actual = actualCode !== null ? resolveErrorCode(actualCode) : 'unknown';
        log.txFail(tag, new Error(`Expected ${expected} but got ${actual}`), txLogs);
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    }

    log.txExpectedFail(tag);
    return error;
  }
}

// ============================================================
// Batch Operations
// ============================================================

/**
 * Send multiple independent transactions in parallel.
 */
export async function sendTransactionsParallel(
  connection: Connection,
  transactions: Array<{
    tx: Transaction;
    signers: Keypair[];
  }>,
  options: TransactionOptions = {}
): Promise<TransactionSignature[]> {
  const blockhash = (await connection.getLatestBlockhash()).blockhash;

  const promises = transactions.map(({ tx, signers }) => {
    tx.recentBlockhash = blockhash;
    tx.feePayer = signers[0]!.publicKey;
    return sendAndConfirmTransaction(connection, tx, signers, {
      skipPreflight: options.skipPreflight ?? true,
      commitment: options.commitment,
    });
  });

  return await Promise.all(promises);
}

/**
 * Send transactions sequentially with delay.
 */
export async function sendTransactionsSequential(
  connection: Connection,
  transactions: Array<{
    tx: Transaction;
    signers: Keypair[];
  }>,
  delayMs: number = 100,
  options: TransactionOptions = {}
): Promise<TransactionSignature[]> {
  const signatures: TransactionSignature[] = [];

  for (const { tx, signers } of transactions) {
    const sig = await sendTransaction(connection, tx, signers, options);
    signatures.push(sig);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return signatures;
}
