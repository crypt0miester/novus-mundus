/**
 * Mount-time three.js scene assembly for the city disc.
 *
 * Extracted from `CityTerrainMapWebGL.tsx` where it lived as a 300-line
 * useEffect with `[]` deps. The setup is a one-shot — renderer, scene,
 * camera, controller, terrain mesh, marker overlays, inspection labels,
 * city name label, scale-bar / compass HUD refs — and its cleanup
 * runs at unmount. Returning the dispose function keeps the React
 * effect body to a thin call site.
 *
 * The handlers (click / hover / reset / etc.) are passed as a
 * `handlersRef` so the controller's bound callbacks always invoke
 * the LATEST React closure rather than the one captured at first
 * mount. Without the indirection, prop changes (a new
 * `onEntitySelect`) would still hit the original snapshot.
 */
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { CityAccount } from "novus-mundus-sdk";

import {
  CityCameraController,
  INITIAL_DISTANCE_2D,
  INITIAL_DISTANCE_3D,
  FOV_DEG,
  cityCameraSizeFactor,
} from "../controls";
import { MarkersLayer } from "../markers";
import { InspectionLabelsLayer } from "../inspectionLabels";
import {
  buildTerrainMesh,
  meshFromBakedPixels,
  COLOR_TEXTURE_SIZE_PREVIEW,
  COLOR_TEXTURE_SIZE_HIGH,
  type BuiltTerrainMesh,
} from "../buildTerrainMesh";
import { getBakeWorker } from "@/lib/world/bakeWorkerClient";
import { MAX_HEIGHT, MESH_SIZE, getElevationAt, gridToWorld } from "../coords";
import type { MapMode } from "@/lib/store/settings";
import type { BiomeKnobs } from "@/lib/world/biome";
import type { RunningTransition, RunningViewTween } from "../transition";

import styles from "../../CityTerrainMap.module.css";

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  cssRenderer: CSS2DRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: CityCameraController;
  markers: MarkersLayer;
  inspectionLabels: InspectionLabelsLayer;
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
  /* The active mode-transition tween, if any. */
  modeTween: RunningTransition | null;
  /* The active in-mode view tween (double-click, reset). */
  viewTween: RunningViewTween | null;
  /* Last time `update(dt)` ran — derives dt without an always-on clock. */
  lastUpdateMs: number;
  /* Last hover client-coords for throttling. */
  lastHoverTs: number;
}

/** Stable shim that the mount-bound controller callbacks read from
 *  every gesture. Component owns this ref and replaces `.current` on
 *  each render so the controller hits the freshest closures. */
export interface SceneHandlersRef {
  current: {
    handleClick: (clientX: number, clientY: number) => void;
    handleDoubleClick: (clientX: number, clientY: number) => void;
    handleResetRequested: () => void;
    handleFrameSelected: () => void;
    handlePointerMove: (clientX: number, clientY: number) => void;
    requestRender: () => void;
  };
}

export interface SetupCitySceneArgs {
  wrap: HTMLDivElement;
  scaleBarEl: HTMLDivElement;
  compassEl: HTMLDivElement;
  /* Initial-prop snapshot — captured at mount time. Subsequent prop
   * changes are picked up by the orchestrator's targeted effects. */
  cityAccount: CityAccount;
  mapMode: MapMode;
  autoFocusCell?: { gridLat: number; gridLong: number } | null;
  teamMatePubkeys?: string[];
  /* Derived inputs the orchestrator has already computed. */
  terrain: { biomeSeed: number; knobs: BiomeKnobs };
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
  /* Refs read inside long-lived callbacks. */
  propsRef: { current: { onContextLost: () => void } };
  autoFocusedForCityRef: { current: number | null };
  handlersRef: SceneHandlersRef;
}

/** Build the scene + return its refs + a dispose closure. Caller
 *  installs `refs.current = sceneRefs` after construction and runs
 *  `dispose()` on unmount. */
