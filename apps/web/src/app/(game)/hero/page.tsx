"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { HeroesTab } from "./_components/heroes-tab";
import { SanctuaryTab } from "./_components/sanctuary-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "heroes", label: "Heroes" },
  { key: "sanctuary", label: "Sanctuary" },
];

function HeroContent() {
  const [tab, setTab] = useTabParam("heroes");

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">HEROES</h1>
        <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        {tab === "heroes" && (
          <FeatureGate feature={FEATURES.HERO_MINT}>
            <HeroesTab />
          </FeatureGate>
        )}
        {tab === "sanctuary" && (
          <FeatureGate feature={FEATURES.SANCTUARY_MEDITATE}>
            <SanctuaryTab />
          </FeatureGate>
        )}
      </div>
    </PageTransition>
  );
}

export default function HeroPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <HeroContent />
    </Suspense>
  );
}
