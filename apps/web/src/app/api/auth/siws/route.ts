import "server-only";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifySignIn } from "@solana/wallet-standard-util";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  issueNonce,
  issueSessionToken,
  verifyNonce,
} from "@/lib/server/session";
import { rateLimited } from "@/lib/server/rate-limit";
import { fail } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/** Client-serialised SolanaSignInOutput — Uint8Arrays are base64 strings. */
interface SerializedOutput {
  account: { address: string; publicKey: string };
  signedMessage: string;
  signature: string;
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** GET /api/auth/siws — issue a login nonce for the SIWS message. */
export function GET() {
  return NextResponse.json({ nonce: issueNonce() });
}

/**
 * POST /api/auth/siws — verify a SIWS payload and set the session cookie.
 *
 * Establishes that the caller controls the wallet, so the co-sign routes can
 * derive `owner` from the session rather than trusting the request body.
 */
export async function POST(req: Request) {
  const limited = await rateLimited(req);
  if (limited) return limited;

  let payload: { input?: SolanaSignInInput; output?: SerializedOutput };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return fail("invalid JSON body");
  }
  const { input, output } = payload;
  if (!input || !output) return fail("missing SIWS input/output");

  if (!input.nonce || !verifyNonce(input.nonce)) {
    return fail("login challenge expired — please try again", 401);
  }
  const host = req.headers.get("host");
  if (input.domain && host && input.domain !== host) {
    return fail("domain mismatch", 401);
  }

  const restored = {
    account: {
      address: output.account.address,
      publicKey: fromBase64(output.account.publicKey),
      chains: [],
      features: [],
    },
    signedMessage: fromBase64(output.signedMessage),
    signature: fromBase64(output.signature),
  } as unknown as SolanaSignInOutput;

  let verified = false;
  try {
    verified = verifySignIn(input, restored);
  } catch {
    verified = false;
  }
  if (!verified) return fail("signature verification failed", 401);

  let owner: string;
  try {
    owner = new PublicKey(output.account.address).toBase58();
  } catch {
    return fail("invalid account address", 401);
  }

  const res = NextResponse.json({ owner });
  res.cookies.set(SESSION_COOKIE, issueSessionToken(owner), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
