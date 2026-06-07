"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

// The active-square glide (left-sidebar-nav doc 9): a single absolutely
// positioned element behind the rail icons that slides to whichever icon is
// active, rather than each icon drawing its own square. Sliding one element
// reads as the highlight moving, not popping, when the route changes.
//
// The hook owns:
//   - a ref for the scroll container (the rail <nav>),
//   - a ref for the glider element,
//   - measuring the active icon (tagged data-rail-active="true") relative to the
//     container and tweening the glider's top + height to it (~180ms),
//   - hiding the glider when no icon is active (a route the rail does not own).
//
// The first placement is instant (no entrance slide from 0); subsequent moves
// tween. Reduced motion snaps every move. We re-measure on layout changes that
// move icons (collapse, resource-chip show/hide) via a ResizeObserver on the
// container, so the glider tracks the active icon even when the rail reflows.
export interface RailGlider {
  navRef: React.RefObject<HTMLElement | null>;
  gliderRef: React.RefObject<HTMLSpanElement | null>;
  // Whether an active icon currently exists (drives the glider's mount/opacity).
  visible: boolean;
}

const GLIDE_MS = 180;

export function useRailGlider(deps: unknown[]): RailGlider {
  const navRef = useRef<HTMLElement | null>(null);
  const gliderRef = useRef<HTMLSpanElement | null>(null);
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);
  // First placement after the glider appears is a snap (no slide in from the top
  // edge); only later route changes tween between icons.
  const placed = useRef(false);

  const remeasure = useCallback(() => {
    const nav = navRef.current;
    const glider = gliderRef.current;
    if (!nav || !glider) return;
    const active = nav.querySelector<HTMLElement>('[data-rail-active="true"]');
    if (!active) {
      setVisible(false);
      placed.current = false;
      return;
    }
    setVisible(true);
    // offsetTop is relative to the nearest positioned ancestor; the nav is
    // `relative`, so the active button's offsetTop is its position within it.
    const top = active.offsetTop;
    const height = active.offsetHeight;
    if (reduce || !placed.current) {
      glider.style.transform = `translateY(${top}px)`;
      glider.style.height = `${height}px`;
      placed.current = true;
      return;
    }
    animate(glider, {
      translateY: top,
      height,
      duration: GLIDE_MS,
      ease: "outQuad",
    });
  }, [reduce]);

  // Re-measure on every relevant change (route + the caller's deps) and whenever
  // the rail reflows (collapse toggles the chips, which shifts the foot icons).
  // useLayoutEffect so the measure runs against the committed layout, pre-paint.
  // `deps` is the caller's intent-list (pathname, drawer mode); remeasure is
  // stable across renders.
  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, ...deps]);

  // Own the ResizeObserver separately so it is not torn down and recreated on
  // every route / drawer-mode change (it only needs the stable nav node).
  // `remeasure` changes only when reduced-motion flips, so this re-subscribes
  // approximately never.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(nav);
    return () => ro.disconnect();
  }, [remeasure]);

  return { navRef, gliderRef, visible };
}
