"use client";

import { create } from "zustand";

// The single reactive owner of "am I in ?viewAs impersonation?" state.
//
// ViewAsBridge (lib/solana/provider.tsx) overrides the wallet context with a
// faked, signer-less pubkey when the URL carries `?viewAs=<pubkey>`. That fake
// reports `connected: true` and a real player exists, so wallet/player reads
// alone cannot tell impersonation apart from a genuine seat. The bridge mirrors
// its decision here so useCanAct can fold viewAs under the read-only umbrella
// without re-parsing the URL.
interface ViewAsState {
  isViewAs: boolean;
  setIsViewAs: (on: boolean) => void;
}

export const useViewAsStore = create<ViewAsState>((set) => ({
  isViewAs: false,
  setIsViewAs: (on) => set({ isViewAs: on }),
}));
