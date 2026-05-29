import { create } from "zustand";
import { persist } from "zustand/middleware";

type NumberFormat = "compact" | "full";
export type Explorer = "solscan" | "explorer" | "solanafm";
export type ThemePreference = "paper" | "dark" | "auto";
export type MapMode = "flat" | "iso" | "top";

const NUMBER_FORMATS = new Set<NumberFormat>(["compact", "full"]);
const EXPLORERS = new Set<Explorer>(["solscan", "explorer", "solanafm"]);
const THEME_PREFERENCES = new Set<ThemePreference>(["paper", "dark", "auto"]);
const MAP_MODES = new Set<MapMode>(["flat", "iso", "top"]);

// v1 → v2: "2d" maps to the new Canvas2D top-down "flat" preset, and
// "3d" maps to the dimetric "iso" preset (closest match to the old
// 35° tilt; user can switch to "top" via the picker if they prefer).
const LEGACY_MAP_MODE_MAP: Record<string, MapMode> = {
  "2d": "flat",
  "3d": "iso",
};

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
      mapMode: "flat",
      setNumberFormat: (fmt) => set({ numberFormat: fmt }),
      setAnimationsEnabled: (enabled) => set({ animationsEnabled: enabled }),
      setExplorer: (e) => set({ explorer: e }),
      setPriorityFee: (fee) => set({ priorityFee: fee }),
      setThemePreference: (t) => set({ themePreference: t }),
      setMapMode: (m) => set({ mapMode: m }),
    }),
    {
      name: "novus-settings",
      // Bumped to v2 at the flat-strategy cut. v1 stored mapMode as
      // "2d" | "3d"; the migration maps "2d"→"flat" and "3d"→"iso".
      // Any future schema change should bump and patch in place.
      version: 2,
      migrate: (state) => {
        const s = (state ?? {}) as Partial<SettingsStore> & { mapMode?: unknown };
        const raw = s.mapMode;
        let mapMode: MapMode = "flat";
        if (typeof raw === "string") {
          if (MAP_MODES.has(raw as MapMode)) {
            mapMode = raw as MapMode;
          } else if (raw in LEGACY_MAP_MODE_MAP) {
            mapMode = LEGACY_MAP_MODE_MAP[raw]!;
          }
        }
        return { ...s, mapMode };
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
            : typeof p.mapMode === "string" && p.mapMode in LEGACY_MAP_MODE_MAP
              ? LEGACY_MAP_MODE_MAP[p.mapMode as string]!
              : current.mapMode,
        };
      },
    },
  ),
);
