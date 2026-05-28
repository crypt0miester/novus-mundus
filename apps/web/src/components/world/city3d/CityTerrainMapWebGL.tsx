"use client";

/**
 * WebGL renderer for the city terrain.
 *
 * Renders BOTH 2D and 3D modes inside a single three.js scene — the
 * difference is just camera pitch + `mesh.scale.y`, which the mode-
 * transition tween (transition.ts) lerps between two presets. There
 * is no per-mode renderer swap; the same WebGL context drives both
 * looks, so the Google-Maps-style tilt animation can run.
 *
 * The Canvas2D path survives in CityTerrainMap2DFallback.tsx and is
 * mounted by the orchestrator (CityTerrainMap.tsx) only when WebGL2
 * initialisation fails.
 *
 * Render policy: on-demand. The only rAF loop is the mode-transition
 * tween or an in-mode view tween; outside those, paints happen on
 * camera/state changes only. Steady-state CPU usage is ~0%.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { toGrid, OCCUPANT_CASTLE, type CityAccount } from "novus-mundus-sdk";
import {
  biomeAt,
  biomeKnobsFromCity,
  biomeName,
  isPassableBiome,
  type BiomeKnobs,
} from "@/lib/world/biome";

/* Minimal terrain handle for the WebGL renderer — biome lookups for
 * click + hover go through this struct. Pre-flat-strategy this was a
 * fully-fledged elevation/moisture/anchor sample; under flat-strategy
 * the biome sampler (biomeAt) is the only consumer, so the struct
 * collapses to a biomeSeed + per-city knob tuple. */
interface CityTerrain {
  biomeSeed: number;
  knobs: BiomeKnobs;
}
function cityTerrain(city: CityAccount): CityTerrain {
  return {
    biomeSeed: city.biomeSeed >>> 0,
    knobs: biomeKnobsFromCity(city),
  };
}
function isPassable(terrain: CityTerrain, ox: number, oy: number): boolean {
  return isPassableBiome(biomeAt(terrain.biomeSeed, ox, oy, terrain.knobs));
}
import type { MapMode } from "@/lib/store/settings";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import type {
  CityTerrainEntity,
  DotTooltip,
  WalkLine,
} from "../CityTerrainMap2DFallback";

import styles from "../CityTerrainMap.module.css";
import {
  MARKER_FLAT_SCALE_Y,
  GRID_OVERLAY_MIN_CSS_PX_PER_CELL,
  MAX_HEIGHT,
  MESH_SIZE,
  METERS_PER_GRID_UNIT,
  cssPxPerCellAt,
  getElevationAt,
  gridToWorld,
  midpointElevation,
  worldToGrid,
} from "./coords";
import {
  buildTerrainMesh,
  meshFromBakedPixels,
  COLOR_TEXTURE_SIZE_HIGH,
  COLOR_TEXTURE_SIZE_PREVIEW,
  type BuiltTerrainMesh,
} from "./buildTerrainMesh";
import { getBakeWorker } from "@/lib/world/bakeWorkerClient";
import {
  CityCameraController,
  FOV_DEG,
  INITIAL_DISTANCE_2D,
  INITIAL_DISTANCE_3D,
  PITCH_2D,
  PITCH_3D,
  cityCameraSizeFactor,
} from "./controls";
import { MarkersLayer } from "./markers";
import { InspectionLabelsLayer } from "./inspectionLabels";
import {
  runModeTransition,
  runViewTween,
  shouldRunTransition,
  snapToMode,
} from "./transition";
import {
  setupCityScene,
  type SceneRefs,
  type SceneHandlersRef,
} from "./hooks/setupCityScene";

export interface HoverReadout {
  /** Capitalised biome name (e.g. "Forest", "Sand", "Shore") — mirrors
   * the 2D fallback's vocabulary so screen readers see no difference
   * between renderers. */
  label: string;
  distM: number;
  passable: boolean;
  outOfBounds: boolean;
}

export interface PickInfo {
  gridLat: number;
  gridLong: number;
  passable: boolean;
  outOfBounds: boolean;
  entityAtCell: CityTerrainEntity | null;
}

