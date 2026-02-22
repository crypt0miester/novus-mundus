"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { BattleTab } from "./_components/battle-tab";
import { ArenaTab } from "./_components/arena-tab";
import { DungeonTab } from "./_components/dungeon-tab";
import { HeroesTab } from "./_components/heroes-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "battle", label: "Battle" },
  { key: "heroes", label: "Heroes" },
  { key: "arena", label: "Arena" },
  { key: "dungeon", label: "Dungeon" },
];

function CombatContent() {
  const [tab, setTab] = useTabParam("battle");

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">COMBAT</h1>
          <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "battle" && (
            <FeatureGate feature={FEATURES.ATTACK_ENCOUNTER}>
              <BattleTab />
            </FeatureGate>
          )}
          {tab === "heroes" && (
            <FeatureGate feature={FEATURES.HERO_MINT}>
              <HeroesTab />
            </FeatureGate>
          )}
          {tab === "arena" && <ArenaTab />}
          {tab === "dungeon" && (
            <FeatureGate feature={FEATURES.DUNGEON_ENTER}>
              <DungeonTab />
            </FeatureGate>
          )}
        </div>
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
