"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { EstateTab } from "./_components/estate-tab";
import { ResearchTab } from "./_components/research-tab";
import { ForgeTab } from "./_components/forge-tab";
import { MarketTab } from "./_components/market-tab";
import { InfirmaryTab } from "./_components/infirmary-tab";
import { WorkshopTab } from "./_components/workshop-tab";
import { SanctuaryTab } from "./_components/sanctuary-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "buildings", label: "Buildings" },
  { key: "market", label: "Market" },
  { key: "research", label: "Research" },
  { key: "forge", label: "Forge" },
  { key: "sanctuary", label: "Sanctuary" },
  { key: "infirmary", label: "Infirmary" },
  { key: "workshop", label: "Workshop" },
];

function EstateContent() {
  const [tab, setTab] = useTabParam("buildings");

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">ESTATE</h1>
          <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "buildings" && <EstateTab />}
          {tab === "research" && (
            <FeatureGate feature={FEATURES.RESEARCH_START}>
              <ResearchTab />
            </FeatureGate>
          )}
          {tab === "forge" && (
            <FeatureGate feature={FEATURES.FORGE_CRAFT}>
              <ForgeTab />
            </FeatureGate>
          )}
          {tab === "market" && <MarketTab />}
          {tab === "sanctuary" && (
            <FeatureGate feature={FEATURES.SANCTUARY_MEDITATE}>
              <SanctuaryTab />
            </FeatureGate>
          )}
          {tab === "infirmary" && <InfirmaryTab />}
          {tab === "workshop" && <WorkshopTab />}
        </div>
      </div>
    </PageTransition>
  );
}

export default function EstatePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <EstateContent />
    </Suspense>
  );
}