export interface CityTerrainMapWebGLProps {
  cityAccount: CityAccount;
  selected: { gridLat: number; gridLong: number } | null;
  selectedEntity: CityTerrainEntity | null;
  occupied: OccupiedCell[];
  travel?: WalkLine | null;
  otherWalks?: WalkLine[];
  myPlayerPubkey?: string;
  autoFocusCell?: { gridLat: number; gridLong: number } | null;
  mapMode: MapMode;
  /* Fires when the toggle pill (rendered by the orchestrator) wants
   * to change modes — the scene runs the tween and calls
   * `onModeCommitted` once it finishes so the orchestrator can
   * commit the change in useSettings. */
  onModeCommitted: (m: MapMode) => void;
  onPick: (info: PickInfo) => void;
  onHover: (info: HoverReadout | null) => void;
  onZoomChange: (zoom: number) => void;
  onCellsVisibleChange: (cellsVisible: boolean) => void;
  onContextLost: () => void;
  /* Toggle-pill state — orchestrator owns the touch-orbit pill but
   * forwards its checked-state to the scene's controller. */
  touchOrbitEnabled: boolean;
  /* Imperative reset trigger from the orchestrator's reset chip.
   * Bumping this counter runs an in-mode reset tween. */
  resetTrigger: number;
  /* Resolver for occupant labels — mirrors the prop the 2D fallback
   * receives. The 3D renderer uses it to populate the inspection-band
   * label pool and the active hover tooltip with name + level + tier
   * + cosmetics. When undefined, labels and the active tooltip don't
   * render (matches the 2D fallback's behaviour). */
  getDotTooltip?: (
    occupant: string,
    occupantType: number,
  ) => DotTooltip | null;
  /* Pubkeys of OTHER players on the local viewer's team — passed
   * straight through to the inspection-band label sizer (teammates
   * get a higher priority so collisions hide neutrals first). */
  teamMatePubkeys?: string[];
  /* Active hover occupant + its projected screen position. Fires on
   * pointer-move when the hovered cell is occupied; null on miss or
   * pointer leave. The orchestrator uses this to render Variant B
   * (cosmetic frame + badge + title + level/tier readout) anchored
   * to the cell's projected XY in CSS px. */
  onActiveOccupant?: (
    info: {
      cell: OccupiedCell;
      screen: { x: number; y: number };
    } | null,
  ) => void;
  /* Imperative focus request — payload-counter pattern. Orchestrator
   * bumps `nonce` on each `focusCell()` call so the same (gridLat,
   * gridLong) re-fires cleanly. The 3D renderer's `useEffect` keys
   * on this prop's identity, converts grid → world XZ, and runs an
   * in-mode view tween toward the cell at near-maximum zoom. Mirrors
   * the 2D fallback's `focusCell` helper. */
  focusRequest?: {
    nonce: number;
    gridLat: number;
    gridLong: number;
    durationMs?: number;
  } | null;
  /* Fired when a user taps an inspection-band label pill. Parent
   * typically does both: focus the camera on the cell + commit the
   * entity selection (so the EntityPanel opens). */
  onLabelClick?: (cell: OccupiedCell) => void;
}

/* `SceneRefs` lives in hooks/setupCityScene.ts now — the orchestrator
 * just references the imported type. */

const HOVER_THROTTLE_MS = 33;

/* Mount the WebGL renderer into the wrap. Returns a ref object the
 * caller pokes via `useEffect` to push state updates. */
