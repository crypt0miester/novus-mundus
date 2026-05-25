"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  cityTerrain,
  radiusToGridUnits,
  toGrid,
  isPassable,
  sampleTerrain,
  terrainElevation,
  terrainMoisture,
  elevationToColor,
  OCCUPANT_PLAYER,
  OCCUPANT_ENCOUNTER,
  type CityAccount,
  type CityTerrain,
} from "novus-mundus-sdk";
import { useCityOccupied } from "@/lib/hooks/useCityOccupied";
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
const MIN_VIEW_SCALE = 1;
const MAX_VIEW_SCALE = 200;
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

export interface CityTerrainEntity {
  pubkey: string; // base58 pubkey of the LocationAccount's occupant
  occupantType: number; // OCCUPANT_PLAYER | OCCUPANT_ENCOUNTER
  gridLat: number;
  gridLong: number;
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
}

interface Props {
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
   * Auto-focus on first mount of the city — the disc animates to centre on
   * this cell at MAX_VIEW_SCALE (200×) so the grid-line overlay and tile-
   * rendered occupants are visible immediately ("you are here" in the most
   * legible mode the disc offers). Fires ONCE per cityId change; subsequent
   * pans/zooms by the user aren't disturbed. Parent passes null (or omits)
   * when the drill-in is a destination / scouting view rather than the
   * player's home city.
   */
  autoFocusCell?: { gridLat: number; gridLong: number } | null;
}

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
 * units, but the renderer paints the whole square so the canvas reads as a
 * rectangular map page rather than a circular medallion. Pixels INSIDE the
 * disc are opaque; pixels in a thin band PAST the edge fade linearly to fully
 * transparent so the inked terrain feathers into the surrounding parchment;
 * pixels well outside that band are skipped (alpha 0, parchment shows through).
 */
function renderTerrainViewport(
  terrain: CityTerrain,
  sizeDevW: number,
  sizeDevH: number,
  panOx: number,
  panOy: number,
  viewportRadius: number,
  cityRadius: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(sizeDevW * sizeDevH * 4);
  const centerX = sizeDevW / 2;
  const centerY = sizeDevH / 2;
  /* Isotropic scale anchored to the shorter dim — disc stays round, longer
   * dim shows extra terrain past the disc boundary (feathered to parchment). */
  const minCenter = Math.min(centerX, centerY);
  const gridPerPx = viewportRadius / minCenter;
  const r2 = cityRadius * cityRadius;
  /* Width (in grid units) of the soft alpha ramp past the disc edge. Tuned
   * by eye: too narrow and the boundary looks like a hard circle again; too
   * wide and the playable area becomes ambiguous. ~8% of radius reads as an
   * inked, feathered shoreline. */
  const fadeBand = Math.max(1, cityRadius * 0.08);
  const outerR = cityRadius + fadeBand;
  const outerR2 = outerR * outerR;

  for (let py = 0; py < sizeDevH; py++) {
    for (let px = 0; px < sizeDevW; px++) {
      const dpx = px - centerX;
      const dpy = py - centerY;
      /* Flip y so +oy is north. */
      const ox = Math.round(dpx * gridPerPx + panOx);
      const oy = Math.round(-dpy * gridPerPx + panOy);
      const i = (py * sizeDevW + px) * 4;

      const dist2 = ox * ox + oy * oy;
      /* Well past the feather band → leave fully transparent and skip the
       * (cheap-but-not-free) terrain sampling. */
      if (dist2 > outerR2) {
        pixels[i + 3] = 0;
        continue;
      }
      const elev = terrainElevation(terrain, ox, oy);
      const moist = terrainMoisture(terrain, ox, oy);
      const [r, g, b] = elevationToColor(elev, terrain.waterLine, terrain.peakLine, moist);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      if (dist2 <= r2) {
        pixels[i + 3] = 255;
      } else {
        const dist = Math.sqrt(dist2);
        pixels[i + 3] = Math.round(255 * (1 - (dist - cityRadius) / fadeBand));
      }
    }
  }
  return pixels;
}

