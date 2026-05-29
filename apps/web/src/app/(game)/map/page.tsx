"use client";

import { Suspense, type ComponentType, type SVGProps } from "react";
import { Castle, Map as MapIcon, Pickaxe, Swords } from "lucide-react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { PageTransition } from "@/components/shared/PageTransition";
import { cn } from "@/lib/utils";
import { MapTab } from "./_components/map-tab";
import { ExpeditionTab } from "./_components/expedition-tab";
import { CastleTab } from "./_components/castle-tab";
import { ForcesTab } from "./_components/forces-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface SubTab {
  key: string;
  label: string;
  icon: LucideIcon;
}

const TABS: SubTab[] = [
  { key: "realm", label: "Realm", icon: MapIcon },
  { key: "forces", label: "Forces", icon: Swords },
  { key: "expedition", label: "Expedition", icon: Pickaxe },
  { key: "castle", label: "Castle", icon: Castle },
];

function MapContent() {
  const [tab, setTab] = useTabParam("realm");
  // Legacy ?tab=travel|cities URLs fall through to the Realm map.
  const activeTab = tab === "travel" || tab === "cities" ? "realm" : tab;

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Not wrapped in FeatureGate: the map itself works without a wallet,
              and gating the tab caused a blank page while player data loaded.
              The in-panel Travel/Teleport CTAs gate themselves. */}
          {activeTab === "realm" && <MapTab />}
          {activeTab === "forces" && <ForcesTab />}
          {activeTab === "expedition" && (
            <FeatureGate feature={FEATURES.EXPEDITION_MINING}>
              <ExpeditionTab />
            </FeatureGate>
          )}
          {activeTab === "castle" && <CastleTab />}
        </div>

        {/* Sub-tab switcher — vertical column of round icon buttons on
         *  the right rail. Shown at every breakpoint now that the map
         *  is fullscreen on desktop too. On md+ the TopBar holds the
         *  wallet button at the same right edge, so we drop the nav
         *  below it (top: 11px = the bar's bottom edge + a small gap)
         *  via the `md:top-[3rem]` arbitrary value. The MorphTabBar on
         *  mobile occupies the bottom and the realm map's status pill
         *  sits ~bottom-7rem; top-36 keeps the nav clear of both. */}
        <nav
          role="tablist"
          aria-label="Map sub-tab"
          aria-orientation="vertical"
          className="fixed right-2 top-14 z-40 flex flex-col gap-2"
        >
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                onClick={() => setTab(key)}
                aria-label={label}
                aria-selected={active}
                title={label}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors",
                  active
                    ? "border-text-gold bg-text-gold/15 text-text-gold"
                    : "border-border-default bg-[var(--nm-bg-bar)]/80 text-text-muted hover:text-text-secondary",
                )}
              >
                <Icon className="h-[18px] w-[18px] text-text-gold" />
              </button>
            );
          })}
        </nav>
      </div>
    </PageTransition>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
          Loading...
        </div>
      }
    >
      <MapContent />
    </Suspense>
  );
}
