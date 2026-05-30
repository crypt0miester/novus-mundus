/**
 * Mode-transition tween (the Google-Maps tilt).
 *
 * Folds camera pitch, mesh height-scale, target.y, target.x/z, and
 * distance onto ONE anime.js `createTimeline` so they cannot desync,
 * replacing the old hand-rolled RAF + lerp + easeOutCubic loop. A
 * single plain-object `{ k }` is tweened 0 -> 1 over ~700 ms on the
 * named `inOutCubic` ease; the timeline's `onUpdate` reads the eased
 * `k` and drives every channel through the controller's `Hard`
 * setters in lockstep, so terrain rises out of the flat plate as the
 * camera tilts back (and the reverse on 3D -> 2D).
 *
 * The setters live INSIDE `onUpdate` deliberately: each `setPitchHard`
 * / `setTargetHard` writes both desired AND smoothed state and rebuilds
 * the camera matrix immediately, so the Three.js controller's own
 * exponential smoothing never double-lerps the eased curve (its
 * `update(dt)` already bypasses pitch/distance/target.y while
 * `isTransitioning`). The controller's `isTransitioning` flag is set
 * for the duration so gestures, clicks, and toggle re-presses are
 * suppressed, otherwise a mid-tween wheel would race the camera and
 * produce visible jitter.
 *
 * A NAMED ease (`inOutCubic`), not a spring: a spring's settle
 * duration overrides the explicit `duration`, which would untether the
 * tilt from the 700 ms window the `isTransitioning` lock is sized for.
 *
 * Because the timeline rides the shared anime engine clock, it pauses
 * with `engine.pauseOnDocumentHidden` if the tab is backgrounded
 * mid-tilt and resumes on return; `onComplete` (and any `then()`)
 * still fire once the timeline genuinely reaches its end on resume,
 * not while frozen. Outside of an in-flight tween the WebGL scene
 * renders on demand (see CityTerrainMapWebGL): each `onUpdate` calls
 * the caller's `onChange` to queue exactly one paint per tick.
 *
 * Note on reduced motion: the mode-toggle call site short-circuits to
 * `snapToMode` under a reduce preference and never reaches
 * `runModeTransition`, so the global `engine.speed` slow-down cannot
 * freeze this tween. `runViewTween` is NOT gated by its callers, so it
 * snaps directly under reduce (see below).
 */

import * as THREE from "three";
import { animate, createTimeline } from "animejs";
import { prefersReducedMotion } from "@/lib/utils";
import type { MapMode } from "@/lib/store/settings";
import type { CityCameraController } from "./controls";
import { PITCH_2D } from "./controls";
import { midpointElevation } from "./coords";
import type { BuiltTerrainMesh } from "./buildTerrainMesh";

export const TRANSITION_DURATION_MS = 700;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface TransitionOptions {
  controller: CityCameraController;
  terrain: BuiltTerrainMesh;
  fromMode: MapMode;
  toMode: MapMode;
  /* If non-null, target.x/z lerps to this point during the tween so
   * the focused cell stays centred under the tilt. Pass `null` to
   * leave target.x/z alone (the default — most toggles aren't entity-
   * focused). */
  selectionTargetXZ: { x: number; z: number } | null;
  /* Distance lerp endpoints — preserved relative zoom across mode
   * toggles. Caller computes both: `distanceFrom` is whatever the
   * controller's smoothed distance is at tween start; `distanceTo`
   * is the equivalent fraction of the new mode's range so the user
   * doesn't lose their zoom level when flipping iso ↔ top. */
  distanceFrom: number;
  distanceTo: number;
  onChange: () => void;
  onComplete: (toMode: MapMode) => void;
}

export interface RunningTransition {
  cancel: () => void;
}

/* Returns false if there's no actual transition needed (e.g.
 * fromMode === toMode). */
export function shouldRunTransition(from: MapMode, to: MapMode): boolean {
  return from !== to;
}

/* Honour prefers-reduced-motion. Snaps to destination state without
 * any animation. Callers should pick this branch when matchMedia
 * reports a reduce preference. */
