"use client";

// PresenceDot: a tiny online/offline status dot.
//
// Green (emerald) when the player is online, a muted grey when offline. Sized to
// overlay an avatar corner; the caller positions it (e.g. absolute bottom-right
// inside a relatively-positioned avatar wrapper). Offline can be hidden entirely
// via `hideOffline` so only active players carry a mark.
//
// Motion (online only, per the motion design doc 4.5): two tiers.
//   1. A one-shot spring sonar ring that fires ONLY on the offline-to-online
//      edge (the moment that matters), scoped to a `.sonar` span inside this
//      dot's own wrapper so a roster does not fire every dot at once.
//   2. A perpetual cheap waapi scale/opacity breathe on the dot core. waapi
//      only accelerates transform + opacity, so this stays compositor-safe and
//      survives RPC polling / a busy main thread.
// Offline dots stay plain CSS so a long roster does no idle compositor work.
// Both motion tiers early-return under reduced motion (an instant-but-looping
// breathe is wasted work and still implies motion).

import { useEffect, useRef } from "react";
import { animate, utils, waapi } from "animejs";
import { BLOOM } from "@/lib/motion/tokens";
import { cn, prefersReducedMotion } from "@/lib/utils";

export interface PresenceDotProps {
  online: boolean;
  // dot diameter in CSS px; default suits a 28-44px avatar corner.
  size?: number;
  // when true, render nothing while offline instead of a grey dot.
  hideOffline?: boolean;
  // per-peer phase seed so a roster of dots breathes out of sync rather than
  // pulsing in lockstep like a metronome. Any stable number works (the caller
  // derives one from the peer PDA).
  seed?: number;
  className?: string;
}

export function PresenceDot({
  online,
  size = 10,
  hideOffline = false,
  seed = 0,
  className,
}: PresenceDotProps) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const coreRef = useRef<HTMLSpanElement | null>(null);
  // The perpetual breathe loop, kept so it can be cancelled on unmount AND the
  // instant the dot goes offline (we do not leave a loop running on a dot the
  // user can no longer see breathing).
  const breatheRef = useRef<ReturnType<typeof waapi.animate> | null>(null);
  // Edge guard: true once we have rendered at least one online frame, so the
  // sonar fires on the offline-to-online transition and NOT on the initial
  // mount of an already-online dot.
  const wasOnline = useRef(false);

  useEffect(() => {
    if (!online) {
      // Going offline (or never online): tear the loop down and reset the edge.
      breatheRef.current?.cancel();
      breatheRef.current = null;
      wasOnline.current = false;
      return;
    }

    if (prefersReducedMotion()) {
      // No choreography under reduce: the resting CSS dot is the final state.
      wasOnline.current = true;
      return;
    }

    const core = coreRef.current;
    const wrap = wrapRef.current;

    // Sonar: one-shot spring ring, only on the offline-to-online edge. Scoped
    // to this wrapper's own `.sonar` span so sibling dots stay put (a native
    // scoped query; anime's utils.$ is global and takes a single selector).
    if (!wasOnline.current && wrap) {
      const ring = wrap.querySelector(".sonar");
      if (ring) {
        animate(ring, {
          scale: [0.6, 2.6],
          opacity: [0.55, 0],
          ease: BLOOM,
        });
      }
    }
    wasOnline.current = true;

    // Breathe: perpetual compositor-safe scale/opacity loop on the dot core.
    // A seeded phase jitter (delay + slightly varied period) keeps a roster
    // from pulsing in unison.
    if (core && !breatheRef.current) {
      const rand = utils.createSeededRandom(seed);
      const phase = rand(0, 1100, 0);
      const period = rand(2400, 3000, 0);
      breatheRef.current = waapi.animate(core, {
        scale: [1, 1.18],
        opacity: [1, 0.78],
        duration: period,
        delay: phase,
        ease: "inOutSine",
        loop: true,
        alternate: true,
      });
    }

    return () => {
      breatheRef.current?.cancel();
      breatheRef.current = null;
    };
  }, [online, seed]);

  if (!online && hideOffline) return null;

  // Offline: a single plain CSS span, no refs, no compositor work.
  if (!online) {
    return (
      <span
        role="img"
        aria-label="Offline"
        title="Offline"
        style={{ width: size, height: size }}
        className={cn(
          "inline-block rounded-full bg-text-muted/50 ring-2 ring-surface",
          className,
        )}
      />
    );
  }

  // Online: a wrapper holding the breathing core and a one-shot sonar ring.
  return (
    <span
      ref={wrapRef}
      role="img"
      aria-label="Online"
      title="Online"
      style={{ width: size, height: size }}
      className={cn("relative inline-block", className)}
    >
      <span
        ref={coreRef}
        aria-hidden
        className="absolute inset-0 rounded-full bg-emerald-400 ring-2 ring-surface"
      />
      <span
        aria-hidden
        className="sonar pointer-events-none absolute inset-0 rounded-full bg-emerald-400 opacity-0"
      />
    </span>
  );
}
