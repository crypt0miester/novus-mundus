/**
 * Transaction Utilities
 *
 * Helpers for sending transactions and parsing results in tests.
 * Uses LiteSVM for in-process transaction execution.
 */

import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  signTransaction,
  getBase58Decoder,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';

import { type LiteSVM, FailedTransactionMetadata } from '../fixtures/svm';
import { parseEventsFromLogs, type NovusMundusEvent } from '../../src/events/index';
import { GameError, parseErrorMessage } from '../../src/errors';
import { log } from './logger';

// Transaction Metadata Cache

interface CachedTxMeta {
  logs: string[];
  computeUnitsConsumed: number;
  signature: string;
}

const _txCache = new Map<string, CachedTxMeta>();

// Transaction Building

export interface TransactionOptions {
  /** Additional compute units */
  computeUnits?: number;
  /** Priority fee in microlamports per compute unit */
  priorityFee?: number;
  /** Additional signers beyond the payer */
  additionalSigners?: KeyPairSigner[];
  /** Whether to simulate before sending */
  simulate?: boolean;
  /** Label for logging (auto-set by callers) */
  _label?: string;
}

const DEFAULT_TX_OPTIONS: TransactionOptions = {
  computeUnits: 400000,
  priorityFee: 1,
  simulate: false,
};

/**
 * Build a kit transaction message, compile it and sign it with the raw
 * key pairs of the provided signers. Compute-budget instructions are
 * prepended automatically.
 */
async function buildAndSign(
  svm: LiteSVM,
  instructions: Instruction[],
  signers: KeyPairSigner[],
  options: TransactionOptions = {},
) {
  const opts = { ...DEFAULT_TX_OPTIONS, ...options };

  const allIxs: Instruction[] = [];
  if (opts.computeUnits) {
    allIxs.push(getSetComputeUnitLimitInstruction({ units: opts.computeUnits }));
  }
  if (opts.priorityFee) {
    allIxs.push(getSetComputeUnitPriceInstruction({ microLamports: opts.priorityFee }));
  }
  allIxs.push(...instructions);

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(signers[0]!.address, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(allIxs, m),
  );

  const compiled = compileTransaction(message);
  return signTransaction(
    signers.map((s) => s.keyPair),
    compiled,
  );
}

// Transaction Sending

/**
 * Send a list of instructions via LiteSVM.
 */
export async function sendTransaction(
  svm: LiteSVM,
  instructions: Instruction[],
  signers: KeyPairSigner[],
  options: TransactionOptions = {},
): Promise<Signature> {
  const opts = { ...DEFAULT_TX_OPTIONS, ...options };
  const label = opts._label ?? 'tx';

  const signed = await buildAndSign(svm, instructions, signers, opts);
  const result = svm.sendTransaction(signed);

  if (result instanceof FailedTransactionMetadata) {
    const meta = result.meta();
    const txLogs = meta.logs();
    const errStr = result.toString();

    // Build error message compatible with existing error code extraction
    let message = `Transaction failed: ${errStr}`;
    const code = extractErrorCodeFromSvmResult(result);
    if (code !== null) {
      message = `failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x${code.toString(16)}`;
      const resolved = resolveErrorCode(code);
      log.txFail(label, new Error(resolved), txLogs);
    } else {
      log.txFail(label, new Error(message), txLogs);
    }

    const error: any = new Error(message);
    error.logs = txLogs;
    error.transactionLogs = txLogs;
    throw error;
  }

  const sig = getBase58Decoder().decode(result.signature()) as Signature;
  const txLogs = result.logs();
  const cu = Number(result.computeUnitsConsumed());

  // Cache metadata for later retrieval
  _txCache.set(sig, { logs: txLogs, computeUnitsConsumed: cu, signature: sig });

  // Expire blockhash so identical transactions can be sent again
  svm.expireBlockhash();

  log.txSuccess(label, sig);
  return sig;
}

/**
 * Send a single instruction as a transaction.
 */
export async function sendInstruction(
  svm: LiteSVM,
  instruction: Instruction,
  signers: KeyPairSigner[],
  options: TransactionOptions = {},
): Promise<Signature> {
  return await sendTransaction(svm, [instruction], signers, options);
}

/**
 * Send multiple instructions in a single transaction.
 */
export async function sendInstructions(
  svm: LiteSVM,
  instructions: Instruction[],
  signers: KeyPairSigner[],
  options: TransactionOptions = {},
): Promise<Signature> {
  return await sendTransaction(svm, instructions, signers, options);
}

// Transaction Parsing

/**
 * Get transaction logs from cache or SVM history.
 */
export async function getTransactionLogs(
  svm: LiteSVM,
  signature: Signature,
): Promise<string[]> {
  // Check cache first
  const cached = _txCache.get(signature);
  if (cached) return cached.logs;

  // Fall back to SVM transaction history
  const txMeta = svm.getTransaction(signature);
  if (txMeta) {
    const meta = txMeta instanceof FailedTransactionMetadata ? txMeta.meta() : txMeta;
    return meta.logs();
  }
  return [];
}

