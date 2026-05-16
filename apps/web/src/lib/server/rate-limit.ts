import "server-only";
import { NextResponse } from "next/server";

/**
 * Best-effort in-memory rate limiter for the co-sign routes.
 *
 * Keyed by client IP. This is per-server-instance — on a multi-instance deploy
 * it limits per instance, not globally (a shared store such as Redis would be
 * needed for a hard global limit). It is a guard against abuse and accidental
 * floods, not a security boundary: a co-signed transaction is useless without
 * the player's own wallet signature.
 */

const WINDOW_MS = 10_000;
const MAX_REQUESTS = 8;

const hits = new Map<string, number[]>();
let lastSweep = 0;

/** Drop IPs with no in-window hits so the map cannot grow unbounded. */
function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [ip, timestamps] of hits) {
    if (timestamps.every((t) => now - t >= WINDOW_MS)) hits.delete(ip);
  }
}

/** Returns a 429 response when the caller is over the limit, else null. */
export function rateLimited(req: Request): NextResponse | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  sweep(now);
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    return NextResponse.json(
      { error: "Too many requests — slow down a moment." },
      { status: 429 },
    );
  }
  recent.push(now);
  hits.set(ip, recent);
  return null;
}
