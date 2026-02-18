"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { TravelTab } from "./_components/travel-tab";
import { ExpeditionTab } from "./_components/expedition-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "travel", label: "Travel" },
  { key: "expedition", label: "Expedition" },
];

function TravelContent() {
  const [tab, setTab] = useTabParam("travel");

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">TRAVEL</h1>
        <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
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
      </div>
    </PageTransition>
  );
}

export default function TravelPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <TravelContent />
    </Suspense>
  );
}
