"use client";

// usePresence: reads "is this player online" from chain activity.
//
// Presence is the blockTime of a player's most recent signature: every
// war-table post rides the player's PlayerAccount PDA as sender_player, and the
// PDA also touches most other actions, so any recent on-chain activity marks the
// player online. The "I'm online" button (usePresenceBeat) posts an empty Status
// ping to refresh this when the player is otherwise idle.
//
// online = the latest signature's blockTime exists and is within ONLINE_WINDOW
// seconds of now. RPC is kept light: only the PDAs passed in are queried (the
// caller passes only the avatars actually on screen), one getSignaturesForAddress
// per PDA with limit 1.

import { useQuery, useQueries } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";

// A player counts as online when their latest on-chain action is newer than
// this many seconds.
const ONLINE_WINDOW_SECONDS = 300;

// React Query cadence: presence is cheap-but-not-free, so we let a result sit
// for a minute and poll a touch slower than that.
const PRESENCE_STALE_MS = 60_000;
const PRESENCE_REFETCH_MS = 75_000;

export interface PresenceState {
  online: boolean;
  // unix seconds of the player's most recent signature, or null when the player
  // has no signatures (never acted) or the lookup failed.
  lastSeen: number | null;
}

const OFFLINE: PresenceState = { online: false, lastSeen: null };

// Fetch the latest signature blockTime for one player PDA and resolve presence
// against the current wall clock. nowSeconds is computed at read time so a long
// staleTime cannot freeze "online" past the window.
async function fetchPresence(conn: Connection, pda: string): Promise<PresenceState> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(pda), { limit: 1 });
  const blockTime = sigs[0]?.blockTime ?? null;
  if (blockTime === null) return OFFLINE;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return { online: nowSeconds - blockTime < ONLINE_WINDOW_SECONDS, lastSeen: blockTime };
}

/**
 * Presence for a set of player PDAs. Returns a record keyed by base58 PDA; a PDA
 * with no resolved data yet reads as offline. Pass only the PDAs whose avatars
 * are actually visible to keep the RPC footprint small.
 */
export function usePresence(playerPdas: string[]): Record<string, PresenceState> {
  const { connection } = useConnection();

  const results = useQueries({
    queries: playerPdas.map((pda) => ({
      queryKey: ["presence", pda],
      queryFn: () => fetchPresence(connection, pda),
      staleTime: PRESENCE_STALE_MS,
      refetchInterval: PRESENCE_REFETCH_MS,
    })),
  });

  const map: Record<string, PresenceState> = {};
  for (let i = 0; i < playerPdas.length; i++) {
    map[playerPdas[i]!] = results[i]?.data ?? OFFLINE;
  }
  return map;
}

/**
 * Presence for a single player PDA. Convenience over usePresence for the common
 * one-avatar case (a profile panel, an inbox row).
 */
export function usePlayerPresence(playerPda: string | null | undefined): PresenceState {
  const { connection } = useConnection();

  const { data } = useQuery({
    queryKey: ["presence", playerPda],
    queryFn: () => fetchPresence(connection, playerPda!),
    enabled: !!playerPda,
    staleTime: PRESENCE_STALE_MS,
    refetchInterval: PRESENCE_REFETCH_MS,
  });

  return data ?? OFFLINE;
}
