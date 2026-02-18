import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NumberFormat = "compact" | "full";
export type Explorer = "solscan" | "explorer" | "solanafm";
export type ThemePreference = "paper" | "dark" | "auto";

interface SettingsStore {
  numberFormat: NumberFormat;
  animationsEnabled: boolean;
  explorer: Explorer;
  priorityFee: number;
  themePreference: ThemePreference;
  setNumberFormat: (fmt: NumberFormat) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  setExplorer: (e: Explorer) => void;
  setPriorityFee: (fee: number) => void;
  setThemePreference: (t: ThemePreference) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      numberFormat: "compact",
      animationsEnabled: true,
      explorer: "solscan",
      priorityFee: 10_000,
      themePreference: "auto",
      setNumberFormat: (fmt) => set({ numberFormat: fmt }),
      setAnimationsEnabled: (enabled) => set({ animationsEnabled: enabled }),
      setExplorer: (e) => set({ explorer: e }),
      setPriorityFee: (fee) => set({ priorityFee: fee }),
      setThemePreference: (t) => set({ themePreference: t }),
    }),
    { name: "novus-settings" }
  )
);
