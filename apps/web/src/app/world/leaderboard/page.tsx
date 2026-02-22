"use client";

import { PageTransition } from "@/components/shared/PageTransition";
import { LeaderboardView } from "@/components/world/LeaderboardView";

export default function LeaderboardPage() {
  return (
    <PageTransition>
      <h1 className="tier-title mx-auto mb-6 max-w-5xl font-display text-3xl font-bold tracking-wide">
        LEADERBOARD
      </h1>
      <LeaderboardView />
    </PageTransition>
  );
}
