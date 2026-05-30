"use client";

// Shared cinematic camera rig for the RealmMap.
//
// A single `createAnimatable` owns the three transform channels (panX, panY,
// zoom) so fly-to, the travel follow, and the inertial fling all speak one
// spatial language and chain into each other instead of fighting separate rAF
// loops. The rig is the source of truth for the map transform string: every
// eased frame it recomputes `translate(panX panY) scale(zoom)` and hands it to
// the subscriber, which writes it onto the inner SVG <g> imperatively (no
// per-frame React render). Counter-scale layers sample the LIVE eased scale via
// `rig.zoom()` so they never desync a frame during a zoom or fling.
//
// The rig is deliberately additive: RealmMap keeps its existing React-derived
// transform as the resting source of truth and only hands control to the rig
// while a rig motion is in flight. If the rig fails to build, the map falls
// back to the plain transform path untouched.

import { createAnimatable, utils, type AnimatableObject } from "animejs";
import { WORLD_FLING } from "@/lib/motion/tokens";

export interface CameraState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface CameraBounds {
  vbWidth: number;
  vbHeight: number;
  minScale: number;
  maxScale: number;
}

// Clamp a camera state to the same envelope useZoomPan enforces: at <= 1x the
// content is centred (no pan); beyond that the translate stays within the
// scaled content so the viewport never shows past an edge.
function clampState(s: CameraState, b: CameraBounds): CameraState {
  const zoom = utils.clamp(s.zoom, b.minScale, b.maxScale);
  if (zoom <= 1.001) return { panX: 0, panY: 0, zoom };
  const minTx = b.vbWidth * (1 - zoom);
  const minTy = b.vbHeight * (1 - zoom);
  return {
    panX: utils.clamp(s.panX, minTx, 0),
    panY: utils.clamp(s.panY, minTy, 0),
    zoom,
  };
}

export interface CameraRig {
  // Read the live eased channels (counter-scale layers sample these).
  panX: () => number;
  panY: () => number;
  zoom: () => number;
  // Current transform string built from the live channels.
  transform: () => string;
  // Snap channels to a state with no animation (resync to React truth).
  set: (s: CameraState) => void;
  // Ease the camera to a target state (fly-to / smooth zoom). Returns once the
  // bounds-clamped target is committed; the eased frames stream to onFrame.
  flyTo: (s: Partial<CameraState>, opts?: { duration?: number; ease?: string }) => void;
  // Spring-fling from the current state by a velocity (viewBox units/sec),
  // bounds-clamped continuously as it settles.
  fling: (vx: number, vy: number) => void;
  // Stop any in-flight rig motion (hand control back to React).
  stop: () => void;
  revert: () => void;
}

