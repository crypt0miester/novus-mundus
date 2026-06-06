"use client";

import { TopBar } from "@/components/layout/TopBar";
import { MorphTabBar } from "@/components/layout/MorphTabBar";
import { LeftPanel, LeftPanelMobile } from "@/components/layout/LeftPanel";
import { CairnFloating } from "@/components/cairn/CairnFloating";
import { CairnPresence } from "@/components/cairn/CairnPresence";
import { RightPanel } from "@/components/layout/RightPanel";
import { CombatOutcomeModal } from "@/components/combat/CombatOutcomeModal";
import { usePathname } from "next/navigation";
import { useActWatch } from "@/lib/hooks/useActWatch";
import { UnreadSync } from "@/lib/hooks/useUnread";
import { SessionProbe } from "@/lib/store/session";
import { MotionEngineProvider } from "@/lib/motion/MotionEngineProvider";

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useActWatch();

  // Spectate is the read-only floor: a wallet-less visitor and a connected
  // wallet with no player both stay in (game) and browse the real realm. The
  // old redirect guards (no-wallet -> landing, no-player -> /estate) are gone;
  // the "claim your seat" CTA now lives in TxButton (and the shell), so a write
  // attempt is what prompts a claim, not entry. /estate remains the Arrival
  // home, reached when a spectator chooses to claim.

  return (
    <MotionEngineProvider>
      <div className="flex h-[100dvh] flex-col overflow-hidden">
        <TopBar />
        {/* Mobile: collapsible data bar + the draggable Cairn.
         *  /map renders a fullscreen disc with its own floating chrome, so
         *  we suppress the Cairn there — its sphere otherwise drifts over
         *  the parchment and competes with the disc for attention. */}
        <div className="lg:hidden">
          <LeftPanelMobile />
          {!(pathname === "/map" || pathname?.startsWith("/map/")) && <CairnFloating />}
        </div>
        {/* 3-column body */}
        <div className="flex flex-1 overflow-hidden">
          <aside className="hidden lg:block lg:w-72 flex-shrink-0 overflow-y-auto border-r border-border-default bg-[var(--nm-bg-bar)]">
            <LeftPanel />
          </aside>
          <main className="min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-4 lg:p-6">
            {children}
          </main>
          <RightPanel />
        </div>
        {/* Desktop: the Cairn rests at the foot of the left sidebar */}
        <CairnPresence />
        <MorphTabBar />
        {/* Centered win/lose breakdown after an attack */}
        <CombatOutcomeModal />
        {/* Global unread-messages sync (DM discovery + team peek); renders nothing. */}
        <UnreadSync />
        {/* App-wide SIWS session probe + wallet-change reconcile; renders nothing. */}
        <SessionProbe />
      </div>
    </MotionEngineProvider>
  );
}
