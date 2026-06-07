"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { clampWidth, WIDTH_MAX, WIDTH_MIN, CLAMP_VW_FRACTION } from "@/lib/store/sidebar";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { PRESS } from "@/lib/motion/tokens";

// Direction the column sits relative to the pointer.
//   - "right" edge (the drawer's inner edge): the column starts at the icon rail,
//     so its width is the pointer's distance from the rail's right edge.
//   - "left" edge (the RightPanel's inner edge): the column ends at the viewport
//     right, so its width is the distance from the pointer to that edge.
export type ResizeEdge = "left" | "right";

// The x the drawer's resize handle is anchored to (the rail edge + the gutter the
// grabber sits in). Must match the handle's `left` offset (4.5rem in
// DrawerResizeHandle) so the grabber tracks the pointer with no jump on grab.
const RAIL_PX = 72;

export interface UseResizableOptions {
  // Which edge the handle sits on.
  edge: ResizeEdge;
  // The CSS custom property the live width is written to during a drag, on <html>
  // (the same element the committed value is mirrored to, so it is never shadowed
  // by a nearer inline var).
  cssVar: string;
  // The committed (persisted) width; keyboard nudges step off it and a collapsed
  // tap reopens to it.
  width: number;
  // The column's default, for double-click / Home reset.
  defaultWidth: number;
  // Commit the final width to the store (passed the live viewport width to clamp).
  commit: (px: number, viewportWidth: number) => void;
  // Reset the column to its default (double-click / Home).
  reset: () => void;
  // Whether the column is currently open. When false, a press/drag on the handle
  // reopens it (onExpand) and resizes from the rail edge. Defaults to true.
  open?: boolean;
  // Reopen the column (used when a collapsed handle is pressed/dragged).
  onExpand?: () => void;
  // Collapse the column when an open-resize is dragged past the min width and
  // released there. Without it, the drag just clamps at WIDTH_MIN.
  onCollapse?: () => void;
  // Element id whose content gets `data-closing` while the column is below the min
  // width, so it can drop its opacity (closing toward the min, or still hidden
  // while reopening up to it). The handle stays full opacity (it lives outside).
  closeDimId?: string;
}

export interface Resizable {
  // True while a pointer drag is in flight (for the handle's drag accent).
  dragging: boolean;
  // Spread onto the handle element.
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onDoubleClick: () => void;
  };
}

// Keyboard nudge steps (doc 6.3): a tap nudges 16px, Shift nudges 48px.
const NUDGE = 16;
const NUDGE_SHIFT = 48;
// Pointer travel under this stays a tap (a collapsed-handle tap just reopens).
const TAP_PX = 6;

const vw = () => (typeof window === "undefined" ? 0 : window.innerWidth);
const vwMax = (viewportWidth: number) =>
  Math.min(WIDTH_MAX, Math.floor(viewportWidth * CLAMP_VW_FRACTION));

// The width implied by the pointer's x for this edge, against a viewport snapshot.
function widthAt(edge: ResizeEdge, clientX: number, viewportWidth: number): number {
  return edge === "right" ? clientX - RAIL_PX : viewportWidth - clientX;
}

// Write the live width to the shell's CSS var (on <html>).
function writeVar(cssVar: string, px: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(cssVar, `${px}px`);
}

// Suppress the column's width transition while the width is driven imperatively.
function setResizing(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.resizing = "";
  else delete document.documentElement.dataset.resizing;
}