export function snapToMode(
  controller: CityCameraController,
  terrain: BuiltTerrainMesh,
  toMode: MapMode,
  selectionTargetXZ: { x: number; z: number } | null,
): void {
  const fromMode = controller.getMode();
  if (fromMode === "iso" && toMode === "flat") {
    controller.setStoredPitch3D(controller.getDesiredPitch());
  }
  const pitchTo = toMode === "iso" ? controller.getStoredPitch3D() : PITCH_2D;
  controller.setPitchHard(pitchTo);
  terrain.heightScale.value = toMode === "iso" ? 1 : 0;
  const yTo = toMode === "iso" ? midpointElevation() : 0;
  const current = controller.getDesiredTarget();
  controller.setTargetHard(
    new THREE.Vector3(
      selectionTargetXZ ? selectionTargetXZ.x : current.x,
      yTo,
      selectionTargetXZ ? selectionTargetXZ.z : current.z,
    ),
  );
  controller.commitModeChange(toMode);
}

export function runModeTransition(opts: TransitionOptions): RunningTransition {
  const { controller, terrain, fromMode, toMode } = opts;

  /* Snapshot from-state at tween start so the eased curve has a
   * stable anchor. The controller may have been smoothing toward
   * different desireds when the user hit the toggle. */
  const pitchFrom = controller.getDesiredPitch();
  // Preserve the user's last 3D pitch across mode toggles. When
  // leaving 3D, stash the current pitch; when entering 3D, restore
  // it instead of slamming back to the default PITCH_3D.
  if (fromMode === "iso" && toMode === "flat") {
    controller.setStoredPitch3D(pitchFrom);
  }
  const pitchTo = toMode === "iso" ? controller.getStoredPitch3D() : PITCH_2D;
  const scaleFrom = terrain.heightScale.value;
  const scaleTo = toMode === "iso" ? 1 : 0;
  const yFrom = controller.getDesiredTarget().y;
  const yTo = toMode === "iso" ? midpointElevation() : 0;
  const xFrom = controller.getDesiredTarget().x;
  const zFrom = controller.getDesiredTarget().z;
  const xTo = opts.selectionTargetXZ ? opts.selectionTargetXZ.x : xFrom;
  const zTo = opts.selectionTargetXZ ? opts.selectionTargetXZ.z : zFrom;

  controller.setTransitioning(true);

  /* Re-anchor scratch target so onUpdate reuses one Vector3 instead of
   * allocating per frame (matches the controller's own scratch-vector
   * discipline). */
  const tweenTarget = new THREE.Vector3();

  let cancelled = false;
  let settled = false;

  /* Apply the full state for an eased fraction `e`. Every channel is
   * driven through the controller's `Hard` setters in the SAME pass so
   * pitch, extrusion, look-at target, and distance can never desync.
   * Kept as a local so `onComplete` can land the exact destination
   * (e === 1) even if a tick was skipped while the tab was hidden. */
  const applyEased = (e: number) => {
    /* Write both desired AND smoothed values via setPitchHard so the
     * controller's smoothing loop doesn't lerp on top of the tween. */
    controller.setPitchHard(lerp(pitchFrom, pitchTo, e));

    /* Lerp distance so a user who was zoomed into a specific area in
     * 2D doesn't snap to the new mode's default distance on toggle.
     * The caller pre-computes `distanceTo` as the same relative-zoom
     * fraction expressed against the new mode's max distance. */
    controller.setDistanceHard(lerp(opts.distanceFrom, opts.distanceTo, e));

    tweenTarget.set(lerp(xFrom, xTo, e), lerp(yFrom, yTo, e), lerp(zFrom, zTo, e));
    controller.setTargetHard(tweenTarget);

    terrain.heightScale.value = lerp(scaleFrom, scaleTo, e);
  };

  /* Single plain-object progress driver. The eased value lives in
   * `progress.k` after each render, so the timeline-level `onUpdate`
   * (fired once per tick, after the child tween renders) reads the
   * fresh eased fraction and fans it out to every camera channel.
   * NAMED ease, never a spring: a spring would override the explicit
   * 700 ms the `isTransitioning` lock depends on. */
  const progress = { k: 0 };
  const tl = createTimeline({
    defaults: { ease: "inOutCubic", duration: TRANSITION_DURATION_MS },
    onUpdate: () => {
      if (cancelled) return;
      applyEased(progress.k);
      /* Render-on-demand: queue exactly one paint for this tick. The
       * scene's paint loop reads the camera state the setters above
       * already committed. */
      opts.onChange();
    },
    onComplete: () => {
      if (cancelled || settled) return;
      settled = true;
      /* Land the precise destination. Guards against a final tick that
       * resumed slightly short of e === 1 after a tab-hidden pause. */
      applyEased(1);
      controller.commitModeChange(toMode);
      controller.setTransitioning(false);
      opts.onChange();
      opts.onComplete(toMode);
    },
  });

  tl.add(progress, { k: [0, 1] });

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      /* cancel() deregisters the timeline from the engine and holds the
       * camera wherever the eased curve left it (it does NOT seek back
       * to 0, that's revert()), so a fresh transition or gesture takes
       * over from the current pose, matching the old RAF cancel which
       * simply stopped requesting frames. */
      tl.cancel();
      controller.setTransitioning(false);
    },
  };
}

