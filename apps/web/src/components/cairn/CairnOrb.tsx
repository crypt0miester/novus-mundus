"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Act, Mood } from "@/lib/narrative";

interface CairnOrbProps {
  mood: Mood;
  /** 0–5 — drives how lit the stone is: dull stone → beacon. */
  act: Act;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/**
 * The Cairn — an origin-unknown stone at the centre of the holding. It casts a
 * shadow in the light theme and throws light in the dark theme (inverted, so it
 * never disappears into the page). Colour tracks the estate's mood; brightness
 * tracks the climb. PLAYER_JOURNEY_GAMEPLAN.md §4.
 */
export function CairnOrb({ mood, act, size = 44, className }: CairnOrbProps) {
  return (
    <div
      aria-hidden
      data-mood={mood}
      className={cn("cairn-orb", className)}
      style={
        {
          width: size,
          height: size,
          "--cairn-lit": (act / 5).toFixed(3),
        } as CSSProperties
      }
    />
  );
}
