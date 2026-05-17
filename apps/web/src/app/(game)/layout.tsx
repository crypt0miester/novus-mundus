"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { LeftPanel, LeftPanelMobile } from "@/components/layout/LeftPanel";
import { CairnFloating } from "@/components/cairn/CairnFloating";
import { CairnPresence } from "@/components/cairn/CairnPresence";
import { RightPanel } from "@/components/layout/RightPanel";
import { CombatOutcomeModal } from "@/components/combat/CombatOutcomeModal";
import { useTransitionStore, exitMessage } from "@/lib/store/transition";
import { usePlayer } from "@/lib/hooks/usePlayer";
import { useActWatch } from "@/lib/hooks/useActWatch";

export default function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connected } = useWallet();
  const { data: playerData, isLoading: playerLoading } = usePlayer();
  const pathname = usePathname();
  const router = useRouter();
  const trigger = useTransitionStore((s) => s.trigger);
  const phase = useTransitionStore((s) => s.phase);

  useActWatch();

  // Transition to landing if disconnected
  useEffect(() => {
    if (!connected && phase === "idle") {
      trigger(exitMessage(), "/");
    }
  }, [connected, phase, trigger]);

  // A connected wallet with no player belongs in the Arrival — the estate is its home.
  useEffect(() => {
    if (connected && !playerLoading && !playerData?.exists && pathname !== "/estate") {
      router.replace("/estate");
    }
  }, [connected, playerLoading, playerData, pathname, router]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {/* Mobile: collapsible data bar + the draggable Cairn */}
      <div className="lg:hidden">
        <LeftPanelMobile />
        <CairnFloating />
      </div>
      {/* 3-column body */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden lg:block lg:w-72 flex-shrink-0 overflow-y-auto border-r border-border-default bg-[var(--nm-bg-bar)]">
          <LeftPanel />
        </aside>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        <RightPanel />
      </div>
      {/* Desktop: the Cairn rests at the foot of the left sidebar */}
      <CairnPresence />
      <BottomNav />
      {/* Centered win/lose breakdown after an attack */}
      <CombatOutcomeModal />
    </div>
  );
}
