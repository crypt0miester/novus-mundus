import { create } from "zustand";
import { persist } from "zustand/middleware";

type NumberFormat = "compact" | "full";
export type Explorer = "solscan" | "explorer" | "solanafm";
export type ThemePreference = "paper" | "dark" | "auto";
export type MapMode = "2d" | "3d";

const NUMBER_FORMATS = new Set<NumberFormat>(["compact", "full"]);
const EXPLORERS = new Set<Explorer>(["solscan", "explorer", "solanafm"]);
const THEME_PREFERENCES = new Set<ThemePreference>(["paper", "dark", "auto"]);
const MAP_MODES = new Set<MapMode>(["2d", "3d"]);

interface SettingsStore {
  numberFormat: NumberFormat;
  animationsEnabled: boolean;
  explorer: Explorer;
  priorityFee: number;
  themePreference: ThemePreference;
  /* City terrain renderer mode. 2D = top-down (camera pitched at ~90°,
   * mesh.scale.y = 0); 3D = isometric tilt (pitch=35°, full elevation).
   * Persisted so the user's choice survives navigation and reload. */
  mapMode: MapMode;
  setNumberFormat: (fmt: NumberFormat) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  setExplorer: (e: Explorer) => void;
  setPriorityFee: (fee: number) => void;
  setThemePreference: (t: ThemePreference) => void;
  setMapMode: (m: MapMode) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      numberFormat: "compact",
      animationsEnabled: true,
      explorer: "solscan",
      priorityFee: 10_000,
      themePreference: "auto",
      mapMode: "2d",
      setNumberFormat: (fmt) => set({ numberFormat: fmt }),
      setAnimationsEnabled: (enabled) => set({ animationsEnabled: enabled }),
      setExplorer: (e) => set({ explorer: e }),
      setPriorityFee: (fee) => set({ priorityFee: fee }),
      setThemePreference: (t) => set({ themePreference: t }),
      setMapMode: (m) => set({ mapMode: m }),
    }),
    {
      name: "novus-settings",
      // Bumped to v1 alongside the mapMode addition. `migrate` returns a
      // partial state shape — Zustand merges it over the current defaults,
      // so a missing field rolls in cleanly without nuking the rest. Any
      // future schema change (rename, enum extension) should bump again
      // and patch this in place.
      version: 1,
      migrate: (state) => {
        const s = (state ?? {}) as Partial<SettingsStore>;
        return { ...s, mapMode: MAP_MODES.has(s.mapMode as MapMode) ? s.mapMode : "2d" };
      },
      // Hard-validate every union-typed field at rehydrate. A tampered or
      // stale localStorage blob can otherwise smuggle a non-union string
      // through (e.g. mapMode:'isometric'), and downstream `=== '3d'`
      // checks silently fall to 2D — exactly the kind of "no fallback"
      // failure the policy elsewhere in this codebase prohibits.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsStore>;
        return {
          ...current,
          ...p,
          numberFormat: NUMBER_FORMATS.has(p.numberFormat as NumberFormat)
            ? (p.numberFormat as NumberFormat)
            : current.numberFormat,
          explorer: EXPLORERS.has(p.explorer as Explorer)
            ? (p.explorer as Explorer)
            : current.explorer,
          themePreference: THEME_PREFERENCES.has(p.themePreference as ThemePreference)
            ? (p.themePreference as ThemePreference)
            : current.themePreference,
          mapMode: MAP_MODES.has(p.mapMode as MapMode)
            ? (p.mapMode as MapMode)
            : current.mapMode,
        };
      },
    }
  )
);
