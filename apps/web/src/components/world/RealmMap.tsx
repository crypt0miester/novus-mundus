"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Map as MapIcon, X } from "lucide-react";
import {
  animate,
  createDraggable,
  createTimeline,
  stagger,
  svg,
  utils,
  type Draggable,
} from "animejs";
import { useAnimeScope } from "@/lib/hooks/useAnimeScope";
import { STAGGER } from "@/lib/motion/tokens";
import { prefersReducedMotion } from "@/lib/utils";
import { BottomSheet } from "@/components/shared/BottomSheet";
import Link from "next/link";
import { GameIcon } from "@/components/shared/GameIcon";
import { CityCrest, citySigilSrc } from "./CityCrest";
import {
  useWorldCities,
  useWorldPlayers,
  useWorldTeams,
  useWorldGameEngine,
  useCitizenStatus,
} from "@/lib/hooks/world";
import { convexHull, inflate, type Pt } from "./util/hull";
import worldLand from "./data/world-land.json";
import { useZoomPan } from "./util/useZoomPan";
import { useChainNow } from "@/lib/hooks/useChainTime";
import { calculateLocalTime } from "novus-mundus-sdk";
import { PHASES } from "@/lib/hooks/useWorldClock";
import styles from "./RealmMap.module.css";
import { getCityLore } from "@/lib/cityLore";
import type { RealmRoute } from "@/lib/hooks/useMapRoutes";

// localStorage key for the desktop floating panel's dragged offset.
const PANEL_POS_KEY = "nm-realm-panel-pos";

// Day/night overlay helpers.
//
// The game's time-of-day is LONGITUDE-ONLY: `calculateLocalTime(chainTs, lon)`
// is a real-24h cycle anchored to the chain clock, offset by longitude like a
// timezone — no latitude, no season (this mirrors the on-chain `get_time_of_day`
// in `time_cycle.rs`). So the map's day/night is a set of vertical longitude
// bands, NOT an astronomical terminator: a city's shade depends only on its
// longitude, exactly as its on-chain clock and NOVI multipliers do. Two cities
// at the same longitude always share the same shade.

// PHASES index for a 0-999 local time. Order matches `PHASES` in useWorldClock
// (DeepNight, Dawn, Morning, Midday, Afternoon, Dusk, Evening) and the on-chain
// `get_time_of_day` bands.
function phaseIndexForLocalTime(localTime: number): number {
  if (localTime < 125) return 0; // DeepNight
  if (localTime < 250) return 1; // Dawn (golden hour)
  if (localTime < 375) return 2; // Morning
  if (localTime < 625) return 3; // Midday
  if (localTime < 750) return 4; // Afternoon
  if (localTime < 875) return 5; // Dusk (golden hour)
  return 6; // Evening
}

type PhaseShade = "night" | "twilight" | "day";

// How a phase shades the map: night (DeepNight/Evening) gets the full wash, the
// golden hours (Dawn/Dusk) a lighter twilight strip, daylight nothing.
function phaseShade(index: number): PhaseShade {
  if (index === 0 || index === 6) return "night";
  if (index === 1 || index === 5) return "twilight";
  return "day";
}

// Format a 0-999 local time as an "HH:MM" wall-clock — the same mapping the
// WorldClock chrome uses (1000 local-time units == 1440 minutes).
function localTimeToClock(localTime: number): string {
  const totalMin = Math.floor((localTime / 1000) * 1440);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const mm = String(totalMin % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Night is retinted to deep sepia for the realm-map wash ONLY. The shared PHASES
// palette stays indigo/violet for the WorldClock chrome and the NOVI multiplier
// readouts, but on the cream parchment a warm umber reads as the chart darkening
// at nightfall rather than a purple cast. DeepNight (idx 0) / Evening (idx 6) are
// the only "night" phases (see phaseShade); twilight and day keep their PHASES
// colours, which are already warm.
const NIGHT_WASH_TINT = { 0: "#3f3326", 6: "#463a2c" } as const;
function washColor(idx: number, shade: PhaseShade): string {
  if (shade === "night") return idx === 0 ? NIGHT_WASH_TINT[0] : NIGHT_WASH_TINT[6];
  return PHASES[idx].color;
}

export { styles as realmMapStyles };

/** A projected city — what the renderSelected callback receives. */
export interface RealmCityNode {
  city: {
    name: string;
    cityType: number;
    cityId: number;
    playersPresent: number;
    minEncounterLevel: number;
    maxEncounterLevel: number;
    latitude: number;
    longitude: number;
    activeEncounters?: bigint;
  };
  key: string;
  x: number;
  y: number;
  size: number;
}

export interface RealmMapDefaultContext {
  typeCounts: number[];
  kingdom: string;
  theme: string;
  start: number;
}

export interface RealmMapSelectedContext {
  node: RealmCityNode;
  isHome: boolean;
}

/* City type to glyph + label + icon. Index must match the on-chain CityType
 * enum: Capital=0, Resource=1, Combat=2, Trade=3. Colour is deliberately
 * absent — type is signalled by the glyph engraved beside each city's dot.
 * `glyph` stays for the tiny in-SVG markers; `icon` is the engraved GameIcon
 * used in the HTML legend and detail panels. */
const TYPE_META = [
  { label: "Capital", glyph: "♛", icon: "map-capital" },
  { label: "Resource", glyph: "⛏", icon: "map-resource" },
  { label: "Combat", glyph: "⚔", icon: "map-combat" },
  { label: "Trade", glyph: "◆", icon: "map-trade" },
] as const;

// Per-city heraldic sigils replace the generic type glyph on the marker only
// once zoomed in past this scale, where cities have spread far enough apart
// that the detailed medallions stop colliding. Below it, the plain dot reads.
const SIGIL_ZOOM = 2.4;

const THEMES = ["Medieval", "Cyberpunk", "Sci-Fi", "Modern", "Post-Apocalyptic"];

const typeIdx = (t: number) => Math.max(0, Math.min(3, t | 0));

/** Read a possibly-bigint numeric field. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v) || 0;
}

// Map viewBox — keeps the SVG math in clean units, scales to the sheet's
// aspect ratio (7:5 matches the .sheet CSS).
const VB_W = 1000;
const VB_H = 720;
const PAD = 80;

// Fixed full-world equirectangular window. The whole world fills the frame at
// one uniform scale (1° lon and 1° lat cover equal screen px, no stretch); the
// ±120° latitude window leaves a margin so the ±90° of real land sits centered.
// Cities and coastlines share this projection, so city dots land at their true
// geographic positions on the world.
const WORLD_LON0 = -180;
const WORLD_LON_SPAN = 360;
const WORLD_LAT0 = -120;
const WORLD_LAT_SPAN = 240;
const worldX = (lon: number) => PAD + ((lon - WORLD_LON0) / WORLD_LON_SPAN) * (VB_W - 2 * PAD);
const worldY = (lat: number) => PAD + (1 - (lat - WORLD_LAT0) / WORLD_LAT_SPAN) * (VB_H - 2 * PAD);

// Fog-of-war: discovery radius (viewBox px) of the soft clearing each city
// opens in the fog. Land inside a clearing is "charted"; the rest of the world
// stays under the parchment-shadow veil until a city is opened near it.
const DISCOVERY_RADIUS = 85;

// Quadratic campaign-arc path shared by the travel line and the ambient route
// arcs: a control point pushed perpendicular to the chord, bow proportional to
// chord length and capped so long routes don't balloon. The control point is
// clamped into the viewBox so arcs between edge-hugging cities can't bow past
// the SVG bounds and render visibly cut off.
const ARC_EDGE_MARGIN = 8;
function campaignArc(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(70, len * 0.18);
  const ctrlX = Math.max(
    ARC_EDGE_MARGIN,
    Math.min(VB_W - ARC_EDGE_MARGIN, (from.x + to.x) / 2 + (-dy / len) * bow),
  );
  const ctrlY = Math.max(
    ARC_EDGE_MARGIN,
    Math.min(VB_H - ARC_EDGE_MARGIN, (from.y + to.y) / 2 + (dx / len) * bow),
  );
  return `M ${from.x} ${from.y} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${to.x} ${to.y}`;
}

// Simplified Natural Earth land, projected once into the viewBox as SVG path
// strings. Rendered as ink coastline outlines, no fill colour (see render).
const WORLD_LAND_PATHS: string[] = (worldLand.rings as [number, number][][]).map((ring) => {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i]!;
    d += `${i === 0 ? "M" : "L"}${worldX(lon).toFixed(1)} ${worldY(lat).toFixed(1)} `;
  }
  return `${d}Z`;
});

// The day/night wash bleeds a full viewBox past every edge so it fills the
// letterbox margins (in fullscreen the sheet is wider than the 7:5 viewBox, so
// "meet" leaves bars the wash must cover) and runs off-sheet when panned — an
// "endless" horizontal sweep, never a contained box. The sheet's overflow:hidden
// clips the excess. The gradient samples real longitudes across this whole span,
// so the cycle simply continues past the kingdom rather than stretching.
const WASH_X = -VB_W;
const WASH_Y = -VB_H;
const WASH_W = VB_W * 3;
const WASH_H = VB_H * 3;

/** The map projection window — fixed to the full world so the realm renders as
 * a world map with cities at their true positions. Returns the same window
 * shape the city-node and day/night mappings already consume, so they reproject
 * onto the world with no other changes. */
function project(): { lat0: number; lon0: number; latR: number; lonR: number } {
  return { lat0: WORLD_LAT0, lon0: WORLD_LON0, latR: WORLD_LAT_SPAN, lonR: WORLD_LON_SPAN };
}

// Resample a closed polygon to exactly `count` evenly-spaced points along its
// perimeter, returned as an SVG path string. svg.morphTo needs matched point
// counts between source and target; resampling guarantees that no matter how
// the underlying hull's vertex count changes between chain ticks.
function resampleClosedPolygon(poly: Pt[], count: number): string {
  if (poly.length < 2) return "";
  // Per-segment lengths around the loop (last vertex back to first).
  const segs: { a: Pt; b: Pt; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, len });
    total += len;
  }
  if (total === 0) return "";
  const out: Pt[] = [];
  const stepLen = total / count;
  let segIdx = 0;
  let segPos = 0;
  for (let i = 0; i < count; i++) {
    const targetDist = i * stepLen;
    // Walk segments until the cumulative length reaches the target.
    let walked = 0;
    for (let s = 0; s < segs.length; s++) {
      if (walked + segs[s]!.len >= targetDist || s === segs.length - 1) {
        segIdx = s;
        segPos = segs[s]!.len === 0 ? 0 : (targetDist - walked) / segs[s]!.len;
        break;
      }
      walked += segs[s]!.len;
    }
    const seg = segs[segIdx]!;
    out.push({
      x: seg.a.x + (seg.b.x - seg.a.x) * segPos,
      y: seg.a.y + (seg.b.y - seg.a.y) * segPos,
    });
  }
  const head = out[0]!;
  return `M ${head.x.toFixed(2)} ${head.y.toFixed(2)} ${out
    .slice(1)
    .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ")} Z`;
}

