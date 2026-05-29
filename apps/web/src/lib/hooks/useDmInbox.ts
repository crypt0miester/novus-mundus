"use client";

// useDmInbox: discovers the connected player's DM conversations.
//
// discoverDmThreads (SDK) scans getSignaturesForAddress on the caller's
// PlayerAccount PDA and returns the distinct DM thread PDAs the caller touched
// plus the newest message id per thread. The DM post instruction lists BOTH
// participants' PlayerAccount PDAs (indices 3 and 4), so for each thread we
// resolve the peer by reading the most recent DM transaction's account keys and
// taking the gate account that is not ours.
//
// DM bodies are encrypted and the inbox does not fetch per-thread keys, so the
// preview is a fixed label rather than decoded text. Live updates re-run
// discovery when onLogs fires on the caller's PlayerAccount PDA.

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { WarTableClient, idToHex, type ThreadKeyProvider } from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { useWarTableStore, type DmConvo } from "@/lib/store/war-table";

const DM_PREVIEW_LABEL = "Encrypted message";

// The inbox never derives thread keys (no decryption here), so a provider that
// refuses to derive is correct and makes the no-key intent explicit.
class NoKeyProvider implements ThreadKeyProvider {
  getKey(): Promise<Uint8Array> {
    return Promise.reject(new Error("dm inbox does not derive keys"));
  }
  getCurrentVersion(): Promise<number> {
    return Promise.resolve(1);
  }
}

export interface UseDmInboxResult {
  conversations: DmConvo[];
  isLoading: boolean;
}

export function useDmInbox(): UseDmInboxResult {
  const client = useNovusMundusClient();
  const myPlayerPda = useAccountStore((s) => s.myPlayerPda);
  const dmMap = useWarTableStore((s) => s.dmConversations);
  const setDmConversations = useWarTableStore((s) => s.setDmConversations);

  const [isLoading, setIsLoading] = useState(false);
  // A DM thread's peer never changes, so resolved peers are memoized by thread
  // PDA: the per-message re-scan then re-fetches transactions only for threads
  // it has not seen before.
  const peerCache = useRef(new Map<string, string>());

  // Resolve the peer PlayerAccount PDA for a DM thread by reading the most
  // recent DM transaction's account keys (the gate account that is not mine).
  const resolvePeer = useCallback(
    async (threadPda: PublicKey, mine: string): Promise<string | null> => {
      const sigs = await client.connection.getSignaturesForAddress(threadPda, { limit: 1 });
      const sig = sigs[0]?.signature;
      if (!sig) return null;
      const tx = await client.connection.getParsedTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      });
      const keys = tx?.transaction.message.accountKeys;
      if (!keys || keys.length < 5) return null;
      // DM accounts: [thread, sender, senderPlayer, playerA, playerB]. The two
      // gate-account player PDAs are the last two entries; the peer is the one
      // that is not the connected player. We read the gate slots directly so we
      // do not mistake the sender wallet for a player PDA.
      const gateA = keys.at(-2)?.pubkey.toBase58();
      const gateB = keys.at(-1)?.pubkey.toBase58();
      if (gateA && gateA !== mine) return gateA;
      if (gateB && gateB !== mine) return gateB;
      return null;
    },
    [client.connection],
  );

  const refresh = useCallback(async () => {
    if (!myPlayerPda) return;
    const mine = myPlayerPda;
    const myPda = new PublicKey(mine);
    setIsLoading(true);
    try {
      const wtClient = new WarTableClient({
        connection: client.connection,
        keyProvider: new NoKeyProvider(),
      });
      const discovered = await wtClient.discoverDmThreads(myPda);

      // Resolve peers in parallel; a known thread skips the two-RPC lookup since
      // its peer is immutable.
      const convos = await Promise.all(
        discovered.map(async (conv): Promise<DmConvo | null> => {
          const threadPda = conv.threadPda.toBase58();
          let peer = peerCache.current.get(threadPda);
          if (!peer) {
            const resolved = await resolvePeer(conv.threadPda, mine);
            if (!resolved) return null;
            peer = resolved;
            peerCache.current.set(threadPda, peer);
          }
          return {
            threadPda,
            peerPlayerPda: peer,
            lastMessageId: idToHex(conv.lastMessageId),
            lastPreview: DM_PREVIEW_LABEL,
          };
        }),
      );
      setDmConversations(convos.filter((c): c is DmConvo => c !== null));
    } finally {
      setIsLoading(false);
    }
  }, [client.connection, myPlayerPda, resolvePeer, setDmConversations]);

  useEffect(() => {
    if (!myPlayerPda) return;
    let cancelled = false;

    void refresh();

    // Live inbox: a new DM that touches my PlayerAccount triggers a re-scan.
    // onLogs does not carry account keys, so we re-discover rather than parse
    // the peer from the log payload.
    const myPda = new PublicKey(myPlayerPda);
    const subId = client.connection.onLogs(
      myPda,
      (logs) => {
        if (cancelled || logs.err) return;
        void refresh();
      },
      "confirmed",
    );

    return () => {
      cancelled = true;
      void client.connection.removeOnLogsListener(subId);
    };
  }, [client.connection, myPlayerPda, refresh]);

  return { conversations: Array.from(dmMap.values()), isLoading };
}
