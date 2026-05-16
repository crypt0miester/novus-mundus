"use client";

import { useEffect, useState } from "react";
import {
  buildingAllowedWindows,
  currentTimeWindow,
  findBuilding,
  isActivityDoneThisWindow,
  isDailyStateStale,
  nextWindowOpensAt,
  type EstateAccount,
  type TimeWindow,
} from "novus-mundus-sdk";
import { useEstate } from "@/lib/hooks/useEstate";
import { formatTime } from "@/lib/utils";
import { DAILY_ACTIVITIES, type ActivityMeta } from "./meta";
import { DailyActivityPanel } from "./DailyActivityPanel";

type ActivityStatus = "available" | "done" | "later" | "missed" | "unbuilt";

const WINDOW_ORDER: Record<TimeWindow, number> = {
  dawn: 0,
  midday: 1,
  dusk: 2,
  expired: 3,
};
const WINDOW_LABEL: Record<TimeWindow, string> = {
  dawn: "Dawn",
  midday: "Midday",
  dusk: "Dusk",
  expired: "Closed",
};
const WINDOW_GLYPH: Record<TimeWindow, string> = {
  dawn: "☀",
  midday: "◐",
  dusk: "☾",
  expired: "—",
};
/** `windows_completed` bitflags (mirror `daily_activity.rs`). */
const WINDOW_BIT: Record<TimeWindow, number> = {
  dawn: 0b001,
  midday: 0b010,
  dusk: 0b100,
  expired: 0,
};

/** The status of one building's activity right now. */
function activityStatus(
  estate: EstateAccount,
  building: number,
  windows: TimeWindow[],
  now: number,
): ActivityStatus {
  const slot = findBuilding(estate, building);
  if (!slot || (slot.status !== 2 && slot.status !== 3)) return "unbuilt";
  if (windows.length === 0) return "unbuilt";

  const stale = isDailyStateStale(estate, now);
  const done =
    !stale && windows.some((w) => isActivityDoneThisWindow(estate, building, w));
  if (done) return "done";

  const cw = currentTimeWindow(estate, now);
  if (cw === "expired") return "missed";
  if (windows.includes(cw)) return "available";

  const earliest = Math.min(...windows.map((w) => WINDOW_ORDER[w]));
  return WINDOW_ORDER[cw] < earliest ? "later" : "missed";
}

/**
 * The estate-page daily-activity overview — every activity the player can
 * reach, grouped by window, with the current window and a countdown to the
 * next. An available activity opens its panel in a modal.
 */
export function DailyActivityTracker() {
  const { data: estateData } = useEstate();
  const estate = estateData?.account;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [openBuilding, setOpenBuilding] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!estate) return null;

  const cw = currentTimeWindow(estate, now);
  const nextAt = nextWindowOpensAt(estate, now);
  const stale = isDailyStateStale(estate, now);

  const owned = DAILY_ACTIVITIES.map((meta) => {
    const windows = buildingAllowedWindows(meta.building);
    return {
      meta,
      window: windows[0] ?? ("dusk" as TimeWindow),
      status: activityStatus(estate, meta.building, windows, now),
    };
  }).filter((a) => a.status !== "unbuilt");

  if (owned.length === 0) return null;

  const groups = (["dawn", "midday", "dusk"] as TimeWindow[])
    .map((w) => ({ window: w, items: owned.filter((a) => a.window === w) }))
    .filter((g) => g.items.length > 0);

  const doneCount = owned.filter((a) => a.status === "done").length;

  return (
    <>
      <div className="card accent-border">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-text-gold">
            Daily Activities
          </h2>
          <div className="flex items-center gap-3 text-[11px] tabular-nums text-text-muted">
            <span>
              {doneCount}/{owned.length} done
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
        </div>

        <div className="space-y-3">
          {groups.map((g) => {
            const complete =
              !stale && (estate.windowsCompleted & WINDOW_BIT[g.window]) !== 0;
            return (
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
                  {complete && (
                    <span className="text-[10px] font-normal normal-case text-emerald-400">
                      ✦ window complete
                    </span>
                  )}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
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
            );
          })}
        </div>
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
          ? "Play →"
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
