/**
 * Shared marker-overlay vocabulary: palette colours, parsing helpers,
 * capacity constants, and small geometry knobs.
 *
 * Every sub-layer imports from here so the antique-cartographer palette
 * stays in one file. Anything keyed by enum (CastleStatus pip, Tier
 * tower count) lives here too.
 *
 * The Canvas2D fallback (`CityTerrainMap2DFallback.tsx`) carries the
 * same constants in its own file — when tuning a colour, update both
 * to keep the two paths visually identical.
 */
import * as THREE from "three";
import { srgbToLinear } from "../coords";

/* Antique-palette sRGB tuples. Wrapped in `linearColor` below because
 * three.js colour attributes are interpreted as linear by default. */
export const PLAYER_FILL_SRGB = [160, 100, 45] as const;
export const MY_PLAYER_FILL_SRGB = [20, 14, 8] as const;
export const WILD_FILL_SRGB = [115, 55, 30] as const;
/* Cold-stone slate — castle plate. Distinct cool fourth shade in an
 * otherwise antique-tobacco occupant palette. */
export const CASTLE_FILL_SRGB = [95, 105, 120] as const;
/* Tower glyphs sit on top of the slate plate — darkest ink so they
 * read strongly against the cool slate. */
export const CASTLE_TOWER_SRGB = [46, 31, 16] as const;
export const CREAM_STROKE_SRGB = [252, 244, 220] as const;
export const SELECTED_STROKE_SRGB = [220, 175, 60] as const;
export const SEAL_ORANGE_SRGB = [180, 83, 9] as const;
export const CENTRE_INK_SRGB = [70, 50, 28] as const;
export const BOUNDARY_INK_SRGB = [46, 31, 16] as const;

/* Status pip palette — matches `CastleStatus` enum:
 *   0 Vacant       — cream (claimable, neutral, blends into the ring)
 *   1 Contest      — seal-orange (active conflict)
 *   2 Protected    — verdigris  (held + safe)
 *   3 Vulnerable   — amber       (held + unprotected)
 *   4 Transitioning — slate-blue (mid-handover) */
export const STATUS_CONTEST_SRGB = [200, 80, 30] as const;
export const STATUS_PROTECTED_SRGB = [80, 130, 70] as const;
export const STATUS_VULNERABLE_SRGB = [200, 150, 50] as const;
export const STATUS_TRANSITIONING_SRGB = [80, 100, 160] as const;

export function linearColor(rgb: readonly [number, number, number]): THREE.Color {
  const c = new THREE.Color();
  c.setRGB(srgbToLinear(rgb[0] / 255), srgbToLinear(rgb[1] / 255), srgbToLinear(rgb[2] / 255));
  return c;
}

/* Pre-built linear THREE.Color instances. Importers pass these by
 * reference into InstancedMesh.setColorAt — never mutate. */
export const COLOR_PLAYER = linearColor(PLAYER_FILL_SRGB);
export const COLOR_MY_PLAYER = linearColor(MY_PLAYER_FILL_SRGB);
export const COLOR_WILD = linearColor(WILD_FILL_SRGB);
export const COLOR_CASTLE = linearColor(CASTLE_FILL_SRGB);
export const COLOR_CASTLE_TOWER = linearColor(CASTLE_TOWER_SRGB);
export const COLOR_CREAM = linearColor(CREAM_STROKE_SRGB);
export const COLOR_SELECTED = linearColor(SELECTED_STROKE_SRGB);
export const COLOR_SEAL = linearColor(SEAL_ORANGE_SRGB);
export const COLOR_CENTRE = linearColor(CENTRE_INK_SRGB);
export const COLOR_BOUNDARY = linearColor(BOUNDARY_INK_SRGB);
export const COLOR_STATUS_CONTEST = linearColor(STATUS_CONTEST_SRGB);
export const COLOR_STATUS_PROTECTED = linearColor(STATUS_PROTECTED_SRGB);
export const COLOR_STATUS_VULNERABLE = linearColor(STATUS_VULNERABLE_SRGB);
export const COLOR_STATUS_TRANSITIONING = linearColor(STATUS_TRANSITIONING_SRGB);

/* Parse a `#rgb` / `#rrggbb` sRGB hex string into a linear THREE.Color.
 * Returns null on malformed input so the caller can fall through to
 * the default fill rather than rendering a black pixel.
 *
 * Cached by trimmed hex: `updateOccupants` runs per animation frame
 * and a busy city can call this hundreds of times per paint. The
 * cosmetic catalog has dozens of distinct hexes (not unbounded) so a
 * Map<hex, Color> turns the hot path into a single lookup after the
 * first paint. Malformed inputs are not cached so a typo doesn't
 * poison the cache. */
const _hexColorCache = new Map<string, THREE.Color>();
export function parseHexLinear(hex: string): THREE.Color | null {
  const trimmed = hex.trim();
  const cached = _hexColorCache.get(trimmed);
  if (cached) return cached;
  let h = trimmed;
  if (h.startsWith("#")) h = h.slice(1);
  // Expand `#rgb` shorthand.
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const color = linearColor([r, g, b]);
  _hexColorCache.set(trimmed, color);
  return color;
}

/* Per-layer InstancedMesh capacities. Sized for a busy event city:
 * ~2k players + ~500 encounters at a major gathering still fits in
 * OCCUPANTS. Castles cap at 64 — kingdom holds ~50 castles total and
 * a single city view shows only its own. */
export const MAX_OCCUPANTS = 4096;
export const MAX_OTHER_WALKS = 256;
export const MAX_CASTLES = 64;
/* Up to 5 towers per castle (Citadel = 4 corners + central keep). */
export const MAX_CASTLE_TOWERS = MAX_CASTLES * 5;
export const MAX_CASTLE_PIPS = MAX_CASTLES;

/* Lift overlay LINES (walk lines, etc.) by this Y offset to dodge
 * z-fighting with the terrain plate at Y=0. polygonOffset on the
 * terrain protects coplanar triangle overlays but doesn't apply to
 * Line primitives. */
export const WALK_LINE_LIFT = 5e-4;

/* Y bias for marker overlays. Pre-flat-strategy this lifted markers
 * above uneven terrain; post-flat the terrain mesh is a single quad
 * at Y=0 with polygonOffset so overlays can sit at Y=0 directly. */
export const OVERLAY_Y_BIAS = 0;

/* One-shot warn flag — capacity overflow drops instances silently
 * into TypedArray no-op territory, but the InstancedMesh.count still
 * bumps so ghost identity-matrix instances render at world origin.
 * Surface once per session during testing. */
let _occupancyOverflowWarned = false;
export function warnOnce(message: string): void {
  if (_occupancyOverflowWarned) return;
  _occupancyOverflowWarned = true;
  console.warn(message);
}
