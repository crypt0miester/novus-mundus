"use client";

import { Hammer } from "lucide-react";

interface BreakGroundSiteProps {
  /** Open the global building picker — the site is a doorway, not a binding. */
  onBreakGround: () => void;
}

/**
 * An empty buildable tile on a claimed parcel. Tapping it opens the global
 * building picker; the chain places the chosen building in the next free slot
 * (see find_empty_slot in estate.rs), so the copy says "choose," not "build
 * here."
 */
export function BreakGroundSite({ onBreakGround }: BreakGroundSiteProps) {
  return (
    <button
      type="button"
      onClick={onBreakGround}
      className="blueprint-site group flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-lg p-3 text-center"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted transition-colors group-hover:text-text-gold">
        <Hammer className="h-3 w-3" aria-hidden /> Break ground
      </span>
      <span className="text-[10px] text-text-muted">choose your next building</span>
    </button>
  );
}
