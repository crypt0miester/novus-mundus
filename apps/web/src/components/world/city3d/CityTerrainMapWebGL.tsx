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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toGrid, type CityAccount } from "novus-mundus-sdk";
import { biomeKnobsFromCity, type BiomeKnobs } from "@/lib/world/biome";

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
/* `isPassable` was inlined into useSceneInputs along with cityTerrain;
 * the orchestrator still uses cityTerrain() above for the `terrain`
 * useMemo it threads into setupCityScene + the rebuild effect. */
import type { MapMode } from "@/lib/store/settings";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import type { CityTerrainEntity, DotTooltip, WalkLine } from "../CityTerrainMap2DFallback";

import styles from "../CityTerrainMap.module.css";
import { MESH_SIZE, METERS_PER_GRID_UNIT, worldToGrid } from "./coords";
import { setupCityScene, type SceneRefs, type SceneHandlersRef } from "./hooks/setupCityScene";
import { usePaintLoop } from "./hooks/usePaintLoop";
import { useSceneInputs } from "./hooks/useSceneInputs";
import { useSceneSync } from "./hooks/useSceneSync";

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
  /* Canonical yaw preset selected by the orchestrator's view-angle
   * toggle (DEFAULT_YAW 0.68 angled, STRAIGHT_YAW 0 straight). When it
   * changes the scene tweens yaw to it, leaving zoom/center/pitch alone.
   * Omitted on the 2D fallback path (top-down only). */
  viewYaw?: number;
  /* Resolver for occupant labels — mirrors the prop the 2D fallback
   * receives. The 3D renderer uses it to populate the inspection-band
   * label pool and the active hover tooltip with name + level + tier
   * + cosmetics. When undefined, labels and the active tooltip don't
   * render (matches the 2D fallback's behaviour). */
  getDotTooltip?: (occupant: string, occupantType: number) => DotTooltip | null;
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

/* `SceneRefs` + `HOVER_THROTTLE_MS` live in `hooks/setupCityScene.ts`
 * and `hooks/useSceneInputs.ts` respectively now. */

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
      setSize((prev) => (Math.abs(prev.w - w) > 4 || Math.abs(prev.h - h) > 4 ? { w, h } : prev));
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

  /* Tracks the cityId we've already snapped the auto-focus camera for.
   * Shared between the mount effect (initial snap, when autoFocusCell
   * is known at mount time) and the post-mount snap effect in
   * useSceneSync (when autoFocusCell becomes non-null later). */
  const autoFocusedForCityRef = useRef<number | null>(null);

  /* Tracks the cityId an explicit focusCell (locate / label click) has
   * targeted, so the home auto-focus yields to it instead of cancelling
   * the locate tween. Lives alongside autoFocusedForCityRef. */
  const focusRequestedForCityRef = useRef<number | null>(null);

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

  /* ─── Helpers (closed over refs) ─────────────────────────── */

  const { requestRender } = usePaintLoop(refs, propsRef, updateScaleBar, updateCompass);

  const {
    handleClick,
    handleDoubleClick,
    handleResetRequested,
    handleFrameSelected,
    handlePointerMove,
  } = useSceneInputs(refs, propsRef, requestRender, raycastMarkers, raycast);

  /* Prop-sync effects: resize, terrain rebuild, marker updates, mode
   * change, touch-orbit, reset chip, focusRequest, home-disc auto-
   * focus. Each was a separate useEffect in the orchestrator before
   * the split — same semantics, deps preserved verbatim. */
  useSceneSync({
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
    focusRequestedForCityRef,
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const label = scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`;
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
