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
import { DAILY_ACTIVITIES, type ActivityMeta } from "./meta";

export type ActivityStatus = "available" | "done" | "later" | "missed" | "unbuilt";

// Local-dev preview: ignore the time-of-day window so any built activity can be
// opened and played regardless of the clock (e.g. the dusk-only Observatory
// star-reading). The on-chain `daily_activity` gate still enforces the window,
// so an out-of-window submit won't claim a reward — this only unblocks
// seeing/playing the game.
export const DEV_WINDOW_BYPASS = process.env.NODE_ENV === "development";

export const WINDOW_ORDER: Record<TimeWindow, number> = {
  dawn: 0,
  midday: 1,
  dusk: 2,
  expired: 3,
};
export const WINDOW_LABEL: Record<TimeWindow, string> = {
  dawn: "Dawn",
  midday: "Midday",
  dusk: "Dusk",
  expired: "Closed",
};
export const WINDOW_GLYPH: Record<TimeWindow, string> = {
  dawn: "☀",
  midday: "◐",
  dusk: "☾",
  expired: "—",
};
/** `windows_completed` bitflags (mirror `daily_activity.rs`). */
export const WINDOW_BIT: Record<TimeWindow, number> = {
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
  const done = !stale && windows.some((w) => isActivityDoneThisWindow(estate, building, w));
  if (done) return "done";

  // Built and not yet done: in local dev, surface it as playable regardless of
  // window so every mini-game is reachable for testing (see DEV_WINDOW_BYPASS).
  if (DEV_WINDOW_BYPASS) return "available";

  const cw = currentTimeWindow(estate, now);
  if (cw === "expired") return "missed";
  if (windows.includes(cw)) return "available";

  const earliest = Math.min(...windows.map((w) => WINDOW_ORDER[w]));
  return WINDOW_ORDER[cw] < earliest ? "later" : "missed";
}

export interface OwnedActivity {
  meta: ActivityMeta;
  window: TimeWindow;
  status: ActivityStatus;
}

export interface ActivityGroup {
  window: TimeWindow;
  /** The whole window's daily reward has been claimed. */
  complete: boolean;
  items: OwnedActivity[];
}

export interface DailyActivitiesState {
  /** Every activity the player owns a built building for. */
  owned: OwnedActivity[];
  /** `owned` split by window, empty windows dropped. */
  groups: ActivityGroup[];
  doneCount: number;
  total: number;
  /** The window open right now. */
  cw: TimeWindow;
  /** Epoch seconds the next window opens, or null when none. */
  nextAt: number | null;
  now: number;
}

/**
 * Shared daily-activity state — every activity the player owns, grouped by
 * window, with progress and the current-window countdown. Drives both the
 * estate-page summary card and the RightPanel list. Returns null until the
 * estate loads, or when the player owns no activity buildings.
 */
export function useDailyActivities(): DailyActivitiesState | null {
  const { data: estateData } = useEstate();
  const estate = estateData?.account ?? null;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!estate) return null;

  const cw = currentTimeWindow(estate, now);
  const nextAt = nextWindowOpensAt(estate, now);
  const stale = isDailyStateStale(estate, now);

  const owned: OwnedActivity[] = DAILY_ACTIVITIES.map((meta) => {
    const windows = buildingAllowedWindows(meta.building);
    return {
      meta,
      window: windows[0] ?? ("dusk" as TimeWindow),
      status: activityStatus(estate, meta.building, windows, now),
    };
  }).filter((a) => a.status !== "unbuilt");

  if (owned.length === 0) return null;

  const groups: ActivityGroup[] = (["dawn", "midday", "dusk"] as TimeWindow[])
    .map((w) => ({
      window: w,
      complete: !stale && (estate.windowsCompleted & WINDOW_BIT[w]) !== 0,
      items: owned.filter((a) => a.window === w),
    }))
    .filter((g) => g.items.length > 0);

  const doneCount = owned.filter((a) => a.status === "done").length;

  return { owned, groups, doneCount, total: owned.length, cw, nextAt, now };
}
