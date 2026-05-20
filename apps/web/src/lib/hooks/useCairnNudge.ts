"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "./usePlayer";
import { cairnBeat } from "@/lib/narrative";

/**
 * How long a wallet must sit at Level 1 (in this tab's session) before the
 * Cairn surfaces the XP-source nudge. The bar/curve is φ-tuned and on-chain;
 * the only safe lever for "I feel stuck" is telling the player where XP comes
 * from. Three minutes is short enough to catch a confused new player, long
 * enough to avoid yelling at someone who just opened the tab.
 */
const STALL_AFTER_MS = 3 * 60_000;

/** Once shown, the nudge stays visible this long before dissolving back. */
const NUDGE_DURATION_MS = 45_000;

const FIRST_SEEN_KEY = "nm-cairn-l1-first-seen-v1";
const SHOWN_AT_KEY = "nm-cairn-l1-shown-at-v1";

/**
 * Returns a one-off Cairn beat line when the player has sat at L1 for long
 * enough this session, or null otherwise. The line is the same kind of override
 * surface as `throughLine` — callers should prefer it when present and fall
 * back to the through-line.
 *
 * Session-scoped on purpose: closing the tab and returning later may re-show
 * it; reaching L2 clears the markers so a fresh-L1 alt won't be suppressed.
 */
export function useCairnNudge(): string | null {
  const { data: playerData } = usePlayer();
  const player = playerData?.account ?? null;
  const level = player?.level ?? null;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (level !== 1) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, [level]);

  // Outdated markers from a prior L1 session — wipe so a future alt at L1
  // gets a fresh shot at the nudge.
  useEffect(() => {
    if (level == null || level <= 1) return;
    try {
      sessionStorage.removeItem(FIRST_SEEN_KEY);
      sessionStorage.removeItem(SHOWN_AT_KEY);
    } catch {
      /* no-op */
    }
  }, [level]);

  if (level !== 1) return null;
  // Re-read every render — `tick` exists only to force the read on the
  // 5s interval; the value isn't used directly.
  void tick;

  const now = Date.now();
  let firstSeen: number;
  try {
    const raw = sessionStorage.getItem(FIRST_SEEN_KEY);
    if (raw) {
      firstSeen = Number(raw);
    } else {
      firstSeen = now;
      sessionStorage.setItem(FIRST_SEEN_KEY, String(firstSeen));
    }
  } catch {
    return null;
  }

  if (now - firstSeen < STALL_AFTER_MS) return null;

  // Past the stall threshold — stamp the moment of first display and keep the
  // line visible for `NUDGE_DURATION_MS`, then let it dissolve back to the
  // through-line. We don't re-arm in the same session.
  let shownAt: number;
  try {
    const raw = sessionStorage.getItem(SHOWN_AT_KEY);
    if (raw) {
      shownAt = Number(raw);
    } else {
      shownAt = now;
      sessionStorage.setItem(SHOWN_AT_KEY, String(shownAt));
    }
  } catch {
    return null;
  }

  if (now - shownAt > NUDGE_DURATION_MS) return null;
  return cairnBeat("level1Stall");
}
