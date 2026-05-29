"use client";

import { useEffect, useMemo } from "react";
import { usePlayer } from "./usePlayer";
import { useEstate } from "./useEstate";
import { usePlayerCastle } from "./usePlayerCastle";
import { useIncomingThreat } from "./useIncomingThreat";
import { deriveAct, deriveMood, actDef as getActDef, setCachedAct } from "@/lib/narrative";
import type { Act, ActDef, Mood } from "@/lib/narrative";

export interface ActState {
  act: Act;
  mood: Mood;
  actDef: ActDef;
  hasPlayer: boolean;
  hasEstate: boolean;
  /** True once the player holds a castle — gates Act V. */
  ownsCastle: boolean;
}

/**
 * Where the player stands on the climb — the current act, the estate's mood,
 * and the act definition. Reads on-chain state the app already fetches, plus
 * the castle-ownership signal for Act V.
 */
export function useAct(): ActState {
  const { data: playerData } = usePlayer();
  const { data: estateData } = useEstate();
  const { ownsCastle } = usePlayerCastle();
  const threat = useIncomingThreat();

  const player = playerData?.account ?? null;
  const estate = estateData?.account ?? null;
  const hasPlayer = !!playerData?.exists;
  const hasEstate = !!estateData?.exists;

  const state = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const act = deriveAct(player, estate, { ownsCastle });
    // A credible non-teammate marching on the gate overrides the build-state
    // mood: the stone goes red and its through-line bends to its threatened
    // variant. Until this, the threatened mood had no trigger and never fired.
    const mood: Mood = threat.active ? "threatened" : deriveMood(estate, nowSec);
    return {
      act,
      mood,
      actDef: getActDef(act),
      hasPlayer,
      hasEstate,
      ownsCastle,
    };
  }, [player, estate, hasPlayer, hasEstate, ownsCastle, threat.active]);

  // The narrative tone keys off the act, so cache it for the next load and
  // expose it on <body> for tone-aware surfaces.
  useEffect(() => {
    setCachedAct(state.act);
    document.body.setAttribute("data-act", String(state.act));
  }, [state.act]);

  return state;
}
