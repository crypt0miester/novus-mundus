"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import bs58 from "bs58";
import {
  LOCATION_ACCOUNT_SIZE,
  PROGRAM_ID as NOVUS_PROGRAM_ID,
  cityTerrain,
  radiusToGridUnits,
  toGrid,
  isPassable,
  sampleTerrain,
  terrainElevation,
  terrainMoisture,
  elevationToColor,
  parseLocation,
  OCCUPANT_PLAYER,
  OCCUPANT_ENCOUNTER,
  type CityAccount,
  type CityTerrain,
  AccountKey,
} from "novus-mundus-sdk";
import { useNovusMundusClient } from "@/lib/solana/provider";
import styles from "./CityTerrainMap.module.css";

// LocationAccount memcmp offsets — mirrors deserializeLocation in
// sdks/novus-mundus-ts/src/state/location.ts. Don't shift these without
// updating that layout in lockstep.
const LOC_OFFSET_GAME_ENGINE = 1;
const LOC_OFFSET_CITY_ID = 44;

// 0.0001° ≈ 11 m at the equator — used for the "X m from centre" readouts.
const METERS_PER_GRID_UNIT = 11;

// Lower bound for the canvas's logical pixel size.
const MIN_LOGICAL_SIZE = 320;
const REFRESH_INTERVAL_MS = 8000;

// Zoom bounds. With viewport-based rendering each zoom level re-renders the
// terrain crisply, so we can push the max much higher than CSS-scale would
// allow. At 200× a single 11 m grid cell is ~7 CSS px — easily visible as a
// discrete tile, which is what the proximity-grid overlay needs.
const MIN_VIEW_SCALE = 1;
const MAX_VIEW_SCALE = 200;
const PAN_THRESHOLD_PX = 4;

// At this many CSS pixels per grid cell, the proximity grid overlay (faint
// graph-paper lines + tile-rendered occupants) turns on. Anything tighter
// looks like moiré — especially on Retina where a 1-device-px line is only
// 0.5 CSS px. Threshold is in CSS px so it stays visually consistent across
// DPRs.
const GRID_OVERLAY_MIN_CSS_PX_PER_CELL = 8;

interface OccupiedCell {
  gridLat: number;
  gridLong: number;
  occupantType: number;
  occupant: string; // base58 pubkey of the player/encounter PDA
}

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
 * The pan clamp keeps the viewport centre inside a disc of radius
 * `radiusGridUnits × (1 − 1/scale)` so the visible circle is always covered
 * by valid terrain (no parchment bleeding through the canvas's transparent
 * outside-disc region).
 */
