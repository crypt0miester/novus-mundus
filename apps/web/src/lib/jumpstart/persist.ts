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
  return !!city && typeof city.cityId === "number";
}

export function loadJump(): PersistedJump | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedJump(parsed) ? parsed : null;
  } catch {
    return null;
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
