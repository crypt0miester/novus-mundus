import "server-only";
import { randomBytes } from "node:crypto";
import { redis } from "../redis";
import type { MinigameSession } from "./types";

/**
 * Redis-backed mini-game session lifecycle (`DAILY_ACTIVITY_MINIGAMES.md` §4).
 *
 * Three keys per the design:
 *   - `mg:session:{id}`           the session blob (puzzle, key, progress, …)
 *   - `mg:lock:{owner}:{day}:{window}:{building}`  live session id, or "done"
 *   - `mg:cosign:{id}`            a short-lived submit claim (double-submit guard)
 *
 * Distinct from the SIWS auth session in `../session.ts`.
 */

/** Sessions live 10 minutes — ample for a 30-45s game, short enough to GC. */
export const SESSION_TTL_SECONDS = 600;
/** The submit claim auto-releases after a minute if explicit cleanup is missed. */
const SUBMIT_CLAIM_TTL_SECONDS = 60;
/** The completion lock outlives the day's playable span (16h). */
const LOCK_TTL_SECONDS = 18 * 3600;

const sessionKey = (id: string): string => `mg:session:${id}`;
const submitKey = (id: string): string => `mg:cosign:${id}`;
const lockKey = (owner: string, day: number, window: string, building: number): string =>
  `mg:lock:${owner}:${day}:${window}:${building}`;

/** A fresh 128-bit unguessable session id. */
export function newSessionId(): string {
  return randomBytes(16).toString("hex");
}

/** Load a session by id, or null when it is gone (expired / never existed). */
export async function loadSession(id: string): Promise<MinigameSession | null> {
  const raw = await redis.get(sessionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MinigameSession;
  } catch (e) {
    console.error("minigame session corrupt — failed to parse", id, e);
    return null;
  }
}

/**
 * Persist a session. Pass the TTL in seconds when creating; pass "keep" on
 * later writes to preserve the original expiry — a session lives a fixed window
 * from `/start`, and moves do not extend it.
 */
export async function saveSession(session: MinigameSession, ttl: number | "keep"): Promise<void> {
  const json = JSON.stringify(session);
  if (ttl === "keep") {
    await redis.set(sessionKey(session.id), json, "KEEPTTL");
  } else {
    await redis.set(sessionKey(session.id), json, "EX", ttl);
  }
}

/** The completion lock for a window+building: a live session id, or "done". */
export function getLock(
  owner: string,
  day: number,
  window: string,
  building: number,
): Promise<string | null> {
  return redis.get(lockKey(owner, day, window, building));
}

/** Set the completion lock for a window+building. */
export async function setLock(
  owner: string,
  day: number,
  window: string,
  building: number,
  value: string,
): Promise<void> {
  await redis.set(lockKey(owner, day, window, building), value, "EX", LOCK_TTL_SECONDS);
}

/**
 * Drop the completion lock for a window+building. Used to clear a stale "done"
 * lock — a co-sign that was never confirmed on-chain — so the player can retry.
 */
export async function clearLock(
  owner: string,
  day: number,
  window: string,
  building: number,
): Promise<void> {
  await redis.del(lockKey(owner, day, window, building));
}

/**
 * Atomically claim the completion lock for a window+building, storing the
 * caller's session id — true if the caller won. Two concurrent `/start` calls
 * race here; only the winner mints a session, the loser resumes the winner's.
 */
export async function claimStartLock(
  owner: string,
  day: number,
  window: string,
  building: number,
  sessionId: string,
): Promise<boolean> {
  const res = await redis.set(
    lockKey(owner, day, window, building),
    sessionId,
    "EX",
    LOCK_TTL_SECONDS,
    "NX",
  );
  return res === "OK";
}

/**
 * Atomically claim the right to co-sign a session — true if the caller won the
 * claim, false if a co-sign for it is already in flight. The claim auto-expires
 * so a crashed request cannot wedge the session.
 */
export async function claimSubmit(id: string): Promise<boolean> {
  const res = await redis.set(submitKey(id), "1", "EX", SUBMIT_CLAIM_TTL_SECONDS, "NX");
  return res === "OK";
}

/** Release a submit claim so a failed co-sign can be retried. */
export async function releaseSubmit(id: string): Promise<void> {
  await redis.del(submitKey(id));
}
