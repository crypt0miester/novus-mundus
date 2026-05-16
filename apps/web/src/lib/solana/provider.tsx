"use client";

import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@/components/shared/wallet-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Connection } from "@solana/web3.js";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NovusMundusClient } from "novus-mundus-sdk";
import { startGameSubscriptions } from "@/lib/store/subscriptions";
import { useAccountStore } from "@/lib/store/accounts";
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
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }));

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>
            <NovusMundusClientProvider>
              <SubscriptionBridge />
              <TierThemeBridge />
              {children}
            </NovusMundusClientProvider>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function NovusMundusClientProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => {
    const connection = new Connection(RPC_URL, { commitment: "confirmed" });
    return new NovusMundusClient({
      connection,
      kingdomId: Number(process.env.NEXT_PUBLIC_KINGDOM_ID || 0),
    });
  }, []);

  return (
    <NovusMundusContext.Provider value={client}>
      {children}
    </NovusMundusContext.Provider>
  );
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
