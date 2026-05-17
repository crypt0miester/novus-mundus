"use client";

import { useEffect, useState } from "react";

/**
 * A 1-second ticking clock in epoch seconds.
 *
 * Time-derived state (countdowns, "has arrived", progress %) needs a re-render
 * each second or it freezes until something else refetches. Pass `active`
 * false to hold the clock still so idle screens don't re-render every second.
 */
export function useNow(active = true): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);

  return now;
}