export function CityTerrainMapWebGL(props: CityTerrainMapWebGLProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const scaleBarRef = useRef<HTMLDivElement | null>(null);
  const compassRef = useRef<HTMLDivElement | null>(null);

  const refs = useRef<SceneRefs | null>(null);
  const propsRef = useRef<CityTerrainMapWebGLProps>(props);
  useEffect(() => {
    propsRef.current = props;
  });

  /* Derived inputs — kept stable across renders via useMemo where
   * possible. */
  const terrain = useMemo(() => cityTerrain(props.cityAccount), [props.cityAccount]);
  const cityLatGrid = toGrid(props.cityAccount.latitude);
  const cityLongGrid = toGrid(props.cityAccount.longitude);
  const rgu = useMemo(
    () => Math.max(props.cityAccount.widthGrid, props.cityAccount.heightGrid) / 2,
    [props.cityAccount.widthGrid, props.cityAccount.heightGrid],
  );
  // Mirror terrain into a ref so the mount-bound controller callbacks
  // (onFrameSelectedRequested etc.) and any other long-lived closure
  // can read the latest city's terrain without re-binding through the
  // controller every city switch.
  const terrainRef = useRef(terrain);
  useEffect(() => {
    terrainRef.current = terrain;
  }, [terrain]);

  /* Track logical canvas size — drives the renderer's setSize calls
   * and the cssPxPerCellAt computation. Debounced via the same
   * 150 ms ResizeObserver pattern the Canvas2D path uses. */
  const [size, setSize] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      setSize((prev) =>
        Math.abs(prev.w - w) > 4 || Math.abs(prev.h - h) > 4 ? { w, h } : prev,
      );
    };
    const schedule = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(measure, 150);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, []);

  /* Stable handler shim — long-lived controller callbacks (bound once
   * at mount inside `setupCityScene`) read through this ref so they
   * always hit the LATEST React closure rather than the snapshot
   * captured at first mount. Sync every render — the cost is one
   * object literal, the win is that prop changes (a new
   * `onEntitySelect`) propagate without re-mounting the scene. */
  const handlersRef = useRef<SceneHandlersRef["current"]>({
    handleClick: () => {},
    handleDoubleClick: () => {},
    handleResetRequested: () => {},
    handleFrameSelected: () => {},
    handlePointerMove: () => {},
    requestRender: () => {},
  });

  /* Build the scene exactly once. Subsequent prop changes flow
   * through targeted `useEffect`s below. */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const scaleBarEl = scaleBarRef.current;
    const compassEl = compassRef.current;
    if (!scaleBarEl || !compassEl) return;

    const result = setupCityScene({
      wrap,
      scaleBarEl,
      compassEl,
      cityAccount: props.cityAccount,
      mapMode: props.mapMode,
      autoFocusCell: props.autoFocusCell,
      teamMatePubkeys: props.teamMatePubkeys,
      terrain,
      rgu,
      cityLatGrid,
      cityLongGrid,
      propsRef,
      autoFocusedForCityRef,
      handlersRef,
    });
    if (!result) return;
    refs.current = result.sceneRefs;
    return result.dispose;
    /* Empty deps — scene mounts ONCE. Prop changes hit the targeted
     * effects below. */
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);


  /* Resize on size change. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.renderer.setSize(size.w, size.h, false);
    r.cssRenderer.setSize(size.w, size.h);
    r.camera.aspect = size.w / size.h;
    r.camera.updateProjectionMatrix();
    requestRender();
  }, [size.w, size.h]);

  /* Rebuild terrain when terrain identity or rgu changes.
   *
   * Two-phase: synchronous 512² preview swaps in immediately so the
   * city is visible right away; the high-res 4096² bake runs on the
   * Worker and swaps when ready. Cleanup cancels the in-flight job
   * so a fast city switch drops the stale result. */
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
      // Share heightScale across swap — see mount-effect note above.
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
  }, [terrain, rgu, cityLatGrid, cityLongGrid, props.cityAccount.widthGrid, props.cityAccount.heightGrid]);

  /* Push occupant/selection/walk state into the markers layer on
   * each relevant prop change. The markers layer no-ops if its inputs
   * haven't actually changed shape-wise, so React-render churn from
   * the parent doesn't translate into GPU thrash. */
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
  }, [
    props.occupied,
    props.selected,
    props.selectedEntity,
    props.myPlayerPubkey,
    size.h,
  ]);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.markers.updateOwnWalk(props.travel ?? null);
    r.markers.updateOtherWalks(props.otherWalks ?? []);
    requestRender();
  }, [props.travel, props.otherWalks]);

  /* Mode change: run the tween (or snap if prefers-reduced-motion).
   * Selection-aware framing: if an entity or landing cell is
   * selected, target.x/z tweens to its world position so the focused
   * cell stays centred under the tilt.
   *
   * `lastRequestedModeRef` tracks the most recent mode the orchestrator
   * asked us to be in — NOT the controller's committed mode, which
   * only flips at tween completion. Comparing against the requested
   * mode lets a fast second toggle (e.g. 2D→3D press, then 3D→2D
   * press 200ms later) start a reversing tween instead of short-
   * circuiting via shouldRunTransition(committed, target) === false. */
  const lastRequestedModeRef = useRef<MapMode>(props.mapMode);
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const from = lastRequestedModeRef.current;
    const to = props.mapMode;
    if (!shouldRunTransition(from, to)) return;
    lastRequestedModeRef.current = to;

    /* Pick selection target if any. */
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

    /* Preserve the user's relative zoom across the mode toggle.
     * Compute the fractional zoom against the OLD max (before
     * `setDistanceBounds` clamps), then apply the same fraction to the
     * NEW max. Without this, switching modes snaps the camera to the
     * destination mode's default distance — a 2D-zoomed-in user
     * suddenly framed wide on toggle to 3D, or vice versa. */
    const sizeFactor = cityCameraSizeFactor(props.cityAccount);
    const oldMax =
      (from === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) * sizeFactor;
    const newMax =
      (to === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) * sizeFactor;
    const distanceFrom = r.controller.getDistance();
    const relativeZoom = Math.max(0, Math.min(1, distanceFrom / oldMax));
    const distanceTo = relativeZoom * newMax;

    /* Update controller's distance bounds for the new mode at start
     * of the tween — the user might be zoomed past the new mode's
     * max, which the controller's setDistanceBounds re-clamps. */
    r.controller.setDistanceBounds(newMax / 200, newMax);

    if (reduce) {
      r.modeTween?.cancel();
      snapToMode(r.controller, r.terrain, to, selectionTargetXZ);
      r.controller.setDistanceHard(distanceTo);
      props.onModeCommitted(to);
      requestRender();
      return;
    }

    /* Cancel any in-flight mode tween + view tween before starting. */
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
  }, [props.mapMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Touch-orbit toggle passes through to the controller. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.controller.setTouchOrbitEnabled(props.touchOrbitEnabled);
  }, [props.touchOrbitEnabled]);

  /* Reset trigger — orchestrator bumps a counter and the scene runs
   * an in-mode view tween back to defaults. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    if (props.resetTrigger === 0) return;
    r.viewTween?.cancel();
    const mode = r.controller.getMode();
    const dDefault = mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    const tDefault = new THREE.Vector3(
      0,
      mode === "iso" ? midpointElevation() : 0,
      0,
    );
    r.viewTween = runViewTween(
      r.controller,
      { target: tDefault, distance: dDefault, yaw: 0 },
      requestRender,
    );
  }, [props.resetTrigger]);

  /* Focus request — imperative `focusCell()` handle on the orchestrator
   * sets a payload-counter prop; we run an in-mode view tween to the
   * requested cell at near-maximum zoom. Mirrors the 2D fallback's
   * `focusCell` (CityTerrainMap2DFallback.tsx:570) so callers (entity-
   * panel name-click, future nav prompts) get the same UX on either
   * renderer. The `nonce` in the payload distinguishes successive calls
   * to the same coords. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const req = props.focusRequest;
    if (!req) return;
    /* Convert grid coord → world XZ using the same projection the
     * marker layer + click handler share, so the focused cell lands
     * dead-centre under the new camera target. */
    const ox = req.gridLong - r.cityLongGrid;
    const oy = req.gridLat - r.cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, r.rgu);
    const mode = r.controller.getMode();
    /* Target distance — match the 2D fallback's MAX_VIEW_SCALE = 500
     * (distance = max / 500). Under flat-strategy the mesh has no
     * elevation so the "can't dive too deep into a peak" caveat from
     * the elevation-era is moot; we go as close as the controller
     * allows. The controller's minDistance is `maxDistance / 200`, so
     * `maxD / 200` lands exactly at the deepest legal zoom — same
     * single-cell-fills-the-screen feel as the 2D path at full zoom. */
    const baseMax =
      mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    const sizeFactor = cityCameraSizeFactor(propsRef.current.cityAccount);
    const maxD = baseMax * sizeFactor;
    const targetDistance = maxD / 200;
    const targetVec = new THREE.Vector3(
      wx,
      mode === "iso" ? midpointElevation() : 0,
      wz,
    );
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      { target: targetVec, distance: targetDistance },
      requestRender,
      req.durationMs ?? 520,
    );
  }, [props.focusRequest]);

  /* Auto-focus on a cell when mounting the home-city disc. Fires
   * once per cityId via the autoFocusCell prop changing.
   *
   * SNAP, not tween — the user navigates to /map expecting to land
   * already centred on their cell. Tweening leaves a visible flash
   * of the default overview before animating in, which reads as a
   * load glitch rather than a smooth entrance. The mount effect
   * also snaps when autoFocusCell is known at mount; this effect
   * catches the case where `player` hasn't loaded yet by mount
   * time and autoFocusCell becomes non-null on a later render. */
  const autoFocusedForCityRef = useRef<number | null>(null);
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
      new THREE.Vector3(
        wx,
        mode === "iso" ? getElevationAt(ox, oy) : 0,
        wz,
      ),
    );
    /* Force-apply the snap to the camera before the next paint;
     * controller.update(0) won't, because desired===smoothed leaves
     * `moved` false and the apply call is gated on it. */
    r.controller.applyToCamera();
    requestRender();
    // No cleanup: resetting autoFocusedForCityRef on every dep change
    // (e.g. when autoFocusCell coords update after an intracity walk)
    // would defeat the documented "fires once per cityId" guard above
    // and yank the camera back to the focused cell on every walk.
  }, [
    props.autoFocusCell?.gridLat,
    props.autoFocusCell?.gridLong,
    props.cityAccount.cityId,
    cityLatGrid,
    cityLongGrid,
    rgu,
    terrain,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Helpers (closed over refs) ─────────────────────────── */

  const requestRender = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    if (r.paintQueued) return;
    r.paintQueued = true;
    requestAnimationFrame((now) => {
      if (!refs.current) return;
      paint(now);
    });
  }, []);

  const paint = useCallback((now: number) => {
    const r = refs.current;
    if (!r) return;
    r.paintQueued = false;
    const dt = Math.min(0.1, Math.max(0, (now - r.lastUpdateMs) / 1000));
    r.lastUpdateMs = now;

    /* Tween rAF self-schedules; here we only need to ensure the
     * controller's smoothing is applied and the camera is rebuilt.
     * `update` returns true if anything moved, in which case we
     * need to keep painting until the smoothing settles. */
    const moved = r.controller.update(dt);

    /* Push CSS-px-per-cell to markers so they swap dot/tile mode if
     * threshold crossed. */
    const canvasH = r.renderer.domElement.clientHeight;
    const cssPx = cssPxPerCellAt(
      r.camera,
      r.controller.getTarget(),
      r.rgu,
      canvasH,
    );
    /* Markers follow the terrain's effective height scale but with a
     * MARKER_FLAT_SCALE_Y floor — their raycaster needs a non-singular
     * world matrix to dispatch hits in 2D mode. The terrain mesh itself
     * has no such floor (its uniform handles the visual flatten). */
    r.markers.setTerrainScaleY(
      Math.max(MARKER_FLAT_SCALE_Y, r.terrain.heightScale.value),
    );
    r.markers.updateCentreScale(cssPx);
    r.markers.updateGrid(cssPx, r.controller.getTarget());

    /* Re-evaluate occupant layer mode (dot vs tile) on each paint —
     * markers.updateOccupants is the canonical entry but it requires
     * the latest props. Just re-fire it with current props. */
    const p = propsRef.current;
    r.markers.updateOccupants(
      p.occupied,
      p.selectedEntity ?? null,
      p.myPlayerPubkey,
      cssPx,
    );
    r.markers.updateLanding(p.selected, cssPx);

    /* Inspection-band labels — refresh every paint so projected
     * positions track camera motion. The layer itself short-circuits
     * when the zoom is outside the inspection band. */
    const zoom = r.controller.getDisplayZoom();
    const canvasW = r.renderer.domElement.clientWidth;
    r.inspectionLabels.update({
      occupied: p.occupied,
      getDotTooltip: p.getDotTooltip,
      myPlayerPubkey: p.myPlayerPubkey,
      selectedEntity: p.selectedEntity ?? null,
      viewScale: zoom,
      camera: r.camera,
      canvasW,
      canvasH,
      cityLatGrid: r.cityLatGrid,
      cityLongGrid: r.cityLongGrid,
      rgu: r.rgu,
      teamMatePubkeys: p.teamMatePubkeys,
      onLabelClick: p.onLabelClick,
    });

    r.renderer.render(r.scene, r.camera);
    r.cssRenderer.render(r.scene, r.camera);

    /* Notify orchestrator of zoom + cells-visible state for the
     * status row. Throttled — only fire on change. */
    p.onZoomChange(zoom);
    p.onCellsVisibleChange(cssPx >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL);

    /* LOD scaffolding ripped out — under flat-strategy the mesh is a
     * single flat quad with no vertex displacement, so per-zoom LOD
     * rebuilds were a no-op (`coords.ts:lodForZoom` already always
     * returned "high"). The dead conditional + rebuild branch lived
     * here and synchronously rebuilt the 4096² DataTexture on the
     * main thread per zoom step, which it never actually wanted to
     * do — dropped entirely. */

    updateScaleBar(r);
    updateCompass(r);

    /* If the controller is still smoothing toward a desired state
     * (gesture in flight or just released), schedule the next paint. */
    if (moved) {
      r.paintQueued = true;
      requestAnimationFrame((t) => paint(t));
    }
  }, []);

  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    const r = refs.current;
    if (!r) return;
    const now = performance.now();
    if (now - r.lastHoverTs < HOVER_THROTTLE_MS) return;
    r.lastHoverTs = now;

    /* Marker raycast FIRST so an occupant under the pointer wins the
     * hover even if the terrain ray would land on a neighbouring cell.
     * Active-occupant emission fires from this path so the orchestrator
     * can render the Variant B tooltip; pure-terrain hovers fire only
     * the biome hover label. */
    const p = propsRef.current;
    const markerHit = raycastMarkers(r, clientX, clientY, p.occupied);
    if (markerHit && p.onActiveOccupant) {
      let cell = markerHit.cell;
      /* Castles emit N² OccupiedCell entries (one per footprint cell)
       * with identical occupant pubkey but different grid coords. The
       * 2D-mode ground-plane fallback in raycastMarkers can return ANY
       * of those cells; anchoring the tooltip to whichever cell was
       * hit makes the bubble jump 1–3 cells SW→NE as the cursor slides
       * across the same castle. Snap to the anchor (the one cell with
       * footprintAnchor=true) so the tooltip stays put for the whole
       * footprint. */
      if (cell.occupantType === OCCUPANT_CASTLE && cell.footprintAnchor !== true) {
        const anchor = p.occupied.find(
          (c) =>
            c.occupantType === OCCUPANT_CASTLE &&
            c.occupant === cell.occupant &&
            c.footprintAnchor === true,
        );
        if (anchor) cell = anchor;
      }
      const ox = cell.gridLong - r.cityLongGrid;
      const oy = cell.gridLat - r.cityLatGrid;
      const halfSide = MESH_SIZE / 2;
      const wx = (ox / r.rgu) * halfSide;
      const wz = -(oy / r.rgu) * halfSide;
      const tmpV = new THREE.Vector3(wx, 0, wz);
      tmpV.project(r.camera);
      const canvasW = r.renderer.domElement.clientWidth;
      const canvasH = r.renderer.domElement.clientHeight;
      /* Canvas-relative coords (NOT viewport) — the orchestrator
       * renders the Variant B tooltip inside the position:relative
       * `.canvasWrap` so the inline `left/top` is anchored to the
       * wrap's top-left, which is the same as the canvas's top-left
       * (canvas is `position:absolute; inset: 0`). */
      const screenX = (tmpV.x * 0.5 + 0.5) * canvasW;
      const screenY = (-tmpV.y * 0.5 + 0.5) * canvasH;
      p.onActiveOccupant({
        cell: cell as OccupiedCell,
        screen: { x: screenX, y: screenY },
      });
    } else if (p.onActiveOccupant) {
      p.onActiveOccupant(null);
    }

    const hit = raycast(r, clientX, clientY);
    if (!hit) {
      p.onHover(null);
      return;
    }
    const { ox, oy } = worldToGrid(hit.point.x, hit.point.z, r.rgu);
    /* AABB bounds — the chain validates with `is_within_city_grid`
     * (|ox| ≤ widthGrid/2, |oy| ≤ heightGrid/2). The previous disc
     * check (`ox² + oy² > rgu²`) rejected the four corners of the
     * square plot even though they're legal landing cells. */
    const cityAcc = p.cityAccount;
    const plotHalfW = cityAcc.widthGrid / 2;
    const plotHalfH = cityAcc.heightGrid / 2;
    const outOfBounds = Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH;
    if (outOfBounds) {
      p.onHover(null);
      return;
    }
    /* Sample biome fresh from the city account — mirrors the 2D
     * fallback's hover readout. */
    const knobs = biomeKnobsFromCity(cityAcc);
    const biome = biomeAt(cityAcc.biomeSeed, ox, oy, knobs);
    const passable = isPassableBiome(biome);
    const rawName = biomeName(biome);
    const label = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
    p.onHover({ label, distM, passable, outOfBounds: false });
  }, []);

  const handleClick = useCallback((clientX: number, clientY: number) => {
    const r = refs.current;
    if (!r) return;
    /* Try marker raycast first — if the user's click lands on a
     * rendered dot/tile we resolve the cell from the instance id
     * directly, no grid-coord round-trip risk. Pass the latest
     * occupied snapshot so the ground-plane fallback inside
     * raycastMarkers can match against current cells. */
    const markerHit = raycastMarkers(r, clientX, clientY, propsRef.current.occupied);
    if (markerHit) {
      propsRef.current.onPick({
        gridLat: markerHit.cell.gridLat,
        gridLong: markerHit.cell.gridLong,
        passable: true,
        outOfBounds: false,
        entityAtCell: {
          pubkey: markerHit.cell.occupant,
          occupantType: markerHit.cell.occupantType,
          gridLat: markerHit.cell.gridLat,
          gridLong: markerHit.cell.gridLong,
        },
      });
      return;
    }
    const hit = raycast(r, clientX, clientY);
    if (!hit) {
      /* Click outside the mesh entirely. Treat as a deselect — the
       * orchestrator handles entity-vs-landing branching. */
      propsRef.current.onPick({
        gridLat: 0,
        gridLong: 0,
        passable: false,
        outOfBounds: true,
        entityAtCell: null,
      });
      return;
    }
    const { ox, oy } = worldToGrid(hit.point.x, hit.point.z, r.rgu);
    /* AABB bounds — mirrors the chain's `is_within_city_grid` and the
     * 2D fallback's `plotHalfW` / `plotHalfH` clamp. */
    const cityAcc = propsRef.current.cityAccount;
    const plotHalfW = cityAcc.widthGrid / 2;
    const plotHalfH = cityAcc.heightGrid / 2;
    const outOfBounds = Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH;
    const gridLat = r.cityLatGrid + oy;
    const gridLong = r.cityLongGrid + ox;
    /* Read terrain fresh from props for the same reason as
     * handlePointerMove — controller bindings are mount-time, terrain
     * identity changes with cityAccount. */
    const liveTerrain = cityTerrain(propsRef.current.cityAccount);
    const passable = !outOfBounds && isPassable(liveTerrain, ox, oy);
    /* Strict equality lookup — same contract as the Canvas2D
     * fallback. The marker raycast above (`raycastMarkers`) is the
     * primary path for occupant clicks; this branch only runs when
     * the click landed on raw terrain (empty cell), so it should
     * NEVER fire entity selection. Previously a snap-to-nearest
     * here was hijacking landing-cell picks within 14 CSS px of any
     * occupant. */
    const p = propsRef.current;
    const exact = p.occupied.find(
      (c) => c.gridLat === gridLat && c.gridLong === gridLong,
    );
    const hitCell: typeof exact = exact;
    const entityAtCell = hitCell
      ? {
          pubkey: hitCell.occupant,
          occupantType: hitCell.occupantType,
          gridLat: hitCell.gridLat,
          gridLong: hitCell.gridLong,
        }
      : null;
    const finalGridLat = hitCell ? hitCell.gridLat : gridLat;
    const finalGridLong = hitCell ? hitCell.gridLong : gridLong;
    p.onPick({
      gridLat: finalGridLat,
      gridLong: finalGridLong,
      passable,
      outOfBounds,
      entityAtCell,
    });
  }, []);

  const handleDoubleClick = useCallback((clientX: number, clientY: number) => {
    const r = refs.current;
    if (!r) return;
    const hit = raycast(r, clientX, clientY);
    if (!hit) return;
    /* Double-click zooms in 2× at the cursor. Animate target +
     * distance via the view tween. */
    const targetXZ = new THREE.Vector3(hit.point.x, 0, hit.point.z);
    if (r.controller.getMode() === "iso") {
      targetXZ.y = midpointElevation();
    }
    const newDistance = Math.max(
      0.04,
      r.controller.getDistance() / 2,
    );
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      { target: targetXZ, distance: newDistance },
      requestRender,
    );
  }, []);

  const handleResetRequested = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const mode = r.controller.getMode();
    const tDefault = new THREE.Vector3(
      0,
      mode === "iso" ? midpointElevation() : 0,
      0,
    );
    const dDefault = mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      { target: tDefault, distance: dDefault, yaw: 0 },
      requestRender,
    );
  }, []);

  // F key — Maya/Unity/Blender/Substance "Frame Selected" convention.
  // Tweens to selectedEntity (preferred) or the landing-cell selection,
  // no-op if nothing's selected (don't surprise the user with a reset).
  const handleFrameSelected = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const p = propsRef.current;
    const sel = p.selectedEntity ?? p.selected;
    if (!sel) return;
    const ox = sel.gridLong - r.cityLongGrid;
    const oy = sel.gridLat - r.cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, r.rgu);
    const mode = r.controller.getMode();
    const dTarget = (mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) / 8;
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      {
        target: new THREE.Vector3(
          wx,
          // Read terrain via ref — the controller binds this callback
          // once at mount, so the literal `terrain` closure would freeze
          // at the mount-time city and use stale elevation after a city
          // switch.
          mode === "iso" ? getElevationAt(ox, oy) : 0,
          wz,
        ),
        distance: dTarget,
      },
      requestRender,
    );
  }, []);

  /* Sync handlersRef every render so the controller's mount-bound
   * callbacks always hit the LATEST React closures. Without this,
   * `handleClick` etc. would freeze at first mount and ignore any
   * subsequent prop-driven behaviour changes. */
  handlersRef.current = {
    handleClick,
    handleDoubleClick,
    handleResetRequested,
    handleFrameSelected,
    handlePointerMove,
    requestRender,
  };

  return (
    <>
      <div ref={wrapRef} className={styles.webglWrap} style={{ touchAction: "none" }} />
      <div ref={scaleBarRef} className={styles.scaleBar} />
      <div ref={compassRef} className={styles.compass} />
    </>
  );
}

