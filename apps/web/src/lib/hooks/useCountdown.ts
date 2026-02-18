"use client";

import { useState, useEffect } from "react";

interface CountdownResult {
  remaining: number; // seconds
  pct: number;       // 0-100 progress
  done: boolean;
  formatted: string;
}

export function useCountdown(
  endsAt: number | null | undefined,
  startedAt?: number | null
): CountdownResult {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!endsAt) return;

    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      setRemaining(Math.max(0, endsAt - now));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  const total = endsAt && startedAt ? endsAt - startedAt : 0;
  const elapsed = total - remaining;
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;

  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  let formatted: string;
  if (d > 0) formatted = `${d}d ${h}h`;
  else if (h > 0) formatted = `${h}h ${m}m`;
  else formatted = `${m}m ${s}s`;

  return {
    remaining,
    pct,
    done: remaining === 0 && !!endsAt,
    formatted,
  };
}
