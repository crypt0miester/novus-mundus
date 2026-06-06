import "server-only";
import { timingSafeEqual } from "node:crypto";
import type {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import type { NovusMundusClient } from "novus-mundus-sdk";
import { gameAuthorityKeypair, serverConnection, serverClient } from "./game-authority";
import { gameEnginePda } from "./chain";

export const CRON_CU_PRICE_MICROLAMPORTS = Number(process.env.CRON_CU_PRICE_MICROLAMPORTS ?? "0");

/** Max sim-failure messages to echo back in the summary (observability). */
const MAX_REPORTED_ERRORS = 5;

/**
 * Cron auth — `Authorization: Bearer ${CRON_SECRET}` (set by Vercel Cron).
 * Lifted from the encounters cron so every crank route shares one gate:
 * - secret unset AND not dev → 500 (refuse an open auth surface)
 * - mismatch → 401 (constant-time compare)
 */
export function checkAuth(req: Request): Response | null {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    if (process.env.NODE_ENV === "development") return null;
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const got = Buffer.from(auth);
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}

export interface CrankCtx {
  connection: Connection;
  client: NovusMundusClient;
  gameEngine: PublicKey;
  /** game_authority keypair — the permissionless-crank fee payer/signer. */
  authority: Keypair;
  nowSec: number;
}

export interface CrankItem {
  ix: TransactionInstruction;
  label: string;
}

/**
 * Simulate one instruction (verify it lands + measure CU, like `coSign`), then
 * send it signed by the game_authority. Shared by `runCrank` and bespoke crank
 * routes (e.g. castles) that drive their own send loop.
 */
export async function simulateAndSend(
  client: NovusMundusClient,
  authority: Keypair,
  ix: TransactionInstruction,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const probe = await client.buildVersionedTransaction([ix], authority.publicKey, {
      computeUnits: 1_000_000,
    });
    const sim = await client.simulateTransaction(probe);
    if (!sim.success) return { ok: false, error: sim.error ?? "simulation failed" };

    const tx = await client.buildVersionedTransaction([ix], authority.publicKey, {
      computeUnits: sim.unitsConsumed ? Math.ceil(sim.unitsConsumed * 1.2) : 200_000,
      computeUnitPrice: CRON_CU_PRICE_MICROLAMPORTS,
    });
    const res = await client.sendTransaction(tx, [authority]);
    return res.success ? { ok: true } : { ok: false, error: res.error ?? "send failed" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Run one permissionless-crank route: auth → build the server context →
 * `collect` the instructions to send → for each, **simulate first** (catch a
 * doomed/already-done tx and measure real CU, same approach as `coSign`), then
 * send signed by the game_authority. Each item is its own tx (failure-isolated;
 * cranks are idempotent and low-volume). Returns a JSON summary.
 *
 * `collect` uses the SDK directly (`parse*` + `*_ACCOUNT_SIZE` + instruction
 * builders) — the same source of truth the CLI cranks use — so each subsystem
 * route stays a thin scan with no CLIContext dependency.
 */
export async function runCrank(
  req: Request,
  name: string,
  collect: (ctx: CrankCtx) => Promise<CrankItem[]>,
): Promise<Response> {
  const denied = checkAuth(req);
  if (denied) return denied;

  const connection = serverConnection();
  const client = serverClient();
  const gameEngine = gameEnginePda();
  let authority: Keypair;
  try {
    authority = await gameAuthorityKeypair();
  } catch (err) {
    return Response.json({ ok: false, name, error: String(err) }, { status: 500 });
  }
  const nowSec = Math.floor(Date.now() / 1000);

  let items: CrankItem[];
  try {
    items = await collect({ connection, client, gameEngine, authority, nowSec });
  } catch (err) {
    return Response.json(
      { ok: false, name, error: "collect failed", detail: String(err) },
      { status: 502 },
    );
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const { ix, label } of items) {
    const r = await simulateAndSend(client, authority, ix);
    if (r.ok) {
      sent++;
    } else {
      failed++;
      if (errors.length < MAX_REPORTED_ERRORS) errors.push(`${label}: ${r.error}`);
    }
  }

  return Response.json({ ok: true, name, found: items.length, sent, failed, errors });
}
