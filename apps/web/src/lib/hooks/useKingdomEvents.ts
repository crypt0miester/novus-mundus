"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { EventStatus, type EventAccount, type EventParticipation } from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";

export type EventStatusFilter = "active" | "history";

export interface KingdomEventEntry {
  pubkey: string;
  account: EventAccount;
}

/*
 * Kingdom-scoped events from zustand.
 *
 * Source of truth is `s.events` + `s.eventParticipations`, both kept live by
 * the program-wide WS (see lib/store/subscriptions.ts AccountKey.Event /
 * AccountKey.EventParticipation handlers). Neither is boot-seeded, so this
 * hook:
 *  - Seeds events on mount via fetchKingdomEvents.
 *  - For each event currently in the store that we haven't checked yet,
 *    derives the player's EventParticipation PDA and batch-fetches it.
 *    This covers (a) the seeded set on first render and (b) any brand-new
 *    event that arrives over WS later — the events map changing re-runs
 *    the diff so the new event's PDA is fetched immediately.
 *  - Re-seeds + re-checks participations on each tx completion, so WS lag
 *    after a join/create doesn't strand the UI with stale data.
 */
export function useKingdomEvents({ filter }: { filter: EventStatusFilter }) {
  const eventsMap = useAccountStore((s) => s.events);
  const participationsMap = useAccountStore((s) => s.eventParticipations);
  const client = useNovusMundusClient();
  const { publicKey } = useWallet();
  const transact = useTransact();

  const [seeded, setSeeded] = useState(false);
  /* event pubkey → already attempted a participation fetch for the current
   * (player, tx-generation) pair. Cleared whenever player or transact state
   * flips so the next pass re-checks. */
  const checkedParticipationFor = useRef<Set<string>>(new Set());
  const playerKey = publicKey?.toBase58() ?? null;

  /* Effect A: seed events. Runs on mount and on every tx-completion edge so
   * a freshly created/finalized event doesn't have to wait for the WS push. */
  useEffect(() => {
    let cancelled = false;
    client
      .fetchKingdomEvents()
      .then((results) => {
        if (cancelled) return;
        const store = useAccountStore.getState();
        for (const r of results) {
          store.upsertEvent(r.pubkey, r.account);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSeeded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, transact.isPending]);

  /* Reset the participation-checked set when the player or tx-generation
   * changes. After this fires, effect B will re-fetch participation for
   * every event the store currently knows about. */
  useEffect(() => {
    checkedParticipationFor.current = new Set();
  }, [playerKey, transact.isPending]);

  /* Effect B: ensure participation is fetched for every known event for the
   * current player. Diffs against the seen-set so each event is only fetched
   * once per (player, tx-generation). */
  useEffect(() => {
    if (!publicKey) return;
    if (eventsMap.size === 0) return;

    /* Convert to bigint at the boundary — the SDK ships its own bn.js types,
     * and the web app's root install is a different version, so passing BN
     * across the module boundary trips TS2345. bigint sidesteps the duplicate
     * type identity entirely. */
    const pendingEventIds: bigint[] = [];
    const pendingEventKeys: string[] = [];
    for (const [key, entry] of eventsMap) {
      if (checkedParticipationFor.current.has(key)) continue;
      checkedParticipationFor.current.add(key);
      pendingEventKeys.push(key);
      pendingEventIds.push(BigInt(entry.account.id.toString()));
    }
    if (pendingEventIds.length === 0) return;

    let cancelled = false;
    client
      .fetchPlayerEventParticipations(pendingEventIds, publicKey)
      .then((results) => {
        if (cancelled) return;
        const store = useAccountStore.getState();
        for (const r of results) {
          store.upsertEventParticipation(r.pubkey, r.account);
        }
      })
      .catch(() => {
        if (cancelled) return;
        /* On failure, drop these keys from the seen-set so a later render
         * (or a follow-up tx) gets another shot rather than wedging. */
        for (const k of pendingEventKeys) checkedParticipationFor.current.delete(k);
      });

    return () => {
      cancelled = true;
    };
  }, [eventsMap, publicKey, client]);

  const events = useMemo<KingdomEventEntry[]>(() => {
    const out: KingdomEventEntry[] = [];
    for (const [pubkey, entry] of eventsMap) {
      const matches =
        filter === "active"
          ? entry.account.status === EventStatus.Pending ||
            entry.account.status === EventStatus.Active
          : entry.account.status === EventStatus.Finalized;
      if (matches) out.push({ pubkey, account: entry.account });
    }
    return out.sort((a, b) =>
      filter === "active"
        ? a.account.endTime.toNumber() - b.account.endTime.toNumber()
        : b.account.endTime.toNumber() - a.account.endTime.toNumber(),
    );
  }, [eventsMap, filter]);

  const participationByEventId = useMemo(() => {
    const m = new Map<string, EventParticipation>();
    for (const [, entry] of participationsMap) {
      m.set(entry.account.eventId.toString(), entry.account);
    }
    return m;
  }, [participationsMap]);

  return {
    events,
    participationByEventId,
    isLoading: !seeded && events.length === 0,
  };
}
