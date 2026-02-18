"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { useTransitionStore, exitMessage } from "@/lib/store/transition";
import { useTierTheme } from "@/lib/hooks/useTierTheme";

export default function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connected } = useWallet();
  const trigger = useTransitionStore((s) => s.trigger);
  const phase = useTransitionStore((s) => s.phase);

  useTierTheme();

  // Transition to landing if disconnected
  useEffect(() => {
    if (!connected && phase === "idle") {
      trigger(exitMessage(), "/");
    }
  }, [connected, phase, trigger]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      <StatusBar />
    </div>
  );
}