// Build a camera rig. `onFrame` receives the freshly built transform string on
// every eased frame so the caller can write it to the SVG <g>. `getBounds`
// returns the live clamp envelope (it can change as the sheet resizes).
export function createCameraRig(opts: {
  initial: CameraState;
  getBounds: () => CameraBounds;
  onFrame: (transform: string, state: CameraState) => void;
}): CameraRig {
  const { initial, getBounds, onFrame } = opts;

  // The animatable target is a plain object; anime.js writes the eased values
  // back onto it each frame. We rebuild the transform in onRender and fan it
  // out. A separate manual fling loop reuses the same animatable setters.
  const target: CameraState = { ...initial };

  const build = (): string =>
    `translate(${target.panX} ${target.panY}) scale(${target.zoom})`;

  const cam = createAnimatable(target, {
    panX: 0,
    panY: 0,
    zoom: 0,
    // ease/duration default to instant unless a setter overrides them per call.
    onRender: () => onFrame(build(), { ...target }),
  }) as AnimatableObject;

  // `target` is the authoritative mirror: anime.js writes eased values onto it
  // each animated frame (via onRender), and the manual paths (set / fling
  // integration) write it synchronously. We read FROM the mirror, never from
  // the animatable getter, because a 0-duration setter does not reflect into
  // the getter until the next engine tick (the classic seed-lag footgun).
  const read = (): CameraState => ({ panX: target.panX, panY: target.panY, zoom: target.zoom });

  let flingRaf: number | null = null;
  const stopFling = () => {
    if (flingRaf != null) {
      cancelAnimationFrame(flingRaf);
      flingRaf = null;
    }
  };

  const set = (s: CameraState) => {
    stopFling();
    const c = clampState(s, getBounds());
    // Seed the mirror synchronously so a follow-up read() / fling starts true.
    target.panX = c.panX;
    target.panY = c.panY;
    target.zoom = c.zoom;
    // duration 0 setters snap the animatable's internal numbers without easing.
    cam.panX(c.panX, 0);
    cam.panY(c.panY, 0);
    cam.zoom(c.zoom, 0);
  };

  const flyTo: CameraRig["flyTo"] = (s, o) => {
    stopFling();
    const cur = read();
    const c = clampState({ panX: s.panX ?? cur.panX, panY: s.panY ?? cur.panY, zoom: s.zoom ?? cur.zoom }, getBounds());
    const duration = o?.duration ?? 520;
    const ease = o?.ease ?? "outExpo";
    cam.panX(c.panX, duration, ease);
    cam.panY(c.panY, duration, ease);
    cam.zoom(c.zoom, duration, ease);
  };

  // Velocity-seeded inertial fling. We integrate the velocity ourselves with an
  // exponential decay and bounds-clamp every frame, then settle the residual on
  // the WORLD_FLING spring via the animatable so the stop reads as physical.
  const fling: CameraRig["fling"] = (vx, vy) => {
    stopFling();
    // Integrate position locally so we never round-trip through the getter; the
    // animatable channels are pushed each frame purely to keep onFrame's source
    // string and the rig getters in sync.
    const start = read();
    let posX = start.panX;
    let posY = start.panY;
    const zoom = start.zoom;
    let velX = vx;
    let velY = vy;
    let last = performance.now();
    const DECAY = 0.0042; // per-ms decay; tuned so the glide lasts ~0.4s

    const step = (nowTs: number) => {
      const dt = Math.min(48, nowTs - last);
      last = nowTs;
      const damp = Math.exp(-DECAY * dt);
      velX *= damp;
      velY *= damp;
      const proposedX = posX + (velX * dt) / 1000;
      const proposedY = posY + (velY * dt) / 1000;
      const next = clampState({ panX: proposedX, panY: proposedY, zoom }, getBounds());
      // If a bound clipped us, the velocity in that axis is spent.
      if (next.panX !== proposedX) velX = 0;
      if (next.panY !== proposedY) velY = 0;
      posX = next.panX;
      posY = next.panY;
      // Push the integrated position (instant; we are the driving loop). The
      // 0-duration setters may not fire onRender, so fan the frame out directly.
      cam.panX(posX, 0);
      cam.panY(posY, 0);
      target.panX = posX;
      target.panY = posY;
      onFrame(build(), { ...target });
      if (Math.abs(velX) < 4 && Math.abs(velY) < 4) {
        flingRaf = null;
        // Settle the residual on the shared world spring for a soft stop.
        const settled = clampState({ panX: posX, panY: posY, zoom }, getBounds());
        cam.panX(settled.panX, 1, WORLD_FLING);
        cam.panY(settled.panY, 1, WORLD_FLING);
        return;
      }
      flingRaf = requestAnimationFrame(step);
    };
    flingRaf = requestAnimationFrame(step);
  };

  return {
    panX: () => target.panX,
    panY: () => target.panY,
    zoom: () => target.zoom,
    transform: build,
    set,
    flyTo,
    fling,
    stop: stopFling,
    revert: () => {
      stopFling();
      cam.revert();
    },
  };
}
