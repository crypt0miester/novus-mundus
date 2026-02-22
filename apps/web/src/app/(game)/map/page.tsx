"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { TravelTab } from "./_components/travel-tab";
import { ExpeditionTab } from "./_components/expedition-tab";
import { CastleTab } from "./_components/castle-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";
import { CityBrowser } from "@/components/world/CityBrowser";
import { RealmOverview } from "@/components/world/RealmOverview";

const TABS = [
  { key: "realm", label: "Realm" },
  { key: "travel", label: "Travel" },
  { key: "expedition", label: "Expedition" },
  { key: "castle", label: "Castle" },
  { key: "cities", label: "Cities" },
];

function MapContent() {
  const [tab, setTab] = useTabParam("realm");

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">MAP</h1>
          <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "travel" && (
            <FeatureGate feature={FEATURES.INTERCITY_TRAVEL}>
              <TravelTab />
            </FeatureGate>
          )}
          {tab === "expedition" && (
            <FeatureGate feature={FEATURES.EXPEDITION_MINING}>
              <ExpeditionTab />
            </FeatureGate>
          )}
          {tab === "castle" && <CastleTab />}
          {tab === "cities" && <CityBrowser />}
          {tab === "realm" && <RealmOverview />}
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
