import { create } from "zustand";

/**
 * Tracks bottom sheets for the mobile top bars, which need two distinct
 * signals:
 *
 * - `mounted` — sheets physically on screen, including the spring-shut
 *   animation. The bars stay lifted above the backdrop for as long as it is
 *   painted, so they never flash dark behind the fading overlay on close.
 * - `open` — sheets the user actually has open. This drops the instant a
 *   sheet is dismissed (before its close animation plays out), so the
 *   collapsible data bar folds away immediately instead of lingering.
 *
 * `BottomSheet` acquires `mounted` while it is on screen and `open` while its
 * `open` prop is set; `TopBar` and `LeftPanelMobile` read them back.
 */
interface SheetState {
  mounted: number;
  open: number;
  acquireMounted(): void;
  releaseMounted(): void;
  acquireOpen(): void;
  releaseOpen(): void;
}

export const useSheetStore = create<SheetState>((set) => ({
  mounted: 0,
  open: 0,
  acquireMounted: () => set((s) => ({ mounted: s.mounted + 1 })),
  releaseMounted: () => set((s) => ({ mounted: Math.max(0, s.mounted - 1) })),
  acquireOpen: () => set((s) => ({ open: s.open + 1 })),
  releaseOpen: () => set((s) => ({ open: Math.max(0, s.open - 1) })),
}));
