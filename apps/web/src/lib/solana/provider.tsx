"use client";

import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  WalletContext,
  type WalletContextState,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@/components/shared/wallet-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NovusMundusClient } from "novus-mundus-sdk";
import { startGameSubscriptions } from "@/lib/store/subscriptions";
import { useAccountStore } from "@/lib/store/accounts";
import { useViewAsStore } from "@/lib/store/view-as";
import { useTierTheme } from "@/lib/hooks/useTierTheme";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";

// NovusMundus client context
const NovusMundusContext = createContext<NovusMundusClient | null>(null);

export function useNovusMundusClient(): NovusMundusClient {
  const client = useContext(NovusMundusContext);
  if (!client) throw new Error("useNovusMundusClient must be used within GameProviders");
  return client;
}

export function GameProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [], []);
  const endpoint = RPC_URL;
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <ViewAsBridge>
          <WalletModalProvider>
            <QueryClientProvider client={queryClient}>
              <NovusMundusClientProvider>
                <SubscriptionBridge />
                <TierThemeBridge />
                {children}
              </NovusMundusClientProvider>
            </QueryClientProvider>
          </WalletModalProvider>
        </ViewAsBridge>
      </WalletProvider>
    </ConnectionProvider>
  );
}

// Debug "view as" mode: with `?viewAs=<pubkey>` in the URL, override the
// wallet context so the whole app renders as if that pubkey were connected —
// no wallet extension, no signing. Useful for inspecting a player created via
// the SDK CLI without wiring a real signer into the browser. Read-only:
// signing/sending throws, because no private key is present client-side.
//
// The pubkey is read after mount (not during render) so SSR and the first
// client render agree; the impersonated identity then takes effect on the
// follow-up render. Parsing is the trust boundary — an invalid base58 value is
// ignored and the real wallet is used.
function ViewAsBridge({ children }: { children: React.ReactNode }) {
  const real = useWallet();
  const [viewAs, setViewAs] = useState<PublicKey | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("viewAs");
    if (!raw) return;
    try {
      setViewAs(new PublicKey(raw));
    } catch {
      console.warn(`[viewAs] ignoring invalid pubkey: ${raw}`);
    }
  }, []);

  // Mirror impersonation into the shared store so useCanAct can fold viewAs
  // under the read-only umbrella (a faked wallet reports connected + a real
  // player, so wallet/player reads alone cannot tell it apart from a real seat).
  const setIsViewAs = useViewAsStore((s) => s.setIsViewAs);
  useEffect(() => {
    setIsViewAs(viewAs != null);
  }, [viewAs, setIsViewAs]);

  const value = useMemo<WalletContextState>(() => {
    if (!viewAs) return real;
    const denied = () => {
      throw new Error(
        "View-only mode (?viewAs): no signer attached, so transactions can't be signed. " +
          "Remove viewAs from the URL and connect a wallet to act.",
      );
    };
    return {
      autoConnect: false,
      wallets: [],
      wallet: null,
      publicKey: viewAs,
      connecting: false,
      connected: true,
      disconnecting: false,
      select: () => {},
      connect: async () => {},
      disconnect: async () => {},
      sendTransaction: denied as unknown as WalletContextState["sendTransaction"],
      signTransaction: denied as unknown as WalletContextState["signTransaction"],
      signAllTransactions: denied as unknown as WalletContextState["signAllTransactions"],
      signMessage: denied as unknown as WalletContextState["signMessage"],
      signIn: denied as unknown as WalletContextState["signIn"],
    };
  }, [viewAs, real]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function NovusMundusClientProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => {
    const connection = new Connection(RPC_URL, { commitment: "confirmed" });
    return new NovusMundusClient({
      connection,
      kingdomId: Number(process.env.NEXT_PUBLIC_KINGDOM_ID || 0),
    });
  }, []);

  return <NovusMundusContext.Provider value={client}>{children}</NovusMundusContext.Provider>;
}

/** Sets data-tier and data-theme on body globally */
function TierThemeBridge() {
  useTierTheme();
  return null;
}

/**
 * Starts/stops the program-wide WebSocket subscription
 * based on wallet connection state. Seeds zustand with initial RPC data.
 */
function SubscriptionBridge() {
  const { publicKey } = useWallet();
  const client = useNovusMundusClient();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!publicKey) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      useAccountStore.getState().reset();
      return;
    }
    cleanupRef.current = startGameSubscriptions(client, publicKey);

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [publicKey, client]);

  return null;
}
