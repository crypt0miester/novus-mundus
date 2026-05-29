/**
 * Bundle the prop-sync effects that keep the live three.js scene in
 * step with React state — resize, terrain rebuild, marker updates,
 * mode transition, touch-orbit, reset chip, imperative focusRequest,
 * and the home-disc auto-focus snap.
 *
 * Each block was an individual `useEffect` in the orchestrator. Moving
 * them here keeps the component body to top-level hook calls without
 * changing semantics — each effect's deps array is preserved verbatim.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CityAccount } from "novus-mundus-sdk";

import type { CityTerrainMapWebGLProps } from "../CityTerrainMapWebGL";
import { cssPxPerCellAt, getElevationAt, gridToWorld, midpointElevation } from "../coords";
import { INITIAL_DISTANCE_2D, INITIAL_DISTANCE_3D, cityCameraSizeFactor } from "../controls";
import {
  buildTerrainMesh,
  meshFromBakedPixels,
  COLOR_TEXTURE_SIZE_HIGH,
  COLOR_TEXTURE_SIZE_PREVIEW,
} from "../buildTerrainMesh";
import { getBakeWorker } from "@/lib/world/bakeWorkerClient";
import { runModeTransition, runViewTween, shouldRunTransition, snapToMode } from "../transition";
import type { MapMode } from "@/lib/store/settings";
import type { BiomeKnobs } from "@/lib/world/biome";
import type { SceneRefs } from "./setupCityScene";

type RefObject<T> = { current: T };

export interface UseSceneSyncArgs {
  refs: RefObject<SceneRefs | null>;
  propsRef: RefObject<CityTerrainMapWebGLProps>;
  props: CityTerrainMapWebGLProps;
  size: { w: number; h: number };
  terrain: { biomeSeed: number; knobs: BiomeKnobs };
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
  requestRender: () => void;
  /* Same ref the mount-effect uses to remember the home-disc auto-
   * focus has already fired for the current city. Shared so the
   * snap-to-cell effect doesn't double-fire after mount. */
  autoFocusedForCityRef: RefObject<number | null>;
  /* Used by the inspection-labels prop sync. */
  inspectionTeamMatePubkeys?: string[];
}

