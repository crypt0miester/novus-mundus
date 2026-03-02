import { create } from "zustand";

interface RightPanelState {
  open: boolean;
  title: string;
  contentKey: string | null;
  contentProps: Record<string, any>;
  show(title: string, key: string, props?: Record<string, any>): void;
  close(): void;
}

export const useRightPanelStore = create<RightPanelState>((set) => ({
  open: false,
  title: "",
  contentKey: null,
  contentProps: {},

  show: (title, key, props = {}) =>
    set({ open: true, title, contentKey: key, contentProps: props }),

  close: () =>
    set({ open: false, title: "", contentKey: null, contentProps: {} }),
}));
