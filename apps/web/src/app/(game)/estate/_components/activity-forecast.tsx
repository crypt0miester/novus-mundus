"use client";

import type { ReactNode } from "react";
import {
  type ActivityType,
  TimeOfDay,
  getActivityMultiplierBps,
  getTimeOfDayName,
} from "novus-mundus-sdk";
import { useTimeOfDay } from "@/lib/estate/useTimeOfDay";
import { cn } from "@/lib/utils";

const ALL_TOD: TimeOfDay[] = [
  TimeOfDay.DeepNight,
  TimeOfDay.Dawn,
  TimeOfDay.Morning,
  TimeOfDay.Midday,
  TimeOfDay.Afternoon,
  TimeOfDay.Dusk,
  TimeOfDay.Evening,
];

const mult = (bps: number) => `×${(bps / 10000).toFixed(2)}`;

interface ActivityForecastProps {
  /** The on-chain activity whose time-of-day multiplier applies. */
  activity: ActivityType;
  /** What the activity is, for the strip's label — e.g. "Consuming NOVI". */
  verb: string;
  /** Optional yield-preview line, rendered under the time signal. */
  children?: ReactNode;
}

/**
 * The time-of-day signal for a NOVI-consumption activity: where the multiplier
 * sits right now, and — when the player is in a penalised window — when it
 * peaks. Optionally frames a view-specific yield preview underneath.
 */
export function ActivityForecast({ activity, verb, children }: ActivityForecastProps) {
  const { tod } = useTimeOfDay();
  const nowBps = getActivityMultiplierBps(activity, tod);

  let bestTod = tod;
  let bestBps = nowBps;
  for (const t of ALL_TOD) {
    const b = getActivityMultiplierBps(activity, t);
    if (b > bestBps) {
      bestBps = b;
      bestTod = t;
    }
  }

  const good = nowBps > 10000;
  const bad = nowBps < 10000;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        good
          ? "border-emerald-800/50 bg-emerald-900/15"
          : bad
            ? "border-border-gold/50 bg-accent/15"
            : "border-border-default bg-surface-overlay/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-secondary">
          {verb} {">"} <span className="text-text-muted">{getTimeOfDayName(tod)}</span>
        </span>
        <span
          className={cn(
            "font-mono font-semibold tabular-nums",
            good ? "text-emerald-400" : bad ? "text-danger" : "text-text-muted",
          )}
        >
          {mult(nowBps)}
        </span>
      </div>
      {bad && bestBps > nowBps && (
        <div className="mt-0.5 text-[11px] text-text-muted">
          Peaks at {getTimeOfDayName(bestTod)} ({mult(bestBps)}).
        </div>
      )}
      {children && (
        <div className="mt-1.5 border-t border-border-default/60 pt-1.5 text-text-secondary">
          {children}
        </div>
      )}
    </div>
  );
}
