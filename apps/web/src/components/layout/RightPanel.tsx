"use client";

import { Suspense, type ComponentType } from "react";
import { useRightPanelStore } from "@/lib/store/right-panel";
import { BuildingUpgradePanel } from "@/components/panels/BuildingUpgradePanel";
import { BuildingPickerPanel } from "@/components/panels/BuildingPickerPanel";
import { ResearchPanel } from "@/components/panels/ResearchDetailPanel";
import { RallyDetailPanel } from "@/components/panels/RallyDetailPanel";
import { DailyActivityListPanel } from "@/app/(game)/estate/_components/daily-activity/DailyActivityListPanel";
import { ChroniclePanel } from "@/components/chronicle/ChroniclePanel";
import { EncounterDetailPanel } from "@/components/panels/EncounterDetailPanel";
import { PvpDetailPanel } from "@/components/panels/PvpDetailPanel";
import { DungeonHeroPanel } from "@/components/panels/DungeonHeroPanel";
import { DungeonClaimPanel } from "@/components/panels/DungeonClaimPanel";
import { InventoryPanel } from "@/components/panels/InventoryPanel";
import { ReinforceComposerPanel } from "@/components/panels/ReinforceComposerPanel";
import { RallyComposerPanel } from "@/components/panels/RallyComposerPanel";
import { GarrisonComposerPanel } from "@/components/panels/GarrisonComposerPanel";
import { BottomSheet } from "@/components/shared/BottomSheet";

// ── Panel component registry ──
// Components resolved by contentKey from the store.
const PANELS: Record<string, ComponentType<any>> = {
  "building-detail": BuildingUpgradePanel,
  "building-picker": BuildingPickerPanel,
  research: ResearchPanel,
  "rally-detail": RallyDetailPanel,
  "daily-activities": DailyActivityListPanel,
  chronicle: ChroniclePanel,
  "encounter-detail": EncounterDetailPanel,
  "pvp-detail": PvpDetailPanel,
  "dungeon-hero": DungeonHeroPanel,
  "dungeon-claim": DungeonClaimPanel,
  inventory: InventoryPanel,
  "reinforce-composer": ReinforceComposerPanel,
  "rally-composer": RallyComposerPanel,
  "garrison-composer": GarrisonComposerPanel,
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

/** RightPanel: desktop fixed sidebar; mobile bottom sheet modal. */
export function RightPanel() {
  const open = useRightPanelStore((s) => s.open);
  const title = useRightPanelStore((s) => s.title);
  const close = useRightPanelStore((s) => s.close);

  // Escape-to-close and mobile body-scroll-lock are owned by BottomSheet,
  // which is always mounted below, so no need to duplicate them here.

  return (
    <>
      {/* Desktop: fixed right sidebar, only mounted when something is selected so
          an unused panel reclaims its width. Its width is the resizable
          --right-panel-w; the DrawerResizeHandle (variant "right-panel", in the
          layout) sets it and closes the panel when dragged past the min. */}
      {open && (
        <aside className="hidden lg:flex w-[var(--right-panel-w)] flex-shrink-0 flex-col border-l border-border-default bg-[var(--nm-bg-bar)]">
          <div id="right-panel-content" className="flex flex-1 flex-col overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {title}
              </h3>
              <button
                type="button"
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
