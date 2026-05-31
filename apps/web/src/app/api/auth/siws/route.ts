import "server-only";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  claimNonce,
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

// Local SIWS shapes. These mirror the @solana/wallet-standard-features
// `SolanaSignInInput` / `SolanaSignInOutput` surfaces we depend on; the package
// is not installed (it is a non-resolving transitive of wallet-adapter), so the
// fields the SIWS message-construction spec defines are declared here directly.
interface SolanaSignInInput {
  domain?: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: readonly string[];
}

interface SolanaSignInOutput {
  account: { address: string; publicKey: Uint8Array };
  signedMessage: Uint8Array;
  signature: Uint8Array;
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// Reconstruct the canonical Sign-In-With-Solana message text from the input, per
// the wallet-standard spec. Optional fields are omitted line-by-line; this is a
// byte-for-byte port of @solana/wallet-standard-util's createSignInMessageText.
function createSignInMessageText(input: SolanaSignInInput): string {
  let message = `${input.domain} wants you to sign in with your Solana account:\n`;
  message += `${input.address}`;

  if (input.statement) message += `\n\n${input.statement}`;

  const fields: string[] = [];
  if (input.uri) fields.push(`URI: ${input.uri}`);
  if (input.version) fields.push(`Version: ${input.version}`);
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (input.notBefore) fields.push(`Not Before: ${input.notBefore}`);
  if (input.requestId) fields.push(`Request ID: ${input.requestId}`);
  if (input.resources) {
    fields.push("Resources:");
    for (const resource of input.resources) fields.push(`- ${resource}`);
  }
  if (fields.length) message += `\n\n${fields.join("\n")}`;

  return message;
}

// Local port of @solana/wallet-standard-util's `verifySignIn` (package not
// installed). Binds the wallet's signed bytes to the server-validated `input`
// by reconstructing the expected message and comparing, then checks the ed25519
// signature over those bytes against the account's public key.
function verifySignIn(input: SolanaSignInInput, output: SolanaSignInOutput): boolean {
  // The wallet fills `address` from the signing account when the input omits it,
  // so the signed bytes carry the account address. Mirror that default before
  // reconstructing, or the byte comparison rejects legitimate sign-ins.
  const resolved: SolanaSignInInput = {
    ...input,
    address: input.address ?? output.account.address,
  };
  const expected = new TextEncoder().encode(createSignInMessageText(resolved));
  const signed = output.signedMessage;
  if (expected.length !== signed.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== signed[i]) return false;
  }
  return ed25519.verify(output.signature, signed, output.account.publicKey);
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
  // Anti-phishing domain binding is mandatory: reject unless the signed domain
  // is present and matches this host. The legit client always sends its own
  // host (see src/lib/cosign.ts), so omitting domain cannot bypass the check.
  if (!(input.domain && host && input.domain === host)) {
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

  // Single-use replay guard: a captured payload mints at most one session
  // within its TTL. Fails open if Redis is down — login must not depend on it.
  if (!(await claimNonce(input.nonce))) {
    return fail("login challenge already used", 401);
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
