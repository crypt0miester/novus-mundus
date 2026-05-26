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
import {
  cityTerrain,
  isPassable,
  radiusToGridUnits,
  sampleTerrain,
  toGrid,
  type CityAccount,
} from "novus-mundus-sdk";
import type { MapMode } from "@/lib/store/settings";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import type { CityTerrainEntity, WalkLine } from "../CityTerrainMap2DFallback";

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
  lodForZoom,
  midpointElevation,
  worldToGrid,
  type MeshLOD,
} from "./coords";
import { buildTerrainMesh, type BuiltTerrainMesh } from "./buildTerrainMesh";
import {
  CityCameraController,
  FOV_DEG,
  INITIAL_DISTANCE_2D,
  INITIAL_DISTANCE_3D,
  PITCH_2D,
  PITCH_3D,
} from "./controls";
import { MarkersLayer } from "./markers";
import {
  runModeTransition,
  runViewTween,
  shouldRunTransition,
  snapToMode,
  type RunningTransition,
  type RunningViewTween,
} from "./transition";

export interface HoverReadout {
  label: "Water" | "Shore" | "Land" | "Hill" | "Peak";
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
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  cssRenderer: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: CityCameraController;
  markers: MarkersLayer;
  terrain: BuiltTerrainMesh;
  cityNameLabel: CSS2DObject | null;
  waterMesh: THREE.Mesh | null;
  scaleBarEl: HTMLDivElement;
  compassEl: HTMLDivElement;
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
  raycaster: THREE.Raycaster;
  /* Continuous rAF id for tween-driven paints. Outside a tween, the
   * scene paints on demand via `requestRender`. */
  rafId: number | null;
  /* Per-frame paint flag — multiple state changes in one tick batch
   * into one paint. */
  paintQueued: boolean;
  /* The active mode-transition tween, if any. Reset re-presses
   * during the 700 ms cancel cleanly. */
  modeTween: RunningTransition | null;
  /* The active in-mode view tween (double-click, reset). Any new
   * gesture / wheel cancels this. */
  viewTween: RunningViewTween | null;
  /* Last time `update(dt)` ran — used to derive dt without an
   * always-on clock. */
  lastUpdateMs: number;
  /* Last hover client-coords for throttling. */
  lastHoverTs: number;
  /* Current LOD band — checked each paint; rebuild mesh on change. */
  meshLOD: MeshLOD;
}

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
    () => radiusToGridUnits(props.cityAccount.radiusKm, props.cityAccount.latitude),
    [props.cityAccount.radiusKm, props.cityAccount.latitude],
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

  /* Build the scene exactly once. Subsequent prop changes flow
   * through targeted `useEffect`s below. */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      props.onContextLost();
      return;
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      propsRef.current.onContextLost();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.classList.add(styles.canvas3d ?? "");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    wrap.appendChild(renderer.domElement);

    /* CSS2DRenderer overlays HTML labels (city name) tracked to
     * world-space anchors. Lives in a sibling DOM element so it
     * doesn't intercept canvas pointer events. */
    const cssRenderer = new CSS2DRenderer();
    cssRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
    cssRenderer.domElement.style.position = "absolute";
    cssRenderer.domElement.style.inset = "0";
    cssRenderer.domElement.style.pointerEvents = "none";
    wrap.appendChild(cssRenderer.domElement);

    const scene = new THREE.Scene();
    /* Subtle parchment-toned fog — distant mountains haze toward the
     * sepia ink colour rather than the reference's dark navy, so the
     * disc reads as a hand-drawn map rather than a satellite tile. */
    scene.fog = new THREE.FogExp2(0x6b4a2a, 0.04);

    const camera = new THREE.PerspectiveCamera(
      FOV_DEG,
      wrap.clientWidth / wrap.clientHeight,
      0.01,
      1000,
    );

    /* Lights — MeshLambertMaterial is unlit without these.
     * HemisphereLight tints upward faces toward the sky color and
     * downward faces toward the ground color — Three.js's canonical
     * outdoor-ambient pattern, intensity 1.0 matches the docs example
     * (HemisphereLight docs page). Sky stays near-white so terrain
     * colors aren't shifted; a slight warm tint (0xfff4d6) gives a
     * sunlit-parchment feel without recoloring the palette. */
    scene.add(new THREE.HemisphereLight(0xfff4d6, 0x6b4a2a, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(MESH_SIZE * 0.6, MESH_SIZE * 1.2, MESH_SIZE * 0.4);
    scene.add(sun);

    /* Build the terrain mesh. Square plate, displaced Y per vertex,
     * sRGB-linearised vertex colors, flat-shaded MeshLambertMaterial. */
    const built = buildTerrainMesh(terrain, rgu);
    scene.add(built.mesh);
    /* Mode-aware initial flatten. The uniform multiplies into
     * transformed.y in the vertex shader — mesh scale stays at 1
     * so raycasts work normally even when the terrain renders flat. */
    built.heightScale.value = props.mapMode === "3d" ? 1 : 0;

    /* Water surface dropped per UX review — the circular plate
     * covered the whole disc in 2D mode and added visual noise in
     * 3D. The terrain's own blue water bands already convey the
     * waterLine without it. */

    /* Markers layer — all the overlay vocabulary, mirrored from the
     * Canvas2D fallback. */
    const markers = new MarkersLayer({
      scene,
      rgu,
      cityLatGrid,
      cityLongGrid,
      terrain,
    });

    /* City name label — CSS2DObject anchored slightly above the
     * peak so it doesn't intersect terrain. */
    const labelDiv = document.createElement("div");
    labelDiv.className = styles.cityNameLabel ?? "";
    labelDiv.style.cssText =
      "color:var(--ink,#2e1f10);font-size:0.7rem;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;text-shadow:0 1px 2px var(--parchment,#efe2c4);user-select:none;pointer-events:none;white-space:nowrap;";
    labelDiv.textContent = props.cityAccount.name;
    const cityNameLabel = new CSS2DObject(labelDiv);
    cityNameLabel.position.set(0, MAX_HEIGHT * 1.4, 0);
    scene.add(cityNameLabel);

    /* Camera controller. Bound to the wrap (not the canvas) so
     * touch-action: none applies and one-finger drag doesn't steal
     * page scroll. */
    /* Distance range: max = mode's default (zoom 1×), min = max/200
     * so the user gets the full 200× zoom range the Canvas2D path
     * advertised. At 200× the camera may clip into a tall peak in
     * 3D mode; that's expected — user can tilt up to see better. */
    const maxD0 =
      props.mapMode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    const controller = new CityCameraController({
      domElement: wrap,
      camera,
      initialMode: props.mapMode,
      minDistance: maxD0 / 200,
      maxDistance: maxD0,
      onClick: (cx, cy) => handleClick(cx, cy),
      onDoubleClick: (cx, cy) => handleDoubleClick(cx, cy),
      onResetRequested: () => handleResetRequested(),
      onFrameSelectedRequested: () => handleFrameSelected(),
      onChange: () => requestRender(),
      onPointerMove: (cx, cy) => handlePointerMove(cx, cy),
      onGestureStart: () => {
        /* Any new gesture cancels an in-flight view tween — the
         * user's input always wins, otherwise the eased animation
         * keeps drifting toward an old target while being actively
         * manipulated. Same cancellation contract the Canvas2D
         * fallback applies via `cancelAnim()`. */
        refs.current?.viewTween?.cancel();
        if (refs.current) refs.current.viewTween = null;
      },
    });

    /* If we have an autoFocusCell at mount time, snap the controller
     * to the focused state BEFORE the first paint so the disc lands
     * already centred on the player's cell at high zoom — no flash
     * of the full overview followed by a 520ms tween. The
     * autoFocusedForCityRef below skips the post-mount tween effect
     * so it doesn't double-animate. */
    if (props.autoFocusCell) {
      const ox = props.autoFocusCell.gridLong - cityLongGrid;
      const oy = props.autoFocusCell.gridLat - cityLatGrid;
      const { wx, wz } = gridToWorld(ox, oy, rgu);
      const dTarget = maxD0 / 16;
      controller.setDistanceHard(dTarget);
      controller.setTargetHard(
        new THREE.Vector3(
          wx,
          props.mapMode === "3d" ? getElevationAt(terrain, ox, oy) : 0,
          wz,
        ),
      );
      /* Force-apply so the first paint reflects the snapped state.
       * Without this, the constructor's earlier applyCameraFromSmoothed
       * — done at default state — is the last thing the camera saw. */
      controller.applyToCamera();
      autoFocusedForCityRef.current = props.cityAccount.cityId;
    }

    /* Make the wrap focusable so keyboard shortcuts work without
     * requiring a click-into-focus first. */
    wrap.tabIndex = 0;

    const raycaster = new THREE.Raycaster();

    /* Build the scale bar + compass HUD elements as siblings. They
     * read camera state on each requestRender via DOM refs. */
    const scaleBarEl = scaleBarRef.current!;
    const compassEl = compassRef.current!;

    refs.current = {
      renderer,
      cssRenderer,
      scene,
      camera,
      controller,
      markers,
      terrain: built,
      cityNameLabel,
      waterMesh: null,
      scaleBarEl,
      compassEl,
      rgu,
      cityLatGrid,
      cityLongGrid,
      raycaster,
      rafId: null,
      paintQueued: false,
      modeTween: null,
      viewTween: null,
      lastUpdateMs: performance.now(),
      lastHoverTs: 0,
      /* Initial LOD: paint() will switch on first frame if needed.
       * "mid" matches the existing 256² baseline. */
      meshLOD: "mid",
    };

    /* Initial paint. */
    requestRender();

    const onLost = (e: Event) => {
      e.preventDefault();
      propsRef.current.onContextLost();
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);

    return () => {
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      if (refs.current?.rafId !== null && refs.current?.rafId !== undefined) {
        cancelAnimationFrame(refs.current.rafId);
      }
      refs.current?.modeTween?.cancel();
      refs.current?.viewTween?.cancel();
      controller.dispose();
      markers.dispose();
      // Take the live terrain off the ref — between mount and unmount the
      // rebuild effect (below) may have replaced `built` with a fresh
      // BuiltTerrain. We must dispose THAT one, not the stale closure
      // capture, otherwise the 4096^2 RGBA DataTexture (~64 MB GPU buffer
      // per city) leaks. The rebuild path already disposes the OLD
      // colorMap when swapping; this unmount path closes the loop on the
      // one that's currently in the scene.
      const live = refs.current?.terrain ?? built;
      scene.remove(live.mesh);
      live.geometry.dispose();
      live.material.dispose();
      live.colorMap.dispose();
      if (cityNameLabel.element.parentNode) {
        cityNameLabel.element.parentNode.removeChild(cityNameLabel.element);
      }
      // Walk anything else still in the scene (markers' meshes are
      // disposed by markers.dispose above; this catches stragglers like
      // the city name label's HTML wrapper or any future helper). The
      // terrain mesh is already removed + disposed above, so the
      // traversal won't double-touch it.
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as THREE.Mesh).material as
          | THREE.Material
          | THREE.Material[]
          | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      if (cssRenderer.domElement.parentNode) {
        cssRenderer.domElement.parentNode.removeChild(cssRenderer.domElement);
      }
      renderer.dispose();
      refs.current = null;
    };
    /* Empty deps — scene mounts ONCE. Prop changes hit the targeted
     * effects below. The mesh, however, depends on terrain identity;
     * the doc says rebuild only when terrain/rgu change, so we add
     * a guarded effect for that. */
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

  /* Rebuild terrain when terrain identity or rgu changes. */
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.scene.remove(r.terrain.mesh);
    r.terrain.geometry.dispose();
    r.terrain.material.dispose();
    r.terrain.colorMap.dispose();
    /* Preserve current LOD across city switches so the user doesn't
     * see a coarse mesh flash when changing cities while zoomed in. */
    const built = buildTerrainMesh(terrain, rgu, r.meshLOD);
    built.heightScale.value = r.controller.getMode() === "3d" ? 1 : 0;
    r.scene.add(built.mesh);
    r.terrain = built;
    r.rgu = rgu;
    r.cityLatGrid = cityLatGrid;
    r.cityLongGrid = cityLongGrid;
    r.markers.setTerrain(terrain);
    r.markers.setCenterGrid(cityLatGrid, cityLongGrid, rgu);
    /* Distance bounds: max = mode default (zoom 1×), min = max/200.
     * Re-applied here so a city switch re-clamps in case the user
     * was zoomed in at the previous city. */
    const maxD = r.controller.getMode() === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    r.controller.setDistanceBounds(maxD / 200, maxD);
    requestRender();
  }, [terrain, rgu, cityLatGrid, cityLongGrid, props.cityAccount.radiusKm]);

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

    /* Update controller's distance bounds for the new mode at start
     * of the tween — the user might be zoomed past the new mode's
     * max, which the controller's setDistanceBounds re-clamps. */
    const maxD = to === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    r.controller.setDistanceBounds(maxD / 200, maxD);

    if (reduce) {
      r.modeTween?.cancel();
      snapToMode(r.controller, r.terrain, to, selectionTargetXZ);
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
    const dDefault = mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    const tDefault = new THREE.Vector3(
      0,
      mode === "3d" ? midpointElevation() : 0,
      0,
    );
    r.viewTween = runViewTween(
      r.controller,
      { target: tDefault, distance: dDefault, yaw: 0 },
      requestRender,
    );
  }, [props.resetTrigger]);

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
    const dTarget = (mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) / 16;
    r.viewTween?.cancel();
    r.viewTween = null;
    r.controller.setDistanceHard(dTarget);
    r.controller.setTargetHard(
      new THREE.Vector3(
        wx,
        mode === "3d" ? getElevationAt(terrain, ox, oy) : 0,
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

    r.renderer.render(r.scene, r.camera);
    r.cssRenderer.render(r.scene, r.camera);

    /* Notify orchestrator of zoom + cells-visible state for the
     * status row. Throttled — only fire on change. */
    const zoom = r.controller.getDisplayZoom();
    p.onZoomChange(zoom);
    p.onCellsVisibleChange(cssPx >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL);

    /* LOD switch: if the display zoom crossed a band boundary,
     * rebuild the terrain mesh at the matching resolution. The
     * hysteresis in `lodForZoom` keeps the boundary from thrashing.
     * Mesh rebuild is one-shot (~5-20 ms depending on band) and
     * scheduled inline because the user's gesture already paused. */
    const nextLOD = lodForZoom(zoom, r.meshLOD);
    if (nextLOD !== r.meshLOD) {
      const oldMesh = r.terrain;
      const built = buildTerrainMesh(
        cityTerrain(propsRef.current.cityAccount),
        r.rgu,
        nextLOD,
      );
      built.heightScale.value = oldMesh.heightScale.value;
      r.scene.remove(oldMesh.mesh);
      oldMesh.geometry.dispose();
      oldMesh.material.dispose();
      oldMesh.colorMap.dispose();
      r.scene.add(built.mesh);
      r.terrain = built;
      r.meshLOD = nextLOD;
    }

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
    const hit = raycast(r, clientX, clientY);
    if (!hit) {
      propsRef.current.onHover(null);
      return;
    }
    const { ox, oy } = worldToGrid(hit.point.x, hit.point.z, r.rgu);
    const outOfBounds = ox * ox + oy * oy > r.rgu * r.rgu;
    if (outOfBounds) {
      propsRef.current.onHover(null);
      return;
    }
    /* Read terrain fresh from props — capturing the outer `terrain`
     * via closure would freeze the controller's bindings to whatever
     * terrain existed at mount, and stale-terrain hover labels would
     * persist across city switches. cityTerrain is a cheap struct
     * unwrap from the account; no allocation cost. */
    const liveTerrain = cityTerrain(propsRef.current.cityAccount);
    const s = sampleTerrain(liveTerrain, ox, oy);
    let label: HoverReadout["label"] = "Land";
    if (s.isWater) label = "Water";
    else if (s.isMountain) label = "Peak";
    else {
      const range = Math.max(1, liveTerrain.peakLine - liveTerrain.waterLine);
      const t = (s.elevation - liveTerrain.waterLine) / range;
      if (t < 0.1) label = "Shore";
      else if (t >= 0.5) label = "Hill";
    }
    const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
    propsRef.current.onHover({ label, distM, passable: s.isPassable, outOfBounds: false });
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
    const outOfBounds = ox * ox + oy * oy > r.rgu * r.rgu;
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
    if (r.controller.getMode() === "3d") {
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
      mode === "3d" ? midpointElevation() : 0,
      0,
    );
    const dDefault = mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
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
    const dTarget = (mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) / 8;
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
          mode === "3d" ? getElevationAt(terrainRef.current, ox, oy) : 0,
          wz,
        ),
        distance: dTarget,
      },
      requestRender,
    );
  }, []);

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
