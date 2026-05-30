"use client";

// usePresenceBeat: the manual "I'm online" presence ping.
//
// beat() builds the shared presence ping (buildPresencePingInstruction: a
// KIND=Status, plaintext, empty-payload Public-scope message on the kingdom
// GameEngine PDA) and sends it as its own transaction. The exact same builder
// backs the useTransact piggyback, so the manual button and the auto-ping are
// byte-identical. The player signs (manual gesture); Public is plaintext, so no
// key is ever derived.

import { useCallback, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useAccountStore } from "@/lib/store/accounts";
import { useSettings } from "@/lib/store/settings";
import { buildPresencePingInstruction } from "@/lib/presence/ping";
import { notify } from "@/lib/notify";

export interface UsePresenceBeatResult {
  // Post the presence ping. Resolves to the tx signature, or throws on failure
  // (the hook also surfaces a toast).
  beat: () => Promise<string>;
  // true while a beat is in flight.
  sending: boolean;
}

export function usePresenceBeat(): UsePresenceBeatResult {
  const client = useNovusMundusClient();
  const { publicKey, signTransaction } = useWallet();
  const myPlayerPda = useAccountStore((s) => s.myPlayerPda);
  const [sending, setSending] = useState(false);

  const beat = useCallback(async (): Promise<string> => {
    if (!publicKey || !signTransaction) {
      throw new Error("Connect a wallet to mark yourself online.");
    }
    if (!myPlayerPda) {
      throw new Error("Player not loaded yet.");
    }
    const sender = publicKey;

    setSending(true);
    try {
      const ping = buildPresencePingInstruction(
        client.gameEngine,
        sender,
        new PublicKey(myPlayerPda),
      );
      const { priorityFee } = useSettings.getState();
      const tx = await client.buildVersionedTransaction([ping], sender, {
        computeUnits: 50_000,
        computeUnitPrice: priorityFee,
      });
      const signed = await signTransaction(tx);
      const signature = await client.connection.sendRawTransaction(signed.serialize());
      notify.success({ title: "You're online" });
      return signature;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify.error({ title: "Could not update presence", message });
      throw err;
    } finally {
      setSending(false);
    }
  }, [client, publicKey, signTransaction, myPlayerPda]);

  return { beat, sending };
}
