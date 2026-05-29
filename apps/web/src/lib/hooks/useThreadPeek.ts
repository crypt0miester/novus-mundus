"use client";

// useThreadPeek: the newest message for a collapsed dock strip, best-effort.
//
// It uses a bare HttpKeyProvider with NO reauth wrapper. A 401 throws inside the
// SDK decode path and is swallowed there (the message comes back decrypted:false)
// rather than triggering a SIWS popup, so merely viewing a team page never forces
// a wallet signature just to render a peek. The body is decrypted only when a key
// is already available (the caller is signed in and the key is derivable). Pass
// enabled:false on desktop so the dock does not add a redundant subscription.

import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  WarTableClient,
  HttpKeyProvider,
  idToHex,
  type ReadMessage,
  type WarTableScope,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";

export function useThreadPeek(
  threadPda: PublicKey | null,
  scope: WarTableScope,
  opts: { enabled?: boolean; peer?: string } = {},
): ReadMessage | null {
  const enabled = opts.enabled ?? true;
  const peer = opts.peer;
  const client = useNovusMundusClient();
  const threadBase58 = threadPda ? threadPda.toBase58() : null;
  const [latest, setLatest] = useState<ReadMessage | null>(null);

  const wtClient = useMemo(() => {
    if (!enabled || !threadBase58) return null;
    const fetchFn: typeof fetch = typeof window === "undefined" ? fetch : window.fetch.bind(window);
    return new WarTableClient({
      connection: client.connection,
      keyProvider: new HttpKeyProvider(fetchFn, "", scope, peer),
    });
  }, [enabled, threadBase58, scope, peer, client.connection]);

  useEffect(() => {
    if (!wtClient || !threadBase58) {
      setLatest(null);
      return;
    }
    let cancelled = false;
    const thread = new PublicKey(threadBase58);

    wtClient
      .readThread(thread, { limit: 20 })
      .then((msgs) => {
        if (cancelled) return;
        const last = msgs.length > 0 ? msgs[msgs.length - 1]! : null;
        if (last) setLatest(last);
      })
      .catch(() => {});

    const sub = wtClient.subscribeThread(thread, (m) => {
      if (cancelled) return;
      setLatest((prev) => (!prev || idToHex(m.id) > idToHex(prev.id) ? m : prev));
    });

    return () => {
      cancelled = true;
      sub.unsubscribe();
    };
  }, [wtClient, threadBase58]);

  return enabled ? latest : null;
}