export function useSceneSync({
  refs,
  propsRef,
  props,
  size,
  terrain,
  rgu,
  cityLatGrid,
  cityLongGrid,
  requestRender,
  autoFocusedForCityRef,
}: UseSceneSyncArgs): void {
  /* Resize. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.renderer.setSize(size.w, size.h, false);
    r.cssRenderer.setSize(size.w, size.h);
    r.camera.aspect = size.w / size.h;
    r.camera.updateProjectionMatrix();
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  /* Rebuild terrain when terrain identity or rgu changes.
   *
   * Two-phase: synchronous 512² preview swaps in immediately; the
   * high-res 4096² bake runs on the Worker and swaps when ready.
   * Cleanup cancels the in-flight job so a fast city switch drops
   * the stale result. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const old = r.terrain;
    const preview = buildTerrainMesh(
      terrain.biomeSeed,
      rgu,
      terrain.knobs,
      COLOR_TEXTURE_SIZE_PREVIEW,
    );
    preview.heightScale.value = r.controller.getMode() === "iso" ? 1 : 0;
    r.scene.remove(old.mesh);
    old.geometry.dispose();
    old.material.dispose();
    old.colorMap.dispose();
    r.scene.add(preview.mesh);
    r.terrain = preview;
    r.rgu = rgu;
    r.cityLatGrid = cityLatGrid;
    r.cityLongGrid = cityLongGrid;
    r.markers.setTerrain(terrain);
    r.markers.setCenterGrid(cityLatGrid, cityLongGrid, rgu);
    /* Distance bounds: max = mode default (zoom 1×), min = max/200.
     * Re-applied here so a city switch re-clamps in case the user
     * was zoomed in at the previous city. */
    const maxD = r.controller.getMode() === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    r.controller.setDistanceBounds(maxD / 200, maxD);
    requestRender();

    const job = getBakeWorker().bake({
      biomeSeed: terrain.biomeSeed,
      rgu,
      knobs: terrain.knobs,
      texSize: COLOR_TEXTURE_SIZE_HIGH,
    });
    job.promise.then((pixels) => {
      if (!pixels) return;
      const rr = refs.current;
      if (!rr || rr.terrain !== preview) return;
      const high = meshFromBakedPixels(pixels, COLOR_TEXTURE_SIZE_HIGH);
      high.heightScale = preview.heightScale;
      rr.scene.remove(preview.mesh);
      preview.geometry.dispose();
      preview.material.dispose();
      preview.colorMap.dispose();
      rr.scene.add(high.mesh);
      rr.terrain = high;
      requestRender();
    });

    return () => {
      job.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    terrain,
    rgu,
    cityLatGrid,
    cityLongGrid,
    props.cityAccount.widthGrid,
    props.cityAccount.heightGrid,
  ]);

  /* Push occupants / selection on each relevant prop change. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const cssPx = cssPxPerCellAt(r.camera, r.controller.getTarget(), r.rgu, size.h);
    r.markers.updateOccupants(
      props.occupied,
      props.selectedEntity ?? null,
      props.myPlayerPubkey,
      cssPx,
    );
    r.markers.updateLanding(props.selected, cssPx);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.occupied, props.selected, props.selectedEntity, props.myPlayerPubkey, size.h]);

  /* Push walks. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.markers.updateOwnWalk(props.travel ?? null);
    r.markers.updateOtherWalks(props.otherWalks ?? []);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.travel, props.otherWalks]);

  /* Mode change: tween (or snap if prefers-reduced-motion).
   * `lastRequestedModeRef` tracks what the orchestrator asked for —
   * NOT the controller's committed mode, which only flips at tween
   * completion. Comparing against the requested mode lets a fast
   * second toggle start a reversing tween. */
  const lastRequestedModeRef = useRef<MapMode>(props.mapMode);
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const from = lastRequestedModeRef.current;
    const to = props.mapMode;
    if (!shouldRunTransition(from, to)) return;
    lastRequestedModeRef.current = to;

    let selectionTargetXZ: { x: number; z: number } | null = null;
    const sel = props.selectedEntity ?? props.selected;
    if (sel) {
      const ox = sel.gridLong - cityLongGrid;
      const oy = sel.gridLat - cityLatGrid;
      const { wx, wz } = gridToWorld(ox, oy, rgu);
      selectionTargetXZ = { x: wx, z: wz };
    }

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Preserve the user's relative zoom across the mode toggle. */
    const sizeFactor = cityCameraSizeFactor(props.cityAccount);
    const oldMax = (from === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) * sizeFactor;
    const newMax = (to === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) * sizeFactor;
    const distanceFrom = r.controller.getDistance();
    const relativeZoom = Math.max(0, Math.min(1, distanceFrom / oldMax));
    const distanceTo = relativeZoom * newMax;

    /* Update controller's distance bounds for the new mode. */
    r.controller.setDistanceBounds(newMax / 200, newMax);

    if (reduce) {
      r.modeTween?.cancel();
      snapToMode(r.controller, r.terrain, to, selectionTargetXZ);
      r.controller.setDistanceHard(distanceTo);
      props.onModeCommitted(to);
      requestRender();
      return;
    }

    r.modeTween?.cancel();
    r.viewTween?.cancel();
    r.modeTween = runModeTransition({
      controller: r.controller,
      terrain: r.terrain,
      fromMode: from,
      toMode: to,
      selectionTargetXZ,
      distanceFrom,
      distanceTo,
      onChange: requestRender,
      onComplete: (mode) => {
        if (refs.current) refs.current.modeTween = null;
        propsRef.current.onModeCommitted(mode);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mapMode]);

  /* Touch-orbit toggle passes through to the controller. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.controller.setTouchOrbitEnabled(props.touchOrbitEnabled);
  }, [props.touchOrbitEnabled, refs]);

  /* Reset trigger — orchestrator bumps a counter and the scene runs
   * an in-mode view tween back to defaults. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (props.resetTrigger === 0) return;
    r.viewTween?.cancel();
    const mode = r.controller.getMode();
    const dDefault = mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    const tDefault = new THREE.Vector3(0, mode === "iso" ? midpointElevation() : 0, 0);
    r.viewTween = runViewTween(
      r.controller,
      { target: tDefault, distance: dDefault, yaw: 0 },
      requestRender,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetTrigger]);

  /* Focus request — imperative `focusCell()` payload-counter prop;
   * runs an in-mode view tween to the requested cell at near-maximum
   * zoom. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const req = props.focusRequest;
    if (!req) return;
    const ox = req.gridLong - r.cityLongGrid;
    const oy = req.gridLat - r.cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, r.rgu);
    const mode = r.controller.getMode();
    const baseMax = mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    const sizeFactor = cityCameraSizeFactor(propsRef.current.cityAccount as CityAccount);
    const maxD = baseMax * sizeFactor;
    const targetDistance = maxD / 200;
    const targetVec = new THREE.Vector3(wx, mode === "iso" ? midpointElevation() : 0, wz);
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      { target: targetVec, distance: targetDistance },
      requestRender,
      req.durationMs ?? 520,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusRequest]);

  /* Auto-focus on a cell when mounting the home-city disc. Fires
   * once per cityId via the autoFocusCell prop changing. SNAP, not
   * tween — the user navigates to /map expecting to land already
   * centred on their cell. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (!props.autoFocusCell) return;
    if (autoFocusedForCityRef.current === props.cityAccount.cityId) return;
    autoFocusedForCityRef.current = props.cityAccount.cityId;

    const ox = props.autoFocusCell.gridLong - cityLongGrid;
    const oy = props.autoFocusCell.gridLat - cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, rgu);
    const mode = r.controller.getMode();
    const dTarget = (mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) / 16;
    r.viewTween?.cancel();
    r.viewTween = null;
    r.controller.setDistanceHard(dTarget);
    r.controller.setTargetHard(
      new THREE.Vector3(wx, mode === "iso" ? getElevationAt(ox, oy) : 0, wz),
    );
    /* Force-apply the snap before the next paint; controller.update(0)
     * won't, because desired===smoothed leaves `moved` false. */
    r.controller.applyToCamera();
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.autoFocusCell?.gridLat,
    props.autoFocusCell?.gridLong,
    props.cityAccount.cityId,
    cityLatGrid,
    cityLongGrid,
    rgu,
    terrain,
  ]);
}
