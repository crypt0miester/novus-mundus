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
import { TeamBrowser } from "@/components/world/TeamBrowser";

const TABS = [
  { key: "team", label: "Team" },
  { key: "rally", label: "Rally" },
  { key: "reinforce", label: "Reinforce" },
  { key: "browse", label: "Browse" },
];

function TeamContent() {
  const [tab, setTab] = useTabParam("team");

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">TEAM</h1>
          <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
          {tab === "browse" && <TeamBrowser />}
        </div>
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
