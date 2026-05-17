"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import { animate, stagger } from "animejs";

interface RevealOptions {
  /** Per-element stagger step, ms. */
  staggerStep?: number;
  /** Delay before the first element, ms. */
  staggerStart?: number;
  /** Pixels each element rises from. */
  translateY?: number;
  /** Per-element animation duration, ms. */
  duration?: number;
}

/**
 * Staggers the `[data-reveal]` descendants of `ref` into view on mount —
 * the Arrival beats' entrance. The markup paints those elements at
 * `opacity-0`; this fades and lifts them to rest.
 *
 * Under `prefers-reduced-motion` the animation is skipped and the elements
 * are forced visible, so the static `opacity-0` never flashes.
 */
export function useRevealOnMount(
  ref: RefObject<HTMLElement | null>,
  options: RevealOptions = {},
): void {
  const {
    staggerStep = 300,
    staggerStart = 0,
    translateY = 12,
    duration = 700,
  } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll<HTMLElement>("[data-reveal]");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((t) => {
        t.style.opacity = "1";
      });
      return;
    }

    animate(targets, {
      opacity: [0, 1],
      y: [translateY, 0],
      delay: stagger(staggerStep, { start: staggerStart }),
      duration,
      ease: "outQuad",
    });
  }, [ref, staggerStep, staggerStart, translateY, duration]);
}
