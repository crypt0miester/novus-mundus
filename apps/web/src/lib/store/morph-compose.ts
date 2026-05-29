import { create } from "zustand";

/**
 * Back/dismiss control the morph bar renders in its circle slot while a surface
 * owns compose. `icon` picks the glyph; `onClick` runs on tap. The full-page DM
 * supplies `{ icon: "back", onClick: () => router.push("/messages") }`; surfaces
 * inside a BottomSheet pass null and let `useSheetStore` drive the sheet-close.
 */
export interface ComposeDismiss {
  icon: "back" | "close";
  onClick: () => void;
}

/**
 * One surface's claim on the bar's compose slot. `owner` is a stable useId per
 * useMorphCompose call site, so overlapping surfaces hold their own entry
 * instead of clobbering one shared value; the last entry owns the bar. Mirrors
 * right-panel's MorphActionEntry slot-stacking.
 */
interface ComposeEntry {
  owner: string;
  dismiss: ComposeDismiss | null;
}

interface MorphComposeState {
  /** Stacked compose claims; the last entry owns the bar (topmost wins). */
  entries: ComposeEntry[];
  /**
   * Live slot node the bar publishes while in the compose shape; the owning
   * surface portals its <Composer/> into it. Null otherwise / during teardown.
   */
  slotEl: HTMLElement | null;
  register(owner: string, dismiss: ComposeDismiss | null): void;
  unregister(owner: string): void;
  setSlotEl(el: HTMLElement | null): void;
}

/** composeActive (derived by consumers) = entries.length > 0. */
export const useMorphComposeStore = create<MorphComposeState>((set) => ({
  entries: [],
  slotEl: null,

  // Upsert in place, like registerMorphActions: a surface re-running its effect
  // must not jump ahead of one opened on top of it.
  register: (owner, dismiss) =>
    set((s) => {
      const i = s.entries.findIndex((e) => e.owner === owner);
      if (i === -1) return { entries: [...s.entries, { owner, dismiss }] };
      const next = s.entries.slice();
      next[i] = { owner, dismiss };
      return { entries: next };
    }),

  // Remove only this owner's entry; the bar falls back to the next claim still
  // standing, or leaves compose when none remain.
  unregister: (owner) =>
    set((s) => {
      const next = s.entries.filter((e) => e.owner !== owner);
      return next.length === s.entries.length ? s : { entries: next };
    }),

  setSlotEl: (el) => set((s) => (s.slotEl === el ? s : { slotEl: el })),
}));