export interface RealmMapProps {
  /** Replace the selected-city scroll panel. Default: city detail + "Walk
   *  its gates" link to /cities/[id]. */
  renderSelected?: (ctx: RealmMapSelectedContext) => ReactNode;
  /** Replace the no-selection scroll panel. Default: legend + realm meta. */
  renderDefault?: (ctx: RealmMapDefaultContext) => ReactNode;
  /** Controlled selection — supply with `onSelectChange` to manage selection
   *  externally (e.g., bind to a travel "destinationCity" state). Omit both
   *  for the standalone, internal-state mode used by /world. */
  selectedId?: number | null;
  onSelectChange?: (id: number | null) => void;
  /** Override the small all-caps header above the scroll panel. */
  scrollHead?: string;
  /** When provided AND a city is selected AND the callback returns non-null,
   *  the SVG city map is replaced with this content inside the sheet. The
   *  scroll panel beside it is untouched. Used by the travel flow to "drill
   *  into" a destination city and show its terrain disc full-size. A back
   *  button (and Esc) clears the selection and restores the SVG. */
  renderSheetOverride?: (selected: RealmCityNode) => ReactNode;
  /** City to soft-highlight with a slow pulsing ring. Used by the arrival
   *  flow to mark the recommended starting city — visible enough to guide
   *  newcomers, quiet enough that a deliberate selection (the seal-orange
   *  selection ring) reads as primary. */
  recommendedId?: number | null;
  /** Suppress the "THE KINGDOM" cartouche header. Use when the parent page
   *  already provides a heading (e.g. the arrival's `ChoiceBeat`) so the two
   *  don't stack and fight each other. Readouts and the rest of the chrome
   *  stay visible. */
  hideCartouche?: boolean;
  /** Intercity travel in flight — draws a dashed line from origin to
   *  destination and a marker at the current progress. Omit (or pass null)
   *  for no line. `pct` is 0–100. */
  travel?: { fromCityId: number; toCityId: number; pct: number } | null;
  /** In-flight city-to-city movements drawn as static arcs behind the cities:
   *  rally marches (all teams), other players' intercity travel, and your own
   *  reinforcements. Your own travel uses the animated `travel` arc above. */
  routes?: RealmRoute[];
  /** A stable identifier for whatever the player is acting on right now
   *  (picked cell, selected entity, in-flight travel). When fullscreen is
   *  on, every transition to a NEW non-null value auto-opens the floating
   *  panel so the action surface lands in view. Plain city selection is
   *  handled separately (selecting a city always opens the panel too). */
  actionId?: string | null;
  /** When true the map takes the viewport (escapes its document-flow
   *  container) and the detail panel floats over the right edge of the
   *  map — Civ-style. On phones the same floating panel is used (no
   *  bottom sheet, no backdrop), with an X close button. Stamps
   *  `data-fullscreen="true"` on the root so the CityTerrainMap CSS
   *  module (separate scope) can hook off the same contract via
   *  `:global([data-fullscreen="true"])` selectors. Caller-side: /map
   *  turns this on; /world and /arrival keep the default false so their
   *  existing inline layout is untouched. */
  fullscreen?: boolean;
  /** Called when the user X-closes the floating detail panel. Parent
   *  owns what gets cleared — typical wiring drops selectedEntity +
   *  destCell so the player deselects without leaving the city disc.
   *  Omit if no cleanup is needed beyond closing the panel. */
  onCloseRequest?: () => void;
  /** Optional overlay node mounted as a child of `.shell`, below the
   *  floating detail panel (z-15 vs z-20) and clear of the right-edge
   *  sub-tab nav. Used by /map to host the Forces HUD. Rendered only in
   *  fullscreen so /world and /arrival's inline layout stay untouched. */
  renderHud?: () => ReactNode;
}

