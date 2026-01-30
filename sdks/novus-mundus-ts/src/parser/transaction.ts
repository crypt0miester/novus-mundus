/**
 * Transaction Parser
 *
 * Parse Solana transactions to extract Novus Mundus instructions and events.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { VersionedTransactionResponse, TransactionResponse } from '@solana/web3.js';
import type { ParsedInstruction } from './instruction.ts';
import { parseInstructionData, isNovusMundusInstruction } from './instruction.ts';
import { parseEventsFromLogs } from '../events/parser.ts';
import type { NovusMundusEvent } from '../events/types.ts';
import { PROGRAM_ID } from '../program.ts';

// ============================================================
// Types
// ============================================================

/** Parsed instruction with account keys */
export interface ParsedTransactionInstruction extends ParsedInstruction {
  /** Index of this instruction in the transaction */
  index: number;
  /** Account keys used by this instruction */
  accounts: PublicKey[];
  /** Program ID that executed this instruction */
  programId: PublicKey;
}

/** Fully parsed transaction result */
export interface ParsedTransaction {
  /** Transaction signature */
  signature: string;
  /** Block slot */
  slot: number;
  /** Block time (unix timestamp) */
  blockTime: number | null;
  /** Whether the transaction succeeded */
  success: boolean;
  /** Error message if failed */
  error: string | null;
  /** Parsed Novus Mundus instructions */
  instructions: ParsedTransactionInstruction[];
  /** Parsed events from logs */
  events: NovusMundusEvent[];
  /** Compute units consumed */
  computeUnitsConsumed: number | null;
  /** Transaction fee in lamports */
  fee: number;
  /** All log messages */
  logs: string[];
}

/** Options for transaction parsing */
export interface ParseTransactionOptions {
  /** Whether to parse inner instructions (CPI calls) */
  parseInnerInstructions?: boolean;
  /** Whether to parse events from logs */
  parseEvents?: boolean;
}

// ============================================================
// Helper Functions
// ============================================================

function isVersionedResponse(
  response: VersionedTransactionResponse | TransactionResponse
): response is VersionedTransactionResponse {
  return 'version' in response;
}

function getAccountKeys(
  response: VersionedTransactionResponse | TransactionResponse
): PublicKey[] {
  if (isVersionedResponse(response)) {
    const message = response.transaction.message;
    // Handle both legacy and v0 messages
    if ('staticAccountKeys' in message) {
      // V0 message
      const staticKeys = message.staticAccountKeys.map(k => new PublicKey(k));
      const loadedAddresses = response.meta?.loadedAddresses;
      if (loadedAddresses) {
        return [
          ...staticKeys,
          ...loadedAddresses.writable.map(k => new PublicKey(k)),
          ...loadedAddresses.readonly.map(k => new PublicKey(k)),
        ];
      }
      return staticKeys;
    } else {
      // Legacy message (shouldn't happen for versioned, but handle anyway)
      return (message as { accountKeys: PublicKey[] }).accountKeys;
    }
  } else {
    // Legacy transaction
    return response.transaction.message.accountKeys.map(k => new PublicKey(k));
  }
}

function getInstructions(
  response: VersionedTransactionResponse | TransactionResponse
): { programIdIndex: number; accounts: number[]; data: string }[] {
  if (isVersionedResponse(response)) {
    const message = response.transaction.message;
    if ('compiledInstructions' in message) {
      // V0 message
      return message.compiledInstructions.map(ix => ({
        programIdIndex: ix.programIdIndex,
        accounts: Array.from(ix.accountKeyIndexes),
        data: Buffer.from(ix.data).toString('base64'),
      }));
    }
  }

  // Legacy format
  const legacyMessage = response.transaction.message as {
    instructions: { programIdIndex: number; accounts: number[]; data: string }[];
  };
  return legacyMessage.instructions;
}

// ============================================================
// Main Parser
// ============================================================

/**
 * Parse a transaction response from the RPC.
 * Extracts Novus Mundus instructions and events.
 */
