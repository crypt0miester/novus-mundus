"use client";

import { PageTransition } from "@/components/shared/PageTransition";
import { CityBrowser } from "@/components/world/CityBrowser";

export default function CityBrowserPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">CITIES</h1>
        <CityBrowser />
      </div>
    </PageTransition>
  );
}
