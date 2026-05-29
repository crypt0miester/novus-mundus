"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface GameInfoPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function GameInfoPanel({ children, className }: GameInfoPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={cn(
          "group flex items-center gap-2 rounded-lg border border-zinc-800 bg-surface-raised px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300",
          className,
        )}
      >
        <svg className="h-3.5 w-3.5 text-zinc-500" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 3.5zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z"
            fill="currentColor"
          />
        </svg>
        Game Parameters
      </button>
    );
  }

  return (
    <div className={cn("rounded-xl border border-zinc-800 bg-surface-raised p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-zinc-500" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 3.5zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z"
              fill="currentColor"
            />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Game Parameters
          </span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-zinc-500 hover:text-zinc-400"
        >
          Close
        </button>
      </div>
      {children}
    </div>
  );
}
