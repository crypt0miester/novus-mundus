"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseHoldChargeOptions {
  /** Highest count a hold can charge to. A hold degrades to a 1-shot when <= 1. */
  max: number;
  /** Fires once on release, with the charged count (always >= 1). */
  onFire: (count: number) => void;
  /** Milliseconds between each +1 while held. */
  stepMs?: number;
}

export interface HoldCharge {
  /** Live count while held (1..max); 0 when idle. */
  count: number;
  /** Pointer handlers to spread onto the button element. */
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

/**
 * Press-and-hold "charge" counter. Holding a button ramps a count from 1 up to
 * `max` — one tick per `stepMs` — and releasing fires `onFire(count)` once. A
 * plain tap releases at 1, so a hold-enabled button still behaves normally when
 * tapped.
 *
 * The button captures the pointer on press, so a release anywhere still fires;
 * a `pointercancel` (the OS stealing the gesture) aborts without firing.
 */
export function useHoldCharge({
  max,
  onFire,
  stepMs = 180,
}: UseHoldChargeOptions): HoldCharge {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs so the running interval / handlers never close over stale values.
  const maxRef = useRef(max);
  maxRef.current = max;
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  const countRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Clear a dangling interval if the button unmounts mid-hold.
  useEffect(() => stop, [stop]);

  const set = useCallback((n: number) => {
    countRef.current = n;
    setCount(n);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (timerRef.current) return; // already charging
      e.currentTarget.setPointerCapture?.(e.pointerId);
      set(1);
      timerRef.current = setInterval(() => {
        const ceiling = Math.max(1, maxRef.current);
        const next = Math.min(countRef.current + 1, ceiling);
        if (next !== countRef.current) set(next);
      }, stepMs);
    },
    [set, stepMs],
  );

  const onPointerUp = useCallback(() => {
    if (!timerRef.current && countRef.current === 0) return;
    stop();
    const fired = Math.max(1, countRef.current);
    set(0);
    onFireRef.current(fired);
  }, [stop, set]);

  const onPointerCancel = useCallback(() => {
    stop();
    set(0);
  }, [stop, set]);

  return { count, bind: { onPointerDown, onPointerUp, onPointerCancel } };
}