/* In-mode view tween (220 ms) for discrete gestures like double-click
 * zoom-in and reset. Mirrors the Canvas2D fallback's `animateView`
 * so the two modes feel like the same product. Driven by a single
 * anime.js `animate()` on a plain-object progress driver whose eased
 * `k` fans out to target / distance / yaw through the controller's
 * `Hard` setters, so the Three.js smoothing never double-lerps. Any
 * cancel-trigger (new gesture, programmatic cancel) cancels the
 * animation cleanly and the controller's gesture handlers take over.
 *
 * NAMED ease (`inOutCubic`), never a spring: a spring would override
 * the explicit `durationMs`, and the precise 220 ms (and the 520 ms
 * focus duration callers pass) is the load-bearing feel here. */

export const VIEW_TWEEN_DURATION_MS = 220;

export interface ViewTweenTarget {
  target?: THREE.Vector3 | null;
  distance?: number | null;
  yaw?: number | null;
}

export interface RunningViewTween {
  cancel: () => void;
}

export function runViewTween(
  controller: CityCameraController,
  to: ViewTweenTarget,
  onChange: () => void,
  durationMs: number = VIEW_TWEEN_DURATION_MS,
): RunningViewTween {
  /* Snapshot smoothed state. The user might be mid-gesture when the
   * tween starts; smoothed is the visible "now". */
  const tFrom = controller.getTarget().clone();
  const dFrom = controller.getDistance();
  const yFrom = controller.getYaw();
  const tTo = to.target ? to.target.clone() : tFrom.clone();
  const dTo = to.distance ?? dFrom;
  const yTo = to.yaw ?? yFrom;

  /* Reused scratch target so onUpdate doesn't allocate per frame. */
  const tweenTarget = new THREE.Vector3();

  const applyEased = (e: number) => {
    tweenTarget.set(lerp(tFrom.x, tTo.x, e), lerp(tFrom.y, tTo.y, e), lerp(tFrom.z, tTo.z, e));
    controller.setTargetHard(tweenTarget);
    controller.setDistanceHard(lerp(dFrom, dTo, e));
    controller.setYawHard(lerp(yFrom, yTo, e));
  };

  /* Reduced motion: these callers (double-click, reset, focus, frame)
   * don't gate the preference themselves, and the engine-level
   * `engine.speed = 0.001` slow-down would otherwise freeze an
   * anime-driven tween into a multi-second crawl. Snap to the
   * destination, paint once, and return an inert handle. */
  if (prefersReducedMotion()) {
    applyEased(1);
    onChange();
    return { cancel: () => {} };
  }

  let cancelled = false;

  const progress = { k: 0 };
  const anim = animate(progress, {
    k: [0, 1],
    ease: "inOutCubic",
    duration: durationMs,
    onUpdate: () => {
      if (cancelled) return;
      applyEased(progress.k);
      onChange();
    },
  });

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      anim.cancel();
    },
  };
}
