/**
 * Switchboard On-Demand oracle-quote instructions (Model B).
 *
 * - `initOracleQuote` (ix 301): DAO creates the program-owned oracle-quote PDA.
 * - `crankOracleQuote` (ix 302): persist a fresh verified `OracleQuote` into it.
 *
 * See `docs/SWITCHBOARD_ORACLEQUOTE_PLAN.md`. Purchase instructions then read
 * the quote on-chain via `QuoteVerifier::verify_account`.
 */

import { type Address, type Instruction, address } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { deriveOracleQuotePda, deriveShopConfigPda } from '../pda';

/** Solana Instructions sysvar address. */
export const INSTRUCTIONS_SYSVAR: Address = address(
  'Sysvar1nstructions1111111111111111111111111'
);
/** Solana SlotHashes sysvar address (consumed by purchase verification). */
export const SLOT_HASHES_SYSVAR: Address = address(
  'SysvarS1otHashes111111111111111111111111111'
);

export interface InitOracleQuoteAccounts {
  /** DAO authority (`game_engine.authority`); signer + rent payer. */
  authority: Address;
  /** GameEngine account. */
  gameEngine: Address;
  /** Switchboard On-Demand queue account. */
  switchboardQueue: Address;
}

/**
 * Create the program-owned Switchboard oracle-quote PDA (ix 301, DAO only).
 *
 * One quote account per Switchboard queue, derived `["oracle_quote", queue]`.
 * After creation, `crankOracleQuote` keeps it fresh.
 */
export async function createInitOracleQuoteInstruction(
  accounts: InitOracleQuoteAccounts
): Promise<Instruction> {
  const [oracleQuote] = await deriveOracleQuotePda(accounts.switchboardQueue);

  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: oracleQuote, isSigner: false, isWritable: true },
    { pubkey: accounts.switchboardQueue, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return buildInstruction(
    PROGRAM_ID,
    keys,
    createInstructionData(DISCRIMINATORS.ORACLE_INIT_QUOTE)
  );
}

export interface CrankOracleQuoteAccounts {
  /** Cranker — must equal `game_engine.game_authority`; signer. */
  cranker: Address;
  /** GameEngine account. */
  gameEngine: Address;
  /** Switchboard On-Demand queue account. */
  switchboardQueue: Address;
}

/**
 * Persist a fresh verified `OracleQuote` into the oracle-quote PDA (ix 302).
 *
 * **Cosigner model — this builds only the program instruction.** The crank
 * transaction must be `[switchboard ed25519 verify ix, crankOracleQuote]`,
 * where the ed25519 instruction carries the oracle-signed quote bundle
 * obtained from the Switchboard gateway. `ed25519IxIndex` is that
 * instruction's index within the transaction (default 0).
 *
 * @param ed25519IxIndex index of the ed25519 verify instruction (default 0).
 */
export async function createCrankOracleQuoteInstruction(
  accounts: CrankOracleQuoteAccounts,
  ed25519IxIndex = 0
): Promise<Instruction> {
  const [shopConfig] = await deriveShopConfigPda(accounts.gameEngine);
  const [oracleQuote] = await deriveOracleQuotePda(accounts.switchboardQueue);

  const keys = [
    { pubkey: accounts.cranker, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: shopConfig, isSigner: false, isWritable: false },
    { pubkey: oracleQuote, isSigner: false, isWritable: true },
    { pubkey: accounts.switchboardQueue, isSigner: false, isWritable: false },
    { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
  ];

  return buildInstruction(
    PROGRAM_ID,
    keys,
    createInstructionData(
      DISCRIMINATORS.ORACLE_CRANK_QUOTE,
      new Uint8Array([ed25519IxIndex & 0xff])
    )
  );
}
