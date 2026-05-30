"use client";

import { engine } from "animejs";
import { useEffect } from "react";

// The engine conductor. One root-level effect that reactively drives the shared
// anime.js clock from the OS reduced-motion preference: near-freeze the whole
// library on reduce, full speed otherwise. This retroactively covers every
// animate()/timeline that forgot its own reduced-motion guard, with no per-file
// edits.
//
// Load-bearing: engine.speed scales the ENTIRE library, so any chain-truth
// countdown must read wall-clock time (see lib/motion/countdownClock.ts), never
// anime-scaled time, or it lies about remaining chain time while we are slowed.
// engine.pauseOnDocumentHidden is already the default true; we do NOT hand-roll
// a visibilitychange listener.
export function MotionEngineProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      engine.speed = mq.matches ? 0.001 : 1;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      // Leave the engine at full speed when the conductor unmounts so a later
      // remount (or a non-game route) is never stuck near-frozen.
      engine.speed = 1;
    };
  }, []);

  return <>{children}</>;
}
