"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { MapTab } from "./_components/map-tab";
import { ExpeditionTab } from "./_components/expedition-tab";
import { CastleTab } from "./_components/castle-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "realm", label: "Realm" },
  { key: "expedition", label: "Expedition" },
  { key: "castle", label: "Castle" },
];

function MapContent() {
  const [tab, setTab] = useTabParam("realm");
  // Legacy ?tab=travel|cities URLs fall through to the Realm map.
  const activeTab =
    tab === "travel" || tab === "cities" ? "realm" : tab;

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex justify-end">
          <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Not wrapped in FeatureGate: the map itself works without a wallet,
              and gating the tab caused a blank page while player data loaded.
              The in-panel Travel/Teleport CTAs gate themselves. */}
          {activeTab === "realm" && <MapTab />}
          {activeTab === "expedition" && (
            <FeatureGate feature={FEATURES.EXPEDITION_MINING}>
              <ExpeditionTab />
            </FeatureGate>
          )}
          {activeTab === "castle" && <CastleTab />}
        </div>
      </div>
    </PageTransition>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <MapContent />
    </Suspense>
  );
}
