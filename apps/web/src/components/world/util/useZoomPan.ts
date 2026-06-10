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
import { prefersReducedMotion } from "@/lib/utils";
import { createCameraRig, type CameraRig, type CameraState } from "@/components/world/cameraRig";

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

// Seed the rig's channels from a React State before easing, so an eased motion
// starts from exactly where the map currently sits.
const IDENTITY_CAM = (s: State): CameraState => ({ panX: s.tx, panY: s.ty, zoom: s.scale });

export function useZoomPan({ vbWidth, vbHeight, minScale = 1, maxScale = 4 }: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<State>(IDENTITY);

  // Inertial layer (feature 4.3). The shared camera rig eases smooth zoom and a
  // velocity-seeded fling, streaming each frame back into React state so
  // `zoom.transform` / `zoom.scale` stay the single source of truth and every
  // counter-scale layer keeps reading the same value (no separate render
  // model, no desync). Built lazily on first use; if it ever fails the gesture
  // path is untouched and the map stays fully interactive.
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  const rigRef = useRef<CameraRig | null>(null);
  const ensureRig = useCallback((): CameraRig | null => {
    if (rigRef.current) return rigRef.current;
    try {
      const cur = stateRef.current;
      rigRef.current = createCameraRig({
        initial: { panX: cur.tx, panY: cur.ty, zoom: cur.scale },
        getBounds: () => ({ vbWidth, vbHeight, minScale, maxScale }),
        onFrame: (_t, s) => setState({ scale: s.zoom, tx: s.panX, ty: s.panY }),
      });
    } catch {
      rigRef.current = null;
    }
    return rigRef.current;
  }, [vbWidth, vbHeight, minScale, maxScale]);

  // Pan velocity (viewBox units/sec) sampled across the last move, seeded into
  // the rig's spring fling on release so the map glides to a stop. Tracked in
  // refs so it never triggers a render mid-drag.
  const velRef = useRef<{ vx: number; vy: number; t: number }>({ vx: 0, vy: 0, t: 0 });
  const trackVelocity = useCallback((vbdx: number, vbdy: number) => {
    const now = performance.now();
    const dt = now - velRef.current.t;
    if (dt > 0 && dt < 120) {
      // Blend toward the instantaneous velocity so a flick at release wins.
      const inst = { vx: (vbdx / dt) * 1000, vy: (vbdy / dt) * 1000 };
      velRef.current = { vx: inst.vx * 0.7 + velRef.current.vx * 0.3, vy: inst.vy * 0.7 + velRef.current.vy * 0.3, t: now };
    } else {
      velRef.current = { vx: 0, vy: 0, t: now };
    }
  }, []);
  // Hand the sampled release velocity to the rig as a fling (skipped under
  // reduced motion or when the gesture ended slow).
  const flingFromVelocity = useCallback(() => {
    const { vx, vy } = velRef.current;
    velRef.current = { vx: 0, vy: 0, t: 0 };
    if (prefersReducedMotion()) return;
    if (Math.hypot(vx, vy) < 60) return;
    const rig = ensureRig();
    if (!rig) return;
    rig.set(IDENTITY_CAM(stateRef.current));
    rig.fling(vx, vy);
  }, [ensureRig]);

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

  // Ease the camera to `next` through the rig (stopping any in-flight fling
  // first); falls back to a hard set when the rig is unavailable or the user
  // prefers reduced motion. Shared by reset / focus / smooth zoomAt so the
  // rig hand-off lives in one place.
  const easeTo = useCallback(
    (next: State, durationMs: number) => {
      rigRef.current?.stop();
      const rig = ensureRig();
      if (rig && !prefersReducedMotion()) {
        rig.set(IDENTITY_CAM(stateRef.current));
        rig.flyTo(
          { panX: next.tx, panY: next.ty, zoom: next.scale },
          { duration: durationMs, ease: "outExpo" },
        );
        return;
      }
      setState(next);
    },
    [ensureRig],
  );

  const reset = useCallback(() => easeTo(IDENTITY, 420), [easeTo]);

  // Center a viewBox point in the viewport at a given scale. Used for the
  // initial "settle into the kingdom" framing on load. Clamped like any pan so
  // the view never leaves the content. Eased through the rig (same as reset /
  // wheel zoom) so the framing reads as settling in, not a hard cut.
  const focus = useCallback(
    (cx: number, cy: number, scale: number) => {
      const s = Math.max(minScale, Math.min(maxScale, scale));
      easeTo(clamp({ scale: s, tx: vbWidth / 2 - cx * s, ty: vbHeight / 2 - cy * s }), 620);
    },
    [clamp, minScale, maxScale, vbWidth, vbHeight, easeTo],
  );

  // Zoom around a point in viewBox coords, keeping that point under the cursor.
  // `smooth` eases the dolly via the rig (wheel/double-click); pinch passes
  // raw so the gesture tracks the fingers 1:1.
  const zoomAt = useCallback(
    (vbX: number, vbY: number, factor: number, smooth = false) => {
      const prev = stateRef.current;
      const newScale = Math.max(minScale, Math.min(maxScale, prev.scale * factor));
      const f = newScale / prev.scale;
      const next = clamp({
        scale: newScale,
        tx: vbX - (vbX - prev.tx) * f,
        ty: vbY - (vbY - prev.ty) * f,
      });
      if (smooth) {
        easeTo(next, 260);
        return;
      }
      rigRef.current?.stop();
      setState(next);
    },
    [clamp, minScale, maxScale, easeTo],
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
      // Eased dolly so the wheel zoom settles instead of hard-cutting.
      zoomAt(x, y, factor, true);
    };

    // ── Mouse ──────────────────────────────────────────────────────────────
    // Desktop pan: missing before this change. mousemove + mouseup live on
    // window so the drag survives leaving the sheet.

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // A fresh grab interrupts any in-flight fling/zoom and reseats truth.
      rigRef.current?.stop();
      mouseDragStart.current = { x: e.clientX, y: e.clientY };
      mouseLast.current = { x: e.clientX, y: e.clientY };
      mouseDidPan.current = false;
      velRef.current = { vx: 0, vy: 0, t: performance.now() };
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
      trackVelocity(vbdx, vbdy);
      mouseLast.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      if (mouseDidPan.current) {
        suppressClick.current = true;
        flingFromVelocity();
      }
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
      // Any new touch interrupts an in-flight fling/zoom.
      rigRef.current?.stop();
      if (ts.length === 1) {
        // Track for pan but don't start until threshold is crossed.
        lastTouch.current = { x: ts[0]!.clientX, y: ts[0]!.clientY };
        panning.current = false;
        velRef.current = { vx: 0, vy: 0, t: performance.now() };
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
          trackVelocity(vbdx, vbdy);
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
          flingFromVelocity();
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
  }, [clamp, zoomAt, reset, vbWidth, vbHeight, trackVelocity, flingFromVelocity]);

  // Tear the rig down on unmount so the createAnimatable channels are reverted
  // and the fling rAF can never outlive the component.
  useEffect(() => {
    return () => {
      rigRef.current?.revert();
      rigRef.current = null;
    };
  }, []);

  return {
    containerRef,
    transform: `translate(${state.tx} ${state.ty}) scale(${state.scale})`,
    scale: state.scale,
    reset,
    focus,
  };
}
