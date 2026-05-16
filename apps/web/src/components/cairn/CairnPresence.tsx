"use client";

import { CairnOrb } from "./CairnOrb";
import { useAct } from "@/lib/hooks/useAct";
import { throughLine } from "@/lib/narrative";

/**
 * The Cairn, on the home base — the orb and the line it speaks. It names where
 * the holding stands on the climb, and is the first thing the eye finds on the
 * estate. PLAYER_JOURNEY_GAMEPLAN.md §4, §6.1.
 */
export function CairnPresence() {
  const { act, mood, actDef } = useAct();
  const line = throughLine("place", act, mood);

  return (
    <div className="card flex items-center gap-4">
      <CairnOrb mood={mood} act={act} size={46} />
      <div className="min-w-0">
        <p className="text-sm leading-snug text-text-secondary">{line}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          {actDef.name}
        </p>
      </div>
    </div>
  );
}
