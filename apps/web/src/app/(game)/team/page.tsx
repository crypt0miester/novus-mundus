"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { TeamTab } from "./_components/team-tab";
import { FeatureGate } from "@/components/shared/FeatureGate";
import { FEATURES } from "@/lib/hooks/useFeatureGate";
import { TeamBrowser } from "@/components/world/TeamBrowser";

// Rally + Reinforce moved to /map (Forces tab + EntityPanel composers).
// /team is now identity/admin only.
const TABS = [
  { key: "team", label: "Team" },
  { key: "browse", label: "Browse" },
];

function TeamContent() {
  const [tab, setTab] = useTabParam("team");
  const router = useRouter();

  // Redirect old deep-links (?tab=rally|reinforce) to /map (Forces tab).
  // Done in an effect rather than at render so we don't fight React's
  // tab state — useEffect runs once after the initial render.
  useEffect(() => {
    if (tab === "rally" || tab === "reinforce") {
      router.replace("/map?tab=forces");
    }
  }, [tab, router]);

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
