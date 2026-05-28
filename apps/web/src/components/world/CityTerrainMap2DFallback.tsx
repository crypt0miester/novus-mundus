"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  toGrid,
  OCCUPANT_PLAYER,
  OCCUPANT_ENCOUNTER,
  OCCUPANT_CASTLE,
  type CityAccount,
} from "novus-mundus-sdk";
import {
  biomeAt,
  biomeColor,
  biomeKnobsFromCity,
  biomeName,
  isPassableBiome,
  type BiomeKnobs,
  type BiomeType,
} from "@/lib/world/biome";
import { useCityOccupied, type OccupiedCell } from "@/lib/hooks/useCityOccupied";
import {
  animatedColorAt,
  animatedColorToRgba,
  getCosmeticColor,
  getCosmeticFrame,
  getCosmeticTitle,
  cosmeticColorAnimationClass,
  RARITY_BORDER,
  type CosmeticColorAnimation,
} from "@/lib/config/cosmetics-catalog";
import { CosmeticBadge } from "@/components/cosmetics/CosmeticBadge";
import { CosmeticFrame } from "@/components/cosmetics/CosmeticFrame";
import styles from "./CityTerrainMap.module.css";

// 0.0001° ≈ 11 m at the equator — used for the "X m from centre" readouts.
const METERS_PER_GRID_UNIT = 11;

/* Lower bound for the canvas's logical pixel size — purely defensive
 * against zero/degenerate measurements. Do NOT raise this above what the
 * smallest real container can reach: the canvas buffer is dimensioned in
 * device px from this number, but the CSS still shows the canvas at the
 * actual container size. If buffer > display in either axis, the browser
 * stretch-fits and the grid renders as rectangles instead of squares.
 * The value below comfortably accommodates a single mobile pixel without
 * forcing a synthetic floor on any realistic layout. */
const MIN_LOGICAL_SIZE = 1;

// Zoom bounds. With viewport-based rendering each zoom level re-renders the
// terrain crisply, so we can push the max much higher than CSS-scale would
// allow. At 200× a single 11 m grid cell is ~7 CSS px — easily visible as a
// discrete tile, which is what the proximity-grid overlay needs.
const MIN_VIEW_SCALE = 5;
const MAX_VIEW_SCALE = 500;
const PAN_THRESHOLD_PX = 4;

/* At this many CSS pixels per grid cell, the proximity grid overlay (faint
 * graph-paper lines + tile-rendered occupants) turns on. Anything tighter
 * starts to look like moiré — especially on Retina where a 1-device-px line
 * is only 0.5 CSS px. Threshold is in CSS px so it stays visually consistent
 * across DPRs.
 *
 * Tuned to 5 so the grid is reachable inside the 200× zoom ceiling on small
 * mobile viewports (~280px logicalMin) too — at 5 CSS px / cell, a 1-device-
 * px line takes 10–15% of the cell width on common DPRs, still clearly
 * inked but not yet smudgy. Higher values (8) excluded mobile entirely. */
const GRID_OVERLAY_MIN_CSS_PX_PER_CELL = 5;

/* Coerce a CSS color string (`#rrggbb` or `rgb(...)` or `rgba(...)`) to
 * `rgba(r, g, b, alpha)` with the requested alpha. Used for walk-line
 * tinting where the base color comes either as the catalog hex or as
 * the animator's rgba (already alpha=1) and we want a thinner version
 * for line strokes / halos against the parchment. */
function toRgbaWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("rgba")) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  if (color.startsWith("#")) {
    const h = color.slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith("rgb(")) {
    return color.replace(/^rgb\(([^)]+)\)$/, `rgba($1, ${alpha})`);
  }
  return color;
}

export interface CityTerrainEntity {
  pubkey: string; // base58 pubkey of the LocationAccount's occupant
  occupantType: number; // OCCUPANT_PLAYER | OCCUPANT_ENCOUNTER | OCCUPANT_CASTLE
  gridLat: number;
  gridLong: number;
}

/**
 * Resolve the occupant at (gridLat, gridLong) when multiple share a cell.
 *
 * Castles + players + encounters can coincide on the same grid square
 * (castles live on CastleAccount.lat/long, players + encounters on
 * Location PDAs — separate sources, no de-dupe). useCityOccupied pushes
 * locations first and castles last, so a naive `find()` returns the
 * Location-derived occupant and hides the castle behind it.
 *
 * Resolution: prefer castle, then encounter, then player. Castles are
 * stationary, gameplay-meaningful structures; a player standing on a
 * castle shouldn't make the castle unclickable.
 */
function pickOccupantAt<T extends { gridLat: number; gridLong: number; occupantType: number }>(
  occupied: readonly T[],
  gridLat: number,
  gridLong: number,
): T | null {
  let castle: T | null = null;
  let encounter: T | null = null;
  let player: T | null = null;
  for (const c of occupied) {
    if (c.gridLat !== gridLat || c.gridLong !== gridLong) continue;
    if (c.occupantType === OCCUPANT_CASTLE && !castle) castle = c;
    else if (c.occupantType === OCCUPANT_ENCOUNTER && !encounter) encounter = c;
    else if (c.occupantType === OCCUPANT_PLAYER && !player) player = c;
  }
  return castle ?? encounter ?? player ?? null;
}

/**
 * Hover tooltip payload for an occupant dot. The renderer is game-
 * agnostic — it doesn't know what a "Vanguard" or "Rare wild" is — so
 * the parent resolves the strings/accent and the disc just paints them.
 *
 *  - `primary`: bold first line (player name or rarity descriptor)
 *  - `secondary`: dim second line (level + tier, or level + HP%)
 *  - `accent`: optional CSS colour used as the bubble's left border,
 *     surfacing rarity / subscription tier at a glance
 */
export interface DotTooltip {
  primary: string;
  secondary: string;
  accent?: string;
  /* Cosmetic IDs — raw on-chain u16 slot values. The hover tooltip
   * looks these up through the catalog to render badge + frame + title
   * inline; the inspection-band label uses `title` for the suffix and
   * `nameColorHex`/`nameColorAnim` for the text color. */
  badgeId?: number;
  frameId?: number;
  titleId?: number;
  nameColorHex?: string;
  nameColorAnim?: CosmeticColorAnimation;
}

/**
 * A single in-flight intracity walk. Used for both the local player's walk
 * (the primary, bright variant) and every other player's walk in the same
 * city (the muted, secondary variant). All coords are full grid units,
 * NOT offsets — the component subtracts the city's centre grid internally.
 */
export interface WalkLine {
  fromGridLat: number;
  fromGridLong: number;
  toGridLat: number;
  toGridLong: number;
  pct: number;
  /* Walker's equipped cosmetic name color. Tints the line stroke and
   * the moving marker fill so paid identity follows the walker across
   * the disc, not just their static dot. Animated colors drive the
   * same per-frame modulator the dot uses. */
  nameColorHex?: string;
  nameColorAnim?: CosmeticColorAnimation;
  /* Walker's equipped frame ring color. Wraps the moving marker so
   * frame ownership reads while a player is in motion. */
  frameBorderColor?: string;
}

export interface CityTerrainMapProps {
  cityAccount: CityAccount;
  selected: { gridLat: number; gridLong: number } | null;
  /**
   * Cell-pick callback. Omit to render the disc read-only — useful for the
   * home-city view where you just want to see encounters/players without
   * accidentally setting an intercity landing cell.
   */
  onSelect?: (gridLat: number, gridLong: number) => void;
  /** Entity (player or encounter) the panel is currently focused on. */
  selectedEntity?: CityTerrainEntity | null;
  /** Click-on-occupied-cell selects the entity at that cell. */
  onEntitySelect?: (entity: CityTerrainEntity | null) => void;
  /**
   * Local player's walk path drawn on the overlay — dashed seal-orange line
   * + pulsing marker. Realm-map scale is sub-pixel for an in-city walk, so
   * the disc is the only meaningful surface. Omit when no walk in flight.
   */
  travel?: WalkLine | null;
  /**
   * Every OTHER player in this city who is currently intracity-walking,
   * rendered in a muted variant (lower opacity, thinner stroke, smaller
   * marker) so the local player's own walk still reads as primary. The
   * parent is responsible for excluding the local player from this list
   * — duplicates would just draw twice. `pct` is interpolated by the
   * parent against chain time so the markers tick smoothly between
   * the (stale-cached) account refetches.
   */
  otherWalks?: WalkLine[];
  /**
   * Base58 pubkey of the local player's PlayerCore PDA. When supplied, the
   * cell whose `occupant` matches this pubkey renders in a deep-ink color
   * instead of the muted-amber used for other players, so the viewer can
   * find themselves at a glance. Omit (or pass undefined) in surfaces where
   * the viewer doesn't have a player yet — e.g. the arrival flow.
   */
  myPlayerPubkey?: string;
  /**
   * Base58 pubkeys of OTHER players on the local viewer's team. Their
   * dots render in an allied-amber tone so teammates pop out from
   * neutral / rival players at a glance. Pass an empty array (or omit)
   * when the viewer has no team.
   */
  teamMatePubkeys?: string[];
  /**
   * Auto-focus on first mount of the city — the disc animates to centre on
   * this cell at MAX_VIEW_SCALE (200×) so the grid-line overlay and tile-
   * rendered occupants are visible immediately ("you are here" in the most
   * legible mode the disc offers). Fires ONCE per cityId change; subsequent
   * pans/zooms by the user aren't disturbed. Parent passes null (or omits)
   * when the drill-in is a destination / scouting view rather than the
   * player's home city.
   */
  autoFocusCell?: { gridLat: number; gridLong: number } | null;
  /**
   * Hover-tooltip resolver — called per occupant the cursor passes over.
   * Returning null suppresses the tooltip for that dot. The renderer
   * stays game-agnostic; all name/level/rarity lookup is the parent's
   * job.
   */
  getDotTooltip?: (occupant: string, occupantType: number) => DotTooltip | null;
}