/* ─── Module-scope helpers (no React state) ──────────────────── */

const tmpVec2 = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _groundHit = new THREE.Vector3();

/* Raycast against the occupant marker meshes (dots + tiles for
 * players and encounters). Returns the source cell of whichever
 * instance the ray hits closest, or null if no marker is hit.
 *
 * In 2D mode the markers group's scale.y collapses to MARKER_FLAT_SCALE_Y
 * (~0.001), which makes the per-instance matrixWorld near-singular
 * and three.js's raycaster can silently miss. The terrain raycast
 * has an explicit Y=0 ground-plane fallback for this; we mirror it
 * here by intersecting the ray with the ground plane and matching
 * the resulting world XZ against the rendered occupant positions. */
function raycastMarkers(
  r: SceneRefs,
  clientX: number,
  clientY: number,
  occupied: OccupiedCell[],
): { cell: import("./markers").OccupiedCell } | null {
  const rect = r.renderer.domElement.getBoundingClientRect();
  tmpVec2.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  tmpVec2.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  r.raycaster.setFromCamera(tmpVec2, r.camera);
  const targets = r.markers.getInteractiveMeshes();
  const hits = r.raycaster.intersectObjects(targets, false);
  for (const h of hits) {
    if (h.instanceId == null) continue;
    const cell = r.markers.cellForInstance(h.object, h.instanceId);
    if (cell) return { cell };
  }
  /* Fallback: project to ground plane and match against occupied
   * cells by exact grid coords. Mirrors the terrain raycast's
   * fallback at the same Y=0 plane — needed because in 2D mode the
   * markers group has scale.y ≈ 0.001, making per-instance
   * matrixWorld near-singular and the standard InstancedMesh
   * raycast silently miss. */
  const planeHit = r.raycaster.ray.intersectPlane(_groundPlane, _groundHit);
  if (!planeHit) return null;
  const { ox, oy } = worldToGrid(planeHit.x, planeHit.z, r.rgu);
  const gridLat = r.cityLatGrid + oy;
  const gridLong = r.cityLongGrid + ox;
  for (const c of occupied) {
    if (c.gridLat === gridLat && c.gridLong === gridLong) return { cell: c };
  }
  return null;
}

