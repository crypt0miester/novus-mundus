"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { TIER_NAMES } from "@/lib/hooks/useTierTheme";

/** Sidebar removed — navigation moved to TopBar. This file exports TierSwitcher for settings. */
export function Sidebar() {
  return null;
}

export function TierSwitcher() {
  const [active, setActive] = useState<number | null>(null);

  function set(tier: number) {
    const next = active === tier ? null : tier;
    setActive(next);
    if (next !== null) {
      document.body.setAttribute("data-tier", String(next));
    } else {
      const real = localStorage.getItem("novus-tier");
      if (real) document.body.setAttribute("data-tier", real);
      else document.body.removeAttribute("data-tier");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Tier Preview
      </div>
      <div className="flex gap-1">
        {TIER_NAMES.map((name, i) => (
          <button
            key={i}
            onClick={() => set(i)}
            className={cn(
              "rounded px-2 py-1 text-xs transition-colors",
              active === i
                ? "bg-surface-overlay tier-accent-text"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {i} {name}
          </button>
        ))}
      </div>
    </div>
  );
}
