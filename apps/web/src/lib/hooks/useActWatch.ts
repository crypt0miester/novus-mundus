"use client";

import { useEffect, useRef } from "react";
import { getCachedAct } from "@/lib/narrative";
import { useTransitionStore } from "@/lib/store/transition";
import { useAct } from "./useAct";

/**
 * Watches for act advancement and fires the act-beat interstitial.
 *
 * The act the player last saw is read from the cache at first render —
 * before `useAct`'s own cache-write effect overwrites it. When the live act
 * climbs past it, the inciting beat of the new act runs as the headline.
 * Mount once, in the game shell.
 */
export function useActWatch(): void {
  // Captured at first render: the act from the previous load. `useAct` writes
  // the live act back to the cache in an effect, so this must be read here.
  const prev = useRef(getCachedAct());
  const { act } = useAct();
  const phase = useTransitionStore((s) => s.phase);
  const triggerActBeat = useTransitionStore((s) => s.triggerActBeat);

  useEffect(() => {
    if (act <= prev.current) return;
    // Act V's beat is the coronation, fired from the castle claim itself —
    // record the climb so the watcher settles, but do not fire it here.
    if (act >= 5) {
      prev.current = act;
      return;
    }
    // Hold off while a wipe or an earlier beat is still on screen; retry next render.
    if (phase !== "idle") return;

    triggerActBeat({ act, phase: "inciting" });
    prev.current = act;
  }, [act, phase, triggerActBeat]);
}
