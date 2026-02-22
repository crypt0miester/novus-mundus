"use client";

import { PageTransition } from "@/components/shared/PageTransition";
import { RealmOverview } from "@/components/world/RealmOverview";

export default function WorldOverviewPage() {
  return (
    <PageTransition>
      <h1 className="tier-title mx-auto mb-6 max-w-5xl font-display text-3xl font-bold tracking-wide">
        REALM OVERVIEW
      </h1>
      <RealmOverview />
    </PageTransition>
  );
}
