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
}

interface RightPanelState {
  open: boolean;
  title: string;
  contentKey: string | null;
  contentProps: Record<string, any>;
  actions: PanelAction[];
  show(title: string, key: string, props?: Record<string, any>): void;
  setActions(actions: PanelAction[]): void;
  clearActions(): void;
  close(): void;
}

export const useRightPanelStore = create<RightPanelState>((set) => ({
  open: false,
  title: "",
  contentKey: null,
  contentProps: {},
  actions: [],

  show: (title, key, props = {}) =>
    set({ open: true, title, contentKey: key, contentProps: props, actions: [] }),

  setActions: (actions) => set({ actions }),
  clearActions: () => set({ actions: [] }),

  close: () =>
    set({ open: false, title: "", contentKey: null, contentProps: {}, actions: [] }),
}));
