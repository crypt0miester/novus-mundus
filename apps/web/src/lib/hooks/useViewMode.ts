"use client";

import { useCallback, useEffect, useState } from "react";

export type ViewMode = "grid" | "table";

/** Persistence namespaces — one per directory that offers a grid/table view. */
export type ViewModeKey = "cities" | "teams" | "players";

/**
 * A grid/table view preference, persisted to localStorage under `key` so the
 * choice survives navigation and reloads. SSR-safe: renders `fallback` first,
 * then hydrates from storage on mount.
 */
export function useViewMode(
  key: ViewModeKey,
  fallback: ViewMode = "grid",
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`viewmode:${key}`);
      if (stored === "grid" || stored === "table") {
        setMode((prev) => (prev === stored ? prev : stored));
      }
    } catch {
      // localStorage unavailable — keep the fallback
    }
  }, [key]);

  const update = useCallback(
    (next: ViewMode) => {
      if (next === mode) return;
      setMode(next);
      try {
        window.localStorage.setItem(`viewmode:${key}`, next);
      } catch {
        // ignore — preference just won't persist
      }
    },
    [key, mode],
  );

  return [mode, update];
}
