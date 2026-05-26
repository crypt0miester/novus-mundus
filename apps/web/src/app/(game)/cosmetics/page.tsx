"use client";

import { Suspense } from "react";
import { PageTransition } from "@/components/shared/PageTransition";
import { WardrobeTab } from "./_components/wardrobe-tab";

function CosmeticsContent() {
  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">
            WARDROBE
          </h1>
        </div>
        <div className="min-h-0 flex-1 overflow-x-clip overflow-y-auto">
          <WardrobeTab />
        </div>
      </div>
    </PageTransition>
  );
}

export default function CosmeticsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-text-muted">
          Loading...
        </div>
      }
    >
      <CosmeticsContent />
    </Suspense>
  );
}
