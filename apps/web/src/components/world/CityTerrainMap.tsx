"use client";

/**
 * Orchestrator for the city terrain map.
 *
 * Owns:
 *  - WebGL2 capability check at mount; routes to the WebGL renderer
 *    on success and the Canvas2D fallback on failure.
 *  - Status row chrome (label + zoom indicator + toggle pills).
 *  - Hover readout DOM (aria-live; same strings as the Canvas2D
 *    fallback so screen readers see no difference between modes).
 *  - The 2D/3D toggle pill (hidden in the fallback path — the
 *    fallback can't tilt).
 *  - The touch-only orbit toggle pill (visible only when touch is
 *    detected and the WebGL path is mounted).
 *  - Click-result branching: WebGL scene fires `onPick` with raw cell
 *    + entity-at-cell + passable + out-of-bounds; this component
 *    dispatches to onSelect / onEntitySelect per the rules in the
 *    design doc's "Click semantics under square view".
 *  - Occupancy fetch via useCityOccupied (zustand + WS, not
 *    polling).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  OCCUPANT_PLAYER,
  OCCUPANT_ENCOUNTER,
  toGrid,
} from "novus-mundus-sdk";
import { useSettings, type MapMode } from "@/lib/store/settings";
import { useCityOccupied } from "@/lib/hooks/useCityOccupied";
import styles from "./CityTerrainMap.module.css";
import {
  CityTerrainMap2DFallback,
  type CityTerrainMapHandle,
  type CityTerrainMapProps,
} from "./CityTerrainMap2DFallback";
import {
  CityTerrainMapWebGL as CityTerrainMapWebGLImpl,
  type CityTerrainMapWebGLProps,
  type HoverReadout,
  type PickInfo,
} from "./city3d/CityTerrainMapWebGL";

export type {
  CityTerrainEntity,
  CityTerrainMapHandle,
  DotTooltip,
  WalkLine,
  CityTerrainMapProps,
} from "./CityTerrainMap2DFallback";

// Master switch for the WebGL 3D renderer. Statically imported above so
// the first map open doesn't pay the dynamic-chunk round-trip — the
// file is "use client" already, so three.js lands in the route bundle
// once at compile rather than as a per-mount lazy chunk (which on dev
// HMR was taking 5+ minutes per city open). Flip to false to fall back
// to the 2D Canvas renderer; with a static import three.js still ships
// in the bundle, but the WebGL scene is never mounted.
const ENABLE_3D_MAP = true;

const CityTerrainMapWebGL: ComponentType<CityTerrainMapWebGLProps> | null =
  ENABLE_3D_MAP ? CityTerrainMapWebGLImpl : null;

/**
 * One-shot WebGL2 capability probe. The result is cached at module scope —
 * every mount must NOT allocate a fresh canvas + context, because Safari
 * (iOS WKWebView in particular) caps the per-document WebGL context count
 * at ~16 and the loseContext extension doesn't immediately free the
 * canvas element. Repeated mount/unmount cycles (StrictMode, navigation)
 * would otherwise approach that cap and eventually force every CityTerrainMap
 * onto the 2D fallback for the rest of the session.
 */
let webgl2ProbeResult: boolean | null = null;
function canUseWebGL2(): boolean {
  if (typeof window === "undefined") return false;
  if (webgl2ProbeResult != null) return webgl2ProbeResult;
  try {
    const c = document.createElement("canvas");
    // Detach width/height to keep memory minimal until GC reclaims the node.
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("webgl2");
    const lose = ctx?.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    webgl2ProbeResult = ctx != null;
    return webgl2ProbeResult;
  } catch {
    webgl2ProbeResult = false;
    return false;
  }
}

