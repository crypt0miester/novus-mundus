#!/usr/bin/env bun
/**
 * Switchboard On-Demand `OracleQuote` crank for novus_mundus (Model B).
 *
 * Mirrors the cosigner flow from Switchboard's official `sb-on-demand-examples`
 * advanced example (`scripts/runUpdate.ts`):
 *
 *  1. Fetch a fresh oracle-signed quote from the Switchboard gateway —
 *     `queue.fetchQuoteIx(...)` returns the ed25519 verify instruction that
 *     carries it.
 *  2. Submit `[ed25519 verify ix, crank_oracle_quote (ix 302)]` so the program
 *     persists the quote into the oracle-quote PDA (`OracleQuote::write_from_ix`).
 *
 * Purchase instructions then read that PDA on-chain via
 * `QuoteVerifier::verify_account`.
 *
 * The oracle-quote PDA must already exist — the DAO creates it once via
 * `init_oracle_quote` (ix 301; `createInitOracleQuoteInstruction` in the SDK).
 * Run THIS script with the **game_authority** keypair (the crank co-signer);
 * `sb.AnchorUtils.loadEnv()` reads it from `~/.config/solana/id.json`.
 *
 * The Switchboard SDK (`@switchboard-xyz/on-demand`) is web3.js-v1 based, so
 * this crank is a standalone web3.js script — kept out of the `@solana/kit`
 * library surface (the deps are `devDependencies`).
 *
 * Usage:
 *   bun run scripts/crank-oracle.ts \
 *     --game-engine <GAME_ENGINE_PUBKEY> \
 *     --feeds <feedHashHex,feedHashHex,...> \
 *     [--interval <seconds>] [--simulate]
 *
 * `--feeds` are the Switchboard feed hashes the game prices against — SOL/USD,
 * NOVI/USD and every whitelisted token's TOKEN/USD. One quote carries at most
 * 8 feeds; the DAO-configured `*_switchboard_feed` ids must be a subset of the
 * feeds cranked here, and `shop_config.switchboard_queue` must equal the queue
 * `loadEnv()` selects.
 */

import * as sb from '@switchboard-xyz/on-demand';
import { CrossbarClient } from '@switchboard-xyz/common';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { PROGRAM_ID } from '../src/program';

/** novus_mundus program id. */
const NOVUS_PROGRAM_ID = new PublicKey(PROGRAM_ID);

/** `crank_oracle_quote` instruction discriminant (see `lib.rs` dispatch). */
const IX_CRANK_ORACLE_QUOTE = 302;

const SHOP_CONFIG_SEED = Buffer.from('shop_config');
const ORACLE_QUOTE_SEED = Buffer.from('oracle_quote');

/**
 * The minimal Switchboard environment {@link crankOnce} needs.
 *
 * Satisfied by both `sb.AnchorUtils.loadEnv()` (CLI / `~/.config/solana`) and
 * {@link buildCrankEnv} (server-side — pass your own connection + keypair).
 */
export interface Env {
  connection: Connection;
  keypair: Keypair;
  crossbar: CrossbarClient;
  queue: sb.Queue;
}

/**
 * Build a crank {@link Env} from an explicit connection + cranker keypair —
 * the **server-side** entry point (no `~/.config/solana` dependency).
 *
 * The web/app backend should own the oracle-quote refresh: it has the
 * `game_authority` signer and a connection, so it can keep the quote warm on
 * its own cadence (a short interval, or just-in-time before a Switchboard
 * purchase). A user-driven CLI crank can't predict when a purchase happens.
 *
 * @example
 *   const env = await buildCrankEnv({ connection, cranker, queue });
 *   await crankOnce(env, gameEngine, feeds);
 */
export async function buildCrankEnv(params: {
  /** RPC connection to the target cluster. */
  connection: Connection;
  /** Cranker keypair — must be `game_engine.game_authority`. */
  cranker: Keypair;
  /** The Switchboard On-Demand queue (`shop_config.sol_switchboard_queue`). */
  queue: PublicKey;
}): Promise<Env> {
  const program = await sb.AnchorUtils.loadProgramFromConnection(params.connection);
  return {
    connection: params.connection,
    keypair: params.cranker,
    crossbar: CrossbarClient.default(),
    queue: new sb.Queue(program, params.queue),
  };
}

/** `[discriminant: u16 LE][tail bytes]` — novus_mundus instruction-data prefix. */
function ixData(discriminant: number, tail: number[] = []): Buffer {
  const buf = Buffer.alloc(2 + tail.length);
  buf.writeUInt16LE(discriminant, 0);
  tail.forEach((b, i) => buf.writeUInt8(b & 0xff, 2 + i));
  return buf;
}

// PDA derivation is async under the v3 seam (and PublicKey has .toBytes(), not .toBuffer()).
const deriveShopConfig = async (gameEngine: PublicKey): Promise<PublicKey> =>
  (await PublicKey.findProgramAddress(
    [SHOP_CONFIG_SEED, gameEngine.toBytes()],
    NOVUS_PROGRAM_ID
  ))[0];

