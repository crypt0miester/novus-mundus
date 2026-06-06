"use client";

import { PageTransition } from "@/components/shared/PageTransition";
import { PlayerBrowser } from "@/components/world/PlayerBrowser";

export default function PlayerBrowserPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="tier-title font-display text-3xl font-bold tracking-wide">PLAYERS</h1>
        <PlayerBrowser />
      </div>
    </PageTransition>
  );
}
