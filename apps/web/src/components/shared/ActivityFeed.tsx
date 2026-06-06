"use client";

import { useState, useEffect } from "react";
import { useEventStore, type EventEntry } from "@/lib/store/events";
import { formatEventMessage } from "@/lib/events/format";
import type { EventScope } from "@/lib/events/classify";
import { relativeTime } from "@/lib/utils";

const TABS: { scope: EventScope; label: string }[] = [
  { scope: "personal", label: "My Activity" },
  { scope: "team", label: "Team" },
  { scope: "city", label: "City" },
];

function EventRow({ entry }: { entry: EventEntry }) {
  const formatted = formatEventMessage({ name: entry.name, data: entry.event } as any);
  const title = formatted?.title ?? entry.name;
  const message = formatted?.message;
  const sig = entry.txSignature;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-3 py-2 ${!entry.read ? "bg-surface-raised/50" : ""}`}
    >
      <div
        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: !entry.read ? "#d4a843" : "transparent",
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{title}</span>
          <span className="shrink-0 text-[11px] text-text-muted">
            {relativeTime(entry.timestamp)}
          </span>
        </div>
        {message && <p className="mt-0.5 text-xs text-text-secondary truncate">{message}</p>}
        <a
          href={`https://solscan.io/tx/${sig}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 text-[10px] text-text-muted hover:text-text-gold transition-colors"
        >
          {sig.slice(0, 8)}...
        </a>
      </div>
    </div>
  );
}

export function ActivityFeed() {
  const [activeTab, setActiveTab] = useState<EventScope>("personal");
  const events = useEventStore((s) => s.events);
  const loaded = useEventStore((s) => s.loaded);
  const getUnreadCount = useEventStore((s) => s.getUnreadCount);
  const markRead = useEventStore((s) => s.markRead);
  const init = useEventStore((s) => s.init);

  useEffect(() => {
    if (!loaded) init();
  }, [loaded, init]);

  // Mark events as read when switching to a tab
  useEffect(() => {
    if (loaded && getUnreadCount(activeTab) > 0) {
      markRead(activeTab);
    }
  }, [activeTab, loaded, events.length, getUnreadCount, markRead]);

  const filtered = events.filter((e) => e.scopes.includes(activeTab));

  return (
    <div className="card">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
        Activity Feed
      </h3>

      {/* Tabs */}
      <div className="mb-3 flex gap-1 rounded-lg bg-surface-sunken p-1">
        {TABS.map(({ scope, label }) => {
          const unread = getUnreadCount(scope);
          const isActive = activeTab === scope;
          return (
            <button
              key={scope}
              onClick={() => setActiveTab(scope)}
              className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? "bg-surface-raised text-text-gold shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {label}
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Event List */}
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {!loaded && <p className="py-4 text-center text-xs text-text-muted">Loading...</p>}
        {loaded && filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-text-muted">No events yet</p>
        )}
        {filtered.slice(0, 50).map((entry) => (
          <EventRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
