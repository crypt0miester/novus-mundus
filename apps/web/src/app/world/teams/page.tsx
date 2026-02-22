"use client";

import { PageTransition } from "@/components/shared/PageTransition";
import { TeamBrowser } from "@/components/world/TeamBrowser";

export default function TeamBrowserPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">
          TEAMS
        </h1>
        <TeamBrowser />
      </div>
    </PageTransition>
  );
}
