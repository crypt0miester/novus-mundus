import "server-only";
import { NextResponse } from "next/server";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { coSign } from "./cosign";
import { sessionOwner } from "./session";

/**
 * Shared request/response helpers for the `/api/cosign/*` route handlers.
 */

/**
 * A JSON error response. `code` is an optional machine-readable tag the client
 * can branch on (e.g. `WRONG_WINDOW`) alongside the human-readable `error`.
 */
export function fail(error: string, status = 400, code?: string): NextResponse {
  return NextResponse.json(code ? { error, code } : { error }, { status });
}

/** Parse an `owner` pubkey string, or return an error response. */
export function parseOwner(
  raw: string | null | undefined,
): { owner: PublicKey } | { error: NextResponse } {
  if (!raw) return { error: fail("missing 'owner'") };
  try {
    return { owner: new PublicKey(raw) };
  } catch {
    return { error: fail("invalid 'owner' pubkey") };
  }
}

/**
 * Resolve the authenticated `owner` from the SIWS session cookie, or a 401.
 * A 401 is the signal the client uses to launch the sign-in flow.
 */
export function requireSession(
  req: Request,
): { owner: PublicKey } | { error: NextResponse } {
  const owner = sessionOwner(req);
  if (!owner) return { error: fail("authentication required", 401) };
  try {
    return { owner: new PublicKey(owner) };
  } catch {
    return { error: fail("invalid session", 401) };
  }
}

/**
 * Resolve the authenticated `owner` from the session and parse the JSON body.
 * Any `owner` in the body is ignored — the session is the source of truth.
 */
export async function parseSessionBody<T>(
  req: Request,
): Promise<{ owner: PublicKey; body: T } | { error: NextResponse }> {
  const session = requireSession(req);
  if ("error" in session) return session;
  let body: T;
  try {
    body = (await req.json()) as T;
  } catch {
    return { error: fail("invalid JSON body") };
  }
  return { owner: session.owner, body };
}

/** Co-sign the instructions and return the transaction (plus any extra fields). */
export async function coSignResponse(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  try {
    const transaction = await coSign(instructions, feePayer);
    return NextResponse.json({ transaction, ...extra });
  } catch (e) {
    console.error("co-sign failed", e);
    return fail(e instanceof Error ? e.message : "co-sign failed", 500);
  }
}
