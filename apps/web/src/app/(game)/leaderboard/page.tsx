"use client";

import { Suspense } from "react";
import { PageTransition } from "@/components/shared/PageTransition";
import { LeaderboardView } from "@/components/world/LeaderboardView";

function LeaderboardContent() {
  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
          LEADERBOARD
        </h1>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LeaderboardView />
        </div>
      </div>
    </PageTransition>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
          Loading...
        </div>
      }
    >
      <LeaderboardContent />
    </Suspense>
  );
}
