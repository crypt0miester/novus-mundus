"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useConnection } from "@solana/wallet-adapter-react";
import { deriveCastlePda, parseCastle } from "novus-mundus-sdk";

/**
 * Fetch the castle at (cityId, castleId). The underlying zustand slot is a
 * single global value; without a PDA-equality check, opening this hook for a
 * different castle would render the *previous* castle's data while the new
 * fetch is in flight — and a composer that submits during that window could
 * post a tx for the new castle while the form's preview / team-match gate
 * ran on the old one. We gate `data` on the cached entry matching the
 * requested PDA, and let the in-flight fetch repopulate.
 */
export function useCastle(
  cityId: number | null | undefined,
  castleId: number | null | undefined
) {
  const entry = useAccountStore((s) => s.castle);
  const client = useNovusMundusClient();
  const { connection } = useConnection();
  const [fetchDone, setFetchDone] = useState(false);

  const requestedPubkey = useMemo(() => {
    if (cityId == null || castleId == null) return null;
    return deriveCastlePda(client.gameEngine, cityId, castleId)[0];
  }, [cityId, castleId, client]);

  useEffect(() => {
    if (!requestedPubkey) {
      setFetchDone(true);
      return;
    }

    setFetchDone(false);
    let cancelled = false;
    const pubkey = requestedPubkey;
    connection
      .getAccountInfo(pubkey)
      .then((info) => {
        if (cancelled) return;
        if (info) {
          const parsed = parseCastle(info);
          if (parsed) useAccountStore.getState().setCastle(pubkey, parsed);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetchDone(true);
      });

    return () => {
      cancelled = true;
    };
  }, [requestedPubkey, connection]);

  const matchesRequest =
    !!entry && !!requestedPubkey && entry.pubkey.equals(requestedPubkey);
  const data = matchesRequest
    ? { pubkey: entry.pubkey, account: entry.account, exists: true }
    : null;

  return {
    data,
    isLoading: !fetchDone && !matchesRequest,
    isSuccess: !!data || fetchDone,
  };
}
