/**
 * Transaction Parser
 *
 * Parse Solana transactions to extract Novus Mundus instructions and events.
 */

import { getBase58Encoder } from '@solana/kit';
import type { Address, Instruction } from '@solana/kit';
import type { ParsedInstruction } from './instruction';
import { parseInstructionData, isNovusMundusInstruction } from './instruction';
import { parseEventsFromLogs } from '../events/parser';
import type { NovusMundusEvent } from '../events/types';
import { PROGRAM_ID } from '../program';

const base58Encoder = getBase58Encoder();

/** Decode a base58-encoded string into raw bytes. */
function base58ToBytes(b58: string): Uint8Array {
  return new Uint8Array(base58Encoder.encode(b58));
}

// Minimal kit transaction-response shape consumed by this parser.
// This captures only the fields read here from the value returned by
// `rpc.getTransaction(signature, { encoding: 'json', ... }).send()`.

/** A single compiled instruction inside a kit `getTransaction` JSON response. */
export interface KitCompiledInstruction {
  /** Index into `accountKeys` of the program that executes this instruction. */
  programIdIndex: number;
  /** Indices into `accountKeys` of the accounts this instruction loads. */
  accounts: readonly number[];
  /** Instruction data as a base58-encoded string. */
  data: string;
}

/** Inner-instruction group inside a kit `getTransaction` JSON response. */
export interface KitInnerInstructions {
  /** Index of the top-level instruction these inner instructions belong to. */
  index: number;
  /** The inner (CPI) instructions. */
  instructions: readonly KitCompiledInstruction[];
}

/** Transaction metadata inside a kit `getTransaction` JSON response. */
export interface KitTransactionMeta {
  /** Error if the transaction failed, `null` if it succeeded. */
  err: unknown;
  /** Fee charged, in lamports. */
  fee: bigint | number;
  /** Compute units consumed, if recorded. */
  computeUnitsConsumed?: bigint | number;
  /** Log messages emitted, or `null` if log recording was disabled. */
  logMessages: readonly string[] | null;
  /** Inner (CPI) instructions, if recorded. */
  innerInstructions?: readonly KitInnerInstructions[] | null;
}

/**
 * Minimal shape of the value returned by
 * `rpc.getTransaction(signature, { encoding: 'json' }).send()`.
 */
export interface KitTransactionResponse {
  /** Slot in which the transaction was processed. */
  slot: bigint | number;
  /** Estimated production time, or `null` if unavailable. */
  blockTime: bigint | number | null;
  /** Transaction metadata, or `null` if unavailable. */
  meta: KitTransactionMeta | null;
  /** The transaction itself. */
  transaction: {
    /** Signatures, base58-encoded. */
    signatures: readonly string[];
    message: {
      /** Addresses of the accounts loaded by this transaction. */
      accountKeys: readonly Address[];
      /** Compiled top-level instructions. */
      instructions: readonly KitCompiledInstruction[];
    };
  };
}

// Types

/** Parsed instruction with account keys */
export interface ParsedTransactionInstruction extends ParsedInstruction {
  /** Index of this instruction in the transaction */
  index: number;
  /** Account keys used by this instruction */
  accounts: Address[];
  /** Program ID that executed this instruction */
  programId: Address;
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

// Helper Functions

function getAccountKeys(response: KitTransactionResponse): Address[] {
  // For `encoding: 'json'`, the server resolves all account keys (including
  // those loaded from address lookup tables) into a single ordered list.
  return [...response.transaction.message.accountKeys];
}

function getInstructions(
  response: KitTransactionResponse
): KitCompiledInstruction[] {
  return [...response.transaction.message.instructions];
}

// Main Parser

/**
 * Parse a transaction response from the RPC.
 * Extracts Novus Mundus instructions and events.
 */
export function parseTransaction(
  response: KitTransactionResponse,
  options: ParseTransactionOptions = {}
): ParsedTransaction {
  const { parseInnerInstructions = true, parseEvents = true } = options;

  // Get basic transaction info
  const signature = response.transaction.signatures[0] ?? '';

  const slot = Number(response.slot);
  const blockTime = response.blockTime != null ? Number(response.blockTime) : null;
  const meta = response.meta;

  const success = meta?.err === null;
  const error = meta?.err ? JSON.stringify(meta.err) : null;
  const fee = meta?.fee != null ? Number(meta.fee) : 0;
  const computeUnitsConsumed =
    meta?.computeUnitsConsumed != null ? Number(meta.computeUnitsConsumed) : null;
  const logs: string[] = meta?.logMessages ? [...meta.logMessages] : [];

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
    if (programId === PROGRAM_ID) {
      const data = base58ToBytes(rawIx.data);
      const parsed = parseInstructionData(data);

      if (parsed) {
        const ixAccounts = rawIx.accounts
          .map(idx => accountKeys[idx])
          .filter((k): k is Address => k !== undefined);
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
      for (const ix of innerGroup.instructions) {
        if (ix.programIdIndex === undefined || !ix.accounts || !ix.data) continue;

        const programId = accountKeys[ix.programIdIndex];
        if (!programId) continue;

        if (programId === PROGRAM_ID) {
          const data = base58ToBytes(ix.data);
          const parsed = parseInstructionData(data);

          if (parsed) {
            const ixAccounts = ix.accounts
              .map(idx => accountKeys[idx])
              .filter((k): k is Address => k !== undefined);
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
 * Parse an `Instruction` object (before sending).
 * Useful for inspecting instructions before submission.
 */
export function parseTransactionInstruction(
  instruction: Instruction
): ParsedTransactionInstruction | null {
  if (instruction.programAddress !== PROGRAM_ID) {
    return null;
  }

  if (!instruction.data) {
    return null;
  }

  const parsed = parseInstructionData(new Uint8Array(instruction.data));
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    index: 0,
    accounts: (instruction.accounts ?? []).map(a => a.address),
    programId: instruction.programAddress,
  };
}

/**
 * Extract all Novus Mundus instruction data from a transaction.
 * Returns raw instruction data buffers for further processing.
 */
export function extractNovusMundusInstructions(
  response: KitTransactionResponse
): Uint8Array[] {
  const accountKeys = getAccountKeys(response);
  const rawInstructions = getInstructions(response);
  const result: Uint8Array[] = [];

  for (const rawIx of rawInstructions) {
    if (!rawIx) continue;
    const programId = accountKeys[rawIx.programIdIndex];
    if (programId && programId === PROGRAM_ID) {
      const data = base58ToBytes(rawIx.data);
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
  response: KitTransactionResponse
): boolean {
  const accountKeys = getAccountKeys(response);
  const rawInstructions = getInstructions(response);

  for (const rawIx of rawInstructions) {
    if (!rawIx) continue;
    const programId = accountKeys[rawIx.programIdIndex];
    if (programId && programId === PROGRAM_ID) {
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
