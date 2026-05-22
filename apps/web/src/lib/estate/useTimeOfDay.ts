"use client";

import { useEffect, useState } from "react";
import { getCurrentTimeOfDay, type TimeOfDay } from "novus-mundus-sdk";
import { usePlayer } from "@/lib/hooks/usePlayer";

/**
 * The player's local time-of-day, recomputed each minute. Time-of-day drives
 * every NOVI-consumption multiplier (hiring, collecting), so the activity
 * views read it to forecast yields and flag good/bad windows.
 *
 * `currentLong` is stored ×10000, the same scaling the estate header divides by.
 */
export function useTimeOfDay(): { now: number; tod: TimeOfDay } {
  const { data: playerData } = usePlayer();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  const longitude = (playerData?.account?.currentLong ?? 0) / 10000;
  return { now, tod: getCurrentTimeOfDay(now, longitude) };
}
