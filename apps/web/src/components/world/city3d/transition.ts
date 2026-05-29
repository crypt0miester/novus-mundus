/**
 * Mode-transition tween (the Google-Maps tilt).
 *
 * Lerps camera pitch, mesh.scale.y, and target.y in lockstep over
 * ~700 ms with a cubic ease-out, so terrain rises out of the flat
 * plate as the camera tilts back (and the reverse on 3D -> 2D). The
 * controller's `isTransitioning` flag is set for the duration so
 * gestures, clicks, and toggle re-presses are suppressed — otherwise
 * a mid-tween wheel would race the camera and produce visible jitter.
 *
 * This is the ONLY rAF loop that runs in steady state. Outside of an
 * in-flight tween, the WebGL scene renders on demand (see
 * CityTerrainMapWebGL). The loop is started on toggle press and
 * stopped on completion — never both running concurrently with a
 * background animator.
 */

import * as THREE from "three";
import type { MapMode } from "@/lib/store/settings";
import type { CityCameraController } from "./controls";
import { PITCH_2D } from "./controls";
import { midpointElevation } from "./coords";
import type { BuiltTerrainMesh } from "./buildTerrainMesh";

export const TRANSITION_DURATION_MS = 700;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

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

  const startTs = performance.now();
  let rafId: number | null = null;
  let cancelled = false;

  const tick = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - startTs) / TRANSITION_DURATION_MS);
    const e = easeOutCubic(t);

    /* Write both desired AND smoothed values via setPitchHard so the
     * controller's smoothing loop doesn't lerp on top of the tween. */
    controller.setPitchHard(lerp(pitchFrom, pitchTo, e));

    /* Lerp distance so a user who was zoomed into a specific area in
     * 2D doesn't snap to the new mode's default distance on toggle.
     * The caller pre-computes `distanceTo` as the same relative-zoom
     * fraction expressed against the new mode's max distance. */
    controller.setDistanceHard(lerp(opts.distanceFrom, opts.distanceTo, e));

    const newTarget = new THREE.Vector3(
      lerp(xFrom, xTo, e),
      lerp(yFrom, yTo, e),
      lerp(zFrom, zTo, e),
    );
    controller.setTargetHard(newTarget);

    terrain.heightScale.value = lerp(scaleFrom, scaleTo, e);

    opts.onChange();

    if (t >= 1) {
      controller.commitModeChange(toMode);
      controller.setTransitioning(false);
      opts.onComplete(toMode);
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  fromMode;
  rafId = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      controller.setTransitioning(false);
    },
  };
}

/* In-mode view tween (220 ms) for discrete gestures like double-click
 * zoom-in and reset. Mirrors the Canvas2D fallback's `animateView`
 * so the two modes feel like the same product. Any cancel-trigger
 * (new gesture, programmatic cancel) drops the rAF cleanly and the
 * controller's gesture handlers take over. */

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
  const startTs = performance.now();
  let rafId: number | null = null;
  let cancelled = false;

  /* Snapshot smoothed state — the user might be mid-gesture when
   * the tween starts; smoothed is the visible "now". */
  const tFrom = controller.getTarget().clone();
  const dFrom = controller.getDistance();
  const yFrom = controller.getYaw();
  const tTo = to.target ? to.target.clone() : tFrom.clone();
  const dTo = to.distance ?? dFrom;
  const yTo = to.yaw ?? yFrom;

  const tick = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - startTs) / durationMs);
    const e = easeOutCubic(t);

    controller.setTargetHard(
      new THREE.Vector3(lerp(tFrom.x, tTo.x, e), lerp(tFrom.y, tTo.y, e), lerp(tFrom.z, tTo.z, e)),
    );
    controller.setDistanceHard(lerp(dFrom, dTo, e));
    controller.setYawHard(lerp(yFrom, yTo, e));

    onChange();
    if (t >= 1) return;
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    },
  };
}
