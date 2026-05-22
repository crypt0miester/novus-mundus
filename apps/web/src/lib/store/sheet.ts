import { create } from "zustand";

/** An open bottom sheet — `close` is what the MorphTabBar's ✕ calls. */
interface OpenSheet {
  id: string;
  close: () => void;
}

/**
 * Tracks bottom sheets for the mobile chrome, with two distinct signals:
 *
 * - `mounted` — sheets physically on screen, including the spring-shut
 *   animation. The top bars stay lifted above the backdrop for as long as one
 *   is painted, so they never flash dark behind the fading overlay on close.
 * - `openSheets` — sheets the user actually has open, topmost last. Drops the
 *   instant a sheet is dismissed (before its close animation). The MorphTabBar
 *   reads the topmost to surface a ✕ that closes it; `LeftPanelMobile` drops
 *   its data panel while any sheet is open.
 *
 * `BottomSheet` acquires `mounted` while painted and registers into
 * `openSheets` while its `open` prop is set.
 */
interface SheetState {
  mounted: number;
  openSheets: OpenSheet[];
  acquireMounted(): void;
  releaseMounted(): void;
  registerOpen(sheet: OpenSheet): void;
  releaseOpen(id: string): void;
}

export const useSheetStore = create<SheetState>((set) => ({
  mounted: 0,
  openSheets: [],
  acquireMounted: () => set((s) => ({ mounted: s.mounted + 1 })),
  releaseMounted: () => set((s) => ({ mounted: Math.max(0, s.mounted - 1) })),
  registerOpen: (sheet) => set((s) => ({ openSheets: [...s.openSheets, sheet] })),
  releaseOpen: (id) =>
    set((s) => {
      const next = s.openSheets.filter((x) => x.id !== id);
      return next.length === s.openSheets.length ? s : { openSheets: next };
    }),
}));