export function CityTerrainMap({
  cityAccount,
  selected,
  onSelect,
  selectedEntity,
  onEntitySelect,
  travel,
  otherWalks,
  myPlayerPubkey,
  autoFocusCell,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const cityLatGrid = toGrid(cityAccount.latitude);
  const cityLongGrid = toGrid(cityAccount.longitude);
  const radiusGridUnits = useMemo(
    () => radiusToGridUnits(cityAccount.radiusKm, cityAccount.latitude),
    [cityAccount.radiusKm, cityAccount.latitude],
  );
  const terrain = useMemo(() => cityTerrain(cityAccount), [cityAccount]);

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
  // city centre. scale: zoom factor (1 = full disc, higher = closer).
  const [view, setView] = useState({ scale: 1, panOx: 0, panOy: 0 });
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

  // Clamp the viewport CENTRE so the whole visible circle is covered by the
  // city's disc — sqrt(panOx² + panOy²) + viewportRadius ≤ cityRadius.
  const clampPan = (
    panOx: number,
    panOy: number,
    scale: number,
  ): { panOx: number; panOy: number } => {
    if (scale <= 1.001) return { panOx: 0, panOy: 0 };
    const max = radiusGridUnits - radiusGridUnits / scale;
    const len = Math.hypot(panOx, panOy);
    if (len <= max) return { panOx, panOy };
    const f = max / len;
    return { panOx: panOx * f, panOy: panOy * f };
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

  const resetView = () => animateView({ scale: 1, panOx: 0, panOy: 0 });

  /* Soft auto-focus on the player's cell when this is their home city.
   * Fires once per cityId (tracked via ref) — subsequent renders, pans, or
   * zooms by the user are not disturbed. Targets MAX_VIEW_SCALE so the
   * grid-line overlay + tile-rendered occupants are visible on landing —
   * "you are here" in the most legible mode the disc offers. The cubic
   * ease-out + slightly longer duration (520 ms vs the wheel/click default
   * of 220 ms) keeps the 1×→200× zoom from feeling violent. Pan is
   * clamp-respected so an edge-of-disc player stays in-frame. */
  const autoFocusedForCityRef = useRef<number | null>(null);
  useEffect(() => {
    if (!autoFocusCell) return;
    if (autoFocusedForCityRef.current === cityAccount.cityId) return;
    autoFocusedForCityRef.current = cityAccount.cityId;
    const ox = autoFocusCell.gridLong - cityLongGrid;
    const oy = autoFocusCell.gridLat - cityLatGrid;
    const target = clampPan(ox, oy, MAX_VIEW_SCALE);
    animateView(
      { scale: MAX_VIEW_SCALE, panOx: target.panOx, panOy: target.panOy },
      520,
    );
    return () => {
      autoFocusedForCityRef.current = null;
    };
    /* clampPan/animateView are stable closures; only the city + focus
     * coords matter as triggers. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoFocusCell?.gridLat,
    autoFocusCell?.gridLong,
    cityAccount.cityId,
    cityLatGrid,
    cityLongGrid,
  ]);

  // Terrain layer — re-renders on view change.
  useEffect(() => {
    const canvas = terrainCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const sizeDevW = Math.round(size.w * dpr);
    const sizeDevH = Math.round(size.h * dpr);
    canvas.width = sizeDevW;
    canvas.height = sizeDevH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pixels = renderTerrainViewport(
      terrain,
      sizeDevW,
      sizeDevH,
      view.panOx,
      view.panOy,
      viewportRadius,
      radiusGridUnits,
    );
    const img = ctx.createImageData(sizeDevW, sizeDevH);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
  }, [terrain, radiusGridUnits, size.w, size.h, view.scale, view.panOx, view.panOy, viewportRadius]);

  /* Occupancy: zustand-backed (lib/store/subscriptions.ts streams every
   * LocationAccount over WS). Hook seeds the store on cityId change. */
  const {
    data: occupied,
    isLoading: occupancyLoading,
    error: occupancyError,
  } = useCityOccupied(cityAccount.cityId);

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

    /* Outer disc ring — drawn as a faint dashed line so the boundary reads
     * as an inked shoreline on a map page, not a precise mathematical circle.
     * The terrain alpha already feathers across the edge in the terrain layer;
     * this ring just gives the player a precise "where the chain says no" cue
     * without screaming geometry. Only visible when the edge is in view. */
    const cityCenterPx = gridToDevPx(0, 0, dpr);
    const cityRadiusDevPx = (radiusGridUnits / viewportRadius) * (sizeDevMin / 2);
    // Defensive: during a fast view tween or a transient bad state the
    // radius can compute as NaN or briefly negative. canvas.arc() rejects
    // either with IndexSizeError and breaks the whole frame, so we skip
    // the ring instead — terrain layer alpha already feathers the disc
    // edge, the dashed ring is just precision chrome.
    if (Number.isFinite(cityRadiusDevPx) && cityRadiusDevPx > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(46, 31, 16, 0.35)";
      ctx.lineWidth = 0.75 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.arc(cityCenterPx.px, cityCenterPx.py, cityRadiusDevPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

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
      for (const w of otherWalks) {
        const oxF = w.fromGridLong - cityLongGrid;
        const oyF = w.fromGridLat - cityLatGrid;
        const oxT = w.toGridLong - cityLongGrid;
        const oyT = w.toGridLat - cityLatGrid;
        const fp = gridToDevPx(oxF, oyF, dpr);
        const tp = gridToDevPx(oxT, oyT, dpr);

        ctx.save();
        ctx.strokeStyle = "rgba(180, 83, 9, 0.4)";
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
        ctx.fillStyle = "rgba(180, 83, 9, 0.85)";
        ctx.strokeStyle = "rgba(255, 250, 235, 0.7)";
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

      ctx.save();
      ctx.strokeStyle = "rgba(180, 83, 9, 0.85)";
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
      ctx.fillStyle = "rgba(180, 83, 9, 0.25)";
      ctx.beginPath();
      ctx.arc(mx, my, 9 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(180, 83, 9, 1)";
      ctx.strokeStyle = "rgba(255, 250, 235, 0.95)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(mx, my, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    /* Centre marker — antique cartographer's town glyph: an 8-rayed star
     * (4 cardinal + 4 diagonal rays) around a small inked nucleus with a
     * cream halo. Replaces the previous solid black dot, which read as a
     * modern UI pin against the parchment. */
    {
      const c = gridToDevPx(0, 0, dpr);
      const r = Math.max(6 * dpr, Math.min(pxPerCell * 0.55, 14 * dpr));
      ctx.save();
      ctx.translate(c.px, c.py);
      /* Star rays — cardinal arms first (longer), then diagonal (shorter). */
      ctx.strokeStyle = "rgba(70, 50, 28, 0.85)";
      ctx.lineWidth = Math.max(1, 1.25 * dpr);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      const d = r * 0.65;
      ctx.moveTo(-d, -d);
      ctx.lineTo(d, d);
      ctx.moveTo(-d, d);
      ctx.lineTo(d, -d);
      ctx.stroke();
      /* Inked nucleus with cream halo — the "seat" of the city. */
      const nucleusR = Math.max(2 * dpr, r * 0.3);
      ctx.fillStyle = "rgba(252, 244, 220, 0.95)";
      ctx.beginPath();
      ctx.arc(0, 0, nucleusR + 1.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(70, 50, 28, 0.95)";
      ctx.beginPath();
      ctx.arc(0, 0, nucleusR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* Occupancy — muted antique-palette glyphs, shape-distinguished:
     *   Player  → filled circle, tobacco amber
     *   Wild    → filled diamond, dark oxblood
     * Shape (not just hue) is the primary distinguisher so they read clearly
     * even at the smallest dot size and on a monochrome paper background.
     * At tile-mode zoom each cell still fills solid so the cell footprint is
     * obvious — the shape only takes over in dot mode. */
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;
    const PLAYER_FILL = "rgba(160, 100, 45, 1)";
    /* Local player gets a deep-ink fill so the viewer can pick themselves
     * out at a glance against the warm-amber other-players. Stays in the
     * antique palette but reads near-black against the parchment. */
    const MY_PLAYER_FILL = "rgba(20, 14, 8, 1)";
    const WILD_FILL = "rgba(115, 55, 30, 1)";
    const SELECTED_STROKE = "rgba(220, 175, 60, 1)";
    const CREAM_STROKE = "rgba(252, 244, 220, 0.95)";
    for (const cell of occupied) {
      const ox = cell.gridLong - cityLongGrid;
      const oy = cell.gridLat - cityLatGrid;
      const { px, py } = gridToDevPx(ox, oy, dpr);
      if (px < -20 || px > sizeDevW + 20 || py < -20 || py > sizeDevH + 20) continue;
      const isPlayer = cell.occupantType === OCCUPANT_PLAYER;
      const isEncounter = cell.occupantType === OCCUPANT_ENCOUNTER;
      if (!isPlayer && !isEncounter) continue;
      const isSelectedEntity =
        selectedEntity != null &&
        selectedEntity.gridLat === cell.gridLat &&
        selectedEntity.gridLong === cell.gridLong;
      const isMyPlayer =
        isPlayer && myPlayerPubkey != null && cell.occupant === myPlayerPubkey;

      const fill = isMyPlayer ? MY_PLAYER_FILL : isPlayer ? PLAYER_FILL : WILD_FILL;
      const stroke = isSelectedEntity ? SELECTED_STROKE : CREAM_STROKE;

      if (renderAsTiles) {
        /* Snap rectangle to integer device pixels — otherwise adjacent tiles
         * can show sub-pixel gaps or 2-px-wide seams that look like grid
         * misalignment, especially on mobile DPR. */
        const half = pxPerCell / 2;
        const x0 = Math.round(px - half);
        const y0 = Math.round(py - half);
        const w = Math.round(px + half) - x0;
        const h = Math.round(py + half) - y0;
        ctx.fillStyle = fill;
        ctx.fillRect(x0, y0, w, h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = (isSelectedEntity ? 2 : 1) * dpr;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      } else {
        const r = (isSelectedEntity ? 6 : 5) * dpr;
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = (isSelectedEntity ? 2 : 1.5) * dpr;
        if (isPlayer) {
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
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
      ctx.beginPath();
      ctx.moveTo(px - 4 * dpr, py);
      ctx.lineTo(px + 4 * dpr, py);
      ctx.moveTo(px, py - 4 * dpr);
      ctx.lineTo(px, py + 4 * dpr);
      ctx.stroke();
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

  // Click handler — select occupied cell as entity, else as landing cell.
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = e.currentTarget.getBoundingClientRect();
    const { px, py } = clientToCanvasPx(e.clientX, e.clientY, wrap);
    const { ox, oy } = pxToGrid(px, py);
    // Outside the disc → clear entity selection (acts as "deselect").
    if (ox * ox + oy * oy > radiusGridUnits * radiusGridUnits) {
      onEntitySelect?.(null);
      return;
    }
    const gridLat = cityLatGrid + oy;
    const gridLong = cityLongGrid + ox;
    // Hit an occupied cell first — promote to entity selection regardless of
    // whether onSelect is wired.
    const hit = occupied.find((c) => c.gridLat === gridLat && c.gridLong === gridLong);
    if (hit) {
      onEntitySelect?.({
        pubkey: hit.occupant,
        occupantType: hit.occupantType,
        gridLat: hit.gridLat,
        gridLong: hit.gridLong,
      });
      return;
    }
    // Empty cell — treat as landing-cell pick if a destination flow is wired.
    onEntitySelect?.(null);
    if (!onSelect) return;
    if (!isPassable(terrain, ox, oy)) return;
    onSelect(gridLat, gridLong);
  };

  // ── Hover info ──────────────────────────────────────────────────────────
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const { ox, oy } = pxToGrid(hover.px, hover.py);
    if (ox * ox + oy * oy > radiusGridUnits * radiusGridUnits) return null;
    const s = sampleTerrain(terrain, ox, oy);
    /* Land labels are bucketed by elevation fraction `t` so they line up
     * with the palette's own bands:
     *   t < 0.1   → Shore (matches the warm-sand beach band in the renderer)
     *   t < 0.5   → Land  (lowland tans / muted olive)
     *   t < 1.0   → Hill  (the darker highland band — visually clearly
     *                      elevated, this is what players see as "rises")
     *   e ≥ peak  → Peak  (snow-capped summits)
     * Before this, Hill kicked in at t > 0.7 — the upper half of the
     * highland band — so most of the visually-elevated terrain was
     * mis-labelled as plain Land. */
    let label = "Land";
    if (s.isWater) {
      label = "Water";
    } else if (s.isMountain) {
      label = "Peak";
    } else {
      const range = Math.max(1, terrain.peakLine - terrain.waterLine);
      const t = (s.elevation - terrain.waterLine) / range;
      if (t < 0.1) label = "Shore";
      else if (t >= 0.5) label = "Hill";
    }
    const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
    return { label, distM, passable: s.isPassable };
    /* pxToGrid depends on view + size; declared deps are explicit. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, terrain, radiusGridUnits, size.w, size.h, view.scale, view.panOx, view.panOy]);

  const selectedDistM = useMemo(() => {
    if (!selected) return 0;
    const ox = selected.gridLong - cityLongGrid;
    const oy = selected.gridLat - cityLatGrid;
    return Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
  }, [selected, cityLatGrid, cityLongGrid]);

  const playerCount = occupied.filter((c) => c.occupantType === OCCUPANT_PLAYER).length;
  const encounterCount = occupied.filter((c) => c.occupantType === OCCUPANT_ENCOUNTER).length;
  const terrainEmpty = cityAccount.anchorCount === 0;
  const cellsVisible = 1 / gridPerLogicalPx >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;

  return (
    <div className={styles.root}>
      <div className={styles.label}>
        <span>The land · {cityAccount.name}</span>
        {occupancyLoading && <span className={styles.scouting}> · scouting…</span>}
        {!occupancyLoading && !occupancyError && (
          <span className={styles.scouting}>
            {" · "}
            {playerCount} {playerCount === 1 ? "player" : "players"} · {encounterCount} wild
          </span>
        )}
        {occupancyError && (
          <span className={styles.scouting} title={occupancyError}>
            {" · scouting blocked"}
          </span>
        )}
        {terrainEmpty && (
          <span
            className={styles.scouting}
            title="Terrain anchors are not yet set on this city (set_terrain not run)."
          >
            {" · terrain unset"}
          </span>
        )}
        <span className={styles.scouting}>
          {" · "}
          {view.scale < 1.05 ? "1×" : `${view.scale.toFixed(1)}×`}
          {cellsVisible ? " · cells visible" : ""}
        </span>
      </div>
      <div
        ref={wrapRef}
        role="application"
        tabIndex={0}
        aria-label={`Terrain disc for ${cityAccount.name}. Click an occupant to inspect them, or pick an empty cell to land. Scroll or pinch to zoom, drag to pan, double-click to zoom in.`}
        className={styles.canvasWrap}
        onClick={handleClick}
        style={{ touchAction: "none" }}
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
        {view.scale > 1.001 && (
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
      <div className={styles.legend}>
        <span>
          <span className={`${styles.swatch} ${styles.swCtr}`} /> centre
        </span>
        {myPlayerPubkey && (
          <span>
            <span className={`${styles.swatch} ${styles.swMe}`} /> you
          </span>
        )}
        <span>
          <span className={`${styles.swatch} ${styles.swPlayer}`} /> player
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.swEnc}`} /> wild
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.swSel}`} /> chosen
        </span>
      </div>
    </div>
  );
}
