"use client";

import { useEffect, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useTransact } from "@/lib/hooks/useTransact";
import { useAccountStore } from "@/lib/store/accounts";
import {
  AccountKey,
  PROGRAM_ID as NOVUS_PROGRAM_ID,
  parseEvent,
  parseEventParticipation,
  deriveEventParticipationPda,
  EventStatus,
  type EventAccount,
  type EventParticipation,
} from "novus-mundus-sdk";
import { EventCard } from "./event-card";

type StatusFilter = "active" | "history";

interface EventEntry {
  pubkey: string;
  account: EventAccount;
}

/**
 * Shared event list. `filter` selects which statuses to render:
 *  - "active"  → Pending (0) + Active (1)
 *  - "history" → Finalized (2)
 *
 * Events stream into the `events` zustand store map via the WS subscription
 * (`AccountKey.Event`, kingdom-scoped). The WS only pushes *live updates*, so
 * on a fresh page load the map can be empty — we do a one-shot bulk fetch via
 * `getProgramAccounts` filtered on the `AccountKey.Event` discriminator and the
 * game-engine pubkey, mirroring the on-demand fetch in `castle-tab.tsx`.
 */
export function EventsList({ filter }: { filter: StatusFilter }) {
  const client = useNovusMundusClient();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const transact = useTransact();

  // Live event + participation maps from the store (WS-streamed).
  const eventsMap = useAccountStore((s) => s.events);
  const participationsMap = useAccountStore((s) => s.eventParticipations);

  // On-demand bulk-fetched events (populated when the store is empty on load).
  const [fetched, setFetched] = useState<EventEntry[]>([]);
  // On-demand bulk-fetched participations for the current player.
  const [fetchedParticipations, setFetchedParticipations] = useState<
    { pubkey: string; account: EventParticipation }[]
  >([]);
  const [loading, setLoading] = useState(true);

  // One-shot bulk fetch — runs on mount and after each tx so freshly-created
  // participations / status changes show without waiting for a WS push.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const ge = client.gameEngine;
      const keyByte = bs58.encode(Buffer.from([AccountKey.Event]));
      const accounts = await connection.getProgramAccounts(NOVUS_PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: keyByte } },
          // game_engine pubkey is the first field after the 1-byte account_key
          { memcmp: { offset: 1, bytes: ge.toBase58() } },
        ],
      });
      const events: EventEntry[] = [];
      for (const { pubkey, account } of accounts) {
        const parsed = parseEvent(account);
        if (parsed) events.push({ pubkey: pubkey.toBase58(), account: parsed });
      }

      // Fetch the current player's participation accounts (one PDA per event).
      let participations: { pubkey: string; account: EventParticipation }[] = [];
      if (publicKey) {
        const partPdas = events.map(
          (e) => deriveEventParticipationPda(ge, e.account.id.toNumber(), publicKey)[0],
        );
        if (partPdas.length > 0) {
          const infos = await connection.getMultipleAccountsInfo(partPdas);
          for (let i = 0; i < infos.length; i++) {
            const info = infos[i];
            if (!info) continue;
            const parsed = parseEventParticipation(info);
            if (parsed) {
              participations.push({ pubkey: partPdas[i].toBase58(), account: parsed });
            }
          }
        }
      }

      if (cancelled) return;
      setFetched(events);
      setFetchedParticipations(participations);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setFetched([]);
        setFetchedParticipations([]);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, connection, publicKey?.toBase58(), transact.isPending]);

  // Merge store (live) + fetched (on-demand) — store entries win on conflict.
  const merged = new Map<string, EventAccount>();
  for (const e of fetched) merged.set(e.pubkey, e.account);
  for (const [key, entry] of eventsMap) merged.set(key, entry.account);

  // Merge participations keyed by event id.
  const participationByEventId = new Map<string, EventParticipation>();
  for (const p of fetchedParticipations) {
    participationByEventId.set(p.account.eventId.toString(), p.account);
  }
  for (const [, entry] of participationsMap) {
    participationByEventId.set(entry.account.eventId.toString(), entry.account);
  }

  const events = Array.from(merged.entries())
    .map(([pubkey, account]) => ({ pubkey, account }))
    .filter(({ account }) =>
      filter === "active"
        ? account.status === EventStatus.Pending || account.status === EventStatus.Active
        : account.status === EventStatus.Finalized,
    )
    // Active: soonest-ending first. History: most-recently-ended first.
    .sort((a, b) =>
      filter === "active"
        ? a.account.endTime.toNumber() - b.account.endTime.toNumber()
        : b.account.endTime.toNumber() - a.account.endTime.toNumber(),
    );

  if (loading && events.length === 0) {
    return <p className="text-sm text-text-muted">Loading events...</p>;
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-text-muted">
          {filter === "active"
            ? "No active or upcoming events right now. Check back soon."
            : "No finalized events yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map(({ pubkey, account }) => (
        <EventCard
          key={pubkey}
          eventPubkey={pubkey}
          event={account}
          participation={participationByEventId.get(account.id.toString()) ?? null}
        />
      ))}
    </div>
  );
}