function detectTouchSupport(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

export const CityTerrainMap = forwardRef<CityTerrainMapHandle, CityTerrainMapProps>(
  function CityTerrainMap(props, ref) {
    const Renderer = CityTerrainMapWebGL;
    if (!Renderer) {
      return <CityTerrainMap2DFallback ref={ref} {...props} />;
    }
    return <CityTerrainMap3DScene ref={ref} Renderer={Renderer} {...props} />;
  },
);

interface CityTerrainMap3DSceneProps extends CityTerrainMapProps {
  Renderer: ComponentType<CityTerrainMapWebGLProps>;
}

const CityTerrainMap3DScene = forwardRef<CityTerrainMapHandle, CityTerrainMap3DSceneProps>(
function CityTerrainMap3DScene({
  Renderer,
  ...props
}, ref) {
  const mapMode = useSettings((s) => s.mapMode);
  const setMapMode = useSettings((s) => s.setMapMode);

  /* Stub focusCell — the WebGL renderer doesn't yet expose its
   * runViewTween via ref. Once we wire that up (a `focusRequest`
   * trigger-counter passed into <Renderer>, mirroring resetTrigger),
   * route the call through. Until then this is a no-op so callers
   * don't blow up when ENABLE_3D_MAP=true is flipped. */
  useImperativeHandle(
    ref,
    () => ({
      focusCell: (_gridLat: number, _gridLong: number) => {
        // Intentionally empty — see comment above. Coords ignored.
        void _gridLat;
        void _gridLong;
      },
    }),
    [],
  );

  /* Capability state: `webglAvailable` is the initial probe; `webglLost`
   * flips true if the scene's `webglcontextlost` fires mid-session. When
   * either is false the component short-circuits to the 2D fallback. No
   * in-app retry today — recovery from a permanent context loss is a
   * page refresh. */
  const [webglAvailable] = useState<boolean>(canUseWebGL2);
  const [webglLost, setWebglLost] = useState(false);
  const [touchSupport] = useState<boolean>(detectTouchSupport);
  /* `outOfBoundsNotice` is shown when the user clicks a corner of the
   * square mesh outside the inscribed gameplay disc. Auto-clears
   * after ~2.5 s or on the next click. */
  const [outOfBoundsNotice, setOutOfBoundsNotice] = useState(false);

  const useWebGL = webglAvailable && !webglLost;

  const [hover, setHover] = useState<HoverReadout | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cellsVisible, setCellsVisible] = useState(false);
  const [touchOrbitEnabled, setTouchOrbitEnabled] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);

  const {
    data: occupied,
    isLoading: occupancyLoading,
    error: occupancyError,
  } = useCityOccupied(props.cityAccount.cityId);

  const playerCount = occupied.filter((c) => c.occupantType === OCCUPANT_PLAYER).length;
  const encounterCount = occupied.filter(
    (c) => c.occupantType === OCCUPANT_ENCOUNTER,
  ).length;
  // Post flat-strategy there are no anchors; biome is sampled from
  // biomeSeed at use-time, so the disc is never "empty".
  const terrainEmpty = false;

  // Distance from city centre to the selected landing cell, mirroring
  // the 2D fallback's "Landing chosen · X m from centre" readout so the
  // 3D path doesn't silently lose the pick confirmation.
  // 0.0001° ≈ 11 m at the equator — same constant the fallback uses.
  const selectedDistM = useMemo(() => {
    if (!props.selected) return 0;
    const cityLatGrid = toGrid(props.cityAccount.latitude);
    const cityLongGrid = toGrid(props.cityAccount.longitude);
    const ox = props.selected.gridLong - cityLongGrid;
    const oy = props.selected.gridLat - cityLatGrid;
    return Math.round(Math.sqrt(ox * ox + oy * oy) * 11);
  }, [props.selected, props.cityAccount.latitude, props.cityAccount.longitude]);

  const handlePick = (info: PickInfo) => {
    /* Any click clears a stale out-of-bounds notice — the user's
     * second tap implicitly dismisses the previous one. */
    setOutOfBoundsNotice(false);
    /* Click missed mesh entirely (raycast off the plate) -> deselect. */
    if (info.outOfBounds && info.gridLat === 0 && info.gridLong === 0) {
      props.onEntitySelect?.(null);
      return;
    }
    /* On the square mesh but outside the inscribed gameplay disc.
     * The square AABB pan clamp keeps the visible region inside the
     * mesh, but the user can still click a far corner that's
     * outside the chain's circular disc — surface a brief notice so
     * "nothing happened" reads as a deliberate boundary rather than
     * a broken click. */
    if (info.outOfBounds) {
      props.onEntitySelect?.(null);
      setOutOfBoundsNotice(true);
      return;
    }
    if (info.entityAtCell) {
      props.onEntitySelect?.(info.entityAtCell);
      return;
    }
    /* Empty cell. Set landing destination but PRESERVE the entity
     * selection if one is active — the user is most likely picking
     * a neighbour cell to walk to an encounter they just selected
     * for striking. Clearing the entity here would hide the
     * EntityPanel + its Approach button, leaving the user with no
     * clear path to the strike. */
    if (!props.onSelect) return;
    if (!info.passable) return;
    props.onSelect(info.gridLat, info.gridLong);
  };

  /* Auto-dismiss the out-of-bounds notice after a moment so it
   * doesn't linger if the user takes no follow-up action. */
  useEffect(() => {
    if (!outOfBoundsNotice) return;
    const id = window.setTimeout(() => setOutOfBoundsNotice(false), 2500);
    return () => window.clearTimeout(id);
  }, [outOfBoundsNotice]);

  const handleToggleMode = () => {
    setMapMode(mapMode === "iso" ? "flat" : "iso");
  };

  const handleModeCommitted = (_m: MapMode) => {
    _m;
  };

  // WebGL unavailable or context lost mid-session: short-circuit to the
  // bare 2D fallback. The fallback owns its own .root/.label/.canvasWrap
  // /.readout/.legend chrome, so wrapping it in the orchestrator's chrome
  // would double every header and aria-live region. We lose the retry
  // overlay (no UI to bump retryCounter), but the user can refresh to
  // re-probe WebGL — and ENABLE_3D_MAP=false means this branch ships
  // dormant until 3D is reactivated anyway.
  if (!useWebGL) {
    return <CityTerrainMap2DFallback {...props} />;
  }

  const rendererNode = (
    <Renderer
      cityAccount={props.cityAccount}
      selected={props.selected}
      selectedEntity={props.selectedEntity ?? null}
      occupied={occupied}
      travel={props.travel}
      otherWalks={props.otherWalks}
      myPlayerPubkey={props.myPlayerPubkey}
      autoFocusCell={props.autoFocusCell}
      mapMode={mapMode}
      onModeCommitted={handleModeCommitted}
      onPick={handlePick}
      onHover={setHover}
      onZoomChange={setZoom}
      onCellsVisibleChange={setCellsVisible}
      onContextLost={() => setWebglLost(true)}
      touchOrbitEnabled={touchOrbitEnabled}
      resetTrigger={resetTrigger}
    />
  );

  return (
    <div className={styles.root}>
      <div
        className={styles.canvasWrap}
        role="application"
        aria-label={`Terrain disc for ${props.cityAccount.name}. Click an occupant to inspect them, or pick an empty cell to land. Scroll or pinch to zoom, drag to pan, double-click to zoom in.`}
      >
        {rendererNode}
        <button
          type="button"
          className={`${styles.togglePill} ${styles.toggle3DPill}`}
          onClick={handleToggleMode}
          aria-pressed={mapMode === "iso"}
          title={mapMode === "iso" ? "Switch to top-down (2D)" : "Switch to tilted view (3D)"}
        >
          {mapMode === "iso" ? "2D" : "3D"}
        </button>
        {touchSupport && (
          <button
            type="button"
            className={`${styles.togglePill} ${styles.orbitTogglePill}`}
            onClick={() => setTouchOrbitEnabled((v) => !v)}
            aria-pressed={touchOrbitEnabled}
            title={
              touchOrbitEnabled
                ? "Two-finger drag rotates (tap to switch back to pan)"
                : "Two-finger drag pans (tap to enable rotate)"
            }
          >
            ⤺
          </button>
        )}
        {/* Reset chip — mirror the 2D fallback's `view.scale > 1.001`
         * gate so the chip only appears once the user has actually
         * zoomed in. At default zoom it would be a no-op affordance. */}
        {zoom > 1.001 && (
          <button
            type="button"
            className={styles.resetBtn}
            onClick={(e) => {
              e.stopPropagation();
              setResetTrigger((n) => n + 1);
            }}
            aria-label="Reset view"
            title="Reset view"
          >
            ↻
          </button>
        )}
        {outOfBoundsNotice && (
          <div className={styles.outOfBoundsNotice} role="status" aria-live="polite">
            Outside city bounds
          </div>
        )}
      </div>
      <div className={styles.readout} aria-live="polite">
        {hover ? (
          <>
            <span className={hover.passable ? "" : styles.impassable}>{hover.label}</span>
            <span>·</span>
            <span>{hover.distM.toLocaleString()}m from centre</span>
            {!hover.passable && <span>· impassable</span>}
          </>
        ) : props.selected ? (
          <span>Landing chosen · {selectedDistM.toLocaleString()}m from centre</span>
        ) : (
          <span>click a player or wild to inspect, or pick an empty cell to land.</span>
        )}
      </div>
    </div>
  );
});
