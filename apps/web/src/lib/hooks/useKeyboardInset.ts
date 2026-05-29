"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Height in CSS px the on-screen keyboard currently occludes from the bottom of
 * the layout viewport. 0 when the keyboard is closed, on the server, or when the
 * browser has no visualViewport.
 *
 * iOS Safari: opening the keyboard does NOT resize the layout viewport. It
 * shrinks the visual viewport (and offsets it when the page scrolls under the
 * keyboard), while position:fixed stays pinned to the unchanged layout viewport,
 * so a bottom-fixed bar hides behind the keyboard. This recovers the occluded
 * height so callers can lift the bar:
 *
 *   kb = max(0, layoutViewportHeight - visualViewport.height - visualViewport.offsetTop)
 *
 * Android Chrome: usually resizes the layout viewport, so this yields ~0 (the
 * fixed bar is already lifted by the layout shrink). Both platforms converge on
 * "how far must I lift the bar."
 *
 * The result is clamped to [0, 60% of the layout height]: the iOS layout-vs-
 * visual reference frames can disagree by the URL-bar height across Safari
 * versions, and the clamp prevents a bad measurement from pushing the bar off
 * the top of the screen. This is a Phase-2 piece that needs real-device tuning.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  // rAF handle so resize+scroll bursts collapse to one measurement per frame.
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const measure = () => {
      rafRef.current = null;
      // documentElement.clientHeight tracks the layout viewport, which on iOS
      // stays fixed while the keyboard is up: the reference the visual viewport
      // shrinks against.
      const layoutH = document.documentElement.clientHeight;
      const raw = layoutH - vv.height - vv.offsetTop;
      const clamped = Math.max(0, Math.min(raw, layoutH * 0.6));
      // Round to whole px so sub-pixel jitter doesn't thrash the transform/padding.
      const next = Math.round(clamped);
      setInset((prev) => (prev === next ? prev : next));
    };

    const schedule = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(measure);
    };

    measure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return inset;
}
