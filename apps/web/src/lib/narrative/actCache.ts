/**
 * Cached act, persisted to localStorage.
 *
 * The narrative tone (loading labels, transition wipes) needs the act before
 * player data has loaded, so the last-known act is cached client-side. Mirrors
 * the cached-tier pattern in useTierTheme.ts.
 */
import type { Act } from "./types";

const STORAGE_KEY = "novus-act";

/** Read the cached act from localStorage (defaults to 0 if unknown). */
export function getCachedAct(): Act {
  if (typeof window === "undefined") return 0;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    const n = v ? parseInt(v, 10) : 0;
    if (n >= 1 && n <= 5) return n as Act;
    return 0;
  } catch {
    return 0;
  }
}

/** Persist the player's current act. */
export function setCachedAct(act: Act): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, String(act));
  } catch {}
}
