import { create } from "zustand";
import type { TxPhase } from "@/components/shared/TxButton";

/** Action surfaced by the morph tab bar. `onClick` matches `TxButton`'s
 * signature so the bar can render via TxButton without per-panel work. */
export interface PanelAction {
  id: string;
  label: string;
  onClick: (reportPhase: (p: TxPhase) => void) => Promise<string>;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  /** A back/dismiss action. The morph bar lifts it out of the action row and
   *  renders it as a standalone circle — matching the nav-mode `+` toggle. */
  kind?: "dismiss";
  /**
   * Press-and-hold charging for this action (mirrors `TxButton`'s `holdMax` /
   * `onHold`). When `holdMax > 1` and `onHold` is set, holding the morph
   * button ramps a count 1..holdMax and release fires `onHold` with it — so a
   * speedup action can pack that many instructions into one tx. A tap still
   * fires `onClick`. Omitted or <= 1 → plain one-shot.
   */
  holdMax?: number;
  /** Hold-release handler — receives the charged count (always >= 1). */
  onHold?: (reportPhase: (p: TxPhase) => void, count: number) => Promise<string>;
}

/** One panel's claim on the morph bar's action slot. `owner` is a stable id
 * per `useMorphActions` call site, so panels whose lifetimes overlap each hold
 * their own entry instead of clobbering one shared array. */
interface MorphActionEntry {
  owner: string;
  actions: PanelAction[];
}

interface RightPanelState {
  open: boolean;
  title: string;
  contentKey: string | null;
  contentProps: Record<string, any>;
  /** Stacked action claims; the last entry owns the morph bar. */
  morphActions: MorphActionEntry[];
  show(title: string, key: string, props?: Record<string, any>): void;
  registerMorphActions(owner: string, actions: PanelAction[]): void;
  unregisterMorphActions(owner: string): void;
  close(): void;
}

export const useRightPanelStore = create<RightPanelState>((set) => ({
  open: false,
  title: "",
  contentKey: null,
  contentProps: {},
  morphActions: [],

  show: (title, key, props = {}) =>
    set({ open: true, title, contentKey: key, contentProps: props }),

  // Upsert: an existing owner keeps its slot — a panel re-rendering its
  // actions must not jump ahead of a panel that opened on top of it — while a
  // new owner is appended, so the most recently opened panel owns the bar.
  registerMorphActions: (owner, actions) =>
    set((s) => {
      const i = s.morphActions.findIndex((e) => e.owner === owner);
      if (i === -1) {
        return { morphActions: [...s.morphActions, { owner, actions }] };
      }
      const next = s.morphActions.slice();
      next[i] = { owner, actions };
      return { morphActions: next };
    }),

  // Remove only this owner's entry; the bar falls back to the next claim
  // still standing, or to its nav tabs when none remain.
  unregisterMorphActions: (owner) =>
    set((s) => {
      const next = s.morphActions.filter((e) => e.owner !== owner);
      return next.length === s.morphActions.length ? s : { morphActions: next };
    }),

  close: () => set({ open: false, title: "", contentKey: null, contentProps: {} }),
}));
