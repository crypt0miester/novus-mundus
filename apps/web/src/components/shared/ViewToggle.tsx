"use client";

import { LayoutGrid, Table } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/hooks/useViewMode";

const OPTIONS = [
  { mode: "grid" as const, icon: LayoutGrid, label: "Grid view" },
  { mode: "table" as const, icon: Table, label: "Table view" },
];

/**
 * Grid/table segmented control. Pair with `useViewMode` to persist the choice.
 * Matches the app's tab styling (`bg-surface` track, gold active pill).
 */
export function ViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        "inline-flex shrink-0 gap-0.5 rounded-lg bg-surface p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ mode: m, icon: Icon, label }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(m)}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              active
                ? "bg-surface-raised text-text-gold"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
