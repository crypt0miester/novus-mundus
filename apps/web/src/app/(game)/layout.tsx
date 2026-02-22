"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { useTransitionStore, exitMessage } from "@/lib/store/transition";

export default function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connected } = useWallet();
  const trigger = useTransitionStore((s) => s.trigger);
  const phase = useTransitionStore((s) => s.phase);

  // Transition to landing if disconnected
  useEffect(() => {
    if (!connected && phase === "idle") {
      trigger(exitMessage(), "/");
    }
  }, [connected, phase, trigger]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Desktop: TopBar at top */}
      <TopBar />
      {/* Mobile: StatusBar at top */}
      <div className="md:hidden">
        <StatusBar />
      </div>
      <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      {/* Desktop: StatusBar at bottom */}
      <div className="hidden md:block">
        <StatusBar />
      </div>
      {/* Mobile: BottomNav at bottom */}
      <BottomNav />
    </div>
  );
}
