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
// DM bodies are encrypted. For the list preview we best-effort decrypt only the
// newest message per thread, and only while signed in: a bare HttpKeyProvider
// (no reauth wrapper) means a signed-out 401 is swallowed inside the SDK decode
// (decrypted:false) and never prompts a SIWS popup, so the preview just falls
// back to a fixed label. Live updates re-run discovery when onLogs fires on the
// caller's PlayerAccount PDA, and a sign-in re-runs it so previews fill in.

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey, type PartiallyDecodedInstruction } from "@solana/web3.js";
import {
  WarTableClient,
  HttpKeyProvider,
  WarTableScope,
  PROGRAM_ID,
  deriveDmThreadPda,
  idToHex,
  type ThreadKeyProvider,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { useSessionStore } from "@/lib/store/session";
import { useWarTableStore, type DmConvo } from "@/lib/store/war-table";

const DM_PREVIEW_LABEL = "Encrypted message";
const textDecoder = new TextDecoder();

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
  // A sign-in (status flips to "in") re-runs refresh so previews that fell back
  // to the placeholder while signed out get decrypted.
  const sessionStatus = useSessionStore((s) => s.status);

  const [isLoading, setIsLoading] = useState(false);
  // A DM thread's peer never changes, so resolved peers are memoized by thread
  // PDA: the per-message re-scan then re-fetches transactions only for threads
  // it has not seen before.
  const peerCache = useRef(new Map<string, string>());

  // Resolve the peer PlayerAccount PDA for a DM thread from the most recent DM
  // transaction. We must read the program INSTRUCTION's ordered accounts, not
  // message.accountKeys: the compiler reorders the flat key list (signers first,
  // then by writability), which scatters the two player gates and can leave the
  // thread PDA in the last slot. The DM instruction layout is
  // [thread, senderWallet, senderPlayer, gate0, gate1]; the two gates are both
  // participants' PlayerAccount PDAs, so the peer is whichever gate isn't mine.
  const resolvePeer = useCallback(
    async (threadPda: PublicKey, mine: string): Promise<string | null> => {
      const sigs = await client.connection.getSignaturesForAddress(threadPda, { limit: 1 });
      const sig = sigs[0]?.signature;
      if (!sig) return null;
      const tx = await client.connection.getParsedTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      });
      const ix = tx?.transaction.message.instructions.find(
        (i): i is PartiallyDecodedInstruction =>
          "accounts" in i && i.programId.equals(PROGRAM_ID),
      );
      if (!ix || ix.accounts.length < 5) return null;
      const gates = ix.accounts.slice(3).map((k) => k.toBase58());
      return gates.find((g) => g !== mine) ?? null;
    },
    [client.connection],
  );

  // Best-effort decrypt of the newest message for the list preview. A bare
  // HttpKeyProvider (no reauth wrapper) makes a signed-out 401 a swallowed
  // decrypted:false inside the SDK decode, never a SIWS popup; any failure
  // falls back to the fixed label.
  const previewFor = useCallback(
    async (threadPda: PublicKey, peer: string, fetchFn: typeof fetch): Promise<string> => {
      try {
        const wt = new WarTableClient({
          connection: client.connection,
          keyProvider: new HttpKeyProvider(fetchFn, "", WarTableScope.Dm, peer),
        });
        const msgs = await wt.readThread(threadPda, { limit: 5 });
        const last = msgs.length > 0 ? msgs[msgs.length - 1]! : null;
        if (last?.decrypted) {
          const text = textDecoder.decode(last.payload).trim();
          if (text.length > 0) return text;
        }
      } catch {
        // network / decode failure — fall back to the placeholder.
      }
      return DM_PREVIEW_LABEL;
    },
    [client.connection],
  );

  const refresh = useCallback(async () => {
    if (!myPlayerPda) return;
    const mine = myPlayerPda;
    const myPda = new PublicKey(mine);
    // Attempt decryption unless we KNOW we're signed out — matching the
    // conversation view (useWarTable), which only skips on "out" and still tries
    // on "unknown" (probe pending/failed but the cookie may be valid). A bare
    // 401 is swallowed to the placeholder; the sessionStatus dep re-runs this
    // when the status resolves.
    const trySign = sessionStatus !== "out";
    const fetchFn: typeof fetch = typeof window === "undefined" ? fetch : window.fetch.bind(window);
    setIsLoading(true);
    try {
      const discoveryClient = new WarTableClient({
        connection: client.connection,
        keyProvider: new NoKeyProvider(),
      });
      const discovered = await discoveryClient.discoverDmThreads(myPda);

      // Resolve peers in parallel; a known thread skips the two-RPC lookup since
      // its peer is immutable. The preview is re-read every refresh (the newest
      // message changes) but only decrypted unless known signed-out.
      const convos = await Promise.all(
        discovered.map(async (conv): Promise<DmConvo | null> => {
          const threadPda = conv.threadPda.toBase58();
          let peer = peerCache.current.get(threadPda);
          if (!peer) {
            const resolved = await resolvePeer(conv.threadPda, mine);
            if (!resolved) return null;
            // Privacy guard: discoverDmThreads groups EVERY wt1 thread my player
            // PDA touched and cannot read scope from the envelope, so a team /
            // rally / castle thread I posted to would otherwise leak in as a fake
            // conversation showing my own group posts. Prove this is really a DM
            // between me and `resolved` by re-deriving the pair PDA; only a match
            // is cached and surfaced.
            let derived: string;
            try {
              derived = (await deriveDmThreadPda(myPda, new PublicKey(resolved)))[0].toBase58();
            } catch {
              return null;
            }
            if (derived !== threadPda) return null;
            peer = resolved;
            peerCache.current.set(threadPda, peer);
          }
          return {
            threadPda,
            peerPlayerPda: peer,
            lastMessageId: idToHex(conv.lastMessageId),
            lastPreview: trySign
              ? await previewFor(conv.threadPda, peer, fetchFn)
              : DM_PREVIEW_LABEL,
          };
        }),
      );
      setDmConversations(convos.filter((c): c is DmConvo => c !== null));
    } finally {
      setIsLoading(false);
    }
  }, [client.connection, myPlayerPda, resolvePeer, previewFor, setDmConversations, sessionStatus]);

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
