import "server-only";
import { NextResponse } from "next/server";
import { redis } from "./redis";

/**
 * Redis-backed sliding-window rate limiter for the co-sign / auth routes.
 *
 * Keyed by client IP. Backed by Redis so the limit holds across server
 * instances — the previous in-memory Map limited per-instance only. Each key is
 * a sorted set of recent request timestamps; a request is allowed while no more
 * than MAX_REQUESTS fall inside the trailing WINDOW_MS.
 *
 * This is a guard against abuse and accidental floods, not a security boundary:
 * a co-signed transaction is useless without the player's own wallet signature.
 * If Redis is unreachable the limiter FAILS OPEN (allows the request) rather
 * than locking every player out.
 */

const WINDOW_MS = 10_000;
// Generous on purpose: an active player streams co-sign + mini-game-move POSTs
// (a fast Reflex or Memory round fires many within seconds), and in local dev
// every request shares one "unknown" IP bucket. This only needs to catch
// runaway loops, not pace human play.
const MAX_REQUESTS = 100;

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Returns a 429 response when the caller is over the limit, else null. Fails
 * open (returns null) when Redis cannot be reached.
 */
export async function rateLimited(req: Request): Promise<NextResponse | null> {
  const key = `rl:${clientIp(req)}`;
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2)}`;

  let count: number;
  try {
    const results = await redis
      .multi()
      .zremrangebyscore(key, 0, now - WINDOW_MS) // drop entries older than the window
      .zadd(key, now, member) // record this request
      .zcard(key) // count requests in the window (this one included)
      .pexpire(key, WINDOW_MS) // let an idle key expire on its own
      .exec();
    // results: [[err, res], ...] in command order; zcard is index 2.
    const zcard = results?.[2];
    if (!zcard || zcard[0]) return null; // exec aborted or command errored — fail open
    count = Number(zcard[1]);
  } catch {
    return null; // Redis unreachable — fail open
  }

  if (count > MAX_REQUESTS) {
    return NextResponse.json(
      { error: "Too many requests — slow down a moment.", code: "RATE_LIMITED" },
      { status: 429 },
    );
  }
  return null;
}
