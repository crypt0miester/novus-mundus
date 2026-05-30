"use client";

import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

// Reactive "user wants reduced motion" flag, the single React-side source of
// truth for the "skip the choreography, set final state" branch (combat,
// dungeon, FLIP). Built on useMediaQuery so it tracks a live OS toggle instead
// of the dozens of one-shot matchMedia reads scattered across the codebase.
// SSR-safe: false until mounted, then syncs to the live query.
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
