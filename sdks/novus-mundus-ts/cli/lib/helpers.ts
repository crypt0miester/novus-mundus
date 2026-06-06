/**
 * CLI Helpers — account checks, transaction sending, logging
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { type CLIContext } from './context';

// SDK instruction builders are async (they derive PDAs via web-crypto under the
// hood), so a "built instruction" may be a value, a promise, an array, or an
// array of promises (e.g. one builder call per field). Everything that sends a
// tx normalizes through `resolveIx` so call sites can stay `() => createXxx(...)`.
type MaybePromise<T> = T | Promise<T>;
export type IxInput =
  | MaybePromise<TransactionInstruction>
  | MaybePromise<TransactionInstruction[]>
  | Array<MaybePromise<TransactionInstruction>>;

async function resolveIx(ix: IxInput): Promise<TransactionInstruction[]> {
  const awaited = await ix;
  const arr = Array.isArray(awaited) ? awaited : [awaited];
  return Promise.all(arr);
}

// Simulation error objects carry bigints under the v3 seam (u64 fields, custom
// program error codes), which plain JSON.stringify rejects with "cannot
// serialize BigInt" — masking the real failure. Use this for any diagnostic
// stringify so a failing tx surfaces its actual error.
export function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// Account Helpers

export async function accountExists(
  connection: Connection,
  pubkey: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(pubkey);
  return info !== null;
}

// Transaction Helpers

export interface SendOptions {
  retries?: number;
  /** Compute unit limit — prepends a SetComputeUnitLimit instruction when set */
  computeUnits?: number;
  /** Compute unit price in micro-lamports — prepends a SetComputeUnitPrice instruction when set */
  computeUnitPrice?: number;
  /** Simulate the transaction before sending — logs CU usage, fails early on errors */
  simulate?: boolean;
}

export async function sendWithRetry(
  ctx: CLIContext,
  ix: IxInput,
  signers: Keypair[],
  opts?: number | SendOptions
): Promise<string | null> {
  // Backwards-compatible: bare number = retries
  const options: SendOptions = typeof opts === 'number' ? { retries: opts } : (opts ?? {});
  const retries = options.retries ?? 3;

  const instructions: TransactionInstruction[] = [];

  // Prepend compute budget instructions when requested
  if (options.computeUnits !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnits })
    );
  }
  if (options.computeUnitPrice !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: options.computeUnitPrice })
    );
  }

  const ixArray = await resolveIx(ix);
  instructions.push(...ixArray);

  /* Dry-run = simulate, so encoding/validation/CU failures surface without sending. */
  if (ctx.dryRun) {
    const sim = await novusSimulateTransaction(ctx, instructions, signers);
    if (!sim.success) {
      throw new Error(`Dry-run simulation failed: ${sim.error}\n${sim.logs.join('\n')}`);
    }
    if (ctx.verbose) {
      log.info(`  sim: ${sim.unitsConsumed ?? '?'} CU`);
    }
    return null;
  }

  // Simulation requires a signed VersionedTransaction
  if (options.simulate) {
    const { blockhash } = await ctx.connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: signers[0].publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(message);
    vtx.sign(signers);

    const sim = await ctx.connection.simulateTransaction(vtx);
    if (sim.value.err) {
      const logs = sim.value.logs?.join('\n') ?? '';
      throw new Error(`Simulation failed: ${safeStringify(sim.value.err)}\n${logs}`);
    }
    if (ctx.verbose) {
      log.info(`  sim: ${sim.value.unitsConsumed ?? '?'} CU`);
    }
  }

  const tx = new Transaction().add(...instructions);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      tx.recentBlockhash = (await ctx.connection.getLatestBlockhash()).blockhash;
      tx.feePayer = signers[0].publicKey;
      const sig = await sendAndConfirmTransaction(ctx.connection, tx, signers, {
        skipPreflight: true,
        commitment: 'confirmed',
      });
      if (ctx.verbose) {
        log.info(`  sig: ${sig}`);
      }
      return sig;
    } catch (error: any) {
      if (attempt === retries) {
        throw error;
      }
      const delay = Math.pow(2, attempt) * 500;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

export interface SimulationResult {
  success: boolean;
  unitsConsumed: number | null;
  logs: string[];
  error: string | null;
}

/**
 * Simulate a transaction without sending it.
 * Builds a signed VersionedTransaction (v0) for simulation.
 */
export async function novusSimulateTransaction(
  ctx: CLIContext,
  ix: IxInput,
  signers: Keypair[],
  opts?: { computeUnits?: number; computeUnitPrice?: number }
): Promise<SimulationResult> {
  const instructions: TransactionInstruction[] = [];

  if (opts?.computeUnits !== undefined) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits }));
  }
  if (opts?.computeUnitPrice !== undefined) {
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.computeUnitPrice }));
  }

  const ixArray = await resolveIx(ix);
  instructions.push(...ixArray);

  const { blockhash } = await ctx.connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const vtx = new VersionedTransaction(message);
  vtx.sign(signers);

  const sim = await ctx.connection.simulateTransaction(vtx);

  return {
    success: sim.value.err === null,
    unitsConsumed: Number(sim.value.unitsConsumed) ?? null,
    logs: sim.value.logs ?? [],
    error: sim.value.err ? safeStringify(sim.value.err) : null,
  };
}

