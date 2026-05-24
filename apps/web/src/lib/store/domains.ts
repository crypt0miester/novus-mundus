import { create } from "zustand";
import type { Connection } from "@solana/web3.js";
import { resolveDomainName, resolveDomainNamesBatched } from "@/lib/domains";

interface DomainsState {
  /** base58 to "domain.tld" | null (resolved) | undefined (not fetched) */
  names: Map<string, string | null>;

  /** Keys currently being fetched (dedup) */
  pending: Set<string>;

  /** Read a cached name. Returns undefined if not yet resolved. */
  get: (key: string) => string | null | undefined;

  /** Resolve a single address (lazy, deduped). */
  resolve: (connection: Connection, key: string) => void;

  /** Batch-resolve many addresses (uses getMultipleAccountsInfo). */
  resolveBatch: (connection: Connection, keys: string[]) => void;

  /** Manually set a name (e.g. after on-chain name change). */
  set: (key: string, name: string | null) => void;

  /** Clear all cached names (on wallet disconnect). */
  reset: () => void;
}

export const useDomainStore = create<DomainsState>()((set, get) => ({
  names: new Map(),
  pending: new Set(),

  get: (key) => get().names.get(key),

  resolve: (connection, key) => {
    const state = get();
    if (state.names.has(key) || state.pending.has(key)) return;

    // Mark pending
    set((s) => {
      const next = new Set(s.pending);
      next.add(key);
      return { pending: next };
    });

    resolveDomainName(connection, key).then((name) => {
      set((s) => {
        const names = new Map(s.names);
        names.set(key, name);
        const pending = new Set(s.pending);
        pending.delete(key);
        return { names, pending };
      });
    });
  },

  resolveBatch: (connection, keys) => {
    const state = get();
    const missing = keys.filter(
      (k) => !state.names.has(k) && !state.pending.has(k),
    );
    if (missing.length === 0) return;

    // Mark all pending
    set((s) => {
      const next = new Set(s.pending);
      for (const k of missing) next.add(k);
      return { pending: next };
    });

    resolveDomainNamesBatched(connection, missing).then((resolved) => {
      set((s) => {
        const names = new Map(s.names);
        const pending = new Set(s.pending);
        for (const [k, v] of resolved) {
          names.set(k, v);
          pending.delete(k);
        }
        return { names, pending };
      });
    });
  },

  set: (key, name) =>
    set((s) => {
      const names = new Map(s.names);
      names.set(key, name);
      return { names };
    }),

  reset: () => set({ names: new Map(), pending: new Set() }),
}));
