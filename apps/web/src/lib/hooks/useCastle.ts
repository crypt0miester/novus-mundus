"use client";

import { useEffect, useState } from "react";
import { useAccountStore } from "@/lib/store/accounts";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useConnection } from "@solana/wallet-adapter-react";
import { deriveCastlePda, parseCastle } from "@/lib/sdk";

export function useCastle(
  cityId: number | null | undefined,
  castleId: number | null | undefined
) {
  const entry = useAccountStore((s) => s.castle);
  const loading = useAccountStore((s) => s.loading);
  const client = useNovusMundusClient();
  const { connection } = useConnection();
  const [fetchDone, setFetchDone] = useState(false);

  useEffect(() => {
    if (cityId == null || castleId == null) {
      setFetchDone(true);
      return;
    }

    setFetchDone(false);
    const ge = client.gameEngine;
    const [pubkey] = deriveCastlePda(ge, cityId, castleId);

    connection.getAccountInfo(pubkey).then((info) => {
      if (info) {
        const parsed = parseCastle(info);
        if (parsed) useAccountStore.getState().setCastle(pubkey, parsed);
      }
    }).catch(() => {}).finally(() => setFetchDone(true));
  }, [cityId, castleId, client, connection]);

  const data = entry
    ? { pubkey: entry.pubkey, account: entry.account, exists: true }
    : null;

  return {
    data,
    isLoading: !fetchDone && !entry,
    isSuccess: !!data || fetchDone,
  };
}
