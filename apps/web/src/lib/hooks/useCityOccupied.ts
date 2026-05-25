"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";

export interface OccupiedCell {
  gridLat: number;
  gridLong: number;
  occupantType: number;
  /* base58 pubkey of the player/encounter occupying the cell */
  occupant: string;
}

/*
 * City occupancy from zustand.
 *
 * Source of truth is `s.locations`, kept live by the program-wide WS
 * subscription (see lib/store/subscriptions.ts AccountKey.Location handler).
 * Locations aren't seeded at boot, so this hook fires a one-shot
 * fetchLocationsInCity per cityId change to warm the store; subsequent
 * updates arrive over WS.
 *
 * React-18 dev double-effect note: in strict mode every effect mounts +
 * immediately cleans up before its real mount. An earlier `inflightFor`
 * ref guarded against duplicate fetches but wasn't reset on cleanup, so
 * the strict-mode shadow run claimed the flag and the real run bailed
 * before firing the fetch — `seededFor` stayed null forever and the UI
 * stuck on "scouting…". We drop the inflight optimization and rely on
 * the `cancelled` flag for local state only; store upserts are always
 * safe because the data is global on-chain state, not UI state. Worst
 * case in dev is one extra RPC per city open; production has strict mode
 * off so this never fires there.
 */
export function useCityOccupied(cityId: number | null | undefined) {
  const locations = useAccountStore((s) => s.locations);
  /* Cross-reference with the encounters store so we can filter out
   * locations whose encounter just died. The chain closes the location
   * account in the same tx as the killing blow (attack_encounter.rs:693),
   * but Solana's onProgramAccountChange propagates the close notification
   * as `data.length === 0`, which the subscription manager filters out —
   * so the location lingers in this map forever otherwise. Reading the
   * live encounter health gives us sub-second cleanup at render time. */
  const encounters = useAccountStore((s) => s.encounters);
  const client = useNovusMundusClient();
  const ge = client.gameEngine;

  const [seededFor, setSeededFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cityId == null) return;
    setError(null);

    let cancelled = false;
    client
      .fetchLocationsInCity(cityId, { occupiedOnly: true })
      .then((results) => {
        /* Store upserts run regardless of cancel — the data describes
         * on-chain truth, and writing it benefits any later reader. */
        const store = useAccountStore.getState();
        for (const r of results) {
          store.upsertLocation(r.pubkey, r.account);
        }
        if (!cancelled) setSeededFor(cityId);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "fetch failed";
        setError(msg);
        setSeededFor(cityId);
      });

    return () => {
      cancelled = true;
    };
  }, [cityId, client]);

  const data = useMemo<OccupiedCell[]>(() => {
    if (cityId == null) return [];
    const out: OccupiedCell[] = [];
    for (const { account } of locations.values()) {
      if (account.cityId !== cityId) continue;
      if (account.occupantType === 0) continue;
      if (!account.gameEngine.equals(ge)) continue;
      /* Encounter occupant (type=2) — skip if the corresponding
       * EncounterAccount in the store reports health=0. The chain has
       * already closed this location, we just need to stop drawing it
       * until the subscription manager catches up (which currently it
       * doesn't, see comment above the hook). */
      if (account.occupantType === 2) {
        const encEntry = encounters.get(account.occupant.toBase58());
        if (encEntry && encEntry.account.health.isZero()) continue;
      }
      out.push({
        gridLat: account.gridLat,
        gridLong: account.gridLong,
        occupantType: account.occupantType,
        occupant: account.occupant.toBase58(),
      });
    }
    return out;
  }, [locations, cityId, ge, encounters]);

  return {
    data,
    isLoading: cityId != null && seededFor !== cityId,
    error,
  };
}
