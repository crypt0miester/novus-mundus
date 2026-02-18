"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { EstateTab } from "./_components/estate-tab";
import { ResearchTab } from "./_components/research-tab";
import { ForgeTab } from "./_components/forge-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "estate", label: "Estate" },
  { key: "research", label: "Research" },
  { key: "forge", label: "Forge" },
];

function EstateContent() {
  const [tab, setTab] = useTabParam("estate");

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">ESTATE</h1>
        <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        {tab === "estate" && <EstateTab />}
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
