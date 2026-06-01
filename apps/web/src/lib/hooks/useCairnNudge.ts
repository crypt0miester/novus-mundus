"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "./usePlayer";
import { useIncomingThreat } from "./useIncomingThreat";
import { cairnBeat } from "@/lib/narrative";
import { useCairnNudgeStore } from "@/lib/store/cairn-nudge";

/**
 * How long a wallet must sit at Level 1 (in this tab's session) before the
 * Cairn surfaces the XP-source nudge. The bar/curve is φ-tuned and on-chain;
 * the only safe lever for "I feel stuck" is telling the player where XP comes
 * from. Three minutes is short enough to catch a confused new player, long
 * enough to avoid yelling at someone who just opened the tab.
 */
const STALL_AFTER_MS = 3 * 60_000;

/** Once shown, the stall hint stays visible this long before dissolving back. */
const NUDGE_DURATION_MS = 45_000;

const FIRST_SEEN_KEY = "nm-cairn-l1-first-seen-v1";
const SHOWN_AT_KEY = "nm-cairn-l1-shown-at-v1";

/**
 * The Cairn's override line: what the stone says instead of its steady
 * through-line, or null when it should hold to the through-line. Two sources,
 * in priority order:
 *
 *  1. An incoming threat (a credible non-teammate marching on your gate). It
 *     lives for as long as the march does, and it is the most urgent thing the
 *     stone can say. A Legendary-charter early warning, see `useIncomingThreat`.
 *  2. The Level-1 stall hint. Fires once a wallet has sat at L1 for
 *     `STALL_AFTER_MS` this session, holds for `NUDGE_DURATION_MS`, then retires
 *     (no re-arm this session). Reaching L2 clears the markers so a fresh L1 alt
 *     gets its own shot.
 *
 * Session-scoped storage on purpose: closing the tab and returning may re-show
 * the stall hint.
 */
export function useCairnNudge(): string | null {
  const { data: playerData } = usePlayer();
  const level = playerData?.account?.level ?? null;
  const threat = useIncomingThreat();
  // An imperative line the player just triggered (combat forecast warning). It
  // is the freshest signal and outranks the passive nudges below.
  const transient = useCairnNudgeStore((s) => s.line);

  // Whether the L1 stall hint is within its show window. Every sessionStorage
  // read/write happens in the effect below, never in the render body.
  const [stallActive, setStallActive] = useState(false);

  useEffect(() => {
    if (level == null) return;

    // Left L1: wipe the markers so a future L1 alt re-arms, and stand down.
    if (level > 1) {
      try {
        sessionStorage.removeItem(FIRST_SEEN_KEY);
        sessionStorage.removeItem(SHOWN_AT_KEY);
      } catch {
        /* no-op */
      }
      setStallActive(false);
      return;
    }

    // At L1: stamp first-seen, then re-check on an interval until the stall
    // window opens, hold it for its duration, then retire and stop ticking.
    let firstSeen: number;
    try {
      const raw = sessionStorage.getItem(FIRST_SEEN_KEY);
      firstSeen = raw ? Number(raw) : Date.now();
      if (!raw) sessionStorage.setItem(FIRST_SEEN_KEY, String(firstSeen));
    } catch {
      return;
    }

    // True while the hint should show; stamps the show-time on the first tick
    // past the stall threshold.
    const evaluate = (): boolean => {
      const now = Date.now();
      if (now - firstSeen < STALL_AFTER_MS) return false;
      try {
        const raw = sessionStorage.getItem(SHOWN_AT_KEY);
        const shownAt = raw ? Number(raw) : now;
        if (!raw) sessionStorage.setItem(SHOWN_AT_KEY, String(shownAt));
        return now - shownAt <= NUDGE_DURATION_MS;
      } catch {
        return false;
      }
    };

    setStallActive(evaluate());
    const id = window.setInterval(() => {
      setStallActive(evaluate());
      // Once the window has opened and closed there is nothing left to watch.
      let spent = false;
      try {
        const raw = sessionStorage.getItem(SHOWN_AT_KEY);
        spent = !!raw && Date.now() - Number(raw) > NUDGE_DURATION_MS;
      } catch {
        spent = false;
      }
      if (spent) clearInterval(id);
    }, 5000);
    return () => clearInterval(id);
  }, [level]);

  if (transient) return transient;

  if (threat.active) {
    // The seat outranks all: a host marching on a castle you hold is the gravest
    // thing the stone can name.
    if (threat.castleRallies > 0) {
      return cairnBeat(
        threat.castleRallies > 1 ? "incomingCastleThreatMany" : "incomingCastleThreat",
      );
    }
    // A war-band raised against you outranks a lone traveller: it is targeted,
    // coordinated, and certain in its intent.
    if (threat.rallies > 0) {
      return cairnBeat(threat.rallies > 1 ? "incomingRallyMany" : "incomingRally");
    }
    return cairnBeat(threat.travelers > 1 ? "incomingThreatMany" : "incomingThreat");
  }
  return stallActive ? cairnBeat("level1Stall") : null;
}
