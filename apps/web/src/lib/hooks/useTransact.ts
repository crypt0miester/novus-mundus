"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import type { Keypair, VersionedTransaction, AddressLookupTableAccount } from "@solana/web3.js";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { buildPresencePingInstruction } from "@/lib/presence/ping";
import { notify } from "@/lib/notify";
import { useSettings } from "@/lib/store/settings";
import { useAccountStore } from "@/lib/store/accounts";
import { refetchAccounts } from "@/lib/store/refetch";
import { useEventStore, serializeEventData, type EventEntry } from "@/lib/store/events";
import { classifyEvent } from "@/lib/events/classify";
import { formatEventMessage } from "@/lib/events/format";
import { parseTransactionError, parseEventsFromLogs } from "novus-mundus-sdk";
import type { NovusMundusEvent } from "novus-mundus-sdk";

// Pending TX Registry (WebSocket-based confirmation)

const pendingTxs = new Map<
  string,
  {
    resolve: (logs: string[]) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Called from subscriptions.ts when a log payload arrives.
 * If the signature matches a pending tx, resolve/reject it.
 */
export function resolvePendingTx(
  signature: string,
  logs: string[],
  err: string | object | null,
): boolean {
  const pending = pendingTxs.get(signature);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingTxs.delete(signature);

  if (err) {
    pending.reject(new Error(JSON.stringify(err)));
  } else {
    pending.resolve(logs);
  }
  return true;
}

function waitForTxViaLogSub(signature: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTxs.delete(signature);
      reject(new Error("WebSocket confirmation timeout"));
    }, timeoutMs);

    pendingTxs.set(signature, { resolve, reject, timeout });
  });
}

// Presence piggyback (opt-in via settings.broadcastPresence). Throttle so a burst
// of actions appends at most one ping per minute (presence only needs coarse
// freshness), and never breach the Solana packet limit (the real action must
// never fail because of a presence ping). lastPresencePingAt is module-scoped and
// ephemeral by design — it resets on reload, which only means one extra ping.
const PRESENCE_PING_THROTTLE_MS = 60_000;
const PACKET_DATA_SIZE = 1232;
let lastPresencePingAt = 0;

