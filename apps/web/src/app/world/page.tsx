"use client";

import { PageTransition } from "@/components/shared/PageTransition";
import { RealmMap } from "@/components/world/RealmMap";

export default function WorldOverviewPage() {
  return (
    <PageTransition>
      <RealmMap />
    </PageTransition>
  );
}