export function parseTransaction(
  response: VersionedTransactionResponse | TransactionResponse,
  options: ParseTransactionOptions = {}
): ParsedTransaction {
  const { parseInnerInstructions = true, parseEvents = true } = options;

  // Get basic transaction info
  const signature = isVersionedResponse(response)
    ? '' // Versioned doesn't have signature at top level
    : (response.transaction.signatures[0] ?? '');

  const slot = response.slot;
  const blockTime = response.blockTime ?? null;
  const meta = response.meta;

  const success = meta?.err === null;
  const error = meta?.err ? JSON.stringify(meta.err) : null;
  const fee = meta?.fee ?? 0;
  const computeUnitsConsumed = meta?.computeUnitsConsumed ?? null;
  const logs = meta?.logMessages ?? [];

  // Get account keys
  const accountKeys = getAccountKeys(response);

  // Parse top-level instructions
  const rawInstructions = getInstructions(response);
  const instructions: ParsedTransactionInstruction[] = [];

  for (let i = 0; i < rawInstructions.length; i++) {
    const rawIx = rawInstructions[i];
    if (!rawIx) continue;

    const programId = accountKeys[rawIx.programIdIndex];
    if (!programId) continue;

    // Check if this is a Novus Mundus instruction
    if (programId.equals(PROGRAM_ID)) {
      const data = Buffer.from(rawIx.data, 'base64');
      const parsed = parseInstructionData(data);

      if (parsed) {
        const ixAccounts = rawIx.accounts
          .map(idx => accountKeys[idx])
          .filter((k): k is PublicKey => k !== undefined);
        instructions.push({
          ...parsed,
          index: i,
          accounts: ixAccounts,
          programId,
        });
      }
    }
  }

  // Parse inner instructions (CPI calls)
  if (parseInnerInstructions && meta?.innerInstructions) {
    for (const innerGroup of meta.innerInstructions) {
      for (const innerIx of innerGroup.instructions) {
        // Type guard for the inner instruction format
        const ix = innerIx as { programIdIndex: number; accounts: number[]; data: string };
        if (ix.programIdIndex === undefined || !ix.accounts || !ix.data) continue;

        const programId = accountKeys[ix.programIdIndex];
        if (!programId) continue;

        if (programId.equals(PROGRAM_ID)) {
          const data = Buffer.from(ix.data, 'base64');
          const parsed = parseInstructionData(data);

          if (parsed) {
            const ixAccounts = ix.accounts
              .map(idx => accountKeys[idx])
              .filter((k): k is PublicKey => k !== undefined);
            instructions.push({
              ...parsed,
              index: innerGroup.index,
              accounts: ixAccounts,
              programId,
            });
          }
        }
      }
    }
  }

  // Parse events from logs
  const events = parseEvents ? parseEventsFromLogs(logs) : [];

  return {
    signature,
    slot,
    blockTime,
    success,
    error,
    instructions,
    events,
    computeUnitsConsumed,
    fee,
    logs,
  };
}

/**
 * Parse a TransactionInstruction object (before sending).
 * Useful for inspecting instructions before submission.
 */
export function parseTransactionInstruction(
  instruction: TransactionInstruction
): ParsedTransactionInstruction | null {
  if (!instruction.programId.equals(PROGRAM_ID)) {
    return null;
  }

  const parsed = parseInstructionData(instruction.data);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    index: 0,
    accounts: instruction.keys.map(k => k.pubkey),
    programId: instruction.programId,
  };
}

/**
 * Extract all Novus Mundus instruction data from a transaction.
 * Returns raw instruction data buffers for further processing.
 */
export function extractNovusMundusInstructions(
  response: VersionedTransactionResponse | TransactionResponse
): Buffer[] {
  const accountKeys = getAccountKeys(response);
  const rawInstructions = getInstructions(response);
  const result: Buffer[] = [];

  for (const rawIx of rawInstructions) {
    if (!rawIx) continue;
    const programId = accountKeys[rawIx.programIdIndex];
    if (programId && programId.equals(PROGRAM_ID)) {
      const data = Buffer.from(rawIx.data, 'base64');
      if (isNovusMundusInstruction(data)) {
        result.push(data);
      }
    }
  }

  return result;
}

/**
 * Check if a transaction contains any Novus Mundus instructions.
 */
export function hasNovusMundusInstructions(
  response: VersionedTransactionResponse | TransactionResponse
): boolean {
  const accountKeys = getAccountKeys(response);
  const rawInstructions = getInstructions(response);

  for (const rawIx of rawInstructions) {
    if (!rawIx) continue;
    const programId = accountKeys[rawIx.programIdIndex];
    if (programId && programId.equals(PROGRAM_ID)) {
      return true;
    }
  }

  return false;
}

/**
 * Get instruction summary for display purposes.
 */
export function getTransactionSummary(parsed: ParsedTransaction): string {
  const parts: string[] = [];

  if (!parsed.success) {
    parts.push(`FAILED: ${parsed.error}`);
  }

  if (parsed.instructions.length > 0) {
    const ixNames = parsed.instructions.map(ix => ix.name).join(', ');
    parts.push(`Instructions: ${ixNames}`);
  }

  if (parsed.events.length > 0) {
    const eventNames = parsed.events.map(e => e.name).join(', ');
    parts.push(`Events: ${eventNames}`);
  }

  if (parsed.computeUnitsConsumed) {
    parts.push(`CU: ${parsed.computeUnitsConsumed.toLocaleString()}`);
  }

  return parts.join(' | ');
}