const deriveOracleQuote = async (queue: PublicKey): Promise<PublicKey> =>
  (await PublicKey.findProgramAddress(
    [ORACLE_QUOTE_SEED, queue.toBytes()],
    NOVUS_PROGRAM_ID
  ))[0];

/**
 * Build the `crank_oracle_quote` instruction (ix 302).
 *
 * Accounts mirror `processor/oracle/crank_quote.rs`:
 * `[cranker(signer), game_engine, shop_config, oracle_quote(w), queue, instructions_sysvar]`.
 * `ed25519IxIndex` is the ed25519 verify instruction's position in the tx.
 */
function crankOracleQuoteIx(args: {
  cranker: PublicKey;
  gameEngine: PublicKey;
  shopConfig: PublicKey;
  oracleQuote: PublicKey;
  queue: PublicKey;
  ed25519IxIndex: number;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: NOVUS_PROGRAM_ID,
    keys: [
      { pubkey: args.cranker, isSigner: true, isWritable: true },
      { pubkey: args.gameEngine, isSigner: false, isWritable: false },
      { pubkey: args.shopConfig, isSigner: false, isWritable: false },
      { pubkey: args.oracleQuote, isSigner: false, isWritable: true },
      { pubkey: args.queue, isSigner: false, isWritable: false },
      { pubkey: sb.SPL_SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
    ],
    data: ixData(IX_CRANK_ORACLE_QUOTE, [args.ed25519IxIndex]),
  });
}

/** Fetch a fresh quote and submit one crank transaction. */
export async function crankOnce(
  env: Env,
  gameEngine: PublicKey,
  feeds: string[],
  simulate: boolean
): Promise<void> {
  const { connection, keypair, crossbar, queue } = env;
  const shopConfig = await deriveShopConfig(gameEngine);
  const oracleQuote = await deriveOracleQuote(queue.pubkey);

  const quoteInfo = await connection.getAccountInfo(oracleQuote);
  if (!quoteInfo) {
    throw new Error(
      `oracle-quote PDA ${oracleQuote.toBase58()} is not initialized — ` +
        `the DAO must run init_oracle_quote (ix 301) first`
    );
  }

  // Gateway fetch: the ed25519 verify instruction carrying the oracle-signed
  // quote. `instructionIdx: 0` => it sits at transaction index 0.
  const ed25519Ix = await queue.fetchQuoteIx(crossbar, feeds, {
    variableOverrides: {},
    instructionIdx: 0,
  });

  const crankIx = crankOracleQuoteIx({
    cranker: keypair.publicKey,
    gameEngine,
    shopConfig,
    oracleQuote,
    queue: queue.pubkey,
    ed25519IxIndex: 0,
  });

  const tx: VersionedTransaction = await sb.asV0Tx({
    connection,
    ixs: [ed25519Ix, crankIx],
    signers: [keypair],
    computeUnitPrice: 10_000,
    computeUnitLimitMultiple: 1.1,
  });

  if (simulate) {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.logs) console.log(sim.value.logs.join('\n'));
    if (sim.value.err) {
      throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
    }
    console.log('✅ simulation ok');
    return;
  }

  const sig = await connection.sendTransaction(tx);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`✅ cranked — ${sig}`);
}

async function main(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .option('game-engine', {
      type: 'string',
      demandOption: true,
      describe: 'GameEngine PDA pubkey',
    })
    .option('feeds', {
      type: 'string',
      demandOption: true,
      describe: 'Comma-separated Switchboard feed hashes (hex), 1–8 feeds',
    })
    .option('interval', {
      type: 'number',
      describe: 'Loop every N seconds (omit for a single crank)',
    })
    .option('simulate', {
      type: 'boolean',
      default: false,
      describe: 'Simulate only — do not send the transaction',
    })
    .strict()
    .parseSync();

  const gameEngine = new PublicKey(argv['game-engine']);
  const feeds = argv.feeds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (feeds.length === 0 || feeds.length > 8) {
    throw new Error('provide 1–8 feed hashes (one OracleQuote carries at most 8 feeds)');
  }

  // `loadEnv` reads ~/.config/solana (cluster + keypair) and selects the
  // Switchboard queue + crossbar gateway. The keypair must be the
  // game_authority — the on-chain crank co-signer.
  const env = await sb.AnchorUtils.loadEnv();
  console.log(`crank: program  ${NOVUS_PROGRAM_ID.toBase58()}`);
  console.log(`crank: queue    ${env.queue.pubkey.toBase58()}`);
  console.log(`crank: cranker  ${env.keypair.publicKey.toBase58()}`);
  console.log(`crank: feeds    ${feeds.join(', ')}`);

  do {
    try {
      await crankOnce(env, gameEngine, feeds, argv.simulate);
    } catch (e) {
      console.error('crank error:', e instanceof Error ? e.message : e);
    }
    if (argv.interval) {
      await new Promise((r) => setTimeout(r, argv.interval! * 1000));
    }
  } while (argv.interval);
}

// Run only when invoked directly — the CLI `crank oracle` target imports
// `crankOnce` from this module instead.
if (import.meta.main) {
  main().catch((e) => {
    console.error('crank-oracle:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
