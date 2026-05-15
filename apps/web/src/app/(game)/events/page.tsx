"use client";

import { Suspense } from "react";
import { useTabParam } from "@/lib/hooks/useTabParam";
import { TabNav } from "@/components/shared/TabNav";
import { PageTransition } from "@/components/shared/PageTransition";
import { EventsTab } from "./_components/events-tab";
import { HistoryTab } from "./_components/history-tab";

const TABS = [
  { key: "active", label: "Active" },
  { key: "history", label: "History" },
];

function EventsContent() {
  const [tab, setTab] = useTabParam("active");

  return (
    <PageTransition>
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="tier-title font-display text-xl font-bold tracking-wide sm:text-2xl">EVENTS</h1>
          <TabNav tabs={TABS} activeTab={tab} onTabChange={setTab} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "active" && <EventsTab />}
          {tab === "history" && <HistoryTab />}
        </div>
      </div>
    </PageTransition>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-text-muted">Loading...</div>}>
      <EventsContent />
    </Suspense>
  );
}
