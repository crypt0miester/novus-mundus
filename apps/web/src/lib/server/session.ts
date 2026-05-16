import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless Sign-In-With-Solana session primitives for the co-sign API.
 *
 * A session proves the caller controls the `owner` wallet — it does NOT guard
 * funds (the co-signed tx still needs the wallet's own signature). It exists to
 * stop outcome-probing and per-owner abuse, so a lightweight HMAC token with no
 * server-side store is proportionate. Both the login nonce and the session
 * token are self-verifying: signed with `SESSION_SECRET` and time-bounded.
 */

const SECRET =
  process.env.SESSION_SECRET ?? process.env.GAME_AUTHORITY_RNG_SECRET ?? "";

const NONCE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 60_000;
export const SESSION_COOKIE = "cosign_session";

function hmac(data: string): string {
  if (!SECRET) {
    throw new Error(
      "SESSION_SECRET (or GAME_AUTHORITY_RNG_SECRET) must be set for co-sign auth",
    );
  }
  return createHmac("sha256", SECRET).update(data).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Issue a stateless, HMAC-bound login nonce for a SIWS challenge.
 *
 * SIWS requires the nonce to be strictly alphanumeric (`8*(ALPHA / DIGIT)`),
 * so it carries no separator: a base36 timestamp followed by the fixed
 * 64-char hex HMAC. `verifyNonce` splits the two on that known width.
 */
export function issueNonce(): string {
  const ts = Date.now().toString(36);
  return `${ts}${hmac(`nonce:${ts}`)}`;
}

/** True when `nonce` is one we issued and is still within its TTL. */
export function verifyNonce(nonce: string): boolean {
  if (nonce.length <= 64) return false;
  const ts = nonce.slice(0, -64);
  const sig = nonce.slice(-64);
  if (!ts || !safeEqual(sig, hmac(`nonce:${ts}`))) return false;
  const issued = parseInt(ts, 36);
  return Number.isFinite(issued) && Date.now() - issued < NONCE_TTL_MS;
}

/** Mint a session token bound to `owner` (base58 wallet address). */
export function issueSessionToken(owner: string): string {
  const exp = (Date.now() + SESSION_TTL_MS).toString(36);
  const payload = `${owner}.${exp}`;
  return `${payload}.${hmac(`session:${payload}`)}`;
}

/** The owner of a valid, unexpired session token, or null. */
function ownerOfToken(token: string): string | null {
  const [owner, exp, sig] = token.split(".");
  if (!owner || !exp || !sig) return null;
  if (!safeEqual(sig, hmac(`session:${owner}.${exp}`))) return null;
  const expMs = parseInt(exp, 36);
  if (!Number.isFinite(expMs) || Date.now() > expMs) return null;
  return owner;
}

/** Read the authenticated owner from a request's session cookie, or null. */
export function sessionOwner(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return ownerOfToken(part.slice(eq + 1).trim());
    }
  }
  return null;
}