export function setupCityScene(args: SetupCitySceneArgs): {
  sceneRefs: SceneRefs;
  dispose: () => void;
} | null {
  const {
    wrap,
    scaleBarEl,
    compassEl,
    cityAccount,
    mapMode,
    autoFocusCell,
    teamMatePubkeys,
    terrain,
    rgu,
    cityLatGrid,
    cityLongGrid,
    propsRef,
    autoFocusedForCityRef,
    handlersRef,
  } = args;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    propsRef.current.onContextLost();
    return null;
  }
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    propsRef.current.onContextLost();
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.classList.add(styles.canvas3d ?? "");
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  wrap.appendChild(renderer.domElement);

  /* CSS2DRenderer overlays HTML labels (city name, inspection pills)
   * tracked to world-space anchors. Lives in a sibling DOM element so
   * it doesn't intercept canvas pointer events. */
  const cssRenderer = new CSS2DRenderer();
  cssRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
  cssRenderer.domElement.style.position = "absolute";
  cssRenderer.domElement.style.inset = "0";
  cssRenderer.domElement.style.pointerEvents = "none";
  wrap.appendChild(cssRenderer.domElement);

  const scene = new THREE.Scene();
  /* Subtle parchment-toned fog — distant mountains haze toward the
   * sepia ink colour rather than a dark navy. */
  scene.fog = new THREE.FogExp2(0x6b4a2a, 0.04);

  const camera = new THREE.PerspectiveCamera(
    FOV_DEG,
    wrap.clientWidth / wrap.clientHeight,
    0.01,
    1000,
  );

  /* Lights — MeshLambertMaterial is unlit without these. */
  scene.add(new THREE.HemisphereLight(0xfff4d6, 0x6b4a2a, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(MESH_SIZE * 0.6, MESH_SIZE * 1.2, MESH_SIZE * 0.4);
  scene.add(sun);

  /* Build the terrain mesh. Synchronous 512² preview lands in
   * ~250 ms so the city is visible immediately; the full 4096²
   * bake runs on the Worker and swaps in when ready. */
  const built = buildTerrainMesh(
    terrain.biomeSeed,
    rgu,
    terrain.knobs,
    COLOR_TEXTURE_SIZE_PREVIEW,
  );
  scene.add(built.mesh);
  /* Mode-aware initial flatten — uniform multiplies into transformed.y
   * in the vertex shader; mesh scale stays at 1 so raycasts work. */
  built.heightScale.value = mapMode === "iso" ? 1 : 0;

  /* Marker overlays — all the dot/tile/walk/castle vocabulary. */
  const markers = new MarkersLayer({
    scene,
    rgu,
    cityLatGrid,
    cityLongGrid,
    terrain,
  });

  /* Inspection-band labels — DOM pills next to every occupant when
   * the camera zoom sits inside the inspection band. Pool of 256
   * pre-allocated CSS2DObjects; visible count varies per paint. */
  const inspectionLabels = new InspectionLabelsLayer({
    scene,
    teamMatePubkeys,
  });

  /* City name label — CSS2DObject anchored above the peak. */
  const labelDiv = document.createElement("div");
  labelDiv.className = styles.cityNameLabel ?? "";
  labelDiv.style.cssText =
    "color:var(--ink,#2e1f10);font-size:0.7rem;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;text-shadow:0 1px 2px var(--parchment,#efe2c4);user-select:none;pointer-events:none;white-space:nowrap;";
  labelDiv.textContent = cityAccount.name;
  const cityNameLabel = new CSS2DObject(labelDiv);
  cityNameLabel.position.set(0, MAX_HEIGHT * 1.4, 0);
  scene.add(cityNameLabel);

  /* Camera controller — bound to the wrap (not the canvas) so
   * touch-action:none applies and one-finger drag doesn't steal
   * page scroll.
   *
   * Per-city scaling: INITIAL_DISTANCE_{2D,3D} is tuned for the
   * largest canonical city (Tokyo, widthGrid ~8782). Smaller cities
   * at the same distance feel "lost in space"; pull the camera in
   * proportionally so every city frames similarly at zoom 1×. */
  const sizeFactor = cityCameraSizeFactor(cityAccount);
  const baseMax = mapMode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
  const maxD0 = baseMax * sizeFactor;
  let sceneRefs: SceneRefs | null = null;
  const controller = new CityCameraController({
    domElement: wrap,
    camera,
    initialMode: mapMode,
    minDistance: maxD0 / 200,
    maxDistance: maxD0,
    onClick: (cx, cy) => handlersRef.current.handleClick(cx, cy),
    onDoubleClick: (cx, cy) => handlersRef.current.handleDoubleClick(cx, cy),
    onResetRequested: () => handlersRef.current.handleResetRequested(),
    onFrameSelectedRequested: () => handlersRef.current.handleFrameSelected(),
    onChange: () => handlersRef.current.requestRender(),
    onPointerMove: (cx, cy) => handlersRef.current.handlePointerMove(cx, cy),
    onGestureStart: () => {
      /* Any new gesture cancels an in-flight view tween — the user's
       * input always wins. */
      sceneRefs?.viewTween?.cancel();
      if (sceneRefs) sceneRefs.viewTween = null;
    },
  });

  /* If we have an autoFocusCell, snap the controller to the focused
   * state BEFORE the first paint so the disc lands already centred
   * on the player's cell at high zoom — no flash of the full overview
   * followed by a 520ms tween. */
  if (autoFocusCell) {
    const ox = autoFocusCell.gridLong - cityLongGrid;
    const oy = autoFocusCell.gridLat - cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, rgu);
    const dTarget = maxD0 / 16;
    controller.setDistanceHard(dTarget);
    controller.setTargetHard(
      new THREE.Vector3(
        wx,
        mapMode === "iso" ? getElevationAt(ox, oy) : 0,
        wz,
      ),
    );
    /* Force-apply so the first paint reflects the snapped state. */
    controller.applyToCamera();
    autoFocusedForCityRef.current = cityAccount.cityId;
  }

  /* Make the wrap focusable so keyboard shortcuts work without
   * requiring a click-into-focus first. */
  wrap.tabIndex = 0;

  const raycaster = new THREE.Raycaster();

  sceneRefs = {
    renderer,
    cssRenderer,
    scene,
    camera,
    controller,
    markers,
    inspectionLabels,
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
  };

  /* Initial paint. */
  handlersRef.current.requestRender();

  /* Kick off the high-res 4096² bake off the main thread. Swaps in
   * when ready, unless the terrain has been replaced or the component
   * unmounted (cleanup cancels). */
  const initialBake = getBakeWorker().bake({
    biomeSeed: terrain.biomeSeed,
    rgu,
    knobs: terrain.knobs,
    texSize: COLOR_TEXTURE_SIZE_HIGH,
  });
  initialBake.promise.then((pixels) => {
    if (!pixels) return;
    if (!sceneRefs || sceneRefs.terrain !== built) return;
    const high = meshFromBakedPixels(pixels, COLOR_TEXTURE_SIZE_HIGH);
    /* Share the heightScale across the swap so an in-flight mode
     * tween keeps mutating the live mesh's height value. */
    high.heightScale = built.heightScale;
    sceneRefs.scene.remove(built.mesh);
    built.geometry.dispose();
    built.material.dispose();
    built.colorMap.dispose();
    sceneRefs.scene.add(high.mesh);
    sceneRefs.terrain = high;
    handlersRef.current.requestRender();
  });

  const onLost = (e: Event) => {
    e.preventDefault();
    propsRef.current.onContextLost();
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);

  const dispose = () => {
    initialBake.cancel();
    renderer.domElement.removeEventListener("webglcontextlost", onLost);
    if (sceneRefs?.rafId !== null && sceneRefs?.rafId !== undefined) {
      cancelAnimationFrame(sceneRefs.rafId);
    }
    sceneRefs?.modeTween?.cancel();
    sceneRefs?.viewTween?.cancel();
    controller.dispose();
    markers.dispose();
    inspectionLabels.dispose();
    /* Take the LIVE terrain off the ref — between mount and unmount
     * the rebuild effect may have replaced `built` with a fresh
     * BuiltTerrain. We must dispose THAT one, not the stale closure
     * capture, otherwise the 4096² RGBA DataTexture (~64 MB GPU buffer
     * per city) leaks. */
    const live = sceneRefs?.terrain ?? built;
    scene.remove(live.mesh);
    live.geometry.dispose();
    live.material.dispose();
    live.colorMap.dispose();
    if (cityNameLabel.element.parentNode) {
      cityNameLabel.element.parentNode.removeChild(cityNameLabel.element);
    }
    /* Walk anything else still in the scene (markers' meshes are
     * disposed above; this catches stragglers like a future helper). */
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
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
    sceneRefs = null;
  };

  return { sceneRefs, dispose };
}
