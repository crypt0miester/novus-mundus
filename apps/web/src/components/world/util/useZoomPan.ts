"use client";

/**
 * useZoomPan — native input zoom/pan for the realm-map SVG.
 *
 * No third-party dep. Returns a `containerRef` to bind to the sheet div, an
 * SVG `transform` string for the inner <g>, and the current scale (so the
 * caller can counter-scale screen-space layers).
 *
 * Gestures:
 *  - Mouse drag (after a 4 px threshold) to pan; trackpad two-finger drag too
 *  - Wheel / pinch-zoom-gesture (desktop) to zoom around the cursor
 *  - 1-finger touch drag (after a 6 px threshold) to pan
 *  - 2-finger touch pinch to zoom around the pinch midpoint
 *  - Double-tap (touch) or double-click (mouse) to reset 1× / centred
 *
 * Pan is clamped so the viewport always stays inside the (scaled) content.
 * After a drag-pan we swallow the trailing click so the container's onClick
 * (e.g. "deselect city") doesn't fire.
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

export function useZoomPan({ vbWidth, vbHeight, minScale = 1, maxScale = 4 }: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(IDENTITY);

  // Mutable gesture refs — written from event handlers, no re-render churn.
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const pinchDist = useRef<number | null>(null);
  const tapAt = useRef<number>(0);
  const panning = useRef(false);
  // Mouse-drag state. dragging=mouse is down; didPan=we crossed the threshold
  // and should swallow the trailing click so the sheet's deselect-onClick
  // doesn't fire after the drag.
  const mouseDragStart = useRef<{ x: number; y: number } | null>(null);
  const mouseLast = useRef<{ x: number; y: number } | null>(null);
  const mouseDidPan = useRef(false);
  const suppressClick = useRef(false);

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
        const newScale = Math.max(minScale, Math.min(maxScale, prev.scale * factor));
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
      // Ctrl + wheel = pinch-zoom on a trackpad; raw wheel deltas there are
      // huge, so dampen them so each notch isn't an extreme zoom step.
      const delta = e.ctrlKey ? e.deltaY * 0.35 : e.deltaY;
      const factor = delta < 0 ? 1.12 : 1 / 1.12;
      zoomAt(x, y, factor);
    };

    // ── Mouse ──────────────────────────────────────────────────────────────
    // Desktop pan: missing before this change. mousemove + mouseup live on
    // window so the drag survives leaving the sheet.

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouseDragStart.current = { x: e.clientX, y: e.clientY };
      mouseLast.current = { x: e.clientX, y: e.clientY };
      mouseDidPan.current = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      const start = mouseDragStart.current;
      const last = mouseLast.current;
      if (!start || !last) return;
      if (!mouseDidPan.current) {
        const tdx = e.clientX - start.x;
        const tdy = e.clientY - start.y;
        if (Math.hypot(tdx, tdy) < 4) return;
        mouseDidPan.current = true;
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      const r = rect();
      const vbdx = (dx / r.width) * vbWidth;
      const vbdy = (dy / r.height) * vbHeight;
      setState((prev) => clamp({ scale: prev.scale, tx: prev.tx + vbdx, ty: prev.ty + vbdy }));
      mouseLast.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      if (mouseDidPan.current) suppressClick.current = true;
      mouseDragStart.current = null;
      mouseLast.current = null;
      mouseDidPan.current = false;
    };

    // Swallow the click that browsers fire after a drag — without this, a
    // drag-pan that ends over the sheet triggers the deselect-onClick.
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Double-click anywhere on the sheet resets zoom (mirrors touch double-tap).
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      reset();
    };

    // ── Touch ──────────────────────────────────────────────────────────────

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
          setState((prev) => clamp({ scale: prev.scale, tx: prev.tx + vbdx, ty: prev.ty + vbdy }));
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
        // If the finger crossed the pan threshold, swallow the synthetic
        // click that mobile browsers sometimes still emit.
        if (panning.current) {
          suppressClick.current = true;
          // Self-clear after a tick — some browsers never emit the click.
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 350);
        }
        lastTouch.current = null;
        panning.current = false;
      }
    };

    // touchmove + wheel need passive: false so preventDefault works.
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    el.addEventListener("click", onClickCapture, { capture: true });
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("click", onClickCapture, { capture: true } as EventListenerOptions);
      el.removeEventListener("dblclick", onDblClick);
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
