/**
 * Jump-ahead persistence — a progress journal that survives a page refresh.
 *
 * A jump is several transactions; if the tab reloads mid-run the in-memory
 * progress is gone. The journal records the tier + city (so the Arrival can
 * route straight back into the jump) and the id of every step that has
 * confirmed, so the executor replays only the unfinished tail. Every step is
 * one atomic transaction, so a recorded step is fully done — nothing partial
 * is ever journalled. Cleared once the jump completes.
 */

import type { JumpTier } from "./recipes";
import type { CityChoice } from "@/components/arrival/Arrival";

const KEY = "nm.jump-ahead";

export interface PersistedJump {
  tier: JumpTier;
  city: CityChoice;
  /** Ids of steps that have confirmed on-chain. */
  done: string[];
}

/**
 * Narrow `unknown` to a PersistedJump. Storage can hold anything — hand-edited
 * values, or a stale shape from an older build — so a parsed value is verified
 * before the executor trusts it as the source of truth for what's done.
 */
function isPersistedJump(v: unknown): v is PersistedJump {
  if (typeof v !== "object" || v === null) return false;
  const j = v as Record<string, unknown>;
  if (typeof j.tier !== "string") return false;
  if (!Array.isArray(j.done) || !j.done.every((s) => typeof s === "string")) {
    return false;
  }
  const city = j.city as Record<string, unknown> | null | undefined;
  if (!city || typeof city.cityId !== "number") return false;
  // Spawn coords are picked at city-choose time; any persisted jump missing
  // them is from a build before the picker existed and is no longer valid.
  if (typeof city.spawnLat !== "number") return false;
  if (typeof city.spawnLong !== "number") return false;
  return true;
}

const STALE_FLAG_KEY = "nm.jump-ahead-stale";

/**
 * Load the journalled jump if it parses against the current schema. If the
 * storage holds an entry from a previous build (missing required fields like
 * spawnLat/spawnLong), clear it and raise the stale-flag so Arrival can show
 * a one-time notice on mount instead of silently restarting from the world
 * view. Returns null for both "no entry" and "stale, dropped".
 */
export function loadJump(): PersistedJump | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isPersistedJump(parsed)) return parsed;
    /*
     * Parseable but schema-mismatched — definitely a stale build. Wipe the
     * entry so it doesn't keep being rejected every mount, and flag the
     * drop for UI surface.
     */
    window.localStorage.removeItem(KEY);
    window.sessionStorage.setItem(STALE_FLAG_KEY, "1");
    return null;
  } catch {
    return null;
  }
}

/**
 * One-shot read: was a stale persisted-jump dropped on this page load?
 * Consuming clears the flag so the toast doesn't fire twice on re-renders.
 */
export function consumeStaleJumpDropFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flag = window.sessionStorage.getItem(STALE_FLAG_KEY);
    if (flag) {
      window.sessionStorage.removeItem(STALE_FLAG_KEY);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function saveJump(jump: PersistedJump): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(jump));
  } catch {
    /* storage unavailable — non-fatal, the jump just won't survive a refresh */
  }
}

export function clearJump(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