export function RealmMap({
  renderSelected,
  renderDefault,
  selectedId: controlledId,
  onSelectChange,
  scrollHead,
  renderSheetOverride,
  recommendedId,
  hideCartouche,
  travel,
  routes,
  actionId,
  fullscreen,
  onCloseRequest,
  renderHud,
}: RealmMapProps = {}) {
  const { data: cities, isLoading: citiesLoading } = useWorldCities();
  const { data: players } = useWorldPlayers();
  const { data: teams } = useWorldTeams();
  const { data: engineData } = useWorldGameEngine();
  const citizen = useCitizenStatus();

  const [internalId, setInternalId] = useState<number | null>(null);
  const isControlled = controlledId !== undefined;
  const selectedId = isControlled ? controlledId : internalId;
  const setSelectedId = (id: number | null) => {
    if (!isControlled) setInternalId(id);
    onSelectChange?.(id);
  };

  // Zoom/pan transforms the inner SVG <g>. Compass, ornaments, and scale bar
  // live outside the SVG so they stay anchored to the sheet.
  const zoom = useZoomPan({ vbWidth: VB_W, vbHeight: VB_H });

  /* Track sheet pixel size so we can compute the SVG-to-screen scale factor.
   * The SVG paints at viewBox units (1000×720); at a mobile sheet width of
   * ~360 px those units shrink to 0.36× their viewBox size, which made
   * city-name text (fontSize=9.5 viewBox units) render at ~3 screen px —
   * unreadable. We compute a `labelMultiplier` that scales each city group
   * up enough that the on-screen font stays ≥ TARGET_FONT_SCREEN_PX, and
   * fold that multiplier into the existing counter-zoom transform. */
  const [sheetSize, setSheetSize] = useState({ w: VB_W, h: VB_H });
  useEffect(() => {
    const el = zoom.containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = rect.width || VB_W;
      const h = rect.height || VB_H;
      setSheetSize((prev) =>
        Math.abs(prev.w - w) > 2 || Math.abs(prev.h - h) > 2 ? { w, h } : prev,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom.containerRef]);

  const svgScale = Math.min(sheetSize.w / VB_W, sheetSize.h / VB_H);
  /* Floor on-screen font size in CSS px. At 10 the labels read cleanly even
   * on the smallest mobile sheet; on desktop sheets the multiplier naturally
   * clamps to 1 (no upscale beyond the original 9.5-unit design). */
  const TARGET_FONT_SCREEN_PX = 8;
  const BASE_FONT_VB_UNITS = 11;
  const labelMultiplier = Math.max(
    1,
    TARGET_FONT_SCREEN_PX / (BASE_FONT_VB_UNITS * Math.max(0.001, svgScale)),
  );

  const engine = (engineData as { account?: unknown })?.account ?? engineData;
  const eng = engine as
    | {
        kingdomName?: string;
        kingdomTheme?: number;
        kingdomStartTime?: unknown;
        totalPlayers?: unknown;
      }
    | undefined;
  const kingdomName = eng?.kingdomName || "The Kingdom";
  const theme = THEMES[eng?.kingdomTheme ?? 0] ?? "Unknown";

  const homeCity = citizen.isCitizen ? citizen.player?.currentCity : undefined;

  // Project lat/long into the viewBox, then run a small collision pass so
  // dense clusters don't pile on top of each other.
  const nodes = useMemo(() => {
    if (!cities || cities.length === 0) return [];
    const { lat0, lon0, latR, lonR } = project();
    const maxPlayers = Math.max(1, ...cities.map((c) => c.account.playersPresent));
    const placed = cities.map((c) => ({
      city: c.account,
      key: c.pubkey.toBase58(),
      x: PAD + ((c.account.longitude - lon0) / lonR) * (VB_W - 2 * PAD),
      // Invert Y so north is up.
      y: PAD + (1 - (c.account.latitude - lat0) / latR) * (VB_H - 2 * PAD),
      size: 5 + 5 * Math.sqrt(c.account.playersPresent / maxPlayers),
    }));

    // GAP is the minimum edge-to-edge gap between any two dots. On the world
    // map cities must sit at their true projected lat/long (aligned with the
    // coastlines), so this is just enough to stop exact overlaps — not the old
    // 28px de-cluster spread, which shoved tightly-grouped cities off-spot.
    // The initial zoom (below) gives labels their breathing room instead.
    const GAP = 3;
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i]!;
          const b = placed[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const minDist = a.size + b.size + GAP;
          if (dist < minDist) {
            const push = (minDist - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
            moved = true;
          }
        }
      }
      for (const p of placed) {
        p.x = Math.max(PAD, Math.min(VB_W - PAD, p.x));
        p.y = Math.max(PAD, Math.min(VB_H - PAD, p.y));
      }
      if (!moved) break;
    }
    return placed;
  }, [cities]);

  // On first load, settle the camera into the kingdom rather than showing the
  // whole world with the cities a tiny cluster in the center. Fires once, when
  // the cities arrive; the user can pan/zoom/double-click-reset freely after.
  const didFocusRef = useRef(false);
  useEffect(() => {
    if (didFocusRef.current || nodes.length === 0) return;
    didFocusRef.current = true;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // Floor the span so a lone/tight kingdom doesn't demand an extreme zoom,
    // then fit it to ~half the viewport and cap the zoom so the world still
    // reads around the realm ("zoom a bit", not slam to max).
    const w = Math.max(maxX - minX, 60);
    const h = Math.max(maxY - minY, 60);
    const fit = Math.min((VB_W * 0.5) / w, (VB_H * 0.5) / h);
    zoom.focus(cx, cy, Math.max(2, Math.min(3, fit)));
  }, [nodes, zoom]);

  // Larger dots first so smaller (later-painted) dots stay clickable.
  const renderOrder = useMemo(() => [...nodes].sort((a, b) => b.size - a.size), [nodes]);

  const labelSide = useMemo(() => {
    const NEIGHBOR_R = 110;
    const map = new Map<string, "above" | "below">();
    for (const n of nodes) {
      let above = 0;
      let below = 0;
      for (const m of nodes) {
        if (m === n) continue;
        const dx = m.x - n.x;
        const dy = m.y - n.y;
        if (Math.hypot(dx, dy) > NEIGHBOR_R) continue;
        if (dy < 0) above++;
        else if (dy > 0) below++;
      }
      // SVG y increases downward — fewer neighbours above means it's safe to
      // point the label up.
      map.set(n.key, above <= below ? "above" : "below");
    }
    return map;
  }, [nodes]);

  // Inflated convex hull of the cities — reused for point-in-shape terrain
  // placement and the living territory border (a subtle region on the world).
  const { kingdomHull } = useMemo(() => {
    if (nodes.length < 3) return { kingdomHull: [] as Pt[] };
    const pts: Pt[] = nodes.map((n) => ({ x: n.x, y: n.y }));
    const fat = inflate(convexHull(pts), 56);
    return { kingdomHull: fat };
  }, [nodes]);

  // Roads — quiet ink spokes from the King's seat (the Capital) out to every
  // other city, the geography the panel hint already promises. Each is a gentle
  // quadratic arc so the network reads as drawn-by-hand rather than a starburst
  // of straight lines. The reveal (feature 4.3) self-draws these center-out.
  const roads = useMemo(() => {
    if (nodes.length < 2) return [] as { key: string; d: string }[];
    const capital = nodes.find((n) => typeIdx(n.city.cityType) === 0) ?? nodes[0]!;
    return nodes
      .filter((n) => n !== capital)
      .map((n) => {
        const mx = (capital.x + n.x) / 2;
        const my = (capital.y + n.y) / 2;
        // Bow the control point perpendicular to the chord so roads curve.
        const dx = n.x - capital.x;
        const dy = n.y - capital.y;
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(26, len * 0.12);
        const cx = mx + (-dy / len) * bow;
        const cy = my + (dx / len) * bow;
        return {
          key: n.key,
          d: `M ${capital.x} ${capital.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${n.x} ${n.y}`,
        };
      });
  }, [nodes]);

  // Living territory border (feature 4.6). The realm's controlled extent is the
  // chain-derived kingdom hull; we resample it to a FIXED point count so
  // svg.morphTo always has matched node counts when control shifts (a city
  // added / lost / players moved re-shapes the hull). The "d" here is just the
  // initial render; the morph effect below drives transitions imperatively.
  const BORDER_POINTS = 48;
  const borderPath = useMemo(() => {
    if (kingdomHull.length < 3) return "";
    return resampleClosedPolygon(kingdomHull, BORDER_POINTS);
  }, [kingdomHull]);

  /* Day/night overlay — a continuous horizontal wash matching the game's
     on-chain time-of-day. The clock is LONGITUDE-ONLY, so this is a strictly
     horizontal gradient (x-only): every stop is a vertical isochrone meridian,
     two cities at the same longitude provably share a shade, and there's no
     latitude term or curved terminator. Anchored to the chain clock (same as the
     WorldClock chrome and every NOVI multiplier); re-renders on useChainNow's
     tick, geometry quantized to the minute so the stop list never jitters. */
  const chainNow = useChainNow();
  const dayNight = useMemo(() => {
    if (!cities || cities.length < 1) return null;
    const { lon0, lonR } = project();
    const ts = Math.floor(chainNow / 60) * 60;
    const xOf = (lon: number) => PAD + ((lon - lon0) / lonR) * (VB_W - 2 * PAD);

    /* The wash: evenly spaced stops across the FULL viewBox width, each coloured
       by the local time at that longitude. Even spacing keeps the stop COUNT
       constant tick-to-tick (only the colours shift), so React keys stay stable
       and there's no flicker.

       Two ramps, one per theme, because multiply darkens but screen lightens:
       SHADOW (light "paper", multiply) deepens the NIGHT longitudes into dusk
       while day keeps only a faint gold breath; GLOW (dark vellum, screen) lifts
       the DAY longitudes into warm daylight while night stays near-black. Same
       colours, inverted opacity ramp — sharing one ramp is what made night read
       as day on the dark theme. */
    // More stops than before because only the central ~1/3 of the extended rect
    // is on-sheet — keep that visible slice smooth.
    const STOPS = 150;
    const lonAtOffset = (o: number) =>
      lon0 + ((WASH_X + o * WASH_W - PAD) / (VB_W - 2 * PAD)) * lonR;
    type Stop = { offset: number; color: string; opacity: number };
    const shadowStops: Stop[] = [];
    const glowStops: Stop[] = [];
    for (let i = 0; i <= STOPS; i++) {
      const o = i / STOPS;
      const idx = phaseIndexForLocalTime(calculateLocalTime(ts, lonAtOffset(o)));
      const shade = phaseShade(idx);
      const color = washColor(idx, shade);
      shadowStops.push({
        offset: o,
        color,
        opacity: shade === "night" ? 0.55 : shade === "twilight" ? 0.4 : 0,
      });
      glowStops.push({
        offset: o,
        color,
        opacity: shade === "day" ? 0.18 : shade === "twilight" ? 0.11 : 0.03,
      });
    }

    /* Track the local-noon and local-midnight meridians so we can anchor the
       sliding HH:MM labels. Sampled a touch wider than the sheet so a meridian
       just off-frame still resolves. */
    const margin = 40;
    const samples = 240;
    const minLong = lon0 - margin;
    const maxLong = lon0 + lonR + margin;
    let noonX: number | null = null;
    let midnightX: number | null = null;
    let bestNoon = Number.POSITIVE_INFINITY;
    let bestMid = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= samples; i++) {
      const lon = minLong + ((maxLong - minLong) * i) / samples;
      const localTime = calculateLocalTime(ts, lon);
      const x = xOf(lon);
      const dNoon = Math.abs(localTime - 500);
      if (dNoon < bestNoon) {
        bestNoon = dNoon;
        noonX = x;
      }
      const dMid = Math.min(localTime, 1000 - localTime);
      if (dMid < bestMid) {
        bestMid = dMid;
        midnightX = x;
      }
    }

    return {
      shadowStops,
      glowStops,
      /* Only label a meridian when it's actually on the sheet. */
      noonX: bestNoon <= 35 ? noonX : null,
      midnightX: bestMid <= 35 ? midnightX : null,
      noonLabel: localTimeToClock(500),
      midnightLabel: localTimeToClock(0),
    };
  }, [cities, chainNow]);

  // Travel geometry (feature 3c). The straight chord becomes a quadratic arc:
  // a control point pushed perpendicular to the chord so the route reads like a
  // campaign map. The marker rides this exact curve via svg.createMotionPath,
  // bound to chain pct. Computed once per geometry change so the scope effect
  // can depend on stable numbers.
  const travelGeo = useMemo(() => {
    if (!travel) return null;
    const from = nodes.find((n) => n.city.cityId === travel.fromCityId);
    const to = nodes.find((n) => n.city.cityId === travel.toCityId);
    if (!from || !to || from === to) return null;
    return {
      from,
      to,
      d: campaignArc(from, to),
      markerCarriesFlag: travel.fromCityId === homeCity,
    };
  }, [travel, nodes, homeCity]);

  // Static campaign arcs for every other in-flight movement (rally marches, other
  // players' travel, my reinforcements). Same quadratic-bow geometry as the
  // animated travel arc, but markerless — just the line, drawn behind the cities.
  const routeGeos = useMemo(() => {
    if (!routes || routes.length === 0) return [];
    return routes
      .map((r) => {
        const from = nodes.find((n) => n.city.cityId === r.fromCityId);
        const to = nodes.find((n) => n.city.cityId === r.toCityId);
        if (!from || !to || from === to) return null;
        return {
          id: r.id,
          kind: r.kind,
          mine: r.mine,
          d: campaignArc(from, to),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [routes, nodes]);

  // Exit retention for the ambient route arcs. A march that lands or is
  // cancelled would otherwise vanish between two frames; keep just-removed
  // geos around for one beat with the exit class so they fade out. Fresh
  // arcs fade in via the routeLine mount animation.
  const ROUTE_EXIT_MS = 450;
  const [exitingRoutes, setExitingRoutes] = useState<
    ((typeof routeGeos)[number] & { exitAt: number })[]
  >([]);
  const prevRouteGeosRef = useRef<typeof routeGeos>([]);
  useEffect(() => {
    const live = new Set(routeGeos.map((g) => g.id));
    const exited = prevRouteGeosRef.current.filter((g) => !live.has(g.id));
    prevRouteGeosRef.current = routeGeos;
    if (exited.length === 0) return;
    const now = performance.now();
    setExitingRoutes((prev) => [
      // Drop anything that re-appeared in the live set or already finished
      // its exit window before appending the new cohort.
      ...prev.filter((p) => !live.has(p.id) && now - p.exitAt < ROUTE_EXIT_MS),
      ...exited.map((g) => ({ ...g, exitAt: now })),
    ]);
  }, [routeGeos]);
  useEffect(() => {
    if (exitingRoutes.length === 0) return;
    const t = window.setTimeout(() => {
      const now = performance.now();
      setExitingRoutes((prev) => prev.filter((p) => now - p.exitAt < ROUTE_EXIT_MS));
    }, ROUTE_EXIT_MS + 30);
    return () => window.clearTimeout(t);
  }, [exitingRoutes]);

  const selected = nodes.find((n) => n.city.cityId === selectedId) ?? null;

  const sheetOverride = selected && renderSheetOverride ? renderSheetOverride(selected) : null;
  // Boolean flag so the Esc effect only re-runs when the override toggles
  // on/off — `sheetOverride` itself is a fresh ReactNode every render.
  const overrideActive = sheetOverride != null;

  const backBtnRef = useRef<HTMLButtonElement | null>(null);

  // anime.js handles for the map's motion surfaces.
  const svgRef = useRef<SVGSVGElement | null>(null);
  // The progress-bound travel march (feature 3c): driven by chain pct, not time.
  const markerRef = useRef<SVGGElement | null>(null);
  // The control border path + its last-rendered "d" so we morph on the edge of
  // a control shift, not every render (feature 4.6).
  const borderRef = useRef<SVGPathElement | null>(null);
  const prevBorderRef = useRef<string>("");

  useEffect(() => {
    if (!overrideActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    // Drop focus on the back button so Esc/Enter both have an obvious
    // dismiss path and keyboard users aren't stranded on document.body
    // after the SVG city dots are pulled out of the a11y tree.
    backBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [overrideActive]);

  const typeCounts = useMemo(() => {
    const counts = [0, 0, 0, 0];
    nodes.forEach((n) => counts[typeIdx(n.city.cityType)]++);
    return counts;
  }, [nodes]);

  const totalPlayers = toNum(eng?.totalPlayers) || players?.length || 0;

  // Fullscreen-only panel state. Desktop renders a floating card on
  // the right edge of the disc, mounted only when there's something
  // to show (city pick, cell pick, entity, in-flight travel). Mobile
  // uses a BottomSheet that auto-opens on the same transitions but
  // can also be opened by the bottom-centre pill so the player can
  // surface the default realm overview without first selecting a
  // city. Both are user-dismissable; a new transition re-opens.
  //
  // Priority: actionId > selectedId. Once the player is drilled into
  // a city (selectedId set), clicking a rival / picking a cell /
  // starting travel changes actionId, and the panel should re-open
  // on that — NOT stay stuck on "city:${selectedId}". Falling back
  // to the city key when no action is queued keeps the panel open
  // on plain city selection too.
  const panelOpenKey = actionId ?? (selectedId != null ? `city:${selectedId}` : null);
  const [panelOpen, setPanelOpen] = useState(false);
  const lastPanelKeyRef = useRef<string | null>(null);
  // Draggable floating panel (desktop fullscreen). The panel is an absolute
  // child of the relative `.shell`, so anime.js Draggable translates it within
  // the shell (the map area). `.scrollHead` is the grab handle; the offset
  // persists to localStorage and survives selection changes. Mirrors the
  // CairnFloating pattern — React never sees a drag frame.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const panelHandleRef = useRef<HTMLDivElement | null>(null);
  const panelDragRef = useRef<Draggable | null>(null);
  // Viewport — desktop ≥ 768 renders the floating card; below renders
  // the mobile chrome (BottomSheet + status pill).
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  // Mobile: swallow the FIRST non-null panelOpenKey on mount. MapTab
  // auto-defaults destinationCity to the player's home city as soon as
  // the player loads, and we don't want the sheet popping up the instant
  // /map opens — the player wants to look at the map first. Subsequent
  // transitions (tapping a different city, picking a cell, an action)
  // still auto-open. Desktop is unchanged: its floating panel doesn't
  // cover the map, so initial auto-open is fine there.
  const mobileInitialKeyConsumedRef = useRef(false);
  useEffect(() => {
    if (!fullscreen) return;
    if (!isDesktop && !mobileInitialKeyConsumedRef.current && panelOpenKey != null) {
      mobileInitialKeyConsumedRef.current = true;
      lastPanelKeyRef.current = panelOpenKey;
      return;
    }
    if (panelOpenKey && panelOpenKey !== lastPanelKeyRef.current) {
      setPanelOpen(true);
    }
    lastPanelKeyRef.current = panelOpenKey;
  }, [fullscreen, panelOpenKey, isDesktop]);

  // Desktop floating card shows only when there's a target. Mobile
  // sheet shows whenever panelOpen — pill can open default state.
  const desktopPanelShown = !!fullscreen && isDesktop && panelOpen && panelOpenKey != null;
  const mobileSheetOpen = !!fullscreen && !isDesktop && panelOpen;

  // Hand the floating panel to anime.js Draggable while it's shown. Drag is
  // triggered from the header handle and bounded to the shell (the map area);
  // the offset is restored on open and re-saved on release. Reverted on
  // unmount so a re-open rebuilds it cleanly.
  useEffect(() => {
    if (!desktopPanelShown) return;
    const panel = panelRef.current;
    const handle = panelHandleRef.current;
    const shell = shellRef.current;
    if (!panel || !handle || !shell) return;

    const d = createDraggable(panel, {
      trigger: handle,
      container: shell,
      x: true,
      y: true,
      dragThreshold: 3, // a small wobble on the header stays a click, not a drag
      onSettle: (self) => {
        try {
          localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ x: self.x, y: self.y }));
        } catch {
          /* the position just won't persist */
        }
      },
    });
    panelDragRef.current = d;

    // Restore a previously dragged offset; absent one it rests at the CSS
    // anchor (the disc's top-right corner).
    try {
      const raw = localStorage.getItem(PANEL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          d.setX(p.x);
          d.setY(p.y);
        }
      }
    } catch {
      /* fall back to the anchor */
    }

    // Keep the bounds honest when the viewport changes.
    const onResize = () => panelDragRef.current?.refresh();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      d.revert();
      panelDragRef.current = null;
    };
  }, [desktopPanelShown]);

  // Feature 4.3 — inked road reveal. Roads self-draw center-out instead of a
  // flat opacity fade. createDrawable commandeers stroke-dasharray, which
  // collides with the dashed `.road` look, so after the draw completes we
  // commitStyles and restore the dashed class. Under reduced motion we skip the
  // draw and the CSS resting state (opacity 0.55, dashed) shows immediately.
  useAnimeScope(
    { root: svgRef, deps: [roads.length, sheetOverride != null] },
    ({ reduce }) => {
      if (roads.length === 0 || sheetOverride != null) return;
      const targets = svg.createDrawable(".realm-road");
      if (targets.length === 0) return;
      if (reduce) {
        for (const el of targets) {
          (el as unknown as SVGElement).classList.add(styles.roadDrawn);
        }
        return;
      }
      animate(targets, {
        // Center-out per road: the drawn segment grows from a zero-length point
        // at the path midpoint (0.5 0.5) out to the full span (0 1). The
        // `draw` value is a "start end" fraction pair.
        draw: ["0.5 0.5", "0 1"],
        // The road set itself reveals center-out across the network.
        delay: stagger(STAGGER.tight, { from: "center" }),
        duration: 900,
        ease: "inOutQuad",
        onComplete: () => {
          // Commit the drawn geometry, then hand the dash back to CSS (the
          // 1.4/0.9 road dash) by tagging the element so the dashed class wins.
          for (const el of targets) {
            const node = el as unknown as SVGElement;
            utils.set(node, { opacity: 0.55 });
            node.classList.add(styles.roadDrawn);
          }
        },
      });
    },
  );

  // Feature 4.3 — ceremonial city selection. The mount-only CSS ringDraw is
  // replaced by a replay-on-every-re-pick timeline: outer ring scribes, inner
  // follows, the dot springs, and a shockwave ripples outward driven by the `r`
  // attribute (NOT transform scale, so the counter-scale group can't fight it).
  // Keyed imperatively off selectedId so re-picking the same flow replays.
  useAnimeScope(
    { root: svgRef, deps: [selectedId], revertOnCleanup: false },
    ({ reduce }) => {
      if (selectedId == null) return;
      const rings = svg.createDrawable(".realm-sel-ring");
      if (reduce) {
        for (const el of rings) utils.set(el as unknown as SVGElement, { opacity: 1 });
        return;
      }
      const tl = createTimeline({ defaults: { ease: "outQuart" } });
      if (rings[0]) tl.add(rings[0] as unknown as SVGElement, { draw: ["0 0", "0 1"], opacity: [0, 0.95], duration: 420 }, 0);
      if (rings[1]) tl.add(rings[1] as unknown as SVGElement, { draw: ["0 0", "0 1"], opacity: [0, 0.75], duration: 480 }, 80);
      // Shockwave: grow the radius + fade. The ripple circle starts collapsed.
      // Driven by `r` (not transform scale) so the counter-scale can't fight it.
      tl.add(
        ".realm-sel-ripple",
        { r: [2, 26], opacity: [0.5, 0], duration: 620, ease: "outExpo" },
        40,
      );
    },
  );

  // Feature 3c — path-true travel march. The invisible curved route etches
  // itself in on dispatch; the heading-locked marker is then positioned by
  // sampling that path at chain pct in the effect below (never off time).
  useAnimeScope(
    { root: svgRef, deps: [travelGeo?.d ?? null] },
    ({ reduce }) => {
      if (!travelGeo || !markerRef.current) return;
      const route = svg.createDrawable("#travel-route");
      if (!reduce && route[0]) {
        animate(route[0] as unknown as SVGElement, {
          draw: ["0 0", "0 1"],
          duration: 520,
          ease: "inOutQuad",
        });
      } else if (route[0]) {
        utils.set(route[0] as unknown as SVGElement, { opacity: 1 });
      }
      // The marker is positioned by sampling the route path directly (see the
      // effect below). createMotionPath threw inside anime refresh() on this SVG
      // group; getPointAtLength is deterministic and binds straight to chain pct.
    },
  );

  // Bind the marker to chain ground-truth whenever pct changes. Sampling the
  // path each time keeps it correct after pan/zoom re-renders, and position is
  // a pure bind off pct (no time) so it stays truthful under engine slow-mo.
  useEffect(() => {
    const marker = markerRef.current;
    const route = svgRef.current?.querySelector<SVGPathElement>("#travel-route");
    if (!marker || !route) return;
    const len = route.getTotalLength();
    if (!len) return;
    // Sample the curved route at chain progress (0..1) and face the heading.
    const t = utils.clamp((travel?.pct ?? 0) / 100, 0, 1);
    const at = route.getPointAtLength(len * t);
    const ahead = route.getPointAtLength(Math.min(len, len * t + 1));
    const angle = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI;
    marker.setAttribute("transform", `translate(${at.x} ${at.y}) rotate(${angle + 90})`);
  }, [travel?.pct, travelGeo?.d]);

  // Feature 4.6 — living territory borders. When the chain-derived control hull
  // changes silhouette, morph the border polygon to the new shape (matched
  // point counts via resampleClosedPolygon) and re-draw the stroke. Edge-gated
  // on the actual path string so it only fires when control truly shifts.
  useEffect(() => {
    const el = borderRef.current;
    if (!el || !borderPath) return;
    const prev = prevBorderRef.current;
    prevBorderRef.current = borderPath;
    // First render or reduced motion: snap to the shape, no morph.
    if (!prev || prev === borderPath || prefersReducedMotion()) {
      el.setAttribute("d", borderPath);
      return;
    }
    // Morph from the prior silhouette to the new one. morphTo needs a target
    // ELEMENT (not a path string and not a selector that may not resolve at
    // build time), so keep a hidden sibling path, point it at the new shape, and
    // hand the element itself to morphTo. Any morph failure falls back to a hard
    // set so this cosmetic border can never crash the map.
    const parent = el.parentNode as Element | null;
    let target = parent?.querySelector<SVGPathElement>("#territory-hull-target") ?? null;
    if (!target && parent) {
      target = document.createElementNS("http://www.w3.org/2000/svg", "path");
      target.setAttribute("id", "territory-hull-target");
      target.setAttribute("fill", "none");
      target.setAttribute("stroke", "none");
      parent.appendChild(target);
    }
    if (!target) {
      el.setAttribute("d", borderPath);
      return;
    }
    target.setAttribute("d", borderPath);
    el.setAttribute("d", prev);
    let a: ReturnType<typeof animate> | null = null;
    try {
      a = animate(el, {
        d: svg.morphTo(target),
        duration: 720,
        ease: "inOutQuad",
      });
    } catch {
      el.setAttribute("d", borderPath);
    }
    return () => {
      a?.cancel();
      el.setAttribute("d", borderPath);
    };
  }, [borderPath]);

  if (citiesLoading) {
    return (
      <div className={styles.root} data-fullscreen={fullscreen ? "true" : undefined}>
        <div className={styles.center}>the cartographer is at work…</div>
      </div>
    );
  }

  return (
    <div className={styles.root} data-fullscreen={fullscreen ? "true" : undefined}>
      {!hideCartouche && (
        <header className={styles.cartouche}>
          <h1 className={styles.kingdom}>{kingdomName}</h1>
        </header>
      )}
      <div ref={shellRef} className={styles.shell}>
        <div
          ref={zoom.containerRef}
          className={styles.sheet}
          onClick={sheetOverride ? undefined : () => setSelectedId(null)}
          style={{ touchAction: "none" }}
        >
          <div className={styles.grain} aria-hidden />
          <div className={styles.foxing} aria-hidden />

          {/* Hide the parchment corner flourishes under the drill-in view —
              they sit at a higher z-index than the override and clutter the
              terrain disc's edge. */}
          {!sheetOverride && <CornerOrnaments />}

          {sheetOverride && (
            <>
              <div className={styles.sheetOverride}>{sheetOverride}</div>
              <button
                ref={backBtnRef}
                type="button"
                className={styles.sheetBackBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(null);
                }}
                aria-label="Back to the realm map"
                title="Back to the realm map (Esc)"
              >
                <MapIcon className={styles.sheetBackIcon} aria-hidden />
              </button>
            </>
          )}

          <svg
            ref={svgRef}
            className={`${styles.svg} ${sheetOverride ? styles.svgHidden : ""}`}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label={`Map of ${kingdomName}`}
            aria-hidden={sheetOverride ? true : undefined}
          >
            <g transform={zoom.transform}>
              {/* World coastlines — simplified Natural Earth land, equirectangular,
                  as ink outlines on the parchment (no fill colour). The realm's
                  cities pin onto this at their true positions. World-space so it
                  pans/zooms with the map; strokes stay constant width. */}
              <g aria-hidden pointerEvents="none">
                {WORLD_LAND_PATHS.map((d, i) => (
                  <path
                    key={`land-${i}`}
                    d={d}
                    fill="none"
                    stroke="#6b5836"
                    strokeWidth={0.8}
                    strokeOpacity={0.5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>

              {/* Territory-border hull dropped: on the world map the convex
                  hull of the cities drew a stray diagonal quad over everything.
                  The cities + coastlines carry the realm now. */}

              {/* Roads dropped: the King's-seat spokes were a stray web of lines
                  radiating from Valdenmoor on the world map. Cities + coastlines
                  carry the realm now. */}

              {/* Day/night — a continuous horizontal wash matching the game's
                  on-chain time-of-day (longitude-only, latitude-independent: a
                  strictly horizontal gradient, never a curved terminator). Sits
                  above the kingdom wash, below terrain/roads/cities so it reads as
                  atmosphere. pointer-events:none (see CSS) so click-to-deselect
                  still hits the parchment. Small Cinzel HH:MM labels ride the
                  noon/midnight meridians and slide west as the chain clock turns. */}
              {dayNight && (
                <g className={styles.dayNightLayer}>
                  <defs>
                    <linearGradient
                      id="dayNightShadow"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                      gradientUnits="objectBoundingBox"
                    >
                      {dayNight.shadowStops.map((s) => (
                        <stop
                          key={s.offset}
                          offset={s.offset}
                          stopColor={s.color}
                          stopOpacity={s.opacity}
                        />
                      ))}
                    </linearGradient>
                    <linearGradient
                      id="dayNightGlow"
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                      gradientUnits="objectBoundingBox"
                    >
                      {dayNight.glowStops.map((s) => (
                        <stop
                          key={s.offset}
                          offset={s.offset}
                          stopColor={s.color}
                          stopOpacity={s.opacity}
                        />
                      ))}
                    </linearGradient>
                  </defs>
                  {/* Light "paper" shows the multiply shadow (deepens night);
                      dark vellum shows the screen glow (lifts day). CSS toggles
                      which rect is visible per body[data-theme]. */}
                  <rect
                    className={styles.washShadow}
                    x={WASH_X}
                    y={WASH_Y}
                    width={WASH_W}
                    height={WASH_H}
                    fill="url(#dayNightShadow)"
                  />
                  <rect
                    className={styles.washGlow}
                    x={WASH_X}
                    y={WASH_Y}
                    width={WASH_W}
                    height={WASH_H}
                    fill="url(#dayNightGlow)"
                  />
                  {dayNight.noonX !== null && (
                    <g
                      transform={`translate(${dayNight.noonX} ${PAD * 0.6}) scale(${labelMultiplier / zoom.scale})`}
                    >
                      <text className={styles.meridianLabel} x={0} y={0} fontSize={9}>
                        {dayNight.noonLabel}
                      </text>
                      <line className={styles.meridianTick} x1={0} y1={4} x2={0} y2={12} />
                    </g>
                  )}
                  {dayNight.midnightX !== null && (
                    <g
                      transform={`translate(${dayNight.midnightX} ${PAD * 0.6}) scale(${labelMultiplier / zoom.scale})`}
                    >
                      <text className={styles.meridianLabel} x={0} y={0} fontSize={9}>
                        {dayNight.midnightLabel}
                      </text>
                      <line className={styles.meridianTick} x1={0} y1={4} x2={0} y2={12} />
                    </g>
                  )}
                </g>
              )}

              {/* Travel path — origin → destination, dashed, with a marker at
                  the current progress. Drawn above the kingdom wash but below
                  the city groups so the dots and labels stay legible on top.
                  `vector-effect: non-scaling-stroke` (via the CSS class) keeps
                  the dash widths constant regardless of zoom; the marker uses
                  a counter-scale group for the same reason. */}
              {/* Static movement arcs for every other in-flight action: rally
                  marches (any team), other players' intercity travel, and my
                  reinforcements. Drawn below the player's own animated travel
                  arc and the city groups, color-keyed by kind, brighter when
                  the force is mine. Markerless — these read as ambient activity,
                  not the focused journey. */}
              {(routeGeos.length > 0 || exitingRoutes.length > 0) && (
                <g className={styles.routesLayer} aria-hidden>
                  {[...routeGeos, ...exitingRoutes].map((g) => (
                    <path
                      key={g.id}
                      d={g.d}
                      vectorEffect="non-scaling-stroke"
                      className={[
                        styles.routeLine,
                        g.kind === "rally"
                          ? styles.routeRally
                          : g.kind === "reinforcement"
                            ? styles.routeReinforcement
                            : styles.routeTravel,
                        g.mine ? styles.routeMine : "",
                        // Retained post-removal arcs dissolve via the exit class.
                        "exitAt" in g ? styles.routeExit : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  ))}
                </g>
              )}

              {travelGeo && (
                <g className={styles.travelGroup} aria-hidden>
                  {/* Invisible curved route the marker rides; also the etch
                      target (its stroke draws in on dispatch). The marker is
                      placed by svg.createMotionPath relative to its OWN box, so
                      the marker group is anchored at the origin (0,0) and the
                      generated translateX/translateY put it onto this path in
                      world space. The inner group counter-scales so the token
                      stays screen-sized like every other map mark. */}
                  <path
                    id="travel-route"
                    className={styles.travelLine}
                    d={travelGeo.d}
                    vectorEffect="non-scaling-stroke"
                  />
                  <g ref={markerRef}>
                    <g transform={`scale(${labelMultiplier / zoom.scale})`}>
                      <circle className={styles.travelMarkerHalo} cx={0} cy={0} r={7} />
                      <circle className={styles.travelMarker} cx={0} cy={0} r={3.5} />
                      {travelGeo.markerCarriesFlag && (
                        // Same flag shape as the city-side homeFlag, offset
                        // above the marker. Offsets are tuned to the marker's
                        // r=3.5 rather than a city's variable n.size.
                        <polygon className={styles.homeFlag} points="-1,-7 -1,-19 7,-15 -1,-11" />
                      )}
                    </g>
                  </g>
                </g>
              )}

              {/* Fog of war — uncharted world veiled by a parchment-shadow wash
                  (no colour); each city opens a soft clearing, so the realm's
                  known extent grows as cities are opened. Sits ABOVE the day/night
                  wash (else the night wash swamps it) and below the cities, which
                  always stay in their clearings. Reactive to the live city set. */}
              {nodes.length > 0 && (
                <g aria-hidden pointerEvents="none">
                  <defs>
                    {/* Feather the clearings as ONE group, so overlapping
                        circles union first (black ∪ black = black, no internal
                        seams) and only the merged outer edge gets a soft blur.
                        This is why two adjacent cities read as one charted blob
                        instead of leaving dark arcs where their circles cross. */}
                    <filter
                      id="realm-fog-feather"
                      filterUnits="userSpaceOnUse"
                      x={WASH_X}
                      y={WASH_Y}
                      width={WASH_W}
                      height={WASH_H}
                    >
                      <feGaussianBlur stdDeviation="20" />
                    </filter>
                    <mask
                      id="realm-fog-mask"
                      maskUnits="userSpaceOnUse"
                      maskContentUnits="userSpaceOnUse"
                      x={WASH_X}
                      y={WASH_Y}
                      width={WASH_W}
                      height={WASH_H}
                    >
                      <rect x={WASH_X} y={WASH_Y} width={WASH_W} height={WASH_H} fill="#fff" />
                      <g filter="url(#realm-fog-feather)">
                        {nodes.map((n) => (
                          <circle key={`fog-${n.key}`} cx={n.x} cy={n.y} r={DISCOVERY_RADIUS} fill="#000" />
                        ))}
                      </g>
                    </mask>
                  </defs>
                  <rect
                    x={WASH_X}
                    y={WASH_Y}
                    width={WASH_W}
                    height={WASH_H}
                    fill="#161009"
                    fillOpacity={0.82}
                    mask="url(#realm-fog-mask)"
                  />
                </g>
              )}

              <g>
                {renderOrder.map((n) => {
                  const meta = TYPE_META[typeIdx(n.city.cityType)];
                  const isSel = n.city.cityId === selectedId;
                  const isHome = n.city.cityId === homeCity;
                  const isRec = recommendedId != null && n.city.cityId === recommendedId;
                  const isCapital = typeIdx(n.city.cityType) === 0;
                  const always = isCapital || isHome || isSel;
                  // Selected city always wears its crest; others only once
                  // zoomed in. sigR is in pre-zoom (≈ screen-px) units.
                  const showSigil = isSel || zoom.scale >= SIGIL_ZOOM;
                  const sigR = Math.max(n.size * 1.75, 11);
                  const sigImg = sigR * 1.56; // crest box, ~78% of the disc
                  // Hit target is generous — inside the counter-scaled group
                  // these units render at constant screen size regardless of
                  // zoom (composite scale = zoom × 1/zoom = 1).
                  const hitR = Math.max(n.size + 6, 14);
                  const groupClass = [
                    styles.cityGroup,
                    always ? styles.alwaysLabel : "",
                    isSel ? styles.selected : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const side = labelSide.get(n.key) ?? "above";
                  const nameAbove = side === "above";
                  const nameY = nameAbove ? -(n.size + (isHome ? 22 : 9)) : n.size + 14;
                  const countY = nameAbove ? n.size + 12 : -(n.size + 7);
                  // Counter-scale composes with the outer zoom to give the
                  // city's content a constant screen size. The translate(n.x,
                  // n.y) inside the counter-scale puts the dot back at the
                  // city's world position; offsets inside this group are in
                  // pre-zoom (≈ screen-pixel) units.
                  return (
                    <g
                      key={n.key}
                      className={groupClass}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(isSel ? null : n.city.cityId);
                      }}
                      role="button"
                      aria-label={`${n.city.name}, ${meta.label} city`}
                      transform={`translate(${n.x} ${n.y}) scale(${labelMultiplier / zoom.scale})`}
                    >
                      {isSel && (
                        <>
                          {/* Shockwave ripple — driven by the `r` attribute in
                              the selection timeline, not transform scale, so the
                              counter-scale group can't fight it. */}
                          <circle
                            className={`realm-sel-ripple ${styles.selectedRipple}`}
                            cx={0}
                            cy={0}
                            r={2}
                          />
                          <circle
                            className={`realm-sel-ring ${styles.selectedOuter}`}
                            cx={0}
                            cy={0}
                            r={n.size + 9}
                          />
                          <circle
                            className={`realm-sel-ring ${styles.selectedInner}`}
                            cx={0}
                            cy={0}
                            r={n.size + 4}
                          />
                        </>
                      )}

                      {/* Recommended-city pulse — quieter than the selection
                          ring (no orange, slower beat) so it guides without
                          competing with the player's deliberate pick. Hidden
                          when isSel so the two cues don't stack. */}
                      {isRec && !isSel && (
                        <circle className={styles.recommendedPulse} cx={0} cy={0} r={n.size + 7} />
                      )}

                      <circle className={styles.cityRing} cx={0} cy={0} r={n.size + 2.5} />

                      {/* Transparent hit target — bigger than the dot so
                          touch users have a generous target. */}
                      <circle cx={0} cy={0} r={hitR} fill="transparent" />

                      <circle
                        className={`${styles.cityDot} ${isSel ? "realm-sel-dot" : ""}`}
                        cx={0}
                        cy={0}
                        r={n.size}
                      />

                      {/* City crest — the per-city heraldic sigil on a dark
                          medallion, shown when zoomed in (or for the selected
                          city). Rides the counter-scale so it holds a constant
                          screen size; the gold line-art reads against the ink
                          disc where it would wash out on bare parchment. The
                          type glyph below stays as a small corner pip. */}
                      {showSigil && (
                        <g style={{ pointerEvents: "none" }}>
                          <circle className={styles.sigilDisc} cx={0} cy={0} r={sigR} />
                          <image
                            href={citySigilSrc(n.city.cityId)}
                            x={-sigImg / 2}
                            y={-sigImg / 2}
                            width={sigImg}
                            height={sigImg}
                            preserveAspectRatio="xMidYMid meet"
                          />
                        </g>
                      )}

                      {/* City-type sigil — the real engraved map-* GameIcon
                          (CSS mask over currentColor, tinted to --ink), the same
                          asset the legend uses. Replaces the old Unicode glyph,
                          which was font/platform-dependent. foreignObject lets the
                          masked HTML icon live in the SVG and ride the counter-
                          scale with the rest of the marker. */}
                      <foreignObject
                        x={8 + n.size * 0.1}
                        y={-n.size * 0.9}
                        width={n.size * 1.8}
                        height={n.size * 1.8}
                        style={{ overflow: "visible", pointerEvents: "none" }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink)",
                          }}
                        >
                          <GameIcon
                            id={meta.icon}
                            title={`${meta.label} city`}
                            size={Math.round(n.size * 1.6)}
                          />
                        </div>
                      </foreignObject>

                      {isHome && !(travel && travel.fromCityId === homeCity) && (
                        <polygon
                          className={styles.homeFlag}
                          points={`${-1},${-n.size - 4} ${-1},${-n.size - 16} 7,${-n.size - 12} ${-1},${-n.size - 8}`}
                        />
                      )}

                      <text className={styles.cityName} x={0} y={nameY} fontSize={9.5}>
                        {n.city.name}
                      </text>
                      <text className={styles.cityCount} x={0} y={countY} fontSize={8}>
                        {n.city.playersPresent.toLocaleString()}
                      </text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>

          {!sheetOverride && (
            <>
              <div className={styles.compass} aria-hidden>
                <CompassRose />
              </div>

              <div className={styles.scale}>
                <span className={styles.scaleBar} /> 100 leagues
              </div>

              {zoom.scale > 1.001 && (
                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    zoom.reset();
                  }}
                  aria-label="Reset zoom"
                  title="Reset zoom (or double-tap)"
                >
                  ↻
                </button>
              )}
            </>
          )}
        </div>

        {/* Fullscreen overlay slot: a child of `.shell` (the `position:
         *  relative` block in fullscreen), painted UNDER the floating panel
         *  (z-20) and the mobile pill (z-25). The host anchors its content
         *  top-left so it clears the right-edge sub-tab nav. Gated on
         *  fullscreen so /world and /arrival's inline layout is untouched. */}
        {fullscreen && renderHud?.()}

        {/* Non-fullscreen: inline `.scroll` aside, same as the page's
         *  always-visible detail panel. Stacks below the sheet at narrow
         *  widths via the .shell grid rules. */}
        {!fullscreen && (
          <aside className={styles.scroll}>
            <div className={styles.scrollHead}>
              {scrollHead ?? (selected ? "the city" : "the chart")}
            </div>
            {renderPanelBody({
              selected,
              homeCity,
              renderSelected,
              renderDefault,
              typeCounts,
              kingdomName,
              theme,
              kingdomStart: toNum(eng?.kingdomStartTime),
            })}
          </aside>
        )}
        {/* Desktop fullscreen: floating card on the right edge of the
         *  disc. Mounts only when there's something to show; X close
         *  dismisses; next selection / action transition reopens. No
         *  slide animation — fades in/out only. */}
        {desktopPanelShown && (
          <aside ref={panelRef} id="realm-map-panel" className={`${styles.scroll} ${styles.panelFloating}`}>
            <button
              type="button"
              className={styles.panelClose}
              onClick={() => {
                // X deselects (entity / landing cell) via the parent's
                // onCloseRequest, then closes the panel. Crucially does
                // NOT clear the city selection — the disc stays mounted
                // so the player is still inside the city they were
                // looking at. Also resets any dragged offset, so the next
                // open starts back at the disc's top-right anchor.
                try {
                  localStorage.removeItem(PANEL_POS_KEY);
                } catch {
                  /* nothing to clear */
                }
                onCloseRequest?.();
                setPanelOpen(false);
              }}
              aria-label="Close details panel"
              title="Close"
            >
              <X className={styles.panelCloseIcon} aria-hidden />
            </button>
            <div ref={panelHandleRef} className={styles.scrollHead}>
              {scrollHead ?? (selected ? "the city" : "the chart")}
            </div>
            {renderPanelBody({
              selected,
              homeCity,
              renderSelected,
              renderDefault,
              typeCounts,
              kingdomName,
              theme,
              kingdomStart: toNum(eng?.kingdomStartTime),
            })}
          </aside>
        )}
        <div className={styles.readouts}>
          <span className={styles.readout}>
            Citizens <span className={styles.readoutVal}>{totalPlayers.toLocaleString()}</span>
          </span>
          <span className={styles.readout}>
            Houses{" "}
            <span className={styles.readoutVal}>{(teams?.length ?? 0).toLocaleString()}</span>
          </span>
          <span className={styles.readout}>
            Cities <span className={styles.readoutVal}>{nodes.length.toLocaleString()}</span>
          </span>
        </div>
      </div>

      <button
        type="button"
        className={styles.mobileStatusPill}
        onClick={() => setPanelOpen(true)}
        aria-label={selected ? `Show ${selected.city.name} details` : "Show realm details"}
      >
        <span className={styles.mobileStatusLabel}>
          {selected ? selected.city.name : kingdomName}
        </span>
        {!selected && (
          <span className={styles.mobileStatusMeta}>
            · {totalPlayers.toLocaleString()} citizens · {nodes.length} cities
          </span>
        )}
      </button>
      <BottomSheet
        open={mobileSheetOpen}
        onClose={() => setPanelOpen(false)}
        title={scrollHead ?? (selected ? "the city" : "the chart")}
      >
        {renderPanelBody({
          selected,
          homeCity,
          renderSelected,
          renderDefault,
          typeCounts,
          kingdomName,
          theme,
          kingdomStart: toNum(eng?.kingdomStartTime),
        })}
      </BottomSheet>
    </div>
  );
}

interface PanelBodyArgs {
  selected: RealmCityNode | null;
  homeCity: number | undefined;
  renderSelected?: (ctx: RealmMapSelectedContext) => ReactNode;
  renderDefault?: (ctx: RealmMapDefaultContext) => ReactNode;
  typeCounts: number[];
  kingdomName: string;
  theme: string;
  kingdomStart: number;
}

function renderPanelBody({
  selected,
  homeCity,
  renderSelected,
  renderDefault,
  typeCounts,
  kingdomName,
  theme,
  kingdomStart,
}: PanelBodyArgs): ReactNode {
  if (selected) {
    const ctx: RealmMapSelectedContext = {
      node: selected,
      isHome: selected.city.cityId === homeCity,
    };
    return renderSelected ? renderSelected(ctx) : <DefaultSelectedPanel {...ctx} />;
  }
  const ctx: RealmMapDefaultContext = {
    typeCounts,
    kingdom: kingdomName,
    theme,
    start: kingdomStart,
  };
  return renderDefault ? renderDefault(ctx) : <DefaultRealmPanel {...ctx} />;
}

export function DefaultSelectedPanel({ node, isHome }: RealmMapSelectedContext) {
  const c = node.city;
  const meta = TYPE_META[typeIdx(c.cityType)];
  const lore = getCityLore(c.cityId);
  return (
    <>
      <CityCrest cityId={c.cityId} name={c.name} />
      <span className={`${styles.detailType} ${isHome ? styles.home : ""}`}>
        <GameIcon id={meta.icon} title={meta.label} size={15} />
        {meta.label}
        {isHome ? " — your seat" : ""}
      </span>

      {lore && <p className={styles.hint}>{lore.lore}</p>}

      <dl className={styles.lineMeta}>
        {lore && (
          <>
            <dt>Region</dt>
            <dd>{lore.region}</dd>
          </>
        )}
        <dt>People present</dt>
        <dd className={styles.numeral}>{c.playersPresent.toLocaleString()}</dd>
        <dt>Wilds about it</dt>
        <dd className={styles.numeral}>
          lv {c.minEncounterLevel}–{c.maxEncounterLevel}
        </dd>
      </dl>

      <Link href={`/cities/${c.cityId}`} className={styles.seal}>
        <span>Walk its gates</span>
        <span>
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </>
  );
}

export function DefaultRealmPanel({ typeCounts, kingdom, theme, start }: RealmMapDefaultContext) {
  const started =
    start > 0
      ? new Date(start * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "—";
  return (
    <>
      {TYPE_META.map((m, i) => (
        <div className={styles.legendRow} key={m.label}>
          <GameIcon id={m.icon} title={m.label} size={16} />
          <span>{m.label}</span>
          <span className={styles.legendCount}>{typeCounts[i]}</span>
        </div>
      ))}

      <dl className={styles.metaTable}>
        <dt>Realm</dt>
        <dd>{kingdom}</dd>
        <dt>Hand</dt>
        <dd>{theme}</dd>
        <dt>First marked</dt>
        <dd>{started}</dd>
      </dl>

      <p className={styles.hint}>
        Touch a city to learn its name and its wilds. The larger the ink, the more players
        walk within; the charted world widens as new cities are discovered.
      </p>
    </>
  );
}

function CompassRose() {
  return (
    <svg viewBox="0 0 100 100">
      <circle
        cx="50"
        cy="50"
        r="38"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        opacity="0.55"
      />
      <circle
        cx="50"
        cy="50"
        r="32"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.35"
        opacity="0.35"
      />

      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * Math.PI) / 4;
        const x1 = 50 + Math.cos(a) * 32;
        const y1 = 50 + Math.sin(a) * 32;
        const x2 = 50 + Math.cos(a) * 38;
        const y2 = 50 + Math.sin(a) * 38;
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth="0.6"
            opacity="0.55"
          />
        );
      })}

      <path d="M50 14 L54 50 L50 86 L46 50 Z" fill="currentColor" opacity="0.85" />
      <path d="M14 50 L50 46 L86 50 L50 54 Z" fill="currentColor" opacity="0.55" />
      <circle cx="50" cy="50" r="2.2" fill="currentColor" opacity="0.9" />

      <text
        x="50"
        y="11"
        textAnchor="middle"
        fontSize="10"
        fontFamily="var(--font-cinzel), serif"
        fontWeight="700"
        fill="currentColor"
        opacity="0.85"
      >
        N
      </text>
    </svg>
  );
}

/** Four small ink flourishes for the sheet corners. */
function CornerOrnaments() {
  const ornament = (
    <svg viewBox="0 0 32 32">
      <path
        d="M2 2 L14 2 L14 4 L4 4 L4 14 L2 14 Z M6 6 L10 6 L10 7 L7 7 L7 10 L6 10 Z M14 12 C 18 12 18 18 22 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="3.2" cy="3.2" r="1.1" fill="currentColor" opacity="0.7" />
    </svg>
  );
  return (
    <>
      <div className={`${styles.ornament} ${styles.tl}`}>{ornament}</div>
      <div className={`${styles.ornament} ${styles.tr}`}>{ornament}</div>
      <div className={`${styles.ornament} ${styles.bl}`}>{ornament}</div>
      <div className={`${styles.ornament} ${styles.br}`}>{ornament}</div>
    </>
  );
}
