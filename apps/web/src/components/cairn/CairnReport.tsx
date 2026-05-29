"use client";

import { useState } from "react";
import { useCairnReport } from "@/lib/hooks/useCairnReport";
import { cairnReport } from "@/lib/narrative";
import { BUILDING_FEATURE_MAP } from "@/lib/config/building-features";

function buildingNames(types: number[]): string[] {
  return types.map((t) => BUILDING_FEATURE_MAP.get(t)?.name ?? "a building");
}

/**
 * The Cairn's Report — what moved while you were away. Shown on the estate on
 * return; renders nothing when there is no news. PLAYER_JOURNEY_GAMEPLAN.md §8.
 */
export function CairnReport() {
  const report = useCairnReport();
  const [dismissed, setDismissed] = useState(false);

  if (!report || dismissed) return null;

  const lines: string[] = [];
  if (report.buildingsRisen.length > 0) {
    lines.push(cairnReport.buildingsRose(buildingNames(report.buildingsRisen)));
  }
  if (report.buildingsImproved.length > 0) {
    lines.push(cairnReport.buildingsImproved(buildingNames(report.buildingsImproved)));
  }
  if (report.attacked > 0) lines.push(cairnReport.attacked(report.attacked));
  if (report.protectionEnded) lines.push(cairnReport.protectionEnded());
  if (report.joinedHouse) lines.push(cairnReport.joinedHouse());
  if (report.unitsGained > 0) {
    lines.push(cairnReport.unitsGained(report.unitsGained));
  }
  if (report.streakGained > 0) {
    lines.push(cairnReport.streakGained(report.streakGained));
  }

  if (lines.length === 0) return null;

  return (
    <div className="card relative border-l-2 border-l-[var(--nm-accent)] animate-in fade-in duration-300">
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-xs text-text-muted transition-colors hover:text-text-secondary"
      >
        ✕
      </button>
      <p className="mb-3 pr-6 font-display text-sm font-semibold tracking-wide text-text-gold">
        {cairnReport.opener()}
      </p>
      <ul className="space-y-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
            <span className="select-none text-text-muted">—</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
