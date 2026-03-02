"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { LeftPanel, LeftPanelMobile } from "@/components/layout/LeftPanel";
import { RightPanel } from "@/components/layout/RightPanel";
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
      <TopBar />
      {/* Mobile: collapsible data bar */}
      <div className="lg:hidden">
        <LeftPanelMobile />
      </div>
      {/* 3-column body */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden lg:block lg:w-56 flex-shrink-0 overflow-y-auto border-r border-border-default bg-[var(--nm-bg-bar)]">
          <LeftPanel />
        </aside>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        <RightPanel />
      </div>
      <BottomNav />
    </div>
  );
}