/**
 * Parse events from transaction signature.
 */
export async function parseEventsFromSignature(
  svm: LiteSVM,
  signature: Signature,
): Promise<NovusMundusEvent[]> {
  const logs = await getTransactionLogs(svm, signature);
  return parseEventsFromLogs(logs);
}

/**
 * Find a specific event type in transaction.
 */
export async function findEventInTransaction<T extends NovusMundusEvent>(
  svm: LiteSVM,
  signature: Signature,
  eventName: string,
): Promise<T | undefined> {
  const events = await parseEventsFromSignature(svm, signature);
  return events.find((e) => e.name === eventName) as T | undefined;
}

// Transaction Result Wrapper

export interface TransactionResult {
  signature: Signature | '';
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
  svm: LiteSVM,
  instructions: Instruction[],
  signers: KeyPairSigner[],
  options: TransactionOptions = {},
): Promise<TransactionResult> {
  const signed = await buildAndSign(svm, instructions, signers, options);
  const result = svm.sendTransaction(signed);

  if (result instanceof FailedTransactionMetadata) {
    const meta = result.meta();
    const logs = meta.logs();
    return {
      signature: '',
      success: false,
      error: new Error(result.toString()),
      logs,
      events: [],
      slot: Number(svm.getClock().slot),
    };
  }

  const sig = getBase58Decoder().decode(result.signature()) as Signature;
  const logs = result.logs();
  const events = parseEventsFromLogs(logs);
  const cu = Number(result.computeUnitsConsumed());

  _txCache.set(sig, { logs, computeUnitsConsumed: cu, signature: sig });

  return {
    signature: sig,
    success: true,
    logs,
    events,
    slot: Number(svm.getClock().slot),
    computeUnitsUsed: cu,
  };
}

// Error Handling

/**
 * Extract custom error code from a FailedTransactionMetadata.
 */
function extractErrorCodeFromSvmResult(failed: FailedTransactionMetadata): number | null {
  try {
    const errStr = failed.toString();
    // Match Custom(NNNN) pattern
    const customMatch = errStr.match(/Custom\((\d+)\)/);
    if (customMatch?.[1]) {
      return parseInt(customMatch[1], 10);
    }
  } catch {}
  return null;
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

  // Match LiteSVM Custom(NNNN) format
  const customMatch = msg.match(/Custom\((\d+)\)/);
  if (customMatch?.[1]) {
    return parseInt(customMatch[1], 10);
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
  for (const logLine of logs) {
    const logMatch = logLine.match(/custom program error: (0x[0-9a-fA-F]+)/);
    if (logMatch?.[1]) {
      return parseInt(logMatch[1], 16);
    }
  }

  return null;
}

/**
 * Resolve an error code to its GameError enum name and message.
 */
export function resolveErrorCode(code: number): string {
  const name = GameError[code];
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
  svm: LiteSVM,
  instructions: Instruction[],
  signers: KeyPairSigner[],
  expectedErrorCode?: number,
  label?: string,
): Promise<Error> {
  const tag = label ?? 'tx (expect fail)';
  try {
    await sendTransaction(svm, instructions, signers, { _label: tag });
    throw new Error('Transaction should have failed');
  } catch (error: any) {
    if (error.message === 'Transaction should have failed') {
      log.txFail(tag, new Error('Transaction succeeded but was expected to fail'));
      throw error;
    }

    if (expectedErrorCode !== undefined) {
      const actualCode = extractErrorCode(error);
      if (actualCode !== expectedErrorCode) {
        const txLogs = (error as any).logs ?? [];
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

// Batch Operations

/**
 * Execute multiple transactions sequentially (LiteSVM is single-threaded).
 */
export async function sendTransactionsParallel(
  svm: LiteSVM,
  transactions: Array<{
    instructions: Instruction[];
    signers: KeyPairSigner[];
  }>,
  options: TransactionOptions = {},
): Promise<Signature[]> {
  const signatures: Signature[] = [];
  for (const { instructions, signers } of transactions) {
    const sig = await sendTransaction(svm, instructions, signers, options);
    signatures.push(sig);
  }
  return signatures;
}

/**
 * Send transactions sequentially.
 */
export async function sendTransactionsSequential(
  svm: LiteSVM,
  transactions: Array<{
    instructions: Instruction[];
    signers: KeyPairSigner[];
  }>,
  _delayMs: number = 0,
  options: TransactionOptions = {},
): Promise<Signature[]> {
  const signatures: Signature[] = [];
  for (const { instructions, signers } of transactions) {
    const sig = await sendTransaction(svm, instructions, signers, options);
    signatures.push(sig);
  }
  return signatures;
}
