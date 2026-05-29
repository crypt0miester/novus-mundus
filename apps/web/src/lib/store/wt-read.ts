"use client";

// Per-thread "last seen" cursor for the unread-messages indicator.
//
// War-table messages are log-only on chain with no read receipts, so "unread"
// is a purely client-side notion: a thread is unread when its latest message id
// (a fixed-width hex ordering coordinate — slot|tx|log) is lexicographically
// greater than the id we last marked seen. Last-seen is persisted in
// localStorage per browser; cross-device read state is impossible on the
// log-only model and is an accepted limitation.

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WtReadState {
  /** base58 thread PDA -> last-seen message id (24-char hex). Persisted. */
  lastSeen: Record<string, string>;
  /** Latest team-thread message id (hex), fed by the global unread sync. Runtime
   *  only (not persisted); DM latest ids already live in the war-table store. */
  teamLatestId: string;
  /** Advance the seen cursor for a thread. Never moves backward, so a stale or
   *  empty id can't un-read a thread. Pending echoes carry a temp id that sorts
   *  last, so callers must pass a CONFIRMED message id. */
  markRead: (thread: string, idHex: string) => void;
  setTeamLatestId: (idHex: string) => void;
}

export const useWtReadStore = create<WtReadState>()(
  persist(
    (set, get) => ({
      lastSeen: {},
      teamLatestId: "",
      markRead: (thread, idHex) => {
        if (!thread || !idHex) return;
        const cur = get().lastSeen[thread] ?? "";
        if (idHex <= cur) return;
        set((s) => ({ lastSeen: { ...s.lastSeen, [thread]: idHex } }));
      },
      setTeamLatestId: (idHex) => {
        if (get().teamLatestId !== idHex) set({ teamLatestId: idHex });
      },
    }),
    { name: "novus-wt-read", version: 1, partialize: (s) => ({ lastSeen: s.lastSeen }) },
  ),
);