// Mark/unmark the column's content as "below the min width" so it can fade its
// opacity (see globals.css). Used both for the close zone and while reopening.
function setDimClosing(id: string | undefined, on: boolean) {
  if (!id || typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  if (on) el.setAttribute("data-closing", "");
  else el.removeAttribute("data-closing");
}

export function useResizable({
  edge,
  cssVar,
  width,
  defaultWidth,
  commit,
  reset,
  open,
  onExpand,
  onCollapse,
  closeDimId,
}: UseResizableOptions): Resizable {
  const [dragging, setDragging] = useState(false);
  const reduce = useReducedMotion();

  // Refs so the move/up listeners never close over stale values.
  const widthRef = useRef(width);
  widthRef.current = width;
  const openRef = useRef(open !== false);
  openRef.current = open !== false;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const resetRef = useRef(reset);
  resetRef.current = reset;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const onExpandRef = useRef(onExpand);
  onExpandRef.current = onExpand;
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;
  const closeDimIdRef = useRef(closeDimId);
  closeDimIdRef.current = closeDimId;

  // Per-gesture scratch.
  const liveRef = useRef(width);
  const startedOpenRef = useRef(true);
  const movedRef = useRef(false);
  const expandedRef = useRef(false);
  const closeOnReleaseRef = useRef(false);
  // The teardown for the in-flight gesture, so an unmount mid-drag still removes
  // the window listeners and clears the flags (the listeners are imperative, not
  // React-owned, so they would otherwise leak).
  const gestureCleanupRef = useRef<(() => void) | null>(null);

  // The in-flight settle/nudge/reset tween, so a new one cancels the last.
  const animRef = useRef<ReturnType<typeof animate> | null>(null);

  // Tween the CSS var from its current value to `to` (anime.js), then commit.
  // Used by the keyboard nudge and the reset so both settle with the app's
  // material (PRESS) instead of snapping; reduced motion writes straight through.
  const settleTo = useCallback(
    (to: number, onDone: (px: number) => void) => {
      const from = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(cssVar),
      );
      const start = Number.isFinite(from) ? from : widthRef.current;
      animRef.current?.pause();
      if (reduceRef.current) {
        writeVar(cssVar, to);
        onDone(to);
        return;
      }
      setResizing(true);
      const proxy = { w: start };
      animRef.current = animate(proxy, {
        w: to,
        ease: PRESS,
        onUpdate: () => writeVar(cssVar, Math.round(proxy.w)),
        onComplete: () => {
          setResizing(false);
          onDone(Math.round(proxy.w));
        },
      });
    },
    [cssVar],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      animRef.current?.pause();

      startedOpenRef.current = openRef.current;
      movedRef.current = false;
      expandedRef.current = false;
      closeOnReleaseRef.current = false;
      liveRef.current = widthRef.current;
      const startX = e.clientX;
      // Snapshot the viewport once per gesture: innerWidth can't change during a
      // pointer drag, so reading it per-move would force a layout flush each frame
      // (every move also writes --drawer-w, so a per-move read is a write→read thrash).
      const gestureVw = vw();

      setDragging(true);
      document.body.style.userSelect = "none";
      setResizing(true);

      // Listen on window (not the handle) so the release always lands even if the
      // handle re-renders or unmounts mid-gesture (the bug where a drag "stuck"
      // because pointerup was missed on a re-rendered handle).
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.style.userSelect = "";
        setResizing(false);
        setDimClosing(closeDimIdRef.current, false);
        setDragging(false);
        gestureCleanupRef.current = null;
      };
      gestureCleanupRef.current = cleanup;

      const onMove = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > TAP_PX) movedRef.current = true;
        // A collapsed column opens only once a drag actually starts (a click
        // alone never opens it); until the threshold is crossed there is nothing
        // to size, so leave it collapsed.
        if (!startedOpenRef.current && !expandedRef.current) {
          if (!movedRef.current) return;
          onExpandRef.current?.();
          expandedRef.current = true;
        }
        // The column tracks the pointer 1:1, un-floored below the min so it keeps
        // shrinking toward the rail instead of freezing at the min; only the
        // upper bound (vwMax) clamps. Content fades out below the min (the
        // release-to-close tell when shrinking, and the still-hidden phase while
        // reopening until it crosses back over).
        const w = Math.max(0, Math.min(widthAt(edge, ev.clientX, gestureVw), vwMax(gestureVw)));
        liveRef.current = w;
        writeVar(cssVar, w);
        const belowMin = w < WIDTH_MIN;
        setDimClosing(closeDimIdRef.current, belowMin);
        // An open column dragged below the min collapses on release (never mid-drag).
        closeOnReleaseRef.current = startedOpenRef.current && !!onCollapseRef.current && belowMin;
      };

      const onUp = () => {
        cleanup();
        if (closeOnReleaseRef.current) {
          // Restore the committed width so a later reopen is not stuck at the
          // floor, then collapse.
          writeVar(cssVar, widthRef.current);
          onCollapseRef.current?.();
          return;
        }
        // A click (no drag) does nothing: it neither resizes nor opens a
        // collapsed column. Only a real drag commits a width.
        if (!movedRef.current) return;
        commitRef.current(clampWidth(liveRef.current, gestureVw), gestureVw);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [edge, cssVar],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Collapsed: Enter / Space / Right reopen the column.
      if (!openRef.current) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          onExpandRef.current?.();
        }
        return;
      }
      // Open: Home resets; arrows nudge (Left shrinks, Right grows), tweened.
      if (e.key === "Home") {
        e.preventDefault();
        settleTo(clampWidth(defaultWidth, vw()), () => resetRef.current());
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const target = clampWidth(widthRef.current + dir * step, vw());
      settleTo(target, (px) => commitRef.current(px, vw()));
    },
    [defaultWidth, settleTo],
  );

  const onDoubleClick = useCallback(() => {
    settleTo(clampWidth(defaultWidth, vw()), () => resetRef.current());
  }, [defaultWidth, settleTo]);

  // On unmount: drop any in-flight tween, tear down a live gesture's listeners,
  // and clear the flags they set.
  useEffect(
    () => () => {
      animRef.current?.pause();
      gestureCleanupRef.current?.();
      setResizing(false);
      setDimClosing(closeDimIdRef.current, false);
    },
    [],
  );

  return {
    dragging,
    bind: { onPointerDown, onKeyDown, onDoubleClick },
  };
}

// Re-export the clamp bounds so the handle can publish aria-valuemin/max without
// re-deriving them.
export { WIDTH_MIN, WIDTH_MAX };
