"use client";

import { create } from "zustand";

/**
 * A transient line pushed into the Cairn's mouth by a user action — today, the
 * combat forecast warning the player off a doomed or under-armed strike. It
 * overrides the steady through-line for a short window, then dissolves back.
 *
 * Kept separate from the derived nudges in `useCairnNudge` (level-stall,
 * incoming threats) because this one is imperative: the composer says it the
 * moment the numbers turn bad. The `nonce` guards the auto-clear so a newer
 * line is never wiped by an older line's timer.
 */
interface CairnNudgeState {
  line: string | null;
  nonce: number;
  /** Speak `line` for `ttlMs`, then clear (unless superseded). Empty = no-op. */
  say: (line: string, ttlMs?: number) => void;
  clear: () => void;
}

const DEFAULT_TTL_MS = 9000;

export const useCairnNudgeStore = create<CairnNudgeState>((set, get) => ({
  line: null,
  nonce: 0,
  say: (line, ttlMs = DEFAULT_TTL_MS) => {
    if (!line) return;
    const nonce = get().nonce + 1;
    set({ line, nonce });
    setTimeout(() => {
      if (get().nonce === nonce) set({ line: null });
    }, ttlMs);
  },
  clear: () => set({ line: null }),
}));
