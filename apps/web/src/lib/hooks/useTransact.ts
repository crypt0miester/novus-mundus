"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import type { TransactionInstruction } from "@solana/web3.js";
import { Keypair, VersionedTransaction, AddressLookupTableAccount } from "@solana/web3.js";
import { useNovusMundusClient } from "@/lib/solana/provider";
import { useNotifications } from "@/lib/store/notifications";
import { useSettings } from "@/lib/store/settings";
import { useAccountStore } from "@/lib/store/accounts";
import { refetchAccounts } from "@/lib/store/refetch";
import { useEventStore, serializeEventData, type EventEntry } from "@/lib/store/events";
import { classifyEvent } from "@/lib/events/classify";
import { formatEventMessage } from "@/lib/events/format";
import { parseTransactionError, parseEventsFromLogs } from "@/lib/sdk";
import type { NovusMundusEvent } from "@/lib/sdk";

// ============================================================
// Pending TX Registry (WebSocket-based confirmation)
// ============================================================

const pendingTxs = new Map<string, {
  resolve: (logs: string[]) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

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

// ============================================================
// Side channel: mutationFn stores events here for onSuccess
// ============================================================

const recentTxEvents = new Map<string, NovusMundusEvent[]>();

// ============================================================
// Hook
// ============================================================

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
  const addNotification = useNotifications((s) => s.add);

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
        const { priorityFee } = useSettings.getState();
        tx = await client.buildVersionedTransaction(
          opts.instructions,
          wallet.publicKey,
          {
            computeUnits: 400_000,
            computeUnitPrice: priorityFee,
            lookupTables: opts.lookupTables,
          },
        );
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
      const signature = await client.connection.sendRawTransaction(
        signed.serialize(),
      );

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

      // Parse and stash events for onSuccess to pick up
      const events = parseEventsFromLogs(logs);
      if (events.length > 0) {
        recentTxEvents.set(signature, events);
      }

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

        // Show rich toast for the most notable event
        const firstFormatted = events
          .map((e) => formatEventMessage(e))
          .find((msg) => msg !== null);

        if (firstFormatted) {
          addNotification({
            type: "gold",
            title: firstFormatted.title,
            message: firstFormatted.message,
            signature,
          });
        } else {
          addNotification({
            type: "gold",
            title: variables.successMessage || "Transaction confirmed",
            message: `Signature: ${signature.slice(0, 8)}...`,
            signature,
          });
        }
      } else {
        addNotification({
          type: "gold",
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
        addNotification({
          type: "error",
          title: "Transaction failed",
          message: error.message,
        });
        return;
      }

      // On-chain / Solana errors — parse custom program codes
      const parsed = parseTransactionError(error);
      addNotification({
        type: "error",
        title: "Transaction failed",
        message: parsed.message,
      });
    },
  });
}

function extractTimestamp(event: NovusMundusEvent): number {
  const d = event.data as never as Record<string, { toNumber?: () => number }>;
  const ts = d["timestamp"];
  if (ts && typeof ts === "object" && ts.toNumber) {
    return ts.toNumber();
  }
  if (typeof ts === "number") return ts;
  return Math.floor(Date.now() / 1000);
}
