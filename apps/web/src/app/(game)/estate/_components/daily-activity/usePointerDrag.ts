"use client";

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

/** Live state of an in-flight drag: which item, current pointer, grab offset. */
export interface DragState {
  index: number;
  x: number;
  y: number;
  /** Pointer offset inside the grabbed element at drag start (for ghost placement). */
  offsetX: number;
  offsetY: number;
}

interface PointerDragOpts {
  /** Called continuously as the pointer moves (e.g. to live-reorder). */
  onMove?: (index: number, x: number, y: number) => void;
  /** Called once on release with the final pointer position (do hit-testing here). */
  onDrop: (index: number, x: number, y: number) => void;
}

/**
 * Minimal pointer-based drag primitive. `startDrag(index, e)` is wired to a
 * handle's `onPointerDown`; the hook then tracks the pointer on `window` until
 * release and reports the lifecycle. Hit-testing against drop zones is left to
 * the caller (compare the released x/y against target `getBoundingClientRect`s)
 * so the same primitive serves both drag-to-bin and drag-to-reorder.
 *
 * The grabbed handle should set `touch-action: none` so touch drags don't
 * scroll the page. Listeners are torn down via an AbortController on release,
 * cancel, or unmount — no leak if a drag is interrupted.
 */
export function usePointerDrag(opts: PointerDragOpts): {
  dragging: DragState | null;
  startDrag: (index: number, e: ReactPointerEvent) => void;
} {
  const [dragging, setDragging] = useState<DragState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const cleanupRef = useRef<(() => void) | null>(null);

  // Abort any in-flight drag if the component unmounts mid-gesture.
  useEffect(() => () => cleanupRef.current?.(), []);

  const startDrag = useCallback((index: number, e: ReactPointerEvent) => {
    // Ignore secondary buttons; only a primary press starts a drag.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDragging({
      index,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });

    const ac = new AbortController();
    cleanupRef.current = () => {
      ac.abort();
      cleanupRef.current = null;
      setDragging(null);
    };

    window.addEventListener(
      "pointermove",
      (ev: PointerEvent) => {
        ev.preventDefault();
        setDragging((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
        optsRef.current.onMove?.(index, ev.clientX, ev.clientY);
      },
      { signal: ac.signal, passive: false },
    );
    window.addEventListener(
      "pointerup",
      (ev: PointerEvent) => {
        ac.abort();
        cleanupRef.current = null;
        setDragging(null);
        optsRef.current.onDrop(index, ev.clientX, ev.clientY);
      },
      { signal: ac.signal },
    );
    window.addEventListener(
      "pointercancel",
      () => {
        ac.abort();
        cleanupRef.current = null;
        setDragging(null);
      },
      { signal: ac.signal },
    );
  }, []);

  return { dragging, startDrag };
}
