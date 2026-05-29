/**
 * Event Store
 *
 * Zustand store with IndexedDB persistence for game events.
 * Events are parsed from transaction logs and classified into scopes:
 * personal, team, and city.
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { NovusMundusEvent } from "novus-mundus-sdk";
import type { EventScope } from "@/lib/events/classify";

// Types

export interface EventEntry {
  /** Unique ID: `${txSignature}:${eventIndex}` */
  id: string;
  /** Event discriminator name */
  name: string;
  /** Serialized event data (BN to string, PublicKey to base58) */
  event: Record<string, unknown>;
  /** Scopes this event belongs to */
  scopes: EventScope[];
  /** Unix seconds timestamp */
  timestamp: number;
  /** Transaction signature */
  txSignature: string;
  /** Whether the user has seen this event */
  read: boolean;
}

interface EventStoreState {
  events: EventEntry[];
  loaded: boolean;

  init: () => Promise<void>;
  addEvents: (entries: EventEntry[]) => void;
  markRead: (scope: EventScope) => void;

  getPersonalFeed: () => EventEntry[];
  getTeamFeed: () => EventEntry[];
  getCityFeed: () => EventEntry[];
  getUnreadCount: (scope: EventScope) => number;
}

// Serialization Helpers

const MAX_EVENTS = 1000;
const IDB_KEY = "novus-events";

/**
 * Serialize event data for IndexedDB storage.
 * Converts BN to string and PublicKey to base58.
 */
export function serializeEventData(event: NovusMundusEvent): Record<string, unknown> {
  const data = event.data as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) {
      result[key] = val;
    } else if (typeof val === "object" && "toNumber" in (val as object)) {
      // BN to string
      result[key] = (val as { toString: () => string }).toString();
    } else if (typeof val === "object" && "toBase58" in (val as object)) {
      // PublicKey to base58
      result[key] = (val as { toBase58: () => string }).toBase58();
    } else if (Array.isArray(val)) {
      result[key] = val.map((v) => {
        if (typeof v === "object" && v !== null && "toNumber" in v) return v.toString();
        if (typeof v === "object" && v !== null && "toBase58" in v) return v.toBase58();
        return v;
      });
    } else {
      result[key] = val;
    }
  }

  return result;
}

// Store

export const useEventStore = create<EventStoreState>((set, get) => ({
  events: [],
  loaded: false,

  init: async () => {
    try {
      const stored = await idbGet<EventEntry[]>(IDB_KEY);
      if (stored && Array.isArray(stored)) {
        set({ events: stored, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  addEvents: (entries) => {
    const { events } = get();
    const existingIds = new Set(events.map((e) => e.id));

    // Dedup
    const newEntries = entries.filter((e) => !existingIds.has(e.id));
    if (newEntries.length === 0) return;

    // Merge and sort by timestamp desc
    let merged = [...events, ...newEntries].sort((a, b) => b.timestamp - a.timestamp);

    // FIFO cap
    if (merged.length > MAX_EVENTS) {
      merged = merged.slice(0, MAX_EVENTS);
    }

    set({ events: merged });

    // Persist async (fire-and-forget)
    idbSet(IDB_KEY, merged).catch(() => {});
  },

  markRead: (scope) => {
    const { events } = get();
    const updated = events.map((e) => (e.scopes.includes(scope) ? { ...e, read: true } : e));
    set({ events: updated });
    idbSet(IDB_KEY, updated).catch(() => {});
  },

  getPersonalFeed: () => get().events.filter((e) => e.scopes.includes("personal")),
  getTeamFeed: () => get().events.filter((e) => e.scopes.includes("team")),
  getCityFeed: () => get().events.filter((e) => e.scopes.includes("city")),

  getUnreadCount: (scope) => get().events.filter((e) => !e.read && e.scopes.includes(scope)).length,
}));
