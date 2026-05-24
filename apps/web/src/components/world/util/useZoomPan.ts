"use client";

/**
 * useZoomPan — native touch + wheel zoom/pan for the realm-map SVG.
 *
 * No third-party dep. The hook returns a `containerRef` to bind to the sheet
 * div and an SVG `transform` string to apply to the inner <g>. All math is
 * in viewBox units so the transform composes cleanly with the SVG's own
 * scaling.
 *
 * Gestures:
 *  - 1-finger drag (after a 6px threshold) to pan
 *  - 2-finger pinch to zoom around the pinch midpoint
 *  - wheel (desktop) to zoom around the cursor
 *  - double-tap to reset to 1× / centred
 *
 * Pan is clamped so the viewport always stays inside the (scaled) content.
 * Tap-without-drag does not preventDefault, so city `onClick` handlers still
 * fire normally.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  vbWidth: number;
  vbHeight: number;
  minScale?: number;
  maxScale?: number;
}

interface State {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY: State = { scale: 1, tx: 0, ty: 0 };

export function useZoomPan({
  vbWidth,
  vbHeight,
  minScale = 1,
  maxScale = 3.5,
}: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(IDENTITY);

  // Mutable gesture refs — written from event handlers, no re-render churn.
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const pinchDist = useRef<number | null>(null);
  const tapAt = useRef<number>(0);
  const panning = useRef(false);

  const clamp = useCallback(
    (s: State): State => {
      const scale = Math.max(minScale, Math.min(maxScale, s.scale));
      if (scale <= 1.001) return { scale, tx: 0, ty: 0 };
      const minTx = vbWidth * (1 - scale); // negative
      const minTy = vbHeight * (1 - scale);
      return {
        scale,
        tx: Math.max(minTx, Math.min(0, s.tx)),
        ty: Math.max(minTy, Math.min(0, s.ty)),
      };
    },
    [vbWidth, vbHeight, minScale, maxScale],
  );

  const reset = useCallback(() => setState(IDENTITY), []);

  // Zoom around a point in viewBox coords, keeping that point under the cursor.
  const zoomAt = useCallback(
    (vbX: number, vbY: number, factor: number) => {
      setState((prev) => {
        const newScale = Math.max(
          minScale,
          Math.min(maxScale, prev.scale * factor),
        );
        const f = newScale / prev.scale;
        return clamp({
          scale: newScale,
          tx: vbX - (vbX - prev.tx) * f,
          ty: vbY - (vbY - prev.ty) * f,
        });
      });
    },
    [clamp, minScale, maxScale],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const rect = () => el.getBoundingClientRect();
    const toVB = (clientX: number, clientY: number) => {
      const r = rect();
      return {
        x: ((clientX - r.left) / r.width) * vbWidth,
        y: ((clientY - r.top) / r.height) * vbHeight,
      };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = toVB(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(x, y, factor);
    };

    const onTouchStart = (e: TouchEvent) => {
      const ts = e.touches;
      if (ts.length === 1) {
        // Track for pan but don't start until threshold is crossed.
        lastTouch.current = { x: ts[0]!.clientX, y: ts[0]!.clientY };
        panning.current = false;
        // Double-tap to reset.
        const now = Date.now();
        if (now - tapAt.current < 300) {
          reset();
          tapAt.current = 0;
        } else {
          tapAt.current = now;
        }
      } else if (ts.length === 2) {
        const dx = ts[1]!.clientX - ts[0]!.clientX;
        const dy = ts[1]!.clientY - ts[0]!.clientY;
        pinchDist.current = Math.hypot(dx, dy);
        panning.current = false;
        tapAt.current = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = e.touches;
      if (ts.length === 1 && lastTouch.current) {
        const dx = ts[0]!.clientX - lastTouch.current.x;
        const dy = ts[0]!.clientY - lastTouch.current.y;
        if (!panning.current && Math.hypot(dx, dy) > 6) {
          panning.current = true;
          tapAt.current = 0; // cancel pending double-tap
        }
        if (panning.current) {
          e.preventDefault();
          const r = rect();
          const vbdx = (dx / r.width) * vbWidth;
          const vbdy = (dy / r.height) * vbHeight;
          setState((prev) =>
            clamp({ scale: prev.scale, tx: prev.tx + vbdx, ty: prev.ty + vbdy }),
          );
          lastTouch.current = { x: ts[0]!.clientX, y: ts[0]!.clientY };
        }
      } else if (ts.length === 2 && pinchDist.current != null) {
        e.preventDefault();
        const dx = ts[1]!.clientX - ts[0]!.clientX;
        const dy = ts[1]!.clientY - ts[0]!.clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / pinchDist.current;
        const midX = (ts[0]!.clientX + ts[1]!.clientX) / 2;
        const midY = (ts[0]!.clientY + ts[1]!.clientY) / 2;
        const { x, y } = toVB(midX, midY);
        zoomAt(x, y, factor);
        pinchDist.current = dist;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchDist.current = null;
      if (e.touches.length === 0) {
        lastTouch.current = null;
        panning.current = false;
      }
    };

    // touchmove + wheel need passive: false so preventDefault works.
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [clamp, zoomAt, reset, vbWidth, vbHeight]);

  return {
    containerRef,
    transform: `translate(${state.tx} ${state.ty}) scale(${state.scale})`,
    scale: state.scale,
    reset,
  };
}
