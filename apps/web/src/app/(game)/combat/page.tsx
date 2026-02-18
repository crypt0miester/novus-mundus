"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { BattleTab } from "./_components/battle-tab";
import { ArenaTab } from "./_components/arena-tab";
import { DungeonTab } from "./_components/dungeon-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "battle", label: "Battle" },
  { key: "arena", label: "Arena" },
  { key: "dungeon", label: "Dungeon" },
];

function CombatContent() {
  const [tab, setTab] = useTabParam("battle");

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">COMBAT</h1>
        <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        {tab === "battle" && (
          <FeatureGate feature={FEATURES.ATTACK_ENCOUNTER}>
            <BattleTab />
          </FeatureGate>
        )}
        {tab === "arena" && <ArenaTab />}
        {tab === "dungeon" && (
          <FeatureGate feature={FEATURES.DUNGEON_ENTER}>
            <DungeonTab />
          </FeatureGate>
        )}
      </div>
    </PageTransition>
  );
}

export default function CombatPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <CombatContent />
    </Suspense>
  );
}