/**
 * @deprecated Use {@link CityTerrainMapProps}. Kept for any internal references.
 */
type Props = CityTerrainMapProps;

/**
 * Viewport-based renderer. At zoom S the canvas paints only the visible
 * region (= radiusGridUnits / S grid units across) at its full pixel
 * resolution, so the terrain stays crisp no matter how far you zoom in.
 *
 * Coord systems:
 *  - GRID OFFSET (ox, oy): signed integer grid units, relative to city centre.
 *    +ox = east, +oy = north. This is what every chain helper speaks.
 *  - VIEW (panOx, panOy, scale): the viewport. (panOx, panOy) is the grid
 *    offset of the canvas centre; scale = radiusGridUnits / viewport_radius.
 *  - CANVAS PIXEL (px, py): integer 0..sizeDev in each axis. py is flipped so
 *    +py = south on screen.
 *
 * Disc handling — the playable area is a disc of radius `cityRadius` grid
 * units, but the renderer paints terrain across the FULL square. The disc
 * is an invisible boundary that the click handler enforces (clicks outside
 * surface an "Out of city bounds" notice); no edge feathering, no dashed
 * ring — the canvas reads as a continuous map page, and the constrained
 * gameplay area is communicated through interaction, not chrome.
 */
function renderTerrainViewport(
  biomeSeed: number,
  knobs: BiomeKnobs,
  sizeDevW: number,
  sizeDevH: number,
  panOx: number,
  panOy: number,
  viewportRadius: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(sizeDevW * sizeDevH * 4);
  const centerX = sizeDevW / 2;
  const centerY = sizeDevH / 2;
  /* Isotropic scale anchored to the shorter dim — keeps cells square on
   * non-square canvases; the longer axis just shows more world. */
  const minCenter = Math.min(centerX, centerY);
  const gridPerPx = viewportRadius / minCenter;

  for (let py = 0; py < sizeDevH; py++) {
    for (let px = 0; px < sizeDevW; px++) {
      const dpx = px - centerX;
      const dpy = py - centerY;
      /* Flip y so +oy is north. */
      const ox = Math.round(dpx * gridPerPx + panOx);
      const oy = Math.round(-dpy * gridPerPx + panOy);
      const i = (py * sizeDevW + px) * 4;

      const [r, g, b] = biomeColor(biomeAt(biomeSeed, ox, oy, knobs));
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Imperative handle for navigating the disc programmatically — exposed
 * via `forwardRef` so callers (the orchestrator, MapTab) can request a
 * camera focus without threading another prop through the tree.
 *
 * Use cases:
 *  - Mount-time auto-focus on the local player's cell (called internally
 *    via the `autoFocusCell` prop + a once-per-cityId guard).
 *  - Click-to-focus from the right-hand EntityPanel — clicking the
 *    selected entity's name pans/zooms the disc onto their cell.
 *  - Future navigation prompts (e.g. "find my Wild" search results).
 */
export interface CityTerrainMapHandle {
  /**
   * Tween the camera so the cell at (gridLat, gridLong) sits centred
   * under the viewport at the target scale. Coords are the same full
   * grid units the rest of the API uses — NOT offsets relative to
   * city centre.
   */
  focusCell: (
    gridLat: number,
    gridLong: number,
    opts?: { scale?: number; durationMs?: number },
  ) => void;
}

export const CityTerrainMap2DFallback = forwardRef<CityTerrainMapHandle, Props>(
  function CityTerrainMap2DFallback(
    {
      cityAccount,
      selected,
      onSelect,
      selectedEntity,
      onEntitySelect,
      travel,
      otherWalks,
      myPlayerPubkey,
      teamMatePubkeys,
      autoFocusCell,
      getDotTooltip,
    },
    ref,
  ) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const cityLatGrid = toGrid(cityAccount.latitude);
  const cityLongGrid = toGrid(cityAccount.longitude);
  /* Post flat-strategy: city is a centred square plot of (widthGrid,
   * heightGrid). We keep the legacy `radiusGridUnits` name as the
   * half-extent of the LARGER axis so the bake math (which renders a
   * square region around the city centre) doesn't change shape. Bounds
   * checks use widthGrid/heightGrid directly via plotHalfW/plotHalfH. */
  const plotHalfW = useMemo(() => cityAccount.widthGrid / 2, [cityAccount.widthGrid]);
  const plotHalfH = useMemo(() => cityAccount.heightGrid / 2, [cityAccount.heightGrid]);
  const radiusGridUnits = useMemo(
    () => Math.max(plotHalfW, plotHalfH),
    [plotHalfW, plotHalfH],
  );
  const biomeSeed = cityAccount.biomeSeed;
  /* Per-city biome knobs — five bytes that bend the procedural sampler.
   * Memoised so the bake-cache key + every biomeAt call site can share a
   * stable reference. */
  const biomeKnobs = useMemo(
    () => biomeKnobsFromCity(cityAccount),
    [
      cityAccount.waterLevelDelta,
      cityAccount.tempBias,
      cityAccount.moistureBias,
      cityAccount.coast,
      cityAccount.landmassSeed,
    ],
  );

  /* Canvas size tracking — track width and height separately so the canvas
   * can be a rectangle that fills the parchment sheet. The renderer keeps
   * `gridPerPx` isotropic against the SHORTER dim, so the disc stays round
   * even on a wide canvas; the extra space on the long axis just shows the
   * surrounding terrain feathered into parchment (or parchment past the
   * feather band). */
  const [size, setSize] = useState({ w: MIN_LOGICAL_SIZE, h: MIN_LOGICAL_SIZE });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(MIN_LOGICAL_SIZE, Math.round(rect.width));
      const h = Math.max(MIN_LOGICAL_SIZE, Math.round(rect.height));
      setSize((prev) =>
        Math.abs(prev.w - w) > 4 || Math.abs(prev.h - h) > 4 ? { w, h } : prev,
      );
    };
    const scheduleMeasure = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(measure, 150);
    };
    measure();
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, []);

  // View state — panOx/panOy: grid offset of the canvas centre from the
  // city centre. scale: zoom factor (MIN_VIEW_SCALE = whole disc visible,
  // MAX_VIEW_SCALE = max closeup). Initial scale matches the user-clamp
  // floor so the first frame doesn't render below what the user could
  // ever pinch back to; the auto-focus effect below overrides this on
  // the home city.
  const [view, setView] = useState({ scale: MIN_VIEW_SCALE, panOx: 0, panOy: 0 });

  // Reset the view whenever the underlying city changes. Without this
  // the prior city's pan/zoom persists into the new one (same React
  // component instance, just different `cityAccount` prop). The auto-
  // focus effect further down then animates from this baseline for
  // the home city; non-home cities stay at MIN_VIEW_SCALE so the
  // player sees the whole disc on arrival.
  useEffect(() => {
    setView({ scale: MIN_VIEW_SCALE, panOx: 0, panOy: 0 });
  }, [cityAccount.cityId]);

  // Animation tick — bumps once per rAF when at least one occupant has an
  // animated cosmetic name color, otherwise stays at 0. The paint effect
  // adds this to its deps so each tick triggers a redraw against the
  // current `performance.now()`.
  const [animationTick, setAnimationTick] = useState(0);
  // (Drag previously used a CSS-translate preview; that left the canvas's
  // transparent corners exposed at the wrap edge. We now re-render the
  // viewport on every drag move (rAF-batched), so no CSS preview is needed.)

  /* Mirror `view` into a ref so the animation helper can read the latest
   * value synchronously (without waiting for the render cycle). Used as the
   * start state for tween captures and as a cheap "current view" reader for
   * one-shot interactions like double-click. */
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const viewportRadius = radiusGridUnits / view.scale;
  /* Grid units per CSS pixel — isotropic, anchored to the SHORTER dim so the
   * disc fills the canvas's smaller axis and the longer axis shows extra
   * world past the disc edge (feathered to parchment). Smaller = zoomed in. */
  const logicalMin = Math.min(size.w, size.h);
  const gridPerLogicalPx = (viewportRadius * 2) / logicalMin;

  // Clamp the viewport CENTRE so the canvas's visible rectangle stays
  // inside the city's SQUARE plot. Axis-wise (AABB) clamp — matches the
  // chain's `is_within_city_grid` bounds check (|ox| ≤ widthGrid/2,
  // |oy| ≤ heightGrid/2). The pre-flat-strategy disc clamp confined the
  // camera to the inscribed circle, which made the corners of the
  // square plot inaccessible even though the terrain bake covered them.
  const clampPan = (
    panOx: number,
    panOy: number,
    scale: number,
  ): { panOx: number; panOy: number } => {
    if (scale <= 1.001) return { panOx: 0, panOy: 0 };
    // Canvas-aspect-aware viewport half-extents in grid units. `gridPerPx`
    // is isotropic against the shorter canvas axis, so the longer axis
    // shows MORE world (= bigger viewport half-extent along that axis).
    const viewportRadius = radiusGridUnits / scale;
    const sMin = Math.min(size.w, size.h);
    const halfViewW = sMin > 0 ? (size.w / sMin) * viewportRadius : viewportRadius;
    const halfViewH = sMin > 0 ? (size.h / sMin) * viewportRadius : viewportRadius;
    const maxOx = Math.max(0, plotHalfW - halfViewW);
    const maxOy = Math.max(0, plotHalfH - halfViewH);
    return {
      panOx: Math.max(-maxOx, Math.min(maxOx, panOx)),
      panOy: Math.max(-maxOy, Math.min(maxOy, panOy)),
    };
  };

  /* Animation infrastructure — `animateView` tweens (scale, panOx, panOy)
   * over a duration with a cubic ease-out, firing setView per rAF. Wheel
   * and pinch zooms stay instant (their per-event delta is small enough to
   * feel smooth on its own); the discrete gestures — double-click and
   * reset — go through this so a single big delta doesn't snap the view.
   * Any in-flight tween is cancelable so a wheel/drag mid-animation wins. */
  const animRef = useRef<number | null>(null);
  const cancelAnim = () => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  };
  useEffect(() => {
    return () => cancelAnim();
  }, []);

  const animateView = (
    target: { scale: number; panOx: number; panOy: number },
    durationMs = 220,
  ) => {
    cancelAnim();
    const start = { ...viewRef.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      /* Cubic ease-out — fast departure, gentle settle. Matches the feel
       * of Google/Apple Maps' zoom snap. */
      const e = 1 - Math.pow(1 - t, 3);
      setView({
        scale: start.scale + (target.scale - start.scale) * e,
        panOx: start.panOx + (target.panOx - start.panOx) * e,
        panOy: start.panOy + (target.panOy - start.panOy) * e,
      });
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
  };

  /* Compute the target view for a zoom anchored at a client point — pulled
   * out of zoomAt so both the instant path (wheel) and the animated path
   * (double-click) can share the math. Returns null if the wrap element is
   * not mounted yet. */
  const computeZoomedView = (
    clientX: number,
    clientY: number,
    factor: number,
    base: { scale: number; panOx: number; panOy: number },
  ): { scale: number; panOx: number; panOy: number } | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const wx = clientX - r.left;
    const wy = clientY - r.top;
    const dxFromCenter = (wx - r.width / 2) / r.width;
    const dyFromCenter = (wy - r.height / 2) / r.height;
    const newScale = Math.max(MIN_VIEW_SCALE, Math.min(MAX_VIEW_SCALE, base.scale * factor));
    const prevViewportRadius = radiusGridUnits / base.scale;
    const cursorOx = base.panOx + dxFromCenter * prevViewportRadius * 2;
    const cursorOy = base.panOy - dyFromCenter * prevViewportRadius * 2;
    const newViewportRadius = radiusGridUnits / newScale;
    const nextPan = clampPan(
      cursorOx - dxFromCenter * newViewportRadius * 2,
      cursorOy + dyFromCenter * newViewportRadius * 2,
      newScale,
    );
    return { scale: newScale, panOx: nextPan.panOx, panOy: nextPan.panOy };
  };

  // Reset goes to MIN_VIEW_SCALE, not 1 — the user can't pan/zoom below
  // MIN_VIEW_SCALE, so "reset" should land at the same most-zoomed-out
  // state they could reach themselves. The visibility guard below only
  // shows the chip when the user is ABOVE MIN_VIEW_SCALE, so reset is
  // never a no-op.
  const resetView = () => animateView({ scale: MIN_VIEW_SCALE, panOx: 0, panOy: 0 });

  /* Shared focus helper — used by both the mount-time auto-focus
   * effect (autoFocusCell prop) and the imperative `focusCell` handle
   * exposed via forwardRef. Centralising the math here means caller
   * code (MapTab's entity-name click, future navigation prompts) gets
   * the exact same tween shape as the mount snap. */
  const focusCell = useCallback(
    (
      gridLat: number,
      gridLong: number,
      opts?: { scale?: number; durationMs?: number },
    ) => {
      const ox = gridLong - cityLongGrid;
      const oy = gridLat - cityLatGrid;
      const scale = opts?.scale ?? MAX_VIEW_SCALE;
      const duration = opts?.durationMs ?? 520;
      const target = clampPan(ox, oy, scale);
      animateView({ scale, panOx: target.panOx, panOy: target.panOy }, duration);
    },
    // clampPan + animateView are render-local closures that read viewRef/setView;
    // they're recreated each render but the IDs they capture are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cityLongGrid, cityLatGrid],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusCell,
    }),
    [focusCell],
  );

  const autoFocusedForCityRef = useRef<number | null>(null);
  useEffect(() => {
    const lat = autoFocusCell?.gridLat;
    const long = autoFocusCell?.gridLong;
    if (lat == null || long == null) return;
    if (size.w <= MIN_LOGICAL_SIZE || size.h <= MIN_LOGICAL_SIZE) return;
    if (autoFocusedForCityRef.current === cityAccount.cityId) return;
    autoFocusedForCityRef.current = cityAccount.cityId;
    focusCell(lat, long);
  }, [
    autoFocusCell?.gridLat,
    autoFocusCell?.gridLong,
    cityAccount.cityId,
    size.w,
    size.h,
    focusCell,
  ]);


  /*
   * Terrain caching.
   *
   * The naive per-pan re-render computes ~8M pixels' worth of
   * terrainElevation/Moisture/elevationToColor on every view change —
   * 60 rAF-driven repaints/sec during a drag = main thread frozen for
   * 100-300 ms each frame on desktop, several seconds on mobile.
   *
   * Cache strategy:
   *  - Build ONE offscreen 2048×2048 canvas per (cityId, terrain) that
   *    covers the entire disc footprint (-radiusGridUnits..+radiusGridUnits).
   *  - On every render, blit the cached image via ctx.drawImage with the
   *    right translation + scale to match the current viewport. drawImage
   *    is GPU-accelerated and runs in microseconds regardless of pan.
   *
   * Trade-off: max-zoom views interpolate the cache up by the zoom factor;
   * at viewport_radius ≈ 30 grid cells in a 60 km city, each cached pixel
   * spans ~30 screen pixels, which softens (but doesn't break) the look.
   * Acceptable — pan responsiveness is the priority, and the dot/marker
   * layer (which draws on top) stays crisp regardless.
   */
  const TERRAIN_CACHE_SIZE = 2048;
  const terrainCacheRef = useRef<{
    cityId: number;
    canvas: HTMLCanvasElement;
    radiusGridUnits: number;
    biomeSeed: number;
    knobs: BiomeKnobs;
  } | null>(null);
  const terrainCache = useMemo(() => {
    const cached = terrainCacheRef.current;
    if (
      cached &&
      cached.cityId === cityAccount.cityId &&
      cached.radiusGridUnits === radiusGridUnits &&
      cached.biomeSeed === biomeSeed &&
      cached.knobs.waterLevelDelta === biomeKnobs.waterLevelDelta &&
      cached.knobs.tempBias === biomeKnobs.tempBias &&
      cached.knobs.moistureBias === biomeKnobs.moistureBias &&
      cached.knobs.coast === biomeKnobs.coast &&
      cached.knobs.landmassSeed === biomeKnobs.landmassSeed
    ) {
      return cached.canvas;
    }
    if (typeof document === "undefined") return null;
    const offscreen = document.createElement("canvas");
    offscreen.width = TERRAIN_CACHE_SIZE;
    offscreen.height = TERRAIN_CACHE_SIZE;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return null;
    /* Cached image covers the full plot bounding square: x∈[-r..+r] grid
     * units mapped to pixels 0..TERRAIN_CACHE_SIZE. */
    const gridPerCachedPx = (radiusGridUnits * 2) / TERRAIN_CACHE_SIZE;
    const pixels = new Uint8ClampedArray(
      TERRAIN_CACHE_SIZE * TERRAIN_CACHE_SIZE * 4,
    );
    const halfCache = TERRAIN_CACHE_SIZE / 2;
    for (let py = 0; py < TERRAIN_CACHE_SIZE; py++) {
      for (let px = 0; px < TERRAIN_CACHE_SIZE; px++) {
        /* px=0 → ox=-radiusGridUnits, px=TERRAIN_CACHE_SIZE → ox=+r.
         * py is flipped (matches the on-screen +y=down, +oy=north). */
        const ox = Math.round((px - halfCache) * gridPerCachedPx);
        const oy = Math.round(-(py - halfCache) * gridPerCachedPx);
        const i = (py * TERRAIN_CACHE_SIZE + px) * 4;
        const [r, g, b] = biomeColor(biomeAt(biomeSeed, ox, oy, biomeKnobs));
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      }
    }
    const img = offCtx.createImageData(TERRAIN_CACHE_SIZE, TERRAIN_CACHE_SIZE);
    img.data.set(pixels);
    offCtx.putImageData(img, 0, 0);
    terrainCacheRef.current = {
      cityId: cityAccount.cityId,
      canvas: offscreen,
      radiusGridUnits,
      biomeSeed,
      knobs: biomeKnobs,
    };
    return offscreen;
  }, [cityAccount.cityId, biomeSeed, radiusGridUnits, biomeKnobs]);

  // Terrain blit — drawImage the cache, translated/scaled to the view.
  // Replaces the per-pixel rerender that previously fired on every pan.
  useEffect(() => {
    const canvas = terrainCanvasRef.current;
    if (!canvas || !terrainCache) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const sizeDevW = Math.round(size.w * dpr);
    const sizeDevH = Math.round(size.h * dpr);
    canvas.width = sizeDevW;
    canvas.height = sizeDevH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* Screen ↔ grid: matches renderTerrainViewport's coordinate math, so
     * the blitted cache lines up pixel-for-pixel with where the
     * per-pixel render would have placed each grid cell. */
    const minCenter = Math.min(sizeDevW, sizeDevH) / 2;
    const gridPerScreenPx = viewportRadius / minCenter;
    /* Screen px per grid cell. Cached image has TERRAIN_CACHE_SIZE px for
     * (radiusGridUnits * 2) grid cells; we scale so 1 grid cell on the
     * cache → screenPxPerGrid screen px. */
    const screenPxPerGrid = 1 / gridPerScreenPx;
    const scale = (screenPxPerGrid * (radiusGridUnits * 2)) / TERRAIN_CACHE_SIZE;
    /* Cached pixel (TERRAIN_CACHE_SIZE/2, TERRAIN_CACHE_SIZE/2) is grid
     * (0, 0). Grid (0,0) lives at screen
     *   (sizeDevW/2 - panOx*screenPxPerGrid, sizeDevH/2 + panOy*screenPxPerGrid)
     * — flip on Y because +oy=north and +y=south on screen. */
    const gridZeroScreenX = sizeDevW / 2 - view.panOx * screenPxPerGrid;
    const gridZeroScreenY = sizeDevH / 2 + view.panOy * screenPxPerGrid;
    const blitW = TERRAIN_CACHE_SIZE * scale;
    const blitH = TERRAIN_CACHE_SIZE * scale;
    const dx = gridZeroScreenX - blitW / 2;
    const dy = gridZeroScreenY - blitH / 2;

    /* Pixelated scaling — sharper terrain edges at high zoom rather than
     * smeared bilinear interpolation. The cache resolution is intentionally
     * grid-aligned, so nearest-neighbour preserves the cell boundaries. */
    ctx.imageSmoothingEnabled = false;
    /* Paint a neutral fill behind the disc — needed when the blit doesn't
     * fully cover the canvas (e.g. pan past the edge of the cached disc). */
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, sizeDevW, sizeDevH);
    ctx.drawImage(terrainCache, dx, dy, blitW, blitH);
  }, [
    terrainCache,
    size.w,
    size.h,
    view.panOx,
    view.panOy,
    view.scale,
    viewportRadius,
    radiusGridUnits,
  ]);

  /* Occupancy: zustand-backed (lib/store/subscriptions.ts streams every
   * LocationAccount over WS). Hook seeds the store on cityId change. */
  const { data: occupied } = useCityOccupied(cityAccount.cityId);

  // Drive `animationTick` at frame rate while any visible occupant has an
  // animated cosmetic name color. When none are visible, no rAF runs and
  // tick stays put (no idle CPU cost). Re-evaluated on every `occupied`
  // change so animations stop the moment the only animated dot leaves the
  // scene.
  const hasAnimatedDot = useMemo(
    () => occupied.some((c) => c.nameColorAnim != null),
    [occupied],
  );
  useEffect(() => {
    if (!hasAnimatedDot) return;
    let rafId: number | null = null;
    const step = () => {
      // Bump modulo a safe range to avoid integer drift over long sessions.
      setAnimationTick((t) => (t + 1) % 1_000_000);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [hasAnimatedDot]);

  /* Per-render cache of inspection-label hit boxes (CSS px). The draw
   * effect rebuilds it each pass; the click handler hit-tests against it
   * so a tap on a name pill zooms into the cell behind it instead of
   * registering as an out-of-bounds disc click. */
  const inspectionLabelHitsRef = useRef<
    {
      x: number;
      y: number;
      w: number;
      h: number;
      cell: OccupiedCell;
    }[]
  >([]);

  /* Coordinate helpers — all isotropic against the shorter canvas dim so the
   * disc geometry stays round regardless of the canvas aspect ratio. */

  /* Canvas px (CSS, 0..size.w/size.h) → grid offset (relative to city centre). */
  const pxToGrid = (px: number, py: number) => {
    const centerX = size.w / 2;
    const centerY = size.h / 2;
    const ox = Math.round((px - centerX) * gridPerLogicalPx + view.panOx);
    const oy = Math.round(-(py - centerY) * gridPerLogicalPx + view.panOy);
    return { ox, oy };
  };

  /* Grid offset (relative to city centre) → device px on the canvas. */
  const gridToDevPx = (ox: number, oy: number, dpr: number) => {
    const sizeDevW = Math.round(size.w * dpr);
    const sizeDevH = Math.round(size.h * dpr);
    const centerX = sizeDevW / 2;
    const centerY = sizeDevH / 2;
    const gridPerDevPx = viewportRadius / Math.min(centerX, centerY);
    return {
      px: (ox - view.panOx) / gridPerDevPx + centerX,
      py: -(oy - view.panOy) / gridPerDevPx + centerY,
    };
  };

  /* Client coord → canvas px (CSS units). The canvas is always in sync with
   * `view` (no CSS preview), so this is a straight rect-to-canvas mapping. */
  const clientToCanvasPx = (clientX: number, clientY: number, wrap: DOMRect) => {
    return {
      px: ((clientX - wrap.left) / wrap.width) * size.w,
      py: ((clientY - wrap.top) / wrap.height) * size.h,
    };
  };

  // Overlay layer — grid, occupants, walk-lines, selection cross.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const sizeDevW = Math.round(size.w * dpr);
    const sizeDevH = Math.round(size.h * dpr);
    const sizeDevMin = Math.min(sizeDevW, sizeDevH);
    canvas.width = sizeDevW;
    canvas.height = sizeDevH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, sizeDevW, sizeDevH);

    // CSS px per grid cell drives the visibility threshold; device px drives
    // the actual draw position. Computing both up front:
    const cssPxPerCell = 1 / gridPerLogicalPx;
    const pxPerCell = cssPxPerCell * dpr; // device px per 1 grid cell

    // (Outer disc ring removed — the playable area is now an invisible
    // boundary, enforced by the click handler's "Out of city bounds"
    // notice when the user picks a cell past radiusGridUnits.)

    // Proximity grid (graph paper) — lineWidth = 1 device px, positions
    // rounded to half-device-pixel offsets. Anything else gives a smeared
    // or doubled look on Retina (Mobile Safari is the worst offender).
    if (cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL) {
      // Stride keeps the line count bounded — render every N-th gridline so
      // the wash doesn't blacken at extreme zooms.
      const stride = Math.max(
        1,
        2 ** Math.max(0, Math.ceil(Math.log2(GRID_OVERLAY_MIN_CSS_PX_PER_CELL / cssPxPerCell))),
      );
      /* Grid-line range is computed per-axis — the canvas may be wider than
       * it is tall (or vice versa), so the visible grid extent is the
       * viewport radius scaled by the axis's device-pixel ratio against the
       * shorter dim. Without this, the wide-axis ends of the canvas would
       * show no grid lines. */
      const halfGridX = (sizeDevW / sizeDevMin) * viewportRadius;
      const halfGridY = (sizeDevH / sizeDevMin) * viewportRadius;
      const minOx = Math.floor(view.panOx - halfGridX) - stride;
      const maxOx = Math.ceil(view.panOx + halfGridX) + stride;
      const minOy = Math.floor(view.panOy - halfGridY) - stride;
      const maxOy = Math.ceil(view.panOy + halfGridY) + stride;

      ctx.strokeStyle = "rgba(46, 31, 16, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startOx = Math.ceil(minOx / stride) * stride;
      const startOy = Math.ceil(minOy / stride) * stride;
      /* Grid lines are drawn at HALF-INTEGER grid coords so they bound cells
       * instead of bisecting them — the chess-board model players expect.
       * A line at (ox − 0.5) sits between cells (ox − 1) and (ox), so the
       * selection square + occupant tiles (which fill the cell centred on
       * its integer coord) align cleanly with the grid. */
      for (let ox = startOx; ox <= maxOx; ox += stride) {
        const x = Math.round(gridToDevPx(ox - 0.5, 0, dpr).px) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, sizeDevH);
      }
      for (let oy = startOy; oy <= maxOy; oy += stride) {
        const y = Math.round(gridToDevPx(0, oy - 0.5, dpr).py) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(sizeDevW, y);
      }
      ctx.stroke();
    }

    // Other players' walks (muted) — drawn first so the local player's
    // bright walk layers on top. Same seal-orange family but lower
    // opacity, thinner stroke, no marker halo — present but not
    // competing. `pct` is interpolated upstream against chainNow.
    if (otherWalks && otherWalks.length > 0) {
      const walkNowMs = performance.now();
      for (const w of otherWalks) {
        const oxF = w.fromGridLong - cityLongGrid;
        const oyF = w.fromGridLat - cityLatGrid;
        const oxT = w.toGridLong - cityLongGrid;
        const oyT = w.toGridLat - cityLatGrid;
        const fp = gridToDevPx(oxF, oyF, dpr);
        const tp = gridToDevPx(oxT, oyT, dpr);

        // Walker's cosmetic name color — tints the line + marker so the
        // walk carries the same identity as the dot. Falls through to
        // the canonical muted seal-orange when the walker has no color
        // equipped.
        const baseColor = w.nameColorHex
          ? w.nameColorAnim
            ? animatedColorToRgba(
                animatedColorAt(w.nameColorHex, w.nameColorAnim, walkNowMs),
              )
            : w.nameColorHex
          : null;

        ctx.save();
        ctx.strokeStyle = baseColor
          ? toRgbaWithAlpha(baseColor, 0.45)
          : "rgba(180, 83, 9, 0.4)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(fp.px, fp.py);
        ctx.lineTo(tp.px, tp.py);
        ctx.stroke();
        ctx.restore();

        const t = Math.min(1, Math.max(0, w.pct / 100));
        const mx = fp.px + (tp.px - fp.px) * t;
        const my = fp.py + (tp.py - fp.py) * t;
        ctx.fillStyle = baseColor
          ? toRgbaWithAlpha(baseColor, 0.85)
          : "rgba(180, 83, 9, 0.85)";
        // Marker ring uses the walker's frame ring color when set so
        // frame ownership reads through the marker's stroke.
        ctx.strokeStyle = w.frameBorderColor ?? "rgba(255, 250, 235, 0.7)";
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.arc(mx, my, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // In-flight walk line + marker (intracity travel) — drawn above the
    // proximity grid and city ring but below the centre marker and
    // occupants so dots and tile fills stay legible on top. Same
    // seal-orange palette as the realm-map intercity line.
    if (travel) {
      const oxFrom = travel.fromGridLong - cityLongGrid;
      const oyFrom = travel.fromGridLat - cityLatGrid;
      const oxTo = travel.toGridLong - cityLongGrid;
      const oyTo = travel.toGridLat - cityLatGrid;
      const fromPx = gridToDevPx(oxFrom, oyFrom, dpr);
      const toPx = gridToDevPx(oxTo, oyTo, dpr);

      // My walk gets the local player's name color too — same modulator
      // as other walks. Static colors render the line in the equipped
      // hex at 0.85 alpha; animated colors pulse on each rAF tick.
      const travelNowMs = performance.now();
      const travelColor = travel.nameColorHex
        ? travel.nameColorAnim
          ? animatedColorToRgba(
              animatedColorAt(travel.nameColorHex, travel.nameColorAnim, travelNowMs),
            )
          : travel.nameColorHex
        : null;

      ctx.save();
      ctx.strokeStyle = travelColor
        ? toRgbaWithAlpha(travelColor, 0.85)
        : "rgba(180, 83, 9, 0.85)";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(fromPx.px, fromPx.py);
      ctx.lineTo(toPx.px, toPx.py);
      ctx.stroke();
      ctx.restore();

      // Pulsing marker at the interpolated progress point. The disc is
      // re-rendered every 250 ms while travel is in flight (via the
      // travel.pct dep), so we don't need a separate animation frame —
      // the marker advances on each useTravelProgress tick.
      const t = Math.min(1, Math.max(0, travel.pct / 100));
      const mx = fromPx.px + (toPx.px - fromPx.px) * t;
      const my = fromPx.py + (toPx.py - fromPx.py) * t;

      // Halo for visibility against busy backgrounds.
      ctx.fillStyle = travelColor
        ? toRgbaWithAlpha(travelColor, 0.25)
        : "rgba(180, 83, 9, 0.25)";
      ctx.beginPath();
      ctx.arc(mx, my, 9 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = travelColor ?? "rgba(180, 83, 9, 1)";
      ctx.strokeStyle = travel.frameBorderColor ?? "rgba(255, 250, 235, 0.95)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(mx, my, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // (Centre cartographer's-star marker removed — the city centre is
    // now anonymous on the disc; players orient via the terrain features
    // and the "X m from centre" readout instead of a fixed glyph.)

    /* Occupancy — muted antique-palette glyphs, shape-distinguished:
     *   Player  → filled circle, tobacco amber
     *   Wild    → filled diamond, dark oxblood
     * Shape (not just hue) is the primary distinguisher so they read clearly
     * even at the smallest dot size and on a monochrome paper background.
     * At tile-mode zoom each cell still fills solid so the cell footprint is
     * obvious — the shape only takes over in dot mode. */
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;
    const PLAYER_FILL = "rgba(160, 100, 45, 1)";
    /* Castles read as cold-stone slate against the warm-tobacco palette so
     * they don't compete with player dots even when they sit on the same
     * cell cluster. Shape is a filled square (the third primitive after
     * circle/diamond) so identity is legible at the smallest dot size. */
    const CASTLE_FILL = "rgba(95, 105, 120, 0.95)";
    /* Local player gets a deep-ink fill so the viewer can pick themselves
     * out at a glance against the warm-amber other-players. Stays in the
     * antique palette but reads near-black against the parchment. */
    const MY_PLAYER_FILL = "rgba(20, 14, 8, 1)";
    /* Team-mates render in a brightened amber-gold — still in the antique
     * palette but clearly differentiated from neutral/rival amber. */
    const TEAM_FILL = "rgba(220, 175, 60, 1)";
    const WILD_FILL = "rgba(115, 55, 30, 1)";
    const teamMateSet = teamMatePubkeys && teamMatePubkeys.length > 0
      ? new Set(teamMatePubkeys)
      : null;
    // Snapshot once per paint; per-cell animated-color computation reads
    // this so all dots stay phase-aligned within a frame.
    const nowMs = performance.now();
    /* Selection stroke was previously the same gold as TEAM_FILL, so a
     * selected teammate read as a solid yellow blob with no visible "this
     * is selected" ring. Cream-white at full opacity contrasts against
     * gold / tobacco / slate / dark fills alike, and the doubled stroke
     * width below (3 dpr vs 1.5 dpr default) gives it a halo. */
    const SELECTED_STROKE = "rgba(255, 248, 224, 1)";
    const CREAM_STROKE = "rgba(252, 244, 220, 0.95)";
    for (const cell of occupied) {
      const ox = cell.gridLong - cityLongGrid;
      const oy = cell.gridLat - cityLatGrid;
      const { px, py } = gridToDevPx(ox, oy, dpr);
      if (px < -20 || px > sizeDevW + 20 || py < -20 || py > sizeDevH + 20) continue;
      const isPlayer = cell.occupantType === OCCUPANT_PLAYER;
      const isEncounter = cell.occupantType === OCCUPANT_ENCOUNTER;
      const isCastle = cell.occupantType === OCCUPANT_CASTLE;
      if (!isPlayer && !isEncounter && !isCastle) continue;
      // Castle cells come in N² copies — one per footprint cell — so
      // click resolution lands on any cell. Render only the anchor
      // (dlat=0, dlong=0); the anchor paints a single plate spanning
      // all N×N cells, so the remaining N²-1 cells stay invisible.
      if (isCastle && cell.footprintAnchor !== true) continue;
      const castleN = isCastle ? Math.max(1, cell.footprintSize ?? 1) : 1;
      const isSelectedEntity =
        selectedEntity != null &&
        selectedEntity.gridLat === cell.gridLat &&
        selectedEntity.gridLong === cell.gridLong;
      const isMyPlayer =
        isPlayer && myPlayerPubkey != null && cell.occupant === myPlayerPubkey;
      const isTeamMate =
        isPlayer && !isMyPlayer && teamMateSet?.has(cell.occupant) === true;

      // Cosmetic name color wins for any player dot — players paid for
      // their identity color, so it overrides the team/my/baseline amber
      // when set. Animated colors are computed against `nowMs` for this
      // frame; static colors use the catalog hex directly.
      let fill: string;
      if (isPlayer && cell.nameColorHex) {
        fill = cell.nameColorAnim
          ? animatedColorToRgba(
              animatedColorAt(cell.nameColorHex, cell.nameColorAnim, nowMs),
            )
          : cell.nameColorHex;
      } else if (isMyPlayer) {
        fill = MY_PLAYER_FILL;
      } else if (isTeamMate) {
        fill = TEAM_FILL;
      } else if (isPlayer) {
        fill = PLAYER_FILL;
      } else if (isCastle) {
        fill = CASTLE_FILL;
      } else {
        fill = WILD_FILL;
      }
      // Avatar frame — players who paid for one swap the cream stroke for
      // the frame's ring color, and a translucent halo paints behind the
      // dot/tile when the frame defines `glow`. Selection still wins (the
      // gold halo is the "this is selected" affordance).
      const frameEntry = isPlayer ? getCosmeticFrame(cell.equippedFrame) : null;
      const stroke = isSelectedEntity
        ? SELECTED_STROKE
        : frameEntry?.ring.borderColor ?? CREAM_STROKE;
      const frameGlow = !isSelectedEntity ? frameEntry?.ring.glow : null;

      if (renderAsTiles) {
        /* Snap rectangle to integer device pixels — otherwise adjacent tiles
         * can show sub-pixel gaps or 2-px-wide seams that look like grid
         * misalignment, especially on mobile DPR. Castle anchors paint a
         * plate spanning N cells in each axis (anchor at the SW corner,
         * footprint extends +north/+east). */
        const half = pxPerCell / 2;
        const x0 = Math.round(px - half);
        const y0 = isCastle
          ? Math.round(py - pxPerCell * (castleN - 1) - half)
          : Math.round(py - half);
        const xExtent = isCastle ? px + pxPerCell * (castleN - 1) + half : px + half;
        const w = Math.round(xExtent) - x0;
        const h = isCastle ? Math.round(py + half) - y0 : Math.round(py + half) - y0;
        if (frameGlow) {
          ctx.fillStyle = frameGlow;
          ctx.fillRect(x0 - 3 * dpr, y0 - 3 * dpr, w + 6 * dpr, h + 6 * dpr);
        }
        ctx.fillStyle = fill;
        ctx.fillRect(x0, y0, w, h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = (isSelectedEntity ? 3 : frameEntry ? frameEntry.ring.borderWidth : 1) * dpr;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      } else {
        const r = (isSelectedEntity ? 6 : 5) * dpr;
        if (frameGlow && isPlayer) {
          /* Halo behind the dot — a translucent circle 1.6× the dot
           * radius reads as a soft outer glow matching the frame's
           * `ring.glow` value. Painted before the fill so the dot
           * color stays clean. */
          ctx.fillStyle = frameGlow;
          ctx.beginPath();
          ctx.arc(px, py, r * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = (isSelectedEntity ? 2.5 : frameEntry ? frameEntry.ring.borderWidth : 1.5) * dpr;
        if (isPlayer) {
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (isCastle) {
          /* Castle — filled square sized by footprint. Anchor sits at
           * the SW corner of the footprint; centre the visible square
           * over the geometric centre of the N×N plot. The minimum
           * draw size grows with footprint so a 4×4 fortress is
           * obviously larger than a 1×1 outpost even in dot mode. */
          const scale = Math.max(1, castleN * 0.7);
          const half = r * scale;
          const cx = px + (pxPerCell * (castleN - 1)) / 2;
          const cy = py - (pxPerCell * (castleN - 1)) / 2;
          ctx.beginPath();
          ctx.rect(cx - half, cy - half, half * 2, half * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          /* Wild — filled diamond. Saves a save/restore by drawing the
           * rotated-square path explicitly around (px, py). */
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.lineTo(px + r, py);
          ctx.lineTo(px, py + r);
          ctx.lineTo(px - r, py);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Selected landing cell (intercity picker).
    if (selected) {
      const ox = selected.gridLong - cityLongGrid;
      const oy = selected.gridLat - cityLatGrid;
      const { px, py } = gridToDevPx(ox, oy, dpr);
      ctx.strokeStyle = "rgba(180, 83, 9, 1)";
      ctx.lineWidth = 2 * dpr;
      if (renderAsTiles) {
        const half = pxPerCell / 2;
        const x0 = Math.round(px - half);
        const y0 = Math.round(py - half);
        const w = Math.round(px + half) - x0;
        const h = Math.round(py + half) - y0;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 7 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
      // (Earlier we drew a small "+" crosshair inside the selection ring;
      // dropped because the ring alone reads as "selected" and the cross
      // crowds the cell at tile-mode zoom.)
    }

    /* ── Inspection-band labels (A2) ───────────────────────────────
     * In a sweet-spot zoom band, draw a small name label next to each
     * visible occupant dot. Outside the band (zoomed too far / too
     * close) labels would be illegible or crowded — at 200× the user
     * is in tactical mode and the EntityPanel + hover tooltip cover
     * single-cell inspection; at 1× the cells are sub-pixel and
     * labels would smear into noise. The band [1.5×, 30×] is where
     * dots are spaced enough that the labels add identity rather
     * than clutter.
     *
     * Density inside the band is handled with greedy collision
     * culling: priority-ordered iteration (mine → selected →
     * encounters → others) lays down labels one at a time, skipping
     * any whose bbox overlaps an already-drawn label's bbox. Top-
     * priority labels survive a dense cluster; the rest are silently
     * hidden and the user can hover/tap to inspect them individually.
     *
     * Skipped when the parent didn't wire `getDotTooltip` — without
     * a resolver there's nothing to render. */
    const INSPECTION_ZOOM_LOW = 1.5;
    const INSPECTION_ZOOM_HIGH = 30;
    if (
      getDotTooltip &&
      view.scale >= INSPECTION_ZOOM_LOW &&
      view.scale <= INSPECTION_ZOOM_HIGH
    ) {
      /* Pull the theme palette from the cascaded CSS vars on the canvas —
       * `--parchment`, `--ink`, `--ink-soft`, `--ink-faint` are redefined
       * for `body[data-theme="dark"]` so reading them here gives the
       * label pill matching colours in both modes. Canvas can't reference
       * CSS variables directly, so we read once per render and use the
       * resolved strings as fillStyle / strokeStyle inputs. Fallbacks are
       * the light-mode values in case the cascade hasn't applied yet. */
      const computed = getComputedStyle(canvas);
      const themeParchment =
        computed.getPropertyValue("--parchment").trim() || "#efe2c4";
      const themeInk = computed.getPropertyValue("--ink").trim() || "#2e1f10";
      const themeInkSoft =
        computed.getPropertyValue("--ink-soft").trim() || "#6b4a2a";
      const themeInkFaint =
        computed.getPropertyValue("--ink-faint").trim() || "#b89a72";

      const labelFontPx = Math.max(10, 10 * dpr);
      ctx.font = `${labelFontPx}px ui-monospace, "JetBrains Mono", monospace`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      const priority = (cell: OccupiedCell): number => {
        if (myPlayerPubkey && cell.occupant === myPlayerPubkey) return 0;
        if (
          selectedEntity &&
          selectedEntity.gridLat === cell.gridLat &&
          selectedEntity.gridLong === cell.gridLong &&
          selectedEntity.pubkey === cell.occupant
        )
          return 1;
        if (cell.occupantType === OCCUPANT_ENCOUNTER) return 2;
        return 3;
      };
      const sorted = [...occupied].sort((a, b) => priority(a) - priority(b));

      const drawn: { x: number; y: number; w: number; h: number }[] = [];
      // Reset the click-hit cache for this render pass — entries pushed
      // inside the loop are CSS-px bboxes so the click handler can hit-
      // test directly without re-dividing by dpr each tap.
      const hits: { x: number; y: number; w: number; h: number; cell: OccupiedCell }[] = [];
      const padX = 4 * dpr;
      const padY = 2 * dpr;
      const cellHalf = renderAsTiles ? pxPerCell / 2 : 5 * dpr;
      const lineH = (labelFontPx + 4) * 1;

      for (const cell of sorted) {
        const ox = cell.gridLong - cityLongGrid;
        const oy = cell.gridLat - cityLatGrid;
        const { px, py } = gridToDevPx(ox, oy, dpr);
        // Off-canvas cull with a generous margin so labels that start
        // off-screen but extend into view still draw.
        if (px < -100 || px > sizeDevW + 100 || py < -100 || py > sizeDevH + 100) continue;
        const t = getDotTooltip(cell.occupant, cell.occupantType);
        if (!t) continue;
        // Append the equipped title after the name when set — gives
        // the label a small public surface for the title cosmetic so
        // it isn't only visible in the EntityPanel. Joined with " · "
        // to match the existing secondary-line punctuation.
        const titleEntry = t.titleId ? getCosmeticTitle(t.titleId) : null;
        const text = titleEntry ? `${t.primary} · ${titleEntry.displayName}` : t.primary;
        const textW = ctx.measureText(text).width;
        const labelX = px + cellHalf + 4 * dpr;
        const labelY = py;
        const bbox = {
          x: labelX - padX,
          y: labelY - lineH / 2 - padY,
          w: textW + padX * 2,
          h: lineH + padY * 2,
        };
        const overlaps = drawn.some(
          (d) =>
            bbox.x < d.x + d.w &&
            bbox.x + bbox.w > d.x &&
            bbox.y < d.y + d.h &&
            bbox.y + bbox.h > d.y,
        );
        if (overlaps) continue;
        drawn.push(bbox);
        // Record the CSS-px version so the click handler can hit-test it.
        // Canvas uses device px; the click handler reads CSS px from the
        // wrap rect, so divide each coord by dpr to bring them into the
        // same space.
        hits.push({
          x: bbox.x / dpr,
          y: bbox.y / dpr,
          w: bbox.w / dpr,
          h: bbox.h / dpr,
          cell,
        });

        // Pill bg in the theme parchment + accent-coloured full border
        // (accent overrides `--ink-faint` per-entity — encounter rarity,
        // future player name-colour from cosmetics).
        ctx.fillStyle = themeParchment;
        ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.strokeStyle = t.accent ?? themeInkFaint;
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bbox.x + 0.5, bbox.y + 0.5, bbox.w - 1, bbox.h - 1);
        // `themeInkSoft` could read the same as ink in some palettes;
        // we pick the bolder one for readable text on the pill.
        void themeInkSoft;

        // Label text fill — equipped name color wins (animated colors
        // compute against `nowMs` so the label pulses in lockstep with
        // the dot). Falls through to the theme ink for un-colored
        // players + encounters.
        let labelFill: string = themeInk;
        if (t.nameColorHex) {
          labelFill = t.nameColorAnim
            ? animatedColorToRgba(
                animatedColorAt(t.nameColorHex, t.nameColorAnim, nowMs),
              )
            : t.nameColorHex;
        }
        ctx.fillStyle = labelFill;
        ctx.fillText(text, labelX, labelY);
      }
      // Publish the hit cache after the loop — the click handler reads it
      // before its cell-pick branch so taps on labels route to the cell
      // even when the label sits outside the disc bounds.
      inspectionLabelHitsRef.current = hits;
    } else {
      // Outside the inspection band — no labels to hit.
      inspectionLabelHitsRef.current = [];
    }
  }, [
    occupied,
    selected,
    selectedEntity,
    cityLatGrid,
    cityLongGrid,
    radiusGridUnits,
    size.w,
    size.h,
    view.scale,
    view.panOx,
    view.panOy,
    viewportRadius,
    gridPerLogicalPx,
    // Travel-line scalars — undefined when no walk in flight. Including
    // `travel.pct` so the marker advances on each useTravelProgress tick.
    travel?.fromGridLat,
    travel?.fromGridLong,
    travel?.toGridLat,
    travel?.toGridLong,
    travel?.pct,
    // Other players' walks — array identity changes per parent render, so
    // this naturally re-fires the effect each chainNow tick (which is the
    // tick driving the markers anyway).
    otherWalks,
    myPlayerPubkey,
    teamMatePubkeys,
    // Label resolver — identity may change when the parent re-renders
    // with new chain data (cityPlayers / viewedEncounters / local
    // player), so the labels re-draw with fresh names/levels.
    getDotTooltip,
    // Animated cosmetic name colors — the rAF tick above bumps this
    // when any occupant has nameColorAnim set. Static scenes leave it
    // at 0 and the effect runs once per real prop change.
    animationTick,
  ]);

  // Gestures — mouse, touch, pinch-zoom, double-click.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragLastRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const pinchDistRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  /* Instant zoom anchored at a client point. Used by wheel + pinch where
   * each per-event delta is small enough that the natural cadence reads as
   * smooth without explicit tweening. Cancels any in-flight animated tween
   * so the user's wheel always wins. */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    cancelAnim();
    setView((prev) => {
      const target = computeZoomedView(clientX, clientY, factor, prev);
      return target ?? prev;
    });
  };

  /* Animated counterpart for discrete gestures (double-click). Reads from
   * viewRef rather than the setView updater so the start of the tween is
   * captured cleanly even if React hasn't committed the latest view yet. */
  const zoomAtAnimated = (clientX: number, clientY: number, factor: number) => {
    const target = computeZoomedView(clientX, clientY, factor, viewRef.current);
    if (!target) return;
    animateView(target);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Wheel-intensity scaling.
      const baseFactor = e.ctrlKey ? 1.05 : 2.0;
      const intensity = Math.min(Math.abs(e.deltaY) / 100, 2.5);
      const factor = Math.pow(baseFactor, intensity);
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? factor : 1 / factor);
    };

    // Drag is applied to the *view* directly (no CSS preview). To keep the
    // main thread responsive under continuous mouse/touch events, we batch
    // pixel deltas inside an animation frame and flush once per paint —
    // this caps the re-render rate to the display refresh.
    let pendingDx = 0;
    let pendingDy = 0;
    let rafId: number | null = null;
    const flushPan = () => {
      rafId = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      const r = el.getBoundingClientRect();
      // panOx in grid units; one CSS pixel = (2 × viewportRadius / wrap_size)
      // grid units. viewportRadius depends on view.scale, so read from latest
      // state inside the updater.
      const dxPx = pendingDx;
      const dyPx = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      setView((prev) => {
        const vp = radiusGridUnits / prev.scale;
        const gridDx = -(dxPx / r.width) * 2 * vp;
        const gridDy = (dyPx / r.height) * 2 * vp;
        const nextPan = clampPan(prev.panOx + gridDx, prev.panOy + gridDy, prev.scale);
        return { scale: prev.scale, panOx: nextPan.panOx, panOy: nextPan.panOy };
      });
    };
    const schedulePan = () => {
      if (rafId === null) rafId = requestAnimationFrame(flushPan);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      /* If a zoom tween is in flight, the user's drag intent wins —
       * otherwise the view would keep snapping toward the old target while
       * being dragged. */
      cancelAnim();
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dragLastRef.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      const last = dragLastRef.current;
      if (!start || !last) return;
      if (!draggedRef.current) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < PAN_THRESHOLD_PX) return;
        draggedRef.current = true;
      }
      pendingDx += e.clientX - last.x;
      pendingDy += e.clientY - last.y;
      dragLastRef.current = { x: e.clientX, y: e.clientY };
      schedulePan();
    };
    const onMouseUp = () => {
      if (draggedRef.current) suppressClickRef.current = true;
      dragStartRef.current = null;
      dragLastRef.current = null;
      draggedRef.current = false;
      // Flush any pending delta so the final position is exact.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flushPan();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      /* Google-Maps convention: double-click zooms IN at the cursor with a
       * smooth ease-out so the eye can follow the transformation. Full
       * reset is available via the top-right ↻ chip (visible when scale
       * > 1) — keeps both gestures intentional. */
      zoomAtAnimated(e.clientX, e.clientY, 2);
    };

    const onTouchStart = (e: TouchEvent) => {
      const ts = e.touches;
      /* Any new touch (drag or pinch) cancels an in-flight tween so the
       * user's gesture always wins over a lingering snap. */
      cancelAnim();
      if (ts.length === 1) {
        dragStartRef.current = { x: ts[0]!.clientX, y: ts[0]!.clientY };
        dragLastRef.current = { x: ts[0]!.clientX, y: ts[0]!.clientY };
        draggedRef.current = false;
      } else if (ts.length === 2) {
        const dx = ts[1]!.clientX - ts[0]!.clientX;
        const dy = ts[1]!.clientY - ts[0]!.clientY;
        pinchDistRef.current = Math.hypot(dx, dy);
        dragStartRef.current = null;
        dragLastRef.current = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const ts = e.touches;
      if (ts.length === 1 && dragLastRef.current) {
        const last = dragLastRef.current;
        const start = dragStartRef.current;
        const dx = ts[0]!.clientX - last.x;
        const dy = ts[0]!.clientY - last.y;
        if (!draggedRef.current && start) {
          if (Math.hypot(ts[0]!.clientX - start.x, ts[0]!.clientY - start.y) < 6) return;
          draggedRef.current = true;
        }
        if (draggedRef.current) {
          e.preventDefault();
          pendingDx += dx;
          pendingDy += dy;
          dragLastRef.current = { x: ts[0]!.clientX, y: ts[0]!.clientY };
          schedulePan();
        }
      } else if (ts.length === 2 && pinchDistRef.current != null) {
        e.preventDefault();
        const dx = ts[1]!.clientX - ts[0]!.clientX;
        const dy = ts[1]!.clientY - ts[0]!.clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / pinchDistRef.current;
        zoomAt(
          (ts[0]!.clientX + ts[1]!.clientX) / 2,
          (ts[0]!.clientY + ts[1]!.clientY) / 2,
          factor,
        );
        pinchDistRef.current = dist;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchDistRef.current = null;
      if (e.touches.length === 0) {
        if (draggedRef.current) {
          suppressClickRef.current = true;
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushPan();
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 350);
        }
        dragStartRef.current = null;
        dragLastRef.current = null;
        draggedRef.current = false;
      }
    };

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
      if (rafId !== null) cancelAnimationFrame(rafId);
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
  }, [radiusGridUnits]);

  // Out-of-bounds notice — terrain now fills the whole square, but the
  // gameplay disc is still bounded by radiusGridUnits. Clicking in a
  // corner (past the invisible boundary) surfaces this notice so the
  // pick reads as a deliberate "no, this is outside the city" rather
  // than a broken click. Auto-clears after ~2.5 s or on the next click.
  const [outOfBoundsNotice, setOutOfBoundsNotice] = useState(false);
  useEffect(() => {
    if (!outOfBoundsNotice) return;
    const id = window.setTimeout(() => setOutOfBoundsNotice(false), 2500);
    return () => window.clearTimeout(id);
  }, [outOfBoundsNotice]);

  /* Touch tap-once-preview, tap-again-commit (Option β).
   *
   * On mouse, hover already gives a no-commit preview, and a click
   * commits selection. On touch there's no hover, so we synthesise a
   * preview-then-commit gesture: the first tap on a dot opens the
   * tooltip without firing onEntitySelect; a second tap on the same
   * dot (within ~3 s) commits the selection. Tapping a different
   * dot replaces the preview. Tapping empty terrain / OOB clears it.
   *
   * `lastPointerTypeRef` is updated by onPointerDown; React's MouseEvent
   * doesn't expose pointerType directly, so we record it one beat earlier
   * and read it in the click handler. */
  const [previewCell, setPreviewCell] = useState<{
    gridLat: number;
    gridLong: number;
    occupant: string;
  } | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);

  const clearPreview = () => {
    setPreviewCell(null);
    if (previewTimeoutRef.current !== null) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
  };
  useEffect(
    () => () => {
      if (previewTimeoutRef.current !== null) clearTimeout(previewTimeoutRef.current);
    },
    [],
  );

  // Click handler — select occupied cell as entity, else as landing cell.
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = e.currentTarget.getBoundingClientRect();
    const { px, py } = clientToCanvasPx(e.clientX, e.clientY, wrap);
    const { ox, oy } = pxToGrid(px, py);
    const isTouch = lastPointerTypeRef.current === "touch";
    // Any click clears a stale notice (the user's second tap dismisses it).
    setOutOfBoundsNotice(false);

    // Inspection-band label hit — zoom into the cell and select it. The
    // pill is a visible affordance, so a click on the pill wins over the
    // grid cell beneath it (the user clicked the UI element, not the
    // terrain). Pills are positioned past the source cell's edge, so the
    // source cell itself is never the cell beneath a pill — only the
    // RIGHT-side neighbours are covered, and those covered cells become
    // unreachable for travel picks at high zoom. That's a worthwhile
    // tradeoff to keep labels clickable.
    if (inspectionLabelHitsRef.current.length > 0) {
      const labelHit = inspectionLabelHitsRef.current.find(
        (h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h,
      );
      if (labelHit) {
        clearPreview();
        focusCell(labelHit.cell.gridLat, labelHit.cell.gridLong);
        onEntitySelect?.({
          pubkey: labelHit.cell.occupant,
          occupantType: labelHit.cell.occupantType,
          gridLat: labelHit.cell.gridLat,
          gridLong: labelHit.cell.gridLong,
        });
        return;
      }
    }
    // Outside the city's square plot — surface the notice and bail.
    // Don't clear the entity selection: the user likely just missed the
    // plot, and yanking the selected encounter away would be hostile.
    if (Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH) {
      setOutOfBoundsNotice(true);
      clearPreview();
      return;
    }
    const gridLat = cityLatGrid + oy;
    const gridLong = cityLongGrid + ox;
    const hit = pickOccupantAt(occupied, gridLat, gridLong);
    if (hit) {
      if (isTouch) {
        // Two-tap commit: second tap on the SAME dot commits.
        const samePreview =
          previewCell != null &&
          previewCell.gridLat === hit.gridLat &&
          previewCell.gridLong === hit.gridLong &&
          previewCell.occupant === hit.occupant;
        if (samePreview) {
          onEntitySelect?.({
            pubkey: hit.occupant,
            occupantType: hit.occupantType,
            gridLat: hit.gridLat,
            gridLong: hit.gridLong,
          });
          clearPreview();
          return;
        }
        // First tap on this dot (or switching from another preview) —
        // surface the tooltip and arm an auto-clear so a stale preview
        // doesn't linger if the user wanders off.
        setPreviewCell({
          gridLat: hit.gridLat,
          gridLong: hit.gridLong,
          occupant: hit.occupant,
        });
        if (previewTimeoutRef.current !== null) clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = setTimeout(() => {
          setPreviewCell(null);
          previewTimeoutRef.current = null;
        }, 3000);
        return;
      }
      // Mouse / pen — commit on the first click (existing behaviour).
      onEntitySelect?.({
        pubkey: hit.occupant,
        occupantType: hit.occupantType,
        gridLat: hit.gridLat,
        gridLong: hit.gridLong,
      });
      return;
    }
    // Empty cell — treat as landing-cell pick if a destination flow is wired,
    // AND clear any selected entity so the EntityPanel doesn't linger on a
    // stale selection. (Earlier behaviour preserved the selection to support
    // "pick adjacent cell → approach selected encounter", but users found
    // that surprising — clicking off the entity should deselect it. The
    // Approach button on the EntityPanel still drives that flow explicitly.)
    clearPreview();
    onEntitySelect?.(null);
    if (!onSelect) return;
    if (!isPassableBiome(biomeAt(biomeSeed, ox, oy, biomeKnobs))) return;
    onSelect(gridLat, gridLong);
  };

  // ── Hover info ──────────────────────────────────────────────────────────
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const { ox, oy } = pxToGrid(hover.px, hover.py);
    if (Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH) return null;
    const biome: BiomeType = biomeAt(biomeSeed, ox, oy, biomeKnobs);
    // Biome name capitalised for the readout — matches the project's
    // existing "Water/Land/Shore/Hill/Peak" label vocabulary in shape
    // (single proper-noun word).
    const name = biomeName(biome);
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const passable = isPassableBiome(biome);
    const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
    return { label, distM, passable };
    /* pxToGrid depends on view + size; declared deps are explicit. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, biomeSeed, biomeKnobs, plotHalfW, plotHalfH, size.w, size.h, view.scale, view.panOx, view.panOy]);

  const selectedDistM = useMemo(() => {
    if (!selected) return 0;
    const ox = selected.gridLong - cityLongGrid;
    const oy = selected.gridLat - cityLatGrid;
    return Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
  }, [selected, cityLatGrid, cityLongGrid]);

  /* Dot tooltip — when the cursor sits over an occupant cell (mouse)
   * OR when a touch user has tapped a dot once (touch preview), look
   * up its rich label via the parent's resolver and surface a small
   * bubble next to the dot. Works at every zoom (independent of the
   * cells-visible / inspection-band gating used for the later batch-
   * label pass). Suppressed when the parent doesn't wire
   * `getDotTooltip`.
   *
   * Resolution priority: a standing touch `previewCell` wins over the
   * mouse `hover` (in practice a device is either touch or mouse, but
   * a hybrid laptop is plausible — the more deliberate "tap" gesture
   * should dominate a stray cursor). */
  const activeOccupant = useMemo(() => {
    if (previewCell) {
      return (
        occupied.find(
          (c) =>
            c.gridLat === previewCell.gridLat &&
            c.gridLong === previewCell.gridLong &&
            c.occupant === previewCell.occupant,
        ) ?? null
      );
    }
    if (!hover) return null;
    const { ox, oy } = pxToGrid(hover.px, hover.py);
    if (Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH) return null;
    const gridLat = cityLatGrid + oy;
    const gridLong = cityLongGrid + ox;
    return pickOccupantAt(occupied, gridLat, gridLong);
    // pxToGrid depends on view + size; declared deps cover those transitively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewCell,
    hover,
    occupied,
    cityLatGrid,
    cityLongGrid,
    radiusGridUnits,
    size.w,
    size.h,
    view.scale,
    view.panOx,
    view.panOy,
  ]);

  const activeTooltip = useMemo(() => {
    if (!activeOccupant || !getDotTooltip) return null;
    return getDotTooltip(activeOccupant.occupant, activeOccupant.occupantType);
  }, [activeOccupant, getDotTooltip]);

  /* CSS-pixel position of the active cell — derived the same way as
   * `gridToDevPx` but in logical pixels (so the DOM overlay positions
   * correctly regardless of DPR). */
  const activeCss = useMemo(() => {
    if (!activeOccupant) return null;
    const cssPxPerGridUnit = 1 / gridPerLogicalPx;
    const ox = activeOccupant.gridLong - cityLongGrid;
    const oy = activeOccupant.gridLat - cityLatGrid;
    const left = size.w / 2 + (ox - view.panOx) * cssPxPerGridUnit;
    const top = size.h / 2 - (oy - view.panOy) * cssPxPerGridUnit;
    return { left, top };
  }, [
    activeOccupant,
    gridPerLogicalPx,
    cityLatGrid,
    cityLongGrid,
    size.w,
    size.h,
    view.panOx,
    view.panOy,
  ]);

  // Scale legend — cartographic "nice round number" scale bar derived from
  // the current view. Picks the round-meter value that fills ~80 CSS px,
  // so the bar feels stable as the user zooms (it snaps between values
  // rather than continuously shrinking/growing).
  const scaleLegend = (() => {
    const metersPerCssPx = METERS_PER_GRID_UNIT * gridPerLogicalPx;
    const niceValues = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    const targetCssWidth = 80;
    const targetMeters = metersPerCssPx * targetCssWidth;
    const niceMeters =
      niceValues.find((v) => v >= targetMeters * 0.7) ?? niceValues[niceValues.length - 1]!;
    const barCss = niceMeters / metersPerCssPx;
    const label = niceMeters >= 1000 ? `${niceMeters / 1000} km` : `${niceMeters} m`;
    return { barCss, label };
  })();

  return (
    <div className={styles.root}>
      <div
        ref={wrapRef}
        role="application"
        tabIndex={0}
        aria-label={`Terrain disc for ${cityAccount.name}. Click an occupant to inspect them, or pick an empty cell to land. Scroll or pinch to zoom, drag to pan, double-click to zoom in.`}
        className={styles.canvasWrap}
        onClick={handleClick}
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          // Record so handleClick (one beat later, on the synthesised
          // click) can branch between mouse-commit and touch-preview-
          // then-commit. Mouse hover and touch preview both clear stale
          // OOB notices; the click handler resets them anyway.
          lastPointerTypeRef.current = e.pointerType;
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return;
          const r = e.currentTarget.getBoundingClientRect();
          const { px, py } = clientToCanvasPx(e.clientX, e.clientY, r);
          setHover({ px, py });
        }}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        <div className={styles.canvasInner}>
          <canvas ref={terrainCanvasRef} className={styles.canvas} aria-hidden />
          <canvas
            ref={overlayCanvasRef}
            className={`${styles.canvas} ${styles.overlay}`}
            aria-hidden
          />
        </div>
        {view.scale > MIN_VIEW_SCALE * 1.001 && (
          <button
            type="button"
            className={styles.resetBtn}
            onClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            ↻
          </button>
        )}
        {outOfBoundsNotice && (
          <div className={styles.outOfBoundsNotice} role="status" aria-live="polite">
            Out of city bounds
          </div>
        )}
        <div className={styles.scaleLegend} aria-hidden="true">
          <div className={styles.scaleLegendBar} style={{ width: `${scaleLegend.barCss}px` }} />
          <div className={styles.scaleLegendLabel}>{scaleLegend.label}</div>
        </div>
        {activeTooltip && activeCss && (() => {
          // Resolve catalog entries once for the active tooltip so the
          // composed render reads as a small EntityPanel preview: badge
          // wrapped in the frame on the left, animated-color name on
          // top right, title chip below. Frame + badge both render
          // null when not equipped, so the layout collapses cleanly
          // for players without paid cosmetics.
          const t = activeTooltip;
          const colorEntry = t.nameColorHex
            ? getCosmeticColor(/* id only used by lookup, we already have hex */ 0) ?? null
            : null;
          // We don't have a way to resolve back from hex; the DotTooltip
          // already carries hex+anim directly, so use them. The catalog
          // helper above is only useful for badge/title/frame ids.
          void colorEntry;
          const titleEntry = t.titleId ? getCosmeticTitle(t.titleId) : null;
          const hasFrame = (t.frameId ?? 0) > 0;
          const hasBadge = (t.badgeId ?? 0) > 0;
          const showLeftCol = hasFrame || hasBadge;
          // Build the CSS animation class from the raw key. The catalog
          // helper expects an entry; we synthesize a minimal stand-in.
          const animClass = t.nameColorAnim
            ? cosmeticColorAnimationClass({
                id: 0,
                name: "",
                rarity: "common",
                hex: t.nameColorHex ?? "#000",
                animation: t.nameColorAnim,
              })
            : null;
          return (
            <div
              className={styles.dotTooltip}
              style={{
                left: `${activeCss.left}px`,
                top: `${activeCss.top}px`,
                borderColor: t.accent ?? undefined,
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
              }}
              role="tooltip"
              aria-hidden="true"
            >
              {showLeftCol && (
                <CosmeticFrame id={t.frameId ?? 0} size={36}>
                  {hasBadge ? (
                    <CosmeticBadge id={t.badgeId ?? 0} size={32} />
                  ) : (
                    <span
                      aria-hidden
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "var(--readout-tint, #efe2c4)",
                      }}
                    />
                  )}
                </CosmeticFrame>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  className={`${styles.dotTooltipPrimary} ${animClass ?? ""}`}
                  style={t.nameColorHex ? { color: t.nameColorHex } : undefined}
                >
                  {t.primary}
                </div>
                <div className={styles.dotTooltipSecondary}>{t.secondary}</div>
                {titleEntry && (
                  <div
                    style={{
                      marginTop: "0.25rem",
                      display: "inline-block",
                      fontSize: "0.55rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      padding: "0.1rem 0.35rem",
                      border: `1px solid ${RARITY_BORDER[titleEntry.rarity]}`,
                      color: RARITY_BORDER[titleEntry.rarity],
                      background: "var(--readout-tint)",
                    }}
                  >
                    {titleEntry.displayName}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      <div className={styles.readout} aria-live="polite">
        {hoverInfo ? (
          <>
            <span className={hoverInfo.passable ? "" : styles.impassable}>{hoverInfo.label}</span>
            <span>·</span>
            <span>{hoverInfo.distM.toLocaleString()}m from centre</span>
            {!hoverInfo.passable && <span>· impassable</span>}
          </>
        ) : selected ? (
          <>
            <span>Landing chosen</span>
            <span>·</span>
            <span>{selectedDistM.toLocaleString()}m from centre</span>
          </>
        ) : (
          <span>click a player or wild to inspect, or pick an empty cell to land.</span>
        )}
      </div>
    </div>
  );
  },
);
