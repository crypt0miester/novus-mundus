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
}

export function TabNav({ tabs, activeTab, onTabChange }: TabNavProps) {
  return (
    <div className="-mx-4 flex overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex gap-1 rounded-lg bg-surface p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? "bg-surface-raised text-text-gold"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.label}
            {tab.badge && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
