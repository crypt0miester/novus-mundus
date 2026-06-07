"use client";

import { MorphTabBar } from "@/components/layout/MorphTabBar";
import { LeftPanelMobile } from "@/components/layout/LeftPanel";
import { SideRail } from "@/components/layout/SideRail";
import { SideDrawer } from "@/components/layout/SideDrawer";
import { DrawerResizeHandle } from "@/components/layout/DrawerResizeHandle";
import { CairnFloating } from "@/components/cairn/CairnFloating";
import { CairnPresence } from "@/components/cairn/CairnPresence";
import { RightPanel } from "@/components/layout/RightPanel";
import { CombatOutcomeModal } from "@/components/combat/CombatOutcomeModal";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useActWatch } from "@/lib/hooks/useActWatch";
import { UnreadSync } from "@/lib/hooks/useUnread";
import { SessionProbe } from "@/lib/store/session";
import { MotionEngineProvider } from "@/lib/motion/MotionEngineProvider";
import { useSidebar } from "@/lib/store/sidebar";
import { useDrawerClassMode } from "@/lib/hooks/useDrawerOpen";

export default function GameLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const drawerWidth = useSidebar((s) => s.drawerWidth);
  const rightPanelWidth = useSidebar((s) => s.rightPanelWidth);
  const reclampWidths = useSidebar((s) => s.reclampWidths);
  // Mirror the drawer's open/collapsed/responsive mode onto the shell so the
  // /map fullscreen disc can inset its left edge by the live rail + drawer width
  // (RealmMap.module.css keys off data-drawer-mode). SSR-safe (no media query).
  const drawerMode = useDrawerClassMode();

  useActWatch();

  // Re-clamp on mount + resize. A width saved on a wide monitor must shrink when
  // the app opens narrower, or a column could exceed the viewport (doc 6.2).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => reclampWidths(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [reclampWidths]);

  // Mirror the committed widths onto <html> (the same element a live drag writes,
  // see useResizable), so the drawer/RightPanel read one un-shadowed --drawer-w /
  // --right-panel-w. The :root defaults in globals.css cover the pre-hydration
  // frame; this corrects to the persisted value once mounted. A drag writes the
  // var directly (no React per-move); pointer-up commits to the store, which
  // re-runs this to re-stamp the final value.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--drawer-w", `${drawerWidth}px`);
    root.style.setProperty("--right-panel-w", `${rightPanelWidth}px`);
  }, [drawerWidth, rightPanelWidth]);

  // Spectate is the read-only floor: a wallet-less visitor and a connected
  // wallet with no player both stay in (game) and browse the real realm. The
  // old redirect guards (no-wallet -> landing, no-player -> /estate) are gone;
  // the "claim your seat" CTA now lives in TxButton (and the shell), so a write
  // attempt is what prompts a claim, not entry. /estate remains the Arrival
  // home, reached when a spectator chooses to claim.

  return (
    <MotionEngineProvider>
      {/* data-drawer-mode mirrors the drawer's open/collapsed/responsive state so
       *  the /map fullscreen disc can inset off it (RealmMap.module.css). The
       *  column width vars live on <html> (see the effect above). */}
      <div className="flex h-[100dvh] flex-col overflow-hidden" data-drawer-mode={drawerMode}>
        {/* Below md: collapsible data bar + the draggable Cairn. From md+ the
         *  rail + drawer carry the nav and the drawer foot carries resources
         *  (plus the rail-anchored CairnPresence), so this mobile pair scopes to
         *  <md. /map renders a fullscreen disc with its own floating chrome, so
         *  we suppress the Cairn there: its sphere otherwise drifts over the
         *  parchment and competes with the disc for attention. */}
        <div className="md:hidden">
          <LeftPanelMobile />
          {!(pathname === "/map" || pathname?.startsWith("/map/")) && <CairnFloating />}
        </div>
        {/* Body. At md+ the left is the two-tier rail (icon rail + the
         *  contextual drawer) that holds the nav (the desktop TopBar is gone)
         *  and pins the resource HUD at the drawer foot. The drawer collapses
         *  via the rail/drawer chevrons (state persists). Its logo, world
         *  clock, and wallet moved onto the rail. The <md path (MorphTabBar,
         *  LeftPanelMobile bottom sheet) and RightPanel are unchanged. */}
        <div className="relative flex flex-1 overflow-hidden">
          <SideRail />
          <SideDrawer />
          {/* The drawer's resize/reopen grabber lives here (outside the drawer) so
           *  it is not clipped and stays usable when the drawer is collapsed. */}
          <DrawerResizeHandle />
          <main className="min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-4 lg:p-6">
            {children}
          </main>
          <RightPanel />
          {/* Same grabber on the right panel's inner edge (only while it is open). */}
          <DrawerResizeHandle variant="right-panel" />
        </div>
        {/* Desktop: the Cairn rests at the drawer foot when open and the rail
         *  foot when collapsed (it re-anchors with the drawer). */}
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
