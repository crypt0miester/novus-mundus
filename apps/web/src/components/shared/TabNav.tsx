"use client";

import { cn } from "@/lib/utils";

interface Tab {
  key: string;
  label: string;
  badge?: boolean;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  size?: "default" | "compact";
}

export function TabNav({ tabs, activeTab, onTabChange, size = "default" }: TabNavProps) {
  const isCompact = size === "compact";

  return (
    <div
      className={cn(
        "flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-surface p-1",
        isCompact && "border-zinc-800/50"
      )}

    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            "flex-shrink-0 rounded-md font-semibold transition-all",
            isCompact ? "px-3 py-1.5 text-xs" : "flex-1 px-4 py-2 text-sm",
            activeTab === tab.key
              ? "bg-surface-raised text-text-gold shadow-sm"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          {tab.label}
          {tab.badge && (
            <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
          )}
        </button>
      ))}
    </div>
  );
}