function renderTerrainViewport(
  terrain: CityTerrain,
  sizeDev: number,
  panOx: number,
  panOy: number,
  viewportRadius: number,
  cityRadius: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(sizeDev * sizeDev * 4);
  const center = sizeDev / 2;
  const gridPerPx = viewportRadius / center;
  const r2 = cityRadius * cityRadius;

  for (let py = 0; py < sizeDev; py++) {
    for (let px = 0; px < sizeDev; px++) {
      const dpx = px - center;
      const dpy = py - center;
      // Flip y so +oy is north.
      const ox = Math.round(dpx * gridPerPx + panOx);
      const oy = Math.round(-dpy * gridPerPx + panOy);
      const i = (py * sizeDev + px) * 4;

      // Outside the city's playable disc → transparent.
      if (ox * ox + oy * oy > r2) {
        pixels[i + 3] = 0;
        continue;
      }
      const elev = terrainElevation(terrain, ox, oy);
      const moist = terrainMoisture(terrain, ox, oy);
      const [r, g, b] = elevationToColor(elev, terrain.waterLine, terrain.peakLine, moist);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
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
}: Props) {
  const client = useNovusMundusClient();
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

  // ── Canvas size tracking ────────────────────────────────────────────────
  const [logicalSize, setLogicalSize] = useState(MIN_LOGICAL_SIZE);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.max(MIN_LOGICAL_SIZE, Math.round(Math.min(rect.width, rect.height)));
      setLogicalSize((prev) => (Math.abs(prev - next) > 4 ? next : prev));
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

  // ── View state (grid-unit viewport) ─────────────────────────────────────
  // panOx, panOy: grid offset of the canvas centre from city centre.
  // scale: zoom factor (1 = full disc, higher = closer).
  const [view, setView] = useState({ scale: 1, panOx: 0, panOy: 0 });
  // (Drag previously used a CSS-translate preview; that left the canvas's
  // transparent corners exposed at the wrap edge. We now re-render the
  // viewport on every drag move (rAF-batched), so no CSS preview is needed.)

  const viewportRadius = radiusGridUnits / view.scale;
  // Grid units per CSS pixel at the current view (smaller = more zoomed in).
  const gridPerLogicalPx = (viewportRadius * 2) / logicalSize;

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

  const resetView = () => setView({ scale: 1, panOx: 0, panOy: 0 });

  // ── Terrain layer (re-renders on view change) ───────────────────────────
  useEffect(() => {
    const canvas = terrainCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const sizeDev = Math.round(logicalSize * dpr);
    canvas.width = sizeDev;
    canvas.height = sizeDev;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pixels = renderTerrainViewport(
      terrain,
      sizeDev,
      view.panOx,
      view.panOy,
      viewportRadius,
      radiusGridUnits,
    );
    const img = ctx.createImageData(sizeDev, sizeDev);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
  }, [terrain, radiusGridUnits, logicalSize, view.scale, view.panOx, view.panOy, viewportRadius]);

  // ── Occupancy fetch ─────────────────────────────────────────────────────
  const [occupied, setOccupied] = useState<OccupiedCell[]>([]);
  const [occupancyLoaded, setOccupancyLoaded] = useState(false);
  const [occupancyError, setOccupancyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const ge = client.gameEngine;
    const cityIdBytes = Buffer.alloc(2);
    cityIdBytes.writeUInt16LE(cityAccount.cityId, 0);
    const cityIdB58 = bs58.encode(cityIdBytes);

    setOccupancyLoaded(false);
    setOccupancyError(null);

    const fetchOccupied = async () => {
      try {
        const keyByte = bs58.encode(Buffer.from([AccountKey.Location]));
        const accounts = await client.connection.getProgramAccounts(NOVUS_PROGRAM_ID, {
          filters: [
            { dataSize: LOCATION_ACCOUNT_SIZE },
            { memcmp: { offset: 0, bytes: keyByte } },
            { memcmp: { offset: LOC_OFFSET_GAME_ENGINE, bytes: ge.toBase58() } },
            { memcmp: { offset: LOC_OFFSET_CITY_ID, bytes: cityIdB58 } },
          ],
        });
        if (cancelled) return;

        const cells: OccupiedCell[] = [];
        for (const { account } of accounts) {
          const loc = parseLocation(account);
          if (!loc || loc.occupantType === 0) continue;
          cells.push({
            gridLat: loc.gridLat,
            gridLong: loc.gridLong,
            occupantType: loc.occupantType,
            occupant: loc.occupant.toBase58(),
          });
        }
        setOccupied(cells);
        setOccupancyLoaded(true);
        setOccupancyError(null);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "fetch failed";
        setOccupancyError(msg);
        setOccupancyLoaded(true);
        // eslint-disable-next-line no-console
        console.warn("[CityTerrainMap] occupancy fetch failed:", e);
      }
    };

    const startInterval = () => {
      if (interval !== null) return;
      interval = setInterval(fetchOccupied, REFRESH_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchOccupied();
        startInterval();
      } else {
        stopInterval();
      }
    };

    fetchOccupied();
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      startInterval();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      cancelled = true;
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [cityAccount.cityId, client]);

  // ── Coordinate helpers ──────────────────────────────────────────────────

  // Canvas px (CSS, 0..logicalSize) → grid offset (relative to city centre).
  const pxToGrid = (px: number, py: number) => {
    const center = logicalSize / 2;
    const ox = Math.round((px - center) * gridPerLogicalPx + view.panOx);
    const oy = Math.round(-(py - center) * gridPerLogicalPx + view.panOy);
    return { ox, oy };
  };

  // Grid offset (relative to city centre) → device px on the canvas.
  const gridToDevPx = (ox: number, oy: number, dpr: number) => {
    const sizeDev = Math.round(logicalSize * dpr);
    const center = sizeDev / 2;
    const gridPerDevPx = (viewportRadius * 2) / sizeDev;
    return {
      px: (ox - view.panOx) / gridPerDevPx + center,
      py: -(oy - view.panOy) / gridPerDevPx + center,
    };
  };

  // Client coord → canvas px (CSS units). The canvas is always in sync with
  // `view` (no CSS preview), so this is a straight rect-to-canvas mapping.
  const clientToCanvasPx = (clientX: number, clientY: number, wrap: DOMRect) => {
    return {
      px: ((clientX - wrap.left) / wrap.width) * logicalSize,
      py: ((clientY - wrap.top) / wrap.height) * logicalSize,
    };
  };

  // ── Overlay layer ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const sizeDev = Math.round(logicalSize * dpr);
    canvas.width = sizeDev;
    canvas.height = sizeDev;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, sizeDev, sizeDev);

    // CSS px per grid cell drives the visibility threshold; device px drives
    // the actual draw position. Computing both up front:
    const cssPxPerCell = 1 / gridPerLogicalPx;
    const pxPerCell = cssPxPerCell * dpr; // device px per 1 grid cell
    const center = sizeDev / 2;

    // ── Outer disc ring (only visible when the city edge is within view). ─
    const cityCenterPx = gridToDevPx(0, 0, dpr);
    const cityRadiusDevPx = radiusGridUnits / ((viewportRadius * 2) / sizeDev);
    ctx.strokeStyle = "rgba(46, 31, 16, 0.55)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.arc(cityCenterPx.px, cityCenterPx.py, cityRadiusDevPx, 0, Math.PI * 2);
    ctx.stroke();

    // ── Proximity grid (graph paper) ──────────────────────────────────────
    // Lines drawn with `lineWidth = 1` device px and positions rounded to
    // half-device-pixel offsets — anything else gives a smeared/double look
    // on Retina-class displays (Mobile Safari is the worst offender).
    if (cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL) {
      // Stride keeps the line count bounded — render every N-th gridline so
      // the wash doesn't blacken at extreme zooms.
      const stride = Math.max(
        1,
        2 ** Math.max(0, Math.ceil(Math.log2(GRID_OVERLAY_MIN_CSS_PX_PER_CELL / cssPxPerCell))),
      );
      const halfGrid = viewportRadius;
      const minOx = Math.floor(view.panOx - halfGrid) - stride;
      const maxOx = Math.ceil(view.panOx + halfGrid) + stride;
      const minOy = Math.floor(view.panOy - halfGrid) - stride;
      const maxOy = Math.ceil(view.panOy + halfGrid) + stride;

      ctx.strokeStyle = "rgba(46, 31, 16, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const startOx = Math.ceil(minOx / stride) * stride;
      const startOy = Math.ceil(minOy / stride) * stride;
      for (let ox = startOx; ox <= maxOx; ox += stride) {
        // Round to a half-pixel offset for a crisp 1-device-px line.
        const x = Math.round(gridToDevPx(ox, 0, dpr).px) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, sizeDev);
      }
      for (let oy = startOy; oy <= maxOy; oy += stride) {
        const y = Math.round(gridToDevPx(0, oy, dpr).py) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(sizeDev, y);
      }
      ctx.stroke();
    }

    // ── Other players' walks (muted) ──────────────────────────────────────
    // Drawn first so the local player's bright walk layers on top. Same
    // seal-orange family but lower opacity, thinner stroke, no halo on the
    // marker — visually present but not competing with the local player's
    // own line. `pct` is interpolated upstream against chainNow.
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

    // ── In-flight walk line + marker (intracity travel) ───────────────────
    // Drawn ABOVE the proximity grid and city ring but BELOW the centre
    // marker and occupants so dots and tile fills stay legible on top.
    // Uses the same seal-orange palette as the realm-map intercity line.
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

    // ── Centre marker ─────────────────────────────────────────────────────
    {
      const c = gridToDevPx(0, 0, dpr);
      ctx.fillStyle = "rgba(46, 31, 16, 0.95)";
      ctx.strokeStyle = "rgba(255, 250, 235, 0.95)";
      ctx.lineWidth = 1.5 * dpr;
      const r = Math.max(5 * dpr, Math.min(pxPerCell * 0.6, 14 * dpr));
      ctx.beginPath();
      ctx.arc(c.px, c.py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // ── Occupancy ─────────────────────────────────────────────────────────
    // At low zoom: dots. At high zoom (one cell ≥ overlay threshold): filled
    // tiles so the cell footprint is obvious.
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;
    for (const cell of occupied) {
      const ox = cell.gridLong - cityLongGrid;
      const oy = cell.gridLat - cityLatGrid;
      const { px, py } = gridToDevPx(ox, oy, dpr);
      if (px < -20 || px > sizeDev + 20 || py < -20 || py > sizeDev + 20) continue;
      const isPlayer = cell.occupantType === OCCUPANT_PLAYER;
      const isEncounter = cell.occupantType === OCCUPANT_ENCOUNTER;
      if (!isPlayer && !isEncounter) continue;
      const isSelectedEntity =
        selectedEntity != null &&
        selectedEntity.gridLat === cell.gridLat &&
        selectedEntity.gridLong === cell.gridLong;

      const fill = isPlayer ? "rgba(180, 83, 9, 1)" : "rgba(160, 30, 30, 1)";
      const stroke = isSelectedEntity ? "rgba(255, 220, 80, 1)" : "rgba(255, 250, 235, 0.95)";

      if (renderAsTiles) {
        // Snap rectangle to integer device pixels — otherwise adjacent tiles
        // can show sub-pixel gaps or 2-px-wide seams that look like grid
        // misalignment, especially on mobile DPR.
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
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (isEncounter) {
          ctx.strokeStyle = "rgba(255, 220, 80, 0.9)";
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // ── Selected landing cell (intercity picker) ──────────────────────────
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
    logicalSize,
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
  ]);

  // ── Gestures ────────────────────────────────────────────────────────────
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragLastRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const pinchDistRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const wx = clientX - r.left;
    const wy = clientY - r.top;
    const dxFromCenter = (wx - r.width / 2) / r.width; // -0.5..0.5
    const dyFromCenter = (wy - r.height / 2) / r.height;
    setView((prev) => {
      const newScale = Math.max(MIN_VIEW_SCALE, Math.min(MAX_VIEW_SCALE, prev.scale * factor));
      const prevViewportRadius = radiusGridUnits / prev.scale;
      const cursorOx = prev.panOx + dxFromCenter * prevViewportRadius * 2;
      const cursorOy = prev.panOy - dyFromCenter * prevViewportRadius * 2;
      const newViewportRadius = radiusGridUnits / newScale;
      const nextPan = clampPan(
        cursorOx - dxFromCenter * newViewportRadius * 2,
        cursorOy + dyFromCenter * newViewportRadius * 2,
        newScale,
      );
      return { scale: newScale, panOx: nextPan.panOx, panOy: nextPan.panOy };
    });
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
      resetView();
    };

    const onTouchStart = (e: TouchEvent) => {
      const ts = e.touches;
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

  // ── Click handler: select occupied cell as entity, else as landing cell ──
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
    let label = "Land";
    if (s.isWater) label = "Water";
    else if (s.isMountain) label = "Peak";
    const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
    return { label, distM, passable: s.isPassable };
    // pxToGrid depends on view + logicalSize; declared deps are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, terrain, radiusGridUnits, logicalSize, view.scale, view.panOx, view.panOy]);

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
        {!occupancyLoaded && <span className={styles.scouting}> · scouting…</span>}
        {occupancyLoaded && !occupancyError && (
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
        aria-label={`Terrain disc for ${cityAccount.name}. Click an occupant to inspect them, or pick an empty cell to land. Scroll or pinch to zoom, drag to pan, double-click to reset.`}
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
            title="Reset zoom (or double-click)"
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