// Serialized byte length of a (possibly unsigned) versioned tx; treats an
// over-size tx (serialize throws past the packet limit) as too large.
function serializedSize(tx: VersionedTransaction): number {
  try {
    return tx.serialize().length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

// Hook

interface TransactOptions {
  /** Instructions to build into a legacy Transaction (mutual exclusive with versionedTx). */
  instructions?: TransactionInstruction[];
  /** Pre-built VersionedTransaction (e.g. from AllDomains co-signer API). */
  versionedTx?: VersionedTransaction;
  /** Lookup tables for building a VersionedTransaction from instructions. */
  lookupTables?: AddressLookupTableAccount[];
  /** Additional keypair signers (e.g. hero mint keypair). Partial-sign before wallet signs. */
  signers?: Keypair[];
  invalidateKeys?: string[][];
  successMessage?: string;
  onPhase?: (phase: "preparing" | "signing" | "sending") => void;
}

export function useTransact() {
  const client = useNovusMundusClient();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts: TransactOptions) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Wallet not connected");
      }

      const { onPhase } = opts;
      onPhase?.("preparing");

      let tx: VersionedTransaction;

      if (opts.versionedTx) {
        // Pre-built versioned tx (co-signer path) — just sign
        tx = opts.versionedTx;
      } else if (opts.instructions) {
        const { priorityFee, broadcastPresence } = useSettings.getState();
        const sender = wallet.publicKey;
        const build = (ixs: TransactionInstruction[]) =>
          client.buildVersionedTransaction(ixs, sender, {
            computeUnits: 400_000,
            computeUnitPrice: priorityFee,
            lookupTables: opts.lookupTables,
          });

        // Opt-in presence piggyback: append an empty Status ping to the kingdom
        // Public channel so normal play keeps the player's online dot fresh.
        // Throttled to once per minute, and dropped if it would push the tx over
        // the packet limit (the action must never fail because of presence).
        const myPlayerPda = useAccountStore.getState().myPlayerPda;
        const now = Date.now();
        const wantPing =
          broadcastPresence &&
          !!myPlayerPda &&
          now - lastPresencePingAt > PRESENCE_PING_THROTTLE_MS;

        if (wantPing) {
          const ping = buildPresencePingInstruction(
            client.gameEngine,
            sender,
            new PublicKey(myPlayerPda!),
          );
          const withPing = await build([...opts.instructions, ping]);
          if (serializedSize(withPing) <= PACKET_DATA_SIZE) {
            tx = withPing;
            lastPresencePingAt = now;
          } else {
            tx = await build(opts.instructions);
          }
        } else {
          tx = await build(opts.instructions);
        }
      } else {
        throw new Error("Must provide instructions or versionedTx");
      }

      // Partial-sign with any additional keypairs (e.g. hero mint)
      if (opts.signers && opts.signers.length > 0) {
        tx.sign(opts.signers);
      }

      onPhase?.("signing");
      const signed = await wallet.signTransaction(tx);

      onPhase?.("sending");

      // Send raw — the versioned tx may already have other signatures
      const signature = await client.connection.sendRawTransaction(signed.serialize());

      // Try WebSocket-based confirmation first (zero extra RPC calls)
      const wsActive = useAccountStore.getState().subscriptionActive;
      let logs: string[];

      if (wsActive) {
        try {
          logs = await waitForTxViaLogSub(signature, 60_000);
        } catch {
          // WebSocket timeout — fall back to polling
          logs = await fallbackConfirm(signature);
        }
      } else {
        // No WebSocket yet — use polling fallback
        logs = await fallbackConfirm(signature);
      }

      // Parse events for onSuccess to pick up (returned on the result)
      const events = parseEventsFromLogs(logs);

      return { signature, events };

      async function fallbackConfirm(sig: string): Promise<string[]> {
        const confirmation = await client.connection.confirmTransaction(sig, "confirmed");
        if (confirmation.value.err) {
          throw new Error(JSON.stringify(confirmation.value.err));
        }
        const txInfo = await client.connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        return txInfo?.meta?.logMessages ?? [];
      }
    },

    onSuccess: (result, variables) => {
      const { signature, events } = result;

      // Store events in the event store
      const myPlayerKey = useAccountStore.getState().myPlayerPda;
      const myTeamPubkey = useAccountStore.getState().team?.pubkey?.toBase58();

      if (events.length > 0 && myPlayerKey) {
        const entries: EventEntry[] = events.map((event, i) => ({
          id: `${signature}:${i}`,
          name: event.name,
          event: serializeEventData(event),
          scopes: classifyEvent(event, myPlayerKey, myTeamPubkey),
          timestamp: extractTimestamp(event),
          txSignature: signature,
          read: true, // personal tx events start as read (user initiated them)
        }));
        useEventStore.getState().addEvents(entries);

        // Toast the tx's outcome — the LAST formatted event. A bundled tx
        // emits several (e.g. instant research = start + speedup + complete);
        // the final one is the end state ("Research Complete", not "Started").
        const formatted = events
          .map((e) => formatEventMessage(e))
          .filter((m): m is NonNullable<typeof m> => m !== null);
        const notable = formatted.at(-1);

        if (notable) {
          notify.gold({
            title: notable.title,
            message: notable.message,
            signature,
          });
        } else {
          notify.gold({
            title: variables.successMessage || "Transaction confirmed",
            message: `Signature: ${signature.slice(0, 8)}...`,
            signature,
          });
        }
      } else {
        notify.gold({
          title: variables.successMessage || "Transaction confirmed",
          message: `Signature: ${signature.slice(0, 8)}...`,
          signature,
        });
      }

      const keys = variables.invalidateKeys ?? [];
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: key });
      }

      // Zustand refetch — RPC fetch affected accounts and push to store.
      // The WS subscription does this too, but can lag or silently fail.
      if (keys.length > 0 && wallet.publicKey) {
        const flatKeys = keys.map((k) => k[0]);
        refetchAccounts(flatKeys, client, wallet.publicKey).catch(() => {});
      }
    },

    onError: (error) => {
      // Pre-send errors (TypeError, missing accounts, etc.) — show as-is
      if (error instanceof TypeError || error instanceof RangeError) {
        notify.error({
          title: "Transaction failed",
          message: error.message,
        });
        return;
      }

      // On-chain / Solana errors — parse custom program codes
      const parsed = parseTransactionError(error);
      notify.error({
        title: "Transaction failed",
        message: parsed.message,
      });
    },
  });
}

function extractTimestamp(event: NovusMundusEvent): number {
  const d = event.data as never as Record<string, { toNumber?: () => number }>;
  const ts = d.timestamp;
  if (ts && typeof ts === "object" && ts.toNumber) {
    return ts.toNumber();
  }
  if (typeof ts === "number") return ts;
  return Math.floor(Date.now() / 1000);
}
