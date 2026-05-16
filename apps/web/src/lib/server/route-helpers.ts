import "server-only";
import { NextResponse } from "next/server";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { coSign } from "./cosign";

/**
 * Shared request/response helpers for the `/api/cosign/*` route handlers.
 */

/** A JSON error response. */
export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
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
 * Parse a co-sign POST body and its required `owner` field. Returns the owner
 * pubkey and the typed body, or an error response.
 */
export async function parseOwnerBody<T extends { owner?: string }>(
  req: Request,
): Promise<{ owner: PublicKey; body: T } | { error: NextResponse }> {
  let body: T;
  try {
    body = (await req.json()) as T;
  } catch {
    return { error: fail("invalid JSON body") };
  }
  const parsed = parseOwner(body.owner);
  if ("error" in parsed) return parsed;
  return { owner: parsed.owner, body };
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
    console.error("Failed to create transaction")
    console.error(e)
    return fail(e instanceof Error ? e.message : "co-sign failed", 500);
  }
}