function raycast(r: SceneRefs, clientX: number, clientY: number): THREE.Intersection | null {
  const rect = r.renderer.domElement.getBoundingClientRect();
  tmpVec2.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  tmpVec2.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  r.raycaster.setFromCamera(tmpVec2, r.camera);
  const hits = r.raycaster.intersectObject(r.terrain.mesh, false);
  if (hits.length > 0) return hits[0]!;
  /* Mesh raycast can fail in 2D mode where the terrain has
   * near-zero scale.y (the inverse world matrix becomes
   * degenerate; three.js falls back to a zero matrix and the ray
   * goes nowhere). As a defensive fallback, intersect with the
   * world Y=0 ground plane and synthesise a hit if the resulting
   * point lies on the mesh footprint. */
  const intersection = r.raycaster.ray.intersectPlane(_groundPlane, _groundHit);
  if (!intersection) return null;
  const half = MESH_SIZE / 2;
  if (Math.abs(intersection.x) > half || Math.abs(intersection.z) > half) {
    return null;
  }
  return {
    distance: r.raycaster.ray.origin.distanceTo(intersection),
    point: intersection.clone(),
    object: r.terrain.mesh,
  } as THREE.Intersection;
}

function updateScaleBar(r: SceneRefs): void {
  if (!r.scaleBarEl) return;
  /* Visible width on the ground at the camera target. Use horizontal
   * world extent (fov × aspect) so the bar matches what the user
   * sees across the canvas. */
  const dist = r.controller.getDistance();
  const fovRad = (r.camera.fov * Math.PI) / 180;
  const visibleH = 2 * dist * Math.tan(fovRad / 2);
  const visibleW = visibleH * r.camera.aspect;
  /* worldToM: 11 m / grid-unit; cellWorld = MESH_SIZE/rgu world-units/cell.
   * So mPerWorldUnit = 11 m/cell / (MESH_SIZE/rgu) = 11 * rgu / MESH_SIZE. */
  const mPerWorldUnit = (METERS_PER_GRID_UNIT * r.rgu) / MESH_SIZE;
  const visibleM = visibleW * mPerWorldUnit;
  const canvasW = r.renderer.domElement.clientWidth || 1;
  const mPerPx = visibleM / canvasW;
  const targetM = mPerPx * 100;
  const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let scaleM = nice[0]!;
  for (const v of nice) {
    if (v >= targetM * 0.5) {
      scaleM = v;
      break;
    }
  }
  const barPx = Math.round(scaleM / mPerPx);
  const label = scaleM >= 1000 ? scaleM / 1000 + " km" : scaleM + " m";
  r.scaleBarEl.innerHTML = `<div class="${styles.scaleBarBar}" style="width:${barPx}px"></div><span>${label}</span>`;
}

function updateCompass(r: SceneRefs): void {
  if (!r.compassEl) return;
  const yaw = r.controller.getYaw();
  const rot = -((yaw * 180) / Math.PI);
  r.compassEl.innerHTML = `
    <svg viewBox="0 0 32 32" width="32" height="32" style="display:block">
      <g transform="rotate(${rot.toFixed(1)} 16 16)">
        <circle cx="16" cy="16" r="14" fill="var(--parchment, #efe2c4)" stroke="var(--ink-soft, #6b4a2a)" stroke-width="1" opacity="0.85"/>
        <polygon points="16,3 18,14 16,12 14,14" fill="var(--seal, #b45309)"/>
        <polygon points="16,29 18,18 16,20 14,18" fill="var(--ink-soft, #6b4a2a)"/>
        <text x="16" y="9" text-anchor="middle" font-size="6" font-weight="bold" fill="var(--ink, #2e1f10)" font-family="serif">N</text>
      </g>
    </svg>
  `;
}