export type TxBuilder<T> = (item: T) => {
  ix: IxInput;
  signers: Keypair[];
};

export async function batchSend<T>(
  ctx: CLIContext,
  items: T[],
  builder: TxBuilder<T>,
  concurrency: number = 4
): Promise<number> {
  let sent = 0;

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map(async (item) => {
      const { ix, signers } = builder(item);
      await sendWithRetry(ctx, ix, signers);
      sent++;
    });
    await Promise.all(promises);
  }

  return sent;
}

// Create-or-Skip / Create-or-Update patterns

export interface PhaseStats {
  created: number;
  updated: number;
  skipped: number;
}

export function newStats(): PhaseStats {
  return { created: 0, updated: 0, skipped: 0 };
}

/**
 * Send one permissionless crank instruction and fold the result into PhaseStats.
 * Shared by the crank modules so the dry-run / send / log / count shape lives in
 * one place. `would`/`done` are the present/past verbs for the log line
 * (e.g. "process"/"Processed"); `benignFail` treats a send error as an expected
 * no-op (logged only under --verbose) rather than an error — used by cranks that
 * just poke a state machine forward.
 */
export async function crankSend(
  ctx: CLIContext,
  stats: PhaseStats,
  ix: IxInput,
  label: string,
  opts: { would: string; done: string; computeUnits?: number; benignFail?: boolean },
): Promise<void> {
  if (ctx.dryRun) {
    log.dryRun(`Would ${opts.would}: ${label}`);
    stats.updated++;
    return;
  }
  try {
    await sendWithRetry(ctx, ix, [ctx.daoAuthority], { computeUnits: opts.computeUnits ?? 15_000 });
    log.update(`${opts.done}: ${label}`);
    stats.updated++;
  } catch (err: any) {
    if (opts.benignFail) {
      if (ctx.verbose) log.info(`  unchanged: ${label} (${err.message})`);
    } else {
      log.error(`Failed ${opts.would} (${label}): ${err.message}`);
    }
    stats.skipped++;
  }
}

export async function createOrSkip(
  ctx: CLIContext,
  name: string,
  pda: PublicKey,
  buildIx: () => IxInput,
  stats: PhaseStats,
  opts?: SendOptions
): Promise<boolean> {
  const exists = await accountExists(ctx.connection, pda);
  if (exists) {
    log.skip(name);
    stats.skipped++;
    return false;
  }

  const ix = buildIx();
  await sendWithRetry(ctx, ix, [ctx.daoAuthority], opts);
  if (ctx.dryRun) log.dryRun(`Would create: ${name}`);
  else log.create(name);
  stats.created++;
  return true;
}

export async function createOrUpdate(
  ctx: CLIContext,
  name: string,
  pda: PublicKey,
  buildCreate: () => IxInput,
  buildUpdate: () => IxInput,
  stats: PhaseStats
): Promise<'created' | 'updated' | 'skipped'> {
  const exists = await accountExists(ctx.connection, pda);

  if (!exists) {
    const ix = buildCreate();
    await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
    if (ctx.dryRun) log.dryRun(`Would create: ${name}`);
    else log.create(name);
    stats.created++;
    return 'created';
  }

  const ix = buildUpdate();
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  if (ctx.dryRun) log.dryRun(`Would update: ${name}`);
  else log.update(name);
  stats.updated++;
  return 'updated';
}

export async function updateOnly(
  ctx: CLIContext,
  name: string,
  pda: PublicKey,
  buildUpdate: () => IxInput,
  stats: PhaseStats
): Promise<boolean> {
  const exists = await accountExists(ctx.connection, pda);
  if (!exists) {
    log.error(`${name} does not exist — use 'init' first`);
    return false;
  }

  const ix = buildUpdate();
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  if (ctx.dryRun) log.dryRun(`Would update: ${name}`);
  else log.update(name);
  stats.updated++;
  return true;
}

// Logging

export const log = {
  header(title: string) {
    console.log(`\nnovus — ${title}\n`);
  },

  phase(n: number, total: number, name: string) {
    console.log(`\nPhase ${n}/${total} — ${name}`);
  },

  create(name: string) {
    console.log(`  + Created: ${name}`);
  },

  update(name: string) {
    console.log(`  ~ Updated: ${name}`);
  },

  skip(name: string) {
    console.log(`  - Skipped: ${name} [exists]`);
  },

  summary(stats: PhaseStats) {
    console.log(`  = ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped`);
  },

  done(elapsed: number) {
    console.log(`\nDone in ${(elapsed / 1000).toFixed(1)}s`);
  },

  error(msg: string) {
    console.error(`  ! Error: ${msg}`);
  },

  warn(msg: string) {
    console.warn(`  ! Warning: ${msg}`);
  },

  dryRun(msg: string) {
    console.log(`  [dry-run] ${msg}`);
  },

  info(msg: string) {
    console.log(msg);
  },

  totalSummary(created: number, updated: number, skipped: number) {
    console.log(`\nDone — ${created} created, ${updated} updated, ${skipped} skipped`);
  },
};
