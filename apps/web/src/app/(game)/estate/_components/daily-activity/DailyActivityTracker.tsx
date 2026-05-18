"use client";

import { useRightPanelStore } from "@/lib/store/right-panel";
import { ChevronRight } from "lucide-react";
import { formatTime } from "@/lib/utils";
import {
  useDailyActivities,
  WINDOW_GLYPH,
  WINDOW_LABEL,
  type ActivityStatus,
} from "./useDailyActivities";

/** Dot colour per activity status — the at-a-glance progress strip. */
const DOT_TONE: Record<ActivityStatus, string> = {
  available: "bg-amber-400",
  done: "bg-emerald-400",
  later: "bg-border-default",
  missed: "bg-border-default",
  unbuilt: "bg-border-default",
};

/**
 * The estate-page daily-activity summary — a compact card showing progress and
 * the current window at a glance. Tapping it opens the full grouped list in
 * the RightPanel (`daily-activities`), which is where activities are played.
 */
export function DailyActivityTracker() {
  const state = useDailyActivities();
  const show = useRightPanelStore((s) => s.show);

  if (!state) return null;
  const { owned, doneCount, total, cw, nextAt, now } = state;

  /** At least one activity is playable right now — surface a notification dot. */
  const hasActionable = owned.some((a) => a.status === "available");

  return (
    <button
      type="button"
      onClick={() => show("Daily Activities", "daily-activities")}
      className="card accent-border w-full text-left transition-colors hover:border-amber-700/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-text-gold">
            Daily Activities
          </h2>
          {hasActionable && (
            <span
              className="relative flex h-2.5 w-2.5"
              aria-label="activity available to play"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
          )}
        </div>
        <span className="text-[11px] tabular-nums text-text-muted">
          {doneCount}/{total} done
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {owned.map((a) => (
            <span
              key={a.meta.building}
              className={`h-2 w-2 rounded-full ${DOT_TONE[a.status]} ${
                a.status === "available" ? "ring-1 ring-amber-400/50" : ""
              }`}
            />
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-text-muted">
          <span>
            {cw === "expired"
              ? "windows closed"
              : nextAt !== null
                ? `${WINDOW_GLYPH[cw]} ${WINDOW_LABEL[cw]} · next in ${formatTime(
                    Math.max(0, nextAt - now),
                    "compact",
                  )}`
                : `${WINDOW_GLYPH[cw]} ${WINDOW_LABEL[cw]}`}
          </span>
          <span className="inline-flex items-center gap-0.5 font-semibold text-text-gold">tap<ChevronRight className="h-3 w-3" /></span>
        </span>
      </div>
    </button>
  );
}
