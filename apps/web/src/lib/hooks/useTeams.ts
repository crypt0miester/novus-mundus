"use client";

import { useEffect, useMemo, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { parseTeam, type TeamAccount } from "novus-mundus-sdk";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";

/**
 * Multi-team fetcher.
 *
 * Takes an array of team PDA pubkeys, fetches whichever ones aren't
 * already in the `teamsByPda` cache, and returns a stable
 * `Map<base58, TeamAccount>` of everything currently known.
 *
 * Uses `getMultipleAccountsInfo` so N rivals = 1 RPC call regardless
 * of count (up to Solana's 100-account batch ceiling — beyond that we
 * chunk). The hook is intentionally fire-and-forget: it doesn't track
 * loading per-team. Callers that need "loading" can compare the
 * requested set against the returned map's keys.
 *
 * Different from `useTeam` (single-team, mirrors into the singleton
 * `team` slot for the local player's team). Don't conflate the two —
 * the singleton is owned by the /team page; this is owned by anyone
 * rendering a roster (map disc, EntityPanel, leaderboard…).
 */
export function useTeams(
  pubkeys: PublicKey[] | undefined | null,
): Map<string, TeamAccount> {
  const { connection } = useConnection();
  const client = useNovusMundusClient();
  const gameEngineKey = client.gameEngine.toBase58();
  const teamsByPda = useAccountStore((s) => s.teamsByPda);
  const upsertTeams = useAccountStore((s) => s.upsertTeams);

  // Dedupe + sort the input so a parent re-render with the same effective
  // set doesn't refire the fetch. Cheap: pubkeys are usually < 50.
  const sortedKeys = useMemo(() => {
    if (!pubkeys || pubkeys.length === 0) return [] as string[];
    const set = new Set<string>();
    for (const k of pubkeys) set.add(k.toBase58());
    return [...set].sort();
  }, [pubkeys]);

  // Track which keys we've already attempted in this session — avoids
  // re-fetching ghosts (PDAs that don't have an account on chain). The ref
  // is scoped to the active kingdom: a switch invalidates the entire set
  // (different program PDA universes) and a ghost that later spawns under
  // the SAME kingdom should still get one re-attempt per zustand cache
  // eviction, so we also reset whenever the cache itself shrinks below
  // what we've already attempted.
  const attemptedRef = useRef<{ key: string; set: Set<string> }>({
    key: gameEngineKey,
    set: new Set(),
  });
  if (attemptedRef.current.key !== gameEngineKey) {
    attemptedRef.current = { key: gameEngineKey, set: new Set() };
  }

  useEffect(() => {
    if (sortedKeys.length === 0) return;
    const missing = sortedKeys
      .filter((k) => !teamsByPda.has(k) && !attemptedRef.current.set.has(k))
      .map((k) => new PublicKey(k));
    if (missing.length === 0) return;
    for (const k of missing) attemptedRef.current.set.add(k.toBase58());

    let cancelled = false;
    /* Chunk at 100 to respect getMultipleAccountsInfo's RPC ceiling.
     * For realistic city populations (≤ ~50 active rival teams) this
     * is one call; the chunking is defensive. */
    const CHUNK = 100;
    (async () => {
      const collected: { pubkey: PublicKey; account: ReturnType<typeof parseTeam> }[] = [];
      for (let i = 0; i < missing.length; i += CHUNK) {
        const chunk = missing.slice(i, i + CHUNK);
        const infos = await connection.getMultipleAccountsInfo(chunk).catch(() => null);
        if (!infos) continue;
        for (let j = 0; j < infos.length; j++) {
          const info = infos[j];
          if (!info) continue;
          const account = parseTeam(info);
          if (account) collected.push({ pubkey: chunk[j]!, account });
        }
      }
      if (cancelled || collected.length === 0) return;
      upsertTeams(
        collected.filter((e): e is { pubkey: PublicKey; account: NonNullable<ReturnType<typeof parseTeam>> } => e.account != null),
      );
    })();

    return () => {
      cancelled = true;
    };
    // teamsByPda intentionally excluded — including it would refire the
    // effect on every successful upsert (its identity changes). The
    // attemptedRef + missing-check guard makes it idempotent regardless.
    // gameEngineKey is in deps so a kingdom switch re-triggers the fetch
    // (the ref reset above happens during render, but the effect still
    // needs to run against the new kingdom's PDAs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedKeys.join("|"), connection, upsertTeams, gameEngineKey]);

  /* Project the cache down to just the requested set so consumers
   * don't have to filter teamsByPda themselves. Stable identity when
   * the request set + cache for that subset are unchanged. */
  return useMemo(() => {
    const out = new Map<string, TeamAccount>();
    for (const k of sortedKeys) {
      const entry = teamsByPda.get(k);
      if (entry) out.set(k, entry.account);
    }
    return out;
  }, [sortedKeys, teamsByPda]);
}
