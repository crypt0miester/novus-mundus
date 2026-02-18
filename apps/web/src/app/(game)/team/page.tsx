"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { TeamTab } from "./_components/team-tab";
import { RallyTab } from "./_components/rally-tab";
import { ReinforceTab } from "./_components/reinforce-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";

const TABS = [
  { key: "team", label: "Team" },
  { key: "rally", label: "Rally" },
  { key: "reinforce", label: "Reinforce" },
];

function TeamContent() {
  const [tab, setTab] = useTabParam("team");

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">TEAM</h1>
        <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        {tab === "team" && (
          <FeatureGate feature={FEATURES.TEAM_CREATE}>
            <TeamTab />
          </FeatureGate>
        )}
        {tab === "rally" && (
          <FeatureGate feature={FEATURES.RALLY_CREATE}>
            <RallyTab />
          </FeatureGate>
        )}
        {tab === "reinforce" && <ReinforceTab />}
      </div>
    </PageTransition>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <TeamContent />
    </Suspense>
  );
}
