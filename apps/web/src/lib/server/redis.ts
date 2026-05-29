import "server-only";
import Redis from "ioredis";

/**
 * Shared Redis client for server-only state.
 *
 * Today this backs the rate limiter (`rate-limit.ts`). The Daily Activity
 * Minigames work builds on it next — mini-game sessions, idempotency locks, and
 * an RPC read-through cache (see `DAILY_ACTIVITY_MINIGAMES.md` §4).
 *
 * Connects to `REDIS_URL` (default `redis://localhost:6379`). A single client
 * is reused across requests and dev HMR reloads via a global. Callers must
 * treat Redis as best-effort — it can be unreachable — and degrade gracefully;
 * `rate-limit.ts` fails open when it is.
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

declare global {
  // eslint-disable-next-line no-var
  var __noviRedis: Redis | undefined;
}

function createClient(): Redis {
  const client = new Redis(REDIS_URL, {
    // Reject commands immediately while disconnected instead of buffering them.
    // Callers depend on a prompt failure to fall open rather than hang.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });
  // ioredis throws on an 'error' event with no listener. Swallow it here and
  // let callers handle per-command failures — the client auto-reconnects.
  client.on("error", () => {});
  return client;
}

/** The shared Redis client (singleton, server-only). */
const cached: Redis = globalThis.__noviRedis ?? createClient();
globalThis.__noviRedis = cached;
export const redis: Redis = cached;
