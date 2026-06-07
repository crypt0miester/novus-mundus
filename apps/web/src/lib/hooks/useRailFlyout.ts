"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Positions a small panel to the RIGHT of a rail anchor (the icon rail sits on
// the left edge, so its tooltips and children flyouts grow inward toward the
// content). The panel is portaled to <body> so the rail's overflow-hidden cannot
// clip it. Open is driven by the caller (hover/focus on the rail icon); we own
// placement, Escape-to-close, and re-measure on scroll/resize.
//
// Distinct from useAnchoredPopover (which opens BELOW a click-toggled trigger):
// the rail wants a hover/focus tooltip + flyout that opens beside the icon.
export interface RailFlyout {
  anchorRef: React.RefObject<HTMLElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  // null until measured; render the panel hidden until then.
  pos: { top: number; left: number } | null;
}

export function useRailFlyout(open: boolean, onClose: () => void): RailFlyout {
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // Escape dismisses the flyout (the doc's keyboard requirement). Outside-click
  // is not wired: a rail flyout is hover/focus driven and closes on leave/blur,
  // so it has no sticky open state to trap a click.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!a || !p) return;
      const margin = 8;
      const gap = 8;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      // To the right of the anchor, vertically centred on it, clamped so a
      // tall children flyout never runs off the top or bottom of the viewport.
      let top = a.top + a.height / 2 - p.height / 2;
      if (top + p.height > vh - margin) top = vh - margin - p.height;
      if (top < margin) top = margin;
      let left = a.right + gap;
      if (left + p.width > vw - margin) left = Math.max(margin, a.left - gap - p.width);
      setPos({ top, left });
    };
    // Coalesce the scroll/resize re-measures to one per frame: a capture-phase
    // scroll listener fires for every scrolling ancestor, and place() does two
    // layout reads, so an un-throttled measure would thrash on the scroll path.
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [open]);

  return { anchorRef, panelRef, pos };
}
