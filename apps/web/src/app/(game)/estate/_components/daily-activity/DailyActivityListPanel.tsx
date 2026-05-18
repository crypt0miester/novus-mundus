"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { DailyActivityPanel } from "./DailyActivityPanel";
import {
  useDailyActivities,
  WINDOW_GLYPH,
  WINDOW_LABEL,
  type ActivityStatus,
} from "./useDailyActivities";
import type { ActivityMeta } from "./meta";

/**
 * The full daily-activity browser — rendered in the RightPanel via the
 * `daily-activities` content key. Every owned activity grouped by window; an
 * available one opens its mini-game in a centered modal (the panel column is
 * too narrow to play in).
 */
export function DailyActivityListPanel() {
  const state = useDailyActivities();
  const [openBuilding, setOpenBuilding] = useState<number | null>(null);

  if (!state) {
    return <p className="text-xs text-text-muted">No daily activities yet.</p>;
  }
  const { groups, doneCount, total, cw, nextAt, now } = state;

  return (
    <>
      <div className="flex items-center justify-between gap-3 text-[11px] tabular-nums text-text-muted">
        <span>
          {doneCount}/{total} done
        </span>
        {cw === "expired" ? (
          <span>windows closed</span>
        ) : nextAt !== null ? (
          <span>
            {WINDOW_LABEL[cw]} · next in{" "}
            {formatTime(Math.max(0, nextAt - now), "compact")}
          </span>
        ) : (
          <span>{WINDOW_LABEL[cw]}</span>
        )}
      </div>

      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.window}>
            <div
              className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${
                g.window === cw ? "text-text-gold" : "text-text-muted"
              }`}
            >
              <span>{WINDOW_GLYPH[g.window]}</span>
              <span>{WINDOW_LABEL[g.window]}</span>
              {g.window === cw && (
                <span className="text-[10px] font-normal normal-case text-text-muted">
                  · open now
                </span>
              )}
              {g.complete && (
                <span className="text-[10px] font-normal normal-case text-emerald-400">
                  ✦ complete
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {g.items.map((a) => (
                <ActivityRow
                  key={a.meta.building}
                  meta={a.meta}
                  status={a.status}
                  onPlay={() => setOpenBuilding(a.meta.building)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {openBuilding !== null && (
        <ActivityModal
          building={openBuilding}
          onClose={() => setOpenBuilding(null)}
        />
      )}
    </>
  );
}

function ActivityRow({
  meta,
  status,
  onPlay,
}: {
  meta: ActivityMeta;
  status: ActivityStatus;
  onPlay: () => void;
}) {
  const available = status === "available";
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onPlay}
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default ${
        available
          ? "border-amber-700/50 bg-amber-900/10 hover:border-amber-600 hover:bg-amber-900/20"
          : status === "done"
            ? "border-emerald-800/40 bg-emerald-900/10"
            : "border-border-default opacity-70"
      }`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-text-primary">
          {meta.title}
        </div>
        <div className="truncate text-[11px] text-text-muted">{meta.tagline}</div>
      </div>
      <span
        className={`shrink-0 text-[11px] font-semibold ${
          available
            ? "text-text-gold"
            : status === "done"
              ? "text-emerald-400"
              : "text-text-muted"
        }`}
      >
        {status === "available"
          ? (
              <span className="inline-flex items-center gap-0.5">
                Play
                <ChevronRight className="h-3 w-3" />
              </span>
            )
          : status === "done"
            ? "✓ Done"
            : status === "later"
              ? "Later"
              : "Missed"}
      </span>
    </button>
  );
}

function ActivityModal({
  building,
  onClose,
}: {
  building: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border-gold bg-surface-raised p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 text-text-muted transition-colors hover:text-text-primary"
        >
          ✕
        </button>
        <DailyActivityPanel building={building} onClose={onClose} />
      </div>
    </div>
  );
}
