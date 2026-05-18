"use client";

import { useEffect, useCallback, lazy, Suspense, type ComponentType } from "react";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { BuildingUpgradePanel } from "@/components/panels/BuildingUpgradePanel";
import { ResearchPanel } from "@/components/panels/ResearchDetailPanel";
import { RallyDetailPanel } from "@/components/panels/RallyDetailPanel";
import { DailyActivityListPanel } from "@/app/(game)/estate/_components/daily-activity/DailyActivityListPanel";
import { ChroniclePanel } from "@/components/chronicle/ChroniclePanel";
import { EncounterDetailPanel } from "@/components/panels/EncounterDetailPanel";
import { PvpDetailPanel } from "@/components/panels/PvpDetailPanel";
import { DungeonHeroPanel } from "@/components/panels/DungeonHeroPanel";
import { DungeonClaimPanel } from "@/components/panels/DungeonClaimPanel";
import { InventoryPanel } from "@/components/panels/InventoryPanel";
import { BottomSheet } from "@/components/shared/BottomSheet";

// ── Panel component registry ──
// Components resolved by contentKey from the store.
const PANELS: Record<string, ComponentType<any>> = {
  "building-detail": BuildingUpgradePanel,
  "research": ResearchPanel,
  "rally-detail": RallyDetailPanel,
  "daily-activities": DailyActivityListPanel,
  "chronicle": ChroniclePanel,
  "encounter-detail": EncounterDetailPanel,
  "pvp-detail": PvpDetailPanel,
  "dungeon-hero": DungeonHeroPanel,
  "dungeon-claim": DungeonClaimPanel,
  "inventory": InventoryPanel,
};

/** Register a panel component for a given key. Call at module scope. */
export function registerPanel(key: string, component: ComponentType<any>) {
  PANELS[key] = component;
}

function PanelContent() {
  const contentKey = useRightPanelStore((s) => s.contentKey);
  const contentProps = useRightPanelStore((s) => s.contentProps);

  if (!contentKey) return null;

  const Component = PANELS[contentKey];
  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-red-400">Unknown panel: {contentKey}</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <p className="text-xs text-text-muted">Loading...</p>
        </div>
      }
    >
      <Component {...contentProps} />
    </Suspense>
  );
}

/** RightPanel — desktop: fixed sidebar. Mobile: bottom sheet modal. */
export function RightPanel() {
  const open = useRightPanelStore((s) => s.open);
  const title = useRightPanelStore((s) => s.title);
  const close = useRightPanelStore((s) => s.close);

  // Close on Escape
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    [close]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, handleKey]);

  // Lock body scroll on mobile when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    const mql = window.matchMedia("(min-width: 1024px)");
    if (!mql.matches) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* ── Desktop: fixed right sidebar — only mounted when something is
          selected, so an unused panel reclaims its width for the main view ── */}
      {open && (
        <aside className="hidden lg:flex lg:w-72 flex-shrink-0 flex-col border-l border-border-default bg-[var(--nm-bg-bar)]">
          <div className="flex flex-1 flex-col overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {title}
              </h3>
              <button
                onClick={close}
                className="rounded border border-border-default px-2 py-0.5 text-xs text-text-muted hover:text-text-secondary"
              >
                Close
              </button>
            </div>
            <div className="flex-1 p-4 space-y-4">
              <PanelContent />
            </div>
          </div>
        </aside>
      )}

      {/* ── Mobile: bottom sheet ── */}
      <BottomSheet open={open} onClose={close} title={title}>
        <PanelContent />
      </BottomSheet>
    </>
  );
}
