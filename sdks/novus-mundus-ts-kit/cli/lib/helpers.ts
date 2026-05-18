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
  ix: TransactionInstruction | TransactionInstruction[],
  signers: Keypair[],
  opts?: number | SendOptions
): Promise<string | null> {
  if (ctx.dryRun) return null;

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

  const ixArray = Array.isArray(ix) ? ix : [ix];
  instructions.push(...ixArray);

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
      throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`);
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
export async function NovusSimulateTransaction(
  ctx: CLIContext,
  ix: TransactionInstruction | TransactionInstruction[],
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

  const ixArray = Array.isArray(ix) ? ix : [ix];
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
    unitsConsumed: sim.value.unitsConsumed ?? null,
    logs: sim.value.logs ?? [],
    error: sim.value.err ? JSON.stringify(sim.value.err) : null,
  };
}

export type TxBuilder<T> = (item: T) => {
  ix: TransactionInstruction | TransactionInstruction[];
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

export async function createOrSkip(
  ctx: CLIContext,
  name: string,
  pda: PublicKey,
  buildIx: () => TransactionInstruction | TransactionInstruction[],
  stats: PhaseStats
): Promise<boolean> {
  const exists = await accountExists(ctx.connection, pda);
  if (exists) {
    log.skip(name);
    stats.skipped++;
    return false;
  }

  if (ctx.dryRun) {
    log.dryRun(`Would create: ${name}`);
    stats.created++;
    return true;
  }

  const ix = buildIx();
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.create(name);
  stats.created++;
  return true;
}

export async function createOrUpdate(
  ctx: CLIContext,
  name: string,
  pda: PublicKey,
  buildCreate: () => TransactionInstruction | TransactionInstruction[],
  buildUpdate: () => TransactionInstruction | TransactionInstruction[],
  stats: PhaseStats
): Promise<'created' | 'updated' | 'skipped'> {
  const exists = await accountExists(ctx.connection, pda);

  if (!exists) {
    if (ctx.dryRun) {
      log.dryRun(`Would create: ${name}`);
      stats.created++;
      return 'created';
    }
    const ix = buildCreate();
    await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
    log.create(name);
    stats.created++;
    return 'created';
  }

  if (ctx.dryRun) {
    log.dryRun(`Would update: ${name}`);
    stats.updated++;
    return 'updated';
  }
  const ix = buildUpdate();
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.update(name);
  stats.updated++;
  return 'updated';
}

export async function updateOnly(
  ctx: CLIContext,
  name: string,
  pda: PublicKey,
  buildUpdate: () => TransactionInstruction | TransactionInstruction[],
  stats: PhaseStats
): Promise<boolean> {
  const exists = await accountExists(ctx.connection, pda);
  if (!exists) {
    log.error(`${name} does not exist — use 'init' first`);
    return false;
  }

  if (ctx.dryRun) {
    log.dryRun(`Would update: ${name}`);
    stats.updated++;
    return true;
  }

  const ix = buildUpdate();
  await sendWithRetry(ctx, ix, [ctx.daoAuthority]);
  log.update(name);
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
