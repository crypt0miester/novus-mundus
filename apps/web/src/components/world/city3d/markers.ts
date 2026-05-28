/**
 * All overlay layers on top of the heightmap mesh.
 *
 * Mirrors the Canvas2D fallback's overlay vocabulary 1:1 (same
 * palette, same dual mode at the same `cssPxPerCell` threshold, same
 * walk-line tiers) but with three.js primitives — `InstancedMesh`
 * per occupant layer, `LineSegments`/`LineLoop` for boundary and
 * grid, `LineDashedMaterial` for the inscribed disc and walks.
 *
 * Layer count is up front, then `count` is set per layer per update
 * — no allocation in the hot path. Z-stack is enforced via
 * `renderOrder` on each layer (the terrain mesh has polygon offset
 * pushing it slightly behind these layers so co-planar overlays
 * don't z-fight).
 */

import * as THREE from "three";
import { OCCUPANT_PLAYER, OCCUPANT_ENCOUNTER, OCCUPANT_CASTLE } from "novus-mundus-sdk";

// CityTerrain retired under flat strategy. Markers no longer carry a
// terrain handle; the type alias below keeps the previous public
// `cfg.terrain` / `setTerrain` surface but the value is unused.
type CityTerrain = unknown;
import {
  GRID_OVERLAY_MIN_CSS_PX_PER_CELL,
  MESH_SIZE,
  getElevationAt,
  gridToWorld,
  midpointElevation,
  srgbToLinear,
} from "./coords";

/* Antique-palette colors — must match the Canvas2D fallback exactly
 * (mention by hex anywhere here drifts the two paths). The `0x...`
 * forms are the sRGB hex; we wrap them in srgb-linear via
 * `linearColor` because three.js color attributes are linear by
 * default. */
const PLAYER_FILL_SRGB = [160, 100, 45] as const;
const MY_PLAYER_FILL_SRGB = [20, 14, 8] as const;
const WILD_FILL_SRGB = [115, 55, 30] as const;
/* Cold-stone slate — mirrors the 2D fallback's `CASTLE_FILL` so the
 * antique-tobacco occupant palette has a distinct cool fourth shade
 * for territorial holdings. */
const CASTLE_FILL_SRGB = [95, 105, 120] as const;
/* Tower glyphs sit on top of the slate plate — use the darkest ink in
 * the palette so they read strongly against the cool slate. */
const CASTLE_TOWER_SRGB = [46, 31, 16] as const;
const CREAM_STROKE_SRGB = [252, 244, 220] as const;
const SELECTED_STROKE_SRGB = [220, 175, 60] as const;
const SEAL_ORANGE_SRGB = [180, 83, 9] as const;
const CENTRE_INK_SRGB = [70, 50, 28] as const;
const BOUNDARY_INK_SRGB = [46, 31, 16] as const;
/* Status pip palette — matches `CastleStatus` enum:
 *   0 Vacant       — cream      (claimable, neutral)
 *   1 Contest      — seal-orange (active conflict)
 *   2 Protected    — verdigris   (held + safe)
 *   3 Vulnerable   — amber       (held + unprotected)
 *   4 Transitioning — slate-blue (mid-handover)
 * Vacant reuses CREAM so the pip blends into the ring — a vacant
 * castle has no urgent state to signal, and the cream tower visible
 * IN it already conveys "unclaimed". */
const STATUS_CONTEST_SRGB = [200, 80, 30] as const;
const STATUS_PROTECTED_SRGB = [80, 130, 70] as const;
const STATUS_VULNERABLE_SRGB = [200, 150, 50] as const;
const STATUS_TRANSITIONING_SRGB = [80, 100, 160] as const;

const WALK_LINE_LIFT = 5e-4;

function linearColor(rgb: readonly [number, number, number]): THREE.Color {
  const c = new THREE.Color();
  c.setRGB(
    srgbToLinear(rgb[0] / 255),
    srgbToLinear(rgb[1] / 255),
    srgbToLinear(rgb[2] / 255),
  );
  return c;
}

/* Parse a `#rgb` / `#rrggbb` sRGB hex string into a linear THREE.Color,
 * matching `linearColor` above. Returns null on a malformed input so the
 * caller can fall through to the default fill rather than render a
 * black pixel. The cosmetic-color catalog stores hex strings, so the
 * occupant cells passed into `updateOccupants` carry hex; this turns
 * each one into a per-instance fill colour. */
function parseHexLinear(hex: string): THREE.Color | null {
  let h = hex.trim();
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
  return linearColor([r, g, b]);
}

const COLOR_PLAYER = linearColor(PLAYER_FILL_SRGB);
const COLOR_MY_PLAYER = linearColor(MY_PLAYER_FILL_SRGB);
const COLOR_WILD = linearColor(WILD_FILL_SRGB);
const COLOR_CASTLE = linearColor(CASTLE_FILL_SRGB);
const COLOR_CASTLE_TOWER = linearColor(CASTLE_TOWER_SRGB);
const COLOR_CREAM = linearColor(CREAM_STROKE_SRGB);
const COLOR_SELECTED = linearColor(SELECTED_STROKE_SRGB);
const COLOR_SEAL = linearColor(SEAL_ORANGE_SRGB);
const COLOR_CENTRE = linearColor(CENTRE_INK_SRGB);
const COLOR_BOUNDARY = linearColor(BOUNDARY_INK_SRGB);
const COLOR_STATUS_CONTEST = linearColor(STATUS_CONTEST_SRGB);
const COLOR_STATUS_PROTECTED = linearColor(STATUS_PROTECTED_SRGB);
const COLOR_STATUS_VULNERABLE = linearColor(STATUS_VULNERABLE_SRGB);
const COLOR_STATUS_TRANSITIONING = linearColor(STATUS_TRANSITIONING_SRGB);

/* Tower-placement table — per `CastleTier`, returns positions (in grid
 * cells offset from the castle's geometric center, can be fractional)
 * plus each tower's scale as a fraction of the PLATE side length
 * (n × cellWorld). Scaling by plate side keeps towers proportionate
 * regardless of N×N footprint. The corner offset is the centre of a
 * corner cell pulled in 15% so towers sit visibly inside the cream
 * ring rather than overlapping it.
 *
 * Tier ladder:
 *   Outpost  (0) — single small tower (lookout)
 *   Keep     (1) — single larger tower (a proper keep)
 *   Stronghold (2) — keep + 2 flanking towers across an axis
 *   Fortress (3) — 4 corner towers (curtain-wall fortress)
 *   Citadel  (4) — 4 corner towers + central keep
 *
 * For N=1 footprints the corner positions collapse onto the centre,
 * so we always emit only the central tower regardless of tier — at
 * one-cell resolution the tier reads from the pip + ring color, not
 * from tower count. */
interface TowerSpec {
  ox: number;
  oy: number;
  scaleFrac: number;
}
function getCastleTowerPositions(tier: number, n: number): TowerSpec[] {
  if (n <= 1) {
    return [{ ox: 0, oy: 0, scaleFrac: 0.30 }];
  }
  const cornerOffset = (n / 2 - 0.5) * 0.85;
  switch (tier) {
    case 0:
      return [{ ox: 0, oy: 0, scaleFrac: 0.16 }];
    case 1:
      return [{ ox: 0, oy: 0, scaleFrac: 0.26 }];
    case 2:
      return [
        { ox: 0, oy: 0, scaleFrac: 0.22 },
        { ox: -cornerOffset, oy: 0, scaleFrac: 0.14 },
        { ox: cornerOffset, oy: 0, scaleFrac: 0.14 },
      ];
    case 3:
      return [
        { ox: -cornerOffset, oy: -cornerOffset, scaleFrac: 0.14 },
        { ox: cornerOffset, oy: -cornerOffset, scaleFrac: 0.14 },
        { ox: -cornerOffset, oy: cornerOffset, scaleFrac: 0.14 },
        { ox: cornerOffset, oy: cornerOffset, scaleFrac: 0.14 },
      ];
    case 4:
      return [
        { ox: -cornerOffset, oy: -cornerOffset, scaleFrac: 0.14 },
        { ox: cornerOffset, oy: -cornerOffset, scaleFrac: 0.14 },
        { ox: -cornerOffset, oy: cornerOffset, scaleFrac: 0.14 },
        { ox: cornerOffset, oy: cornerOffset, scaleFrac: 0.14 },
        { ox: 0, oy: 0, scaleFrac: 0.22 },
      ];
    default:
      return [{ ox: 0, oy: 0, scaleFrac: 0.20 }];
  }
}

/* Map `CastleStatus` to a THREE.Color for the corner pip. Vacant
 * returns null — the renderer hides the pip in that case so the
 * castle reads "no holding faction, no urgent state". */
function colorForCastleStatus(status: number | undefined): THREE.Color | null {
  switch (status) {
    case 1:
      return COLOR_STATUS_CONTEST;
    case 2:
      return COLOR_STATUS_PROTECTED;
    case 3:
      return COLOR_STATUS_VULNERABLE;
    case 4:
      return COLOR_STATUS_TRANSITIONING;
    default:
      return null;
  }
}

/* Per-layer InstancedMesh capacity. Sized for a busy event city:
 * ~2k players + ~500 encounters at a major gathering still fits. Each
 * InstancedMesh buffer is `count × (16 floats matrix + 3 floats colour) ≈
 * 76 bytes/instance`, so 4096 ≈ 300 KB GPU memory per layer — eight
 * layers ≈ 2.4 MB total, comfortable on every browser+device. */
const MAX_OCCUPANTS = 4096;
const MAX_OTHER_WALKS = 256;

/* One-shot warn flag — if the occupant stream ever exceeds capacity,
 * we log once per session so the silent-drop footgun is visible during
 * testing without spamming the console on every paint. */
let _occupancyOverflowWarned = false;

/* Y bias for overlays. Pre-flat-strategy, this lifted markers above
 * uneven terrain so they didn't clip into peaks. Post-flat-strategy
 * the terrain mesh is a single flat quad at Y=0 with `polygonOffset`
 * set on its material — overlays can sit directly on the plate at
 * Y=0 and rely on polygon offset + renderOrder for z-fighting
 * prevention. Even at the previous MAX_HEIGHT*0.005=0.0024 value the
 * lift was visibly elevating dots/tiles/rings off the grid in iso
 * mode (camera looking down at 35° elevation), so collapse it to 0. */
const OVERLAY_Y_BIAS = 0;

export interface OccupiedCell {
  gridLat: number;
  gridLong: number;
  occupantType: number;
  occupant: string;
  /* Cosmetic name colour (sRGB hex like "#b45309"). When set, the
   * occupant's fill instance-colour adopts this — paid identity reads
   * across the disc, not just in the EntityPanel. */
  nameColorHex?: string;
  /* Catalog-keyed colour animation. Renderers re-set the instance
   * colour per frame against this; static when undefined. Defer
   * implementing the per-frame tick until the base static-colour
   * path is shipped. */
  nameColorAnim?: string;
  /* Castle footprint anchor flag — only the (dlat=0, dlong=0) cell of
   * an N×N castle has this set so the renderer paints ONE plate per
   * castle instead of N² duplicates. */
  footprintSize?: number;
  footprintAnchor?: boolean;
  /* Castle tier (CastleTier enum, 0..4) drives tower-glyph layout.
   * Castle status (CastleStatus enum, 0..4) drives the corner pip
   * color. Both only set on OCCUPANT_CASTLE anchor cells. */
  castleTier?: number;
  castleStatus?: number;
}

export interface SelectedEntity {
  pubkey: string;
  occupantType: number;
  gridLat: number;
  gridLong: number;
}

export interface WalkLine {
  fromGridLat: number;
  fromGridLong: number;
  toGridLat: number;
  toGridLong: number;
  pct: number;
  /* Cosmetic name colour tints the line stroke and moving marker so
   * the walker's identity follows them across the disc. */
  nameColorHex?: string;
  nameColorAnim?: string;
  /* Equipped frame ring colour — wraps the moving marker. */
  frameBorderColor?: string;
}

export interface MarkersConfig {
  scene: THREE.Scene;
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
  terrain: CityTerrain;
}

export class MarkersLayer {
  private rgu: number;
  private cityLatGrid: number;
  private cityLongGrid: number;
  private terrain: CityTerrain;

  private group: THREE.Group;
  private centreGroup: THREE.Group;

  /* Static layers */
  private boundarySquare: THREE.LineSegments;
  private gridLines: THREE.LineSegments | null = null;
  private gridStride = 0;

  /* Latest cssPxPerCell — kept up to date by updateOccupants so the
   * walk-line + landing-ring sizers (which don't get cssPxPerCell
   * directly) can compute screen-relative sizes. */
  private currentCssPxPerCell = 1;

  /* Parallel arrays mapping each instance index to its source cell
   * for the four interactive layers. The raycaster reports
   * instanceId on InstancedMesh hits; we look the cell up here so
   * the click handler can resolve an exact occupant without
   * relying on grid-coord round-trips through the terrain. */
  private playerDotInstanceCells: OccupiedCell[] = [];
  private playerTileInstanceCells: OccupiedCell[] = [];
  private encounterDotInstanceCells: OccupiedCell[] = [];
  private encounterTileInstanceCells: OccupiedCell[] = [];
  private castleInstanceCells: OccupiedCell[] = [];

  /* Occupant fills + outlines (dual-mode). */
  private playerDots: THREE.InstancedMesh;
  private playerDotRings: THREE.InstancedMesh;
  private playerTiles: THREE.InstancedMesh;
  private playerTileRings: THREE.InstancedMesh;
  private encounterDots: THREE.InstancedMesh;
  private encounterDotRings: THREE.InstancedMesh;
  private encounterTiles: THREE.InstancedMesh;
  private encounterTileRings: THREE.InstancedMesh;
  /* Castle plates — single layer (no dual-mode dot/tile because a
   * castle's identity is the FOOTPRINT, which only reads as such when
   * sized to N×N cells). Always rendered as a filled plate spanning
   * the castle's N×N grid range. Ring uses the same outline material
   * as players/encounters for the selected stroke. */
  private castles: THREE.InstancedMesh;
  private castleRings: THREE.InstancedMesh;
  /* Castle tower glyphs — small dark-ink disks placed inside the slate
   * plate. Position + scale + count vary by tier (Outpost = 1 small,
   * Citadel = 4 corners + keep). Capacity = MAX_CASTLES * 5 since
   * Citadel is the densest tier. */
  private castleTowers: THREE.InstancedMesh;
  /* Castle status pip — one colored disk per castle at the plate's
   * top-right corner. Hidden for vacant castles. */
  private castleStatusPips: THREE.InstancedMesh;

  /* Selection rings — one mesh each, position-snapped on update. */
  private selectedEntityRing: THREE.Mesh;
  private selectedLandingRing: THREE.Mesh;
  private selectedLandingCross: THREE.LineSegments;

  /* Walk lines — pre-allocated pool. count adjusts per update. */
  private ownWalkLine: THREE.Line;
  private ownWalkMarker: THREE.Mesh;
  private ownWalkHalo: THREE.Mesh;
  private otherWalksPool: Array<{
    line: THREE.Line;
    marker: THREE.Mesh;
  }>;
  private otherWalksActiveCount = 0;

  private disposed = false;

  constructor(cfg: MarkersConfig) {
    this.rgu = cfg.rgu;
    this.cityLatGrid = cfg.cityLatGrid;
    this.cityLongGrid = cfg.cityLongGrid;
    this.terrain = cfg.terrain;

    this.group = new THREE.Group();
    this.group.name = "city-markers";
    cfg.scene.add(this.group);

    this.boundarySquare = this.buildBoundarySquare();
    this.boundarySquare.renderOrder = 1;
    this.group.add(this.boundarySquare);

    /* Centre cartographer star removed — didn't carry any
     * functional weight (the city's name + boundary square already
     * convey "this is a city"), and it competed visually with
     * occupants when they happened to sit near the centre cell. */
    this.centreGroup = new THREE.Group();
    this.group.add(this.centreGroup);

    /* Occupant layers — dot-mode and tile-mode pre-allocated. Both
     * exist for the lifetime of the scene; visibility toggles based
     * on cssPxPerCell threshold each update.
     *
     * Outline ring runs from 1.0 -> 1.45 so it visibly haloes the
     * fill rather than just hinting. That contrast vs the surrounding
     * antique-palette terrain is what makes occupants readable at
     * default zoom. */
    const dotGeom = new THREE.CircleGeometry(1, 24);
    dotGeom.rotateX(-Math.PI / 2);
    const ringGeom = new THREE.RingGeometry(1, 1.45, 24);
    ringGeom.rotateX(-Math.PI / 2);

    /* Encounter shape: axis-aligned SQUARE (not a diamond / rotated
     * square). The grid is axis-aligned, so an axis-aligned square
     * reads as "this cell". Circle = player, square = encounter:
     * shape alone distinguishes occupant type at any zoom. Square
     * has vertices at (±1, 0, ±1) — when instance-scaled by dotR,
     * the square's half-extent is dotR in each direction. */
    const diamondGeom = new THREE.BufferGeometry();
    const dVerts = new Float32Array([
      -1, 0, -1,
      1, 0, -1,
      1, 0, 1,
      -1, 0, 1,
    ]);
    diamondGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(dVerts, 3),
    );
    /* Two triangles forming the square. Counter-clockwise when
     * viewed from +Y so the face normals are +Y (up). Vertices,
     * looking from above: 0=back-left, 1=back-right, 2=front-right,
     * 3=front-left. CCW traversal from above is 0→3→2→1, so
     * triangles (0,3,2) and (0,2,1). */
    diamondGeom.setIndex([0, 3, 2, 0, 2, 1]);
    diamondGeom.computeVertexNormals();
    diamondGeom.computeBoundingSphere();

    /* Encounter outline: SQUARE frame to match the fill shape. Built
     * from a Shape with a hole (same vocabulary as the landing
     * selection frame) so the outline has visible thickness. Outer
     * ±1 matches the fill, inner ±0.72 gives a ~28% stroke width. */
    const encOutlineShape = new THREE.Shape();
    encOutlineShape.moveTo(-1, -1);
    encOutlineShape.lineTo(1, -1);
    encOutlineShape.lineTo(1, 1);
    encOutlineShape.lineTo(-1, 1);
    encOutlineShape.closePath();
    const encOutlineHole = new THREE.Path();
    encOutlineHole.moveTo(-0.72, -0.72);
    encOutlineHole.lineTo(0.72, -0.72);
    encOutlineHole.lineTo(0.72, 0.72);
    encOutlineHole.lineTo(-0.72, 0.72);
    encOutlineHole.closePath();
    encOutlineShape.holes.push(encOutlineHole);
    const diamondRingGeom = new THREE.ShapeGeometry(encOutlineShape);
    diamondRingGeom.rotateX(-Math.PI / 2);

    const tileGeom = new THREE.PlaneGeometry(1, 1);
    tileGeom.rotateX(-Math.PI / 2);

    /* Tile-mode outline: SQUARE frame matching the tile fill (which
     * is already a PlaneGeometry square). Built from a Shape with a
     * hole — outer ±0.5 wraps the PlaneGeometry's ±0.5 corners,
     * inner ±0.37 gives ~26% stroke width. The previous
     * RingGeometry(0.55, 0.6) was a CIRCLE ring inside the tile,
     * which read as "a circle in a square" rather than a tile
     * outline. */
    const tileFrameShape = new THREE.Shape();
    tileFrameShape.moveTo(-0.5, -0.5);
    tileFrameShape.lineTo(0.5, -0.5);
    tileFrameShape.lineTo(0.5, 0.5);
    tileFrameShape.lineTo(-0.5, 0.5);
    tileFrameShape.closePath();
    const tileFrameHole = new THREE.Path();
    tileFrameHole.moveTo(-0.37, -0.37);
    tileFrameHole.lineTo(0.37, -0.37);
    tileFrameHole.lineTo(0.37, 0.37);
    tileFrameHole.lineTo(-0.37, 0.37);
    tileFrameHole.closePath();
    tileFrameShape.holes.push(tileFrameHole);
    const tileFrameGeom = new THREE.ShapeGeometry(tileFrameShape);
    tileFrameGeom.rotateX(-Math.PI / 2);

    /* DoubleSide so we don't lose dots to back-face culling when
     * the camera angle brings a marker's projected normal off-axis
     * — particularly the diamond shape (encounters) whose
     * triangulation winding isn't guaranteed by ShapeGeometry. */
    const fillMat = new THREE.MeshBasicMaterial({
      transparent: false,
      side: THREE.DoubleSide,
    });
    /* polygonOffset nudges the ring's depth slightly toward the
     * camera so it always wins the depth comparison against the
     * coplanar fill underneath. Without this, the ring and fill
     * sit at exactly the same world Y after the OVERLAY_Y_BIAS=0
     * change, and the GPU's per-fragment depth resolve flickers
     * between them as the camera moves — visible as a jittery
     * fringe around tile-mode occupants. Negative units = toward
     * the camera. -1 is the standard "win the tie" magnitude
     * (smaller values still z-fight at oblique angles). */
    const ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.playerDots = new THREE.InstancedMesh(
      dotGeom,
      fillMat.clone(),
      MAX_OCCUPANTS,
    );
    this.playerDots.count = 0;
    this.playerDots.frustumCulled = false;
    this.playerDots.renderOrder = 3.2;
    this.group.add(this.playerDots);

    this.playerDotRings = new THREE.InstancedMesh(
      ringGeom,
      ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.playerDotRings.count = 0;
    this.playerDotRings.frustumCulled = false;
    this.playerDotRings.renderOrder = 3.1;
    this.group.add(this.playerDotRings);

    this.playerTiles = new THREE.InstancedMesh(
      tileGeom,
      fillMat.clone(),
      MAX_OCCUPANTS,
    );
    this.playerTiles.count = 0;
    this.playerTiles.frustumCulled = false;
    this.playerTiles.renderOrder = 3.2;
    this.group.add(this.playerTiles);

    this.playerTileRings = new THREE.InstancedMesh(
      tileFrameGeom,
      ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.playerTileRings.count = 0;
    this.playerTileRings.frustumCulled = false;
    this.playerTileRings.renderOrder = 3.1;
    this.group.add(this.playerTileRings);

    this.encounterDots = new THREE.InstancedMesh(
      diamondGeom,
      fillMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterDots.count = 0;
    this.encounterDots.frustumCulled = false;
    this.encounterDots.renderOrder = 3.2;
    this.group.add(this.encounterDots);

    this.encounterDotRings = new THREE.InstancedMesh(
      diamondRingGeom,
      ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterDotRings.count = 0;
    this.encounterDotRings.frustumCulled = false;
    this.encounterDotRings.renderOrder = 3.1;
    this.group.add(this.encounterDotRings);

    this.encounterTiles = new THREE.InstancedMesh(
      tileGeom.clone(),
      fillMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterTiles.count = 0;
    this.encounterTiles.frustumCulled = false;
    this.encounterTiles.renderOrder = 3.2;
    this.group.add(this.encounterTiles);

    this.encounterTileRings = new THREE.InstancedMesh(
      tileFrameGeom.clone(),
      ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterTileRings.count = 0;
    this.encounterTileRings.frustumCulled = false;
    this.encounterTileRings.renderOrder = 3.1;
    this.group.add(this.encounterTileRings);

    /* Castle plates — capacity 64 is generous. A kingdom maxes ~50
     * castles total across all cities, and a single city's view shows
     * only its own castles. RenderOrder 3.0 puts them BENEATH player
     * + encounter dots so a player standing on a castle cell is still
     * visible. */
    const MAX_CASTLES = 64;
    this.castles = new THREE.InstancedMesh(
      tileGeom.clone(),
      fillMat.clone(),
      MAX_CASTLES,
    );
    this.castles.count = 0;
    this.castles.frustumCulled = false;
    this.castles.renderOrder = 3.0;
    this.group.add(this.castles);

    this.castleRings = new THREE.InstancedMesh(
      tileFrameGeom.clone(),
      ringMat.clone(),
      MAX_CASTLES,
    );
    this.castleRings.count = 0;
    this.castleRings.frustumCulled = false;
    this.castleRings.renderOrder = 2.9;
    this.group.add(this.castleRings);

    /* Castle towers — small filled circles. RenderOrder sits between
     * the plate (3.0) and player dots (3.2) so towers paint on top of
     * the slate but a player standing on a castle still reads over
     * the tower. Up to 5 towers per castle (Citadel tier). */
    const MAX_TOWERS = MAX_CASTLES * 5;
    this.castleTowers = new THREE.InstancedMesh(
      dotGeom.clone(),
      fillMat.clone(),
      MAX_TOWERS,
    );
    this.castleTowers.count = 0;
    this.castleTowers.frustumCulled = false;
    this.castleTowers.renderOrder = 3.05;
    this.group.add(this.castleTowers);

    /* Status pip — single coloured disk per castle. RenderOrder above
     * the tower layer so the pip is always visible at the plate
     * corner regardless of which tower happens to sit nearest. */
    this.castleStatusPips = new THREE.InstancedMesh(
      dotGeom.clone(),
      fillMat.clone(),
      MAX_CASTLES,
    );
    this.castleStatusPips.count = 0;
    this.castleStatusPips.frustumCulled = false;
    this.castleStatusPips.renderOrder = 3.07;
    this.group.add(this.castleStatusPips);

    /* Selection ring + landing cross — singletons. Initially hidden,
     * shown when state demands. */
    const selRingGeom = new THREE.RingGeometry(1, 1.2, 32);
    selRingGeom.rotateX(-Math.PI / 2);
    this.selectedEntityRing = new THREE.Mesh(
      selRingGeom,
      new THREE.MeshBasicMaterial({
        color: COLOR_SELECTED,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.selectedEntityRing.visible = false;
    this.selectedEntityRing.renderOrder = 4;
    this.group.add(this.selectedEntityRing);

    /* Landing selection is a SQUARE frame aligned with the grid cell
     * boundary — the destination is a specific chain-grid cell, and
     * a square outline reinforces that, especially in tile mode
     * where the cell fills the screen. Built as a Shape with a hole
     * (outer square minus inner square) so the frame has visible
     * thickness rather than being a 1-device-px line. Outer extent
     * is ±1, inner ±0.78, giving a stroke width of ~22% of the cell
     * footprint. */
    const landingShape = new THREE.Shape();
    landingShape.moveTo(-1, -1);
    landingShape.lineTo(1, -1);
    landingShape.lineTo(1, 1);
    landingShape.lineTo(-1, 1);
    landingShape.closePath();
    const landingHole = new THREE.Path();
    landingHole.moveTo(-0.78, -0.78);
    landingHole.lineTo(0.78, -0.78);
    landingHole.lineTo(0.78, 0.78);
    landingHole.lineTo(-0.78, 0.78);
    landingHole.closePath();
    landingShape.holes.push(landingHole);
    const landingRingGeom = new THREE.ShapeGeometry(landingShape);
    landingRingGeom.rotateX(-Math.PI / 2);
    this.selectedLandingRing = new THREE.Mesh(
      landingRingGeom,
      new THREE.MeshBasicMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    this.selectedLandingRing.visible = false;
    this.selectedLandingRing.renderOrder = 4;
    this.group.add(this.selectedLandingRing);

    this.selectedLandingCross = this.buildCrosshair();
    this.selectedLandingCross.visible = false;
    this.selectedLandingCross.renderOrder = 4.1;
    this.group.add(this.selectedLandingCross);

    /* Walk lines — own + pre-allocated pool for others. */
    const ownLineGeom = new THREE.BufferGeometry();
    ownLineGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    const ownLineMat = new THREE.LineDashedMaterial({
      color: COLOR_SEAL,
      transparent: true,
      opacity: 0.85,
      dashSize: 0.06,
      gapSize: 0.04,
      linewidth: 2,
      /* depthTest:false + depthWrite:false bypass the GPU depth
       * comparison entirely. Without this, the line is coplanar with
       * the terrain quad at Y≈0 and depth-buffer precision over a
       * 4-unit-wide disc viewed by a perspective camera flickers
       * dashes in and out at oblique angles — the "cut in places"
       * symptom. polygonOffset on the terrain material protects
       * triangle overlays (player tiles, castle plates) but doesn't
       * apply to Line primitives. RenderOrder=1.5 still keeps the
       * line under player dots (3.2) since dots draw after. */
      depthTest: false,
      depthWrite: false,
    });
    this.ownWalkLine = new THREE.Line(ownLineGeom, ownLineMat);
    this.ownWalkLine.visible = false;
    this.ownWalkLine.renderOrder = 1.5;
    this.group.add(this.ownWalkLine);

    const markerGeom = new THREE.CircleGeometry(1, 16);
    markerGeom.rotateX(-Math.PI / 2);
    this.ownWalkMarker = new THREE.Mesh(
      markerGeom.clone(),
      new THREE.MeshBasicMaterial({ color: COLOR_SEAL }),
    );
    this.ownWalkMarker.visible = false;
    this.ownWalkMarker.renderOrder = 1.6;
    this.group.add(this.ownWalkMarker);

    this.ownWalkHalo = new THREE.Mesh(
      markerGeom.clone(),
      new THREE.MeshBasicMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.25,
      }),
    );
    this.ownWalkHalo.visible = false;
    this.ownWalkHalo.renderOrder = 1.55;
    this.group.add(this.ownWalkHalo);

    this.otherWalksPool = [];
    for (let i = 0; i < MAX_OTHER_WALKS; i++) {
      const lineGeom = new THREE.BufferGeometry();
      lineGeom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      const lineMat = new THREE.LineDashedMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.4,
        dashSize: 0.04,
        gapSize: 0.04,
        linewidth: 1.5,
        /* See ownLineMat above — same z-fight fix applies to remote
         * walkers' dashed lines. */
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.visible = false;
      line.renderOrder = 1.2;
      const marker = new THREE.Mesh(
        markerGeom.clone(),
        new THREE.MeshBasicMaterial({
          color: COLOR_SEAL,
          transparent: true,
          opacity: 0.85,
        }),
      );
      marker.visible = false;
      marker.renderOrder = 1.3;
      this.group.add(line);
      this.group.add(marker);
      this.otherWalksPool.push({ line, marker });
    }
  }

  /* ─── Build-once helpers ──────────────────────────────────── */

  private buildBoundarySquare(): THREE.LineSegments {
    const half = MESH_SIZE / 2;
    // Lift along the surface normal (Y here) by OVERLAY_Y_BIAS — the
    // terrain's polygonOffset doesn't apply to lines, so without this
    // the boundary square z-fights at oblique camera angles. All other
    // line overlays in this file already apply the same lift.
    const y = midpointElevation() + OVERLAY_Y_BIAS;
    const verts = new Float32Array([
      -half, y, -half, +half, y, -half,
      +half, y, -half, +half, y, +half,
      +half, y, +half, -half, y, +half,
      -half, y, +half, -half, y, -half,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_BOUNDARY,
      transparent: true,
      opacity: 0.55,
    });
    return new THREE.LineSegments(geom, mat);
  }

  private buildCrosshair(): THREE.LineSegments {
    /* Built at unit scale — updateLanding sets the actual world
     * scale per zoom so the crosshair stays constant on screen. */
    const verts = new Float32Array([
      -1, 0, 0, 1, 0, 0,
      0, 0, -1, 0, 0, 1,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_SEAL,
      transparent: true,
      opacity: 0.95,
    });
    return new THREE.LineSegments(geom, mat);
  }

  /* ─── Update API ──────────────────────────────────────────── */

  setTerrain(terrain: CityTerrain): void {
    this.terrain = terrain;
  }

  setCenterGrid(cityLatGrid: number, cityLongGrid: number, rgu: number): void {
    this.cityLatGrid = cityLatGrid;
    this.cityLongGrid = cityLongGrid;
    this.rgu = rgu;
  }

  updateOccupants(
    occupied: OccupiedCell[],
    selectedEntity: SelectedEntity | null,
    myPlayerPubkey: string | undefined,
    cssPxPerCell: number,
  ): void {
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;

    /* Sizing: target a constant on-screen DIAMETER of ~6 CSS px in
     * DOT MODE so occupants stay visible when cells are sub-pixel
     * (zoomed-out overview). At TILE MODE threshold (cssPxPerCell
     * >= 5) we switch to PlaneGeometry sized to exactly one cell, so
     * the dot-mode formula only kicks in at low zoom where cells are
     * too small to resolve anyway.
     *
     * Previous code capped dotR at `cellWorld * 0.5` to force
     * one-cell occupants, which made the dot sub-pixel and invisible
     * at default zoom — exactly the opposite UX the user wants. */
    const TARGET_DOT_DIAMETER_CSS_PX = 6;
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    const tileHalf = cellWorld * 0.5;
    const cssPxClamped = Math.max(0.05, cssPxPerCell);
    const dotR = (TARGET_DOT_DIAMETER_CSS_PX * 0.5 * cellWorld) / cssPxClamped;
    this.currentCssPxPerCell = cssPxClamped;

    let pCount = 0;
    let eCount = 0;
    let pTileCount = 0;
    let eTileCount = 0;
    let castleCount = 0;
    let towerCount = 0;
    let pipCount = 0;
    const CASTLE_CAPACITY = this.castles.instanceMatrix.count;
    const TOWER_CAPACITY = this.castleTowers.instanceMatrix.count;
    const PIP_CAPACITY = this.castleStatusPips.instanceMatrix.count;

    /* Reset instance->cell maps before this frame's rebuild. */
    this.playerDotInstanceCells.length = 0;
    this.playerTileInstanceCells.length = 0;
    this.encounterDotInstanceCells.length = 0;
    this.encounterTileInstanceCells.length = 0;
    this.castleInstanceCells.length = 0;

    const tmpMat = new THREE.Matrix4();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const tmpPos = new THREE.Vector3();

    let selectedRingPos: { wx: number; wz: number; y: number } | null = null;

    for (let i = 0; i < occupied.length; i++) {
      const cell = occupied[i]!;
      const ox = cell.gridLong - this.cityLongGrid;
      const oy = cell.gridLat - this.cityLatGrid;
      const { wx, wz } = gridToWorld(ox, oy, this.rgu);
      const y = getElevationAt(ox, oy) + OVERLAY_Y_BIAS;

      const isPlayer = cell.occupantType === OCCUPANT_PLAYER;
      const isEncounter = cell.occupantType === OCCUPANT_ENCOUNTER;
      const isCastle = cell.occupantType === OCCUPANT_CASTLE;

      /* Castles — paint a single plate per castle spanning the N×N
       * footprint. `useCityOccupied` emits N² OccupiedCell entries per
       * castle (one per footprint cell so any click resolves), but
       * only the `footprintAnchor === true` cell builds geometry; the
       * remaining N²-1 cells fall through (no dot, no tile) — clicks
       * on them still find the castle via the raycast → cell lookup. */
      if (isCastle) {
        if (cell.footprintAnchor !== true) continue;
        if (castleCount >= CASTLE_CAPACITY) continue;
        const n = Math.max(1, cell.footprintSize ?? 1);
        /* Anchor sits at the SW corner of the N×N footprint. Centre
         * the plate over the geometric centre of the range so the
         * plate's local ±0.5 extent (PlaneGeometry) maps to the full
         * footprint when scaled by `plateExtent`. */
        const centerOx = ox + (n - 1) / 2;
        const centerOy = oy + (n - 1) / 2;
        const center = gridToWorld(centerOx, centerOy, this.rgu);
        /* Match selection by occupant pubkey rather than (gridLat,
         * gridLong). The raycast fallback in CityTerrainMapWebGL
         * (ground-plane match for 2D-mode degenerate matrices) can
         * commit selectedEntity at a non-anchor footprint cell of an
         * N×N castle. The geometry only paints on the anchor cell —
         * a coord-based check would then see no selection and the
         * gold stroke wouldn't fire. */
        const isSelectedCastle =
          selectedEntity != null &&
          selectedEntity.occupantType === OCCUPANT_CASTLE &&
          selectedEntity.pubkey === cell.occupant;
        tmpPos.set(center.wx, y, center.wz);
        /* In tile mode (zoomed in), draw the full N×N footprint so the
         * castle reads as the territorial holding it is. In dot mode
         * (zoomed out), the footprint is sub-pixel — scale up to a
         * constant CSS-px square so the castle stays legible. Mirror
         * the 2D fallback's `scale = max(1, castleN * 0.7)` so a 4×4
         * Citadel reads visibly bigger than a 1×1 Outpost even at
         * overview zoom. */
        const TARGET_CASTLE_DIAMETER_CSS_PX = 12;
        const dotExtent =
          (TARGET_CASTLE_DIAMETER_CSS_PX * cellWorld) / cssPxClamped;
        const castleScale = Math.max(1, n * 0.7);
        const plateExtent = renderAsTiles
          ? n * cellWorld
          : dotExtent * castleScale;
        /* Per-grid-cell world distance on the RENDERED plate. In tile
         * mode this equals cellWorld; in dot mode the plate is inflated
         * to a constant CSS-px scale, so towers/pips placed by raw
         * grid offsets would cluster near the plate centre instead of
         * its corners. Use plateExtent/n so glyph positions follow
         * the plate's actual visual size at every zoom. */
        const cellOnPlate = plateExtent / n;
        tmpScale.set(plateExtent, 1, plateExtent);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.castles.setMatrixAt(castleCount, tmpMat);
        this.castles.setColorAt(castleCount, COLOR_CASTLE);
        this.castleRings.setMatrixAt(castleCount, tmpMat);
        this.castleRings.setColorAt(
          castleCount,
          isSelectedCastle ? COLOR_SELECTED : COLOR_CREAM,
        );
        this.castleInstanceCells[castleCount] = cell;
        castleCount++;

        /* Tower glyphs — placement + count per tier. Drawn slightly
         * above the plate (Y bias) so they don't z-fight. Capacity-
         * capped silently; with MAX_CASTLES=64 and 5 towers max per
         * castle (Citadel) the cap is 320, which matches the GPU
         * buffer we sized. Positions use `cellOnPlate` so glyphs
         * follow the rendered plate's size in both tile mode (= one
         * grid cell) and dot mode (= 1/n of the inflated plate). */
        const towerSpecs = getCastleTowerPositions(cell.castleTier ?? 0, n);
        for (let ti = 0; ti < towerSpecs.length; ti++) {
          if (towerCount >= TOWER_CAPACITY) break;
          const t = towerSpecs[ti]!;
          const dx = t.ox * cellOnPlate;
          const dz = -t.oy * cellOnPlate;
          tmpPos.set(center.wx + dx, y + 1e-4, center.wz + dz);
          const towerR = plateExtent * t.scaleFrac;
          tmpScale.set(towerR, 1, towerR);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.castleTowers.setMatrixAt(towerCount, tmpMat);
          this.castleTowers.setColorAt(towerCount, COLOR_CASTLE_TOWER);
          towerCount++;
        }

        /* Status pip — corner disk coloured by `castleStatus`. Vacant
         * castles get no pip (colorForCastleStatus returns null) so
         * the plate reads as "unclaimed, no urgent state". Positions
         * use cellOnPlate (see tower loop comment) so the pip sits at
         * the rendered plate's corner at every zoom. */
        const pipColor = colorForCastleStatus(cell.castleStatus);
        if (pipColor && pipCount < PIP_CAPACITY) {
          const pipReach = (n / 2) * (n <= 1 ? 0.6 : 0.85);
          const pipDx = pipReach * cellOnPlate;
          const pipDz = -pipReach * cellOnPlate;
          tmpPos.set(center.wx + pipDx, y + 2e-4, center.wz + pipDz);
          const pipR = plateExtent * (n <= 1 ? 0.13 : 0.09);
          tmpScale.set(pipR, 1, pipR);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.castleStatusPips.setMatrixAt(pipCount, tmpMat);
          this.castleStatusPips.setColorAt(pipCount, pipColor);
          pipCount++;
        }
        continue;
      }

      if (!isPlayer && !isEncounter) continue;
      const isMyPlayer =
        isPlayer && myPlayerPubkey != null && cell.occupant === myPlayerPubkey;
      const isSelected =
        selectedEntity != null &&
        selectedEntity.gridLat === cell.gridLat &&
        selectedEntity.gridLong === cell.gridLong;

      /* Cosmetic name colour wins over the canonical palette — same
       * rule the 2D fallback applies (lib/hooks/useCityOccupied.ts
       * threads `nameColorHex` from the player's catalog entry). Falls
       * through to the default ink colours when the player has no
       * paid colour equipped. Static-colour path only here; animated
       * colours (`nameColorAnim`) require a per-frame instance-colour
       * tick — separate follow-up. */
      const cosmeticFill = cell.nameColorHex
        ? parseHexLinear(cell.nameColorHex)
        : null;
      const fill = cosmeticFill
        ? cosmeticFill
        : isMyPlayer
          ? COLOR_MY_PLAYER
          : isPlayer
            ? COLOR_PLAYER
            : COLOR_WILD;

      // Cap iteration at the InstancedMesh capacity. Without this, writes
      // past MAX_OCCUPANTS silently drop into the TypedArray's overflow
      // (no-op) but .count is bumped, so three.js renders past-the-end
      // instances that still hold the identity matrix — visible as a
      // stack of ghost dots at world origin (city centre).
      const playerCapHit =
        isPlayer && (renderAsTiles ? pTileCount : pCount) >= MAX_OCCUPANTS;
      const encounterCapHit =
        isEncounter && (renderAsTiles ? eTileCount : eCount) >= MAX_OCCUPANTS;
      if (playerCapHit || encounterCapHit) {
        if (!_occupancyOverflowWarned) {
          _occupancyOverflowWarned = true;
          console.warn(
            `[city3d/markers] occupant cap reached — MAX_OCCUPANTS=${MAX_OCCUPANTS}. ` +
              `Some dots/tiles are being dropped this frame. Bump the constant in city3d/markers.ts.`,
          );
        }
        continue;
      }

      if (renderAsTiles) {
        tmpPos.set(wx, y, wz);
        tmpScale.set(tileHalf * 2, 1, tileHalf * 2);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        if (isPlayer) {
          this.playerTiles.setMatrixAt(pTileCount, tmpMat);
          this.playerTiles.setColorAt(pTileCount, fill);
          /* Ring uses the same scale as the tile — both geometries
           * are normalised to ±0.5, so they're coplanar at the cell
           * edge. The ShapeGeometry ring has a hole in the middle so
           * the fill shows through. */
          tmpScale.set(tileHalf * 2, 1, tileHalf * 2);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.playerTileRings.setMatrixAt(pTileCount, tmpMat);
          this.playerTileRings.setColorAt(
            pTileCount,
            isSelected ? COLOR_SELECTED : COLOR_CREAM,
          );
          this.playerTileInstanceCells[pTileCount] = cell;
          pTileCount++;
        } else {
          this.encounterTiles.setMatrixAt(eTileCount, tmpMat);
          this.encounterTiles.setColorAt(eTileCount, fill);
          /* Ring uses the same scale as the tile — both geometries
           * are normalised to ±0.5, so they're coplanar at the cell
           * edge. The ShapeGeometry ring has a hole in the middle so
           * the fill shows through. */
          tmpScale.set(tileHalf * 2, 1, tileHalf * 2);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          this.encounterTileRings.setMatrixAt(eTileCount, tmpMat);
          this.encounterTileRings.setColorAt(
            eTileCount,
            isSelected ? COLOR_SELECTED : COLOR_CREAM,
          );
          this.encounterTileInstanceCells[eTileCount] = cell;
          eTileCount++;
        }
      } else {
        tmpPos.set(wx, y, wz);
        tmpScale.set(dotR, 1, dotR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        if (isPlayer) {
          this.playerDots.setMatrixAt(pCount, tmpMat);
          this.playerDots.setColorAt(pCount, fill);
          this.playerDotRings.setMatrixAt(pCount, tmpMat);
          this.playerDotRings.setColorAt(
            pCount,
            isSelected ? COLOR_SELECTED : COLOR_CREAM,
          );
          this.playerDotInstanceCells[pCount] = cell;
          pCount++;
        } else {
          this.encounterDots.setMatrixAt(eCount, tmpMat);
          this.encounterDots.setColorAt(eCount, fill);
          this.encounterDotRings.setMatrixAt(eCount, tmpMat);
          this.encounterDotRings.setColorAt(
            eCount,
            isSelected ? COLOR_SELECTED : COLOR_CREAM,
          );
          this.encounterDotInstanceCells[eCount] = cell;
          eCount++;
        }
      }

      if (isSelected) {
        selectedRingPos = { wx, wz, y };
      }
    }

    /* Toggle visibility of the layer family appropriate for this
     * zoom level. The other family keeps count=0 so it draws nothing. */
    this.playerDots.count = renderAsTiles ? 0 : pCount;
    this.playerDotRings.count = renderAsTiles ? 0 : pCount;
    this.encounterDots.count = renderAsTiles ? 0 : eCount;
    this.encounterDotRings.count = renderAsTiles ? 0 : eCount;
    this.playerTiles.count = renderAsTiles ? pTileCount : 0;
    this.playerTileRings.count = renderAsTiles ? pTileCount : 0;
    this.encounterTiles.count = renderAsTiles ? eTileCount : 0;
    this.encounterTileRings.count = renderAsTiles ? eTileCount : 0;
    /* Castles always render at their footprint size regardless of
     * zoom — they're a structural overlay, not a "you are here" dot. */
    this.castles.count = castleCount;
    this.castleRings.count = castleCount;
    this.castleTowers.count = towerCount;
    this.castleStatusPips.count = pipCount;

    this.playerDots.instanceMatrix.needsUpdate = true;
    this.playerDotRings.instanceMatrix.needsUpdate = true;
    this.encounterDots.instanceMatrix.needsUpdate = true;
    this.encounterDotRings.instanceMatrix.needsUpdate = true;
    this.playerTiles.instanceMatrix.needsUpdate = true;
    this.playerTileRings.instanceMatrix.needsUpdate = true;
    this.encounterTiles.instanceMatrix.needsUpdate = true;
    this.encounterTileRings.instanceMatrix.needsUpdate = true;
    this.castles.instanceMatrix.needsUpdate = true;
    this.castleRings.instanceMatrix.needsUpdate = true;
    this.castleTowers.instanceMatrix.needsUpdate = true;
    this.castleStatusPips.instanceMatrix.needsUpdate = true;
    if (this.castles.instanceColor)
      this.castles.instanceColor.needsUpdate = true;
    if (this.castleRings.instanceColor)
      this.castleRings.instanceColor.needsUpdate = true;
    if (this.castleTowers.instanceColor)
      this.castleTowers.instanceColor.needsUpdate = true;
    if (this.castleStatusPips.instanceColor)
      this.castleStatusPips.instanceColor.needsUpdate = true;

    if (this.playerDots.instanceColor)
      this.playerDots.instanceColor.needsUpdate = true;
    if (this.playerDotRings.instanceColor)
      this.playerDotRings.instanceColor.needsUpdate = true;
    if (this.encounterDots.instanceColor)
      this.encounterDots.instanceColor.needsUpdate = true;
    if (this.encounterDotRings.instanceColor)
      this.encounterDotRings.instanceColor.needsUpdate = true;
    if (this.playerTiles.instanceColor)
      this.playerTiles.instanceColor.needsUpdate = true;
    if (this.playerTileRings.instanceColor)
      this.playerTileRings.instanceColor.needsUpdate = true;
    if (this.encounterTiles.instanceColor)
      this.encounterTiles.instanceColor.needsUpdate = true;
    if (this.encounterTileRings.instanceColor)
      this.encounterTileRings.instanceColor.needsUpdate = true;

    /* `selectedEntityRing` was a 32-segment `RingGeometry` halo drawn
     * around the selected occupant — a CIRCLE in both modes. In tile
     * mode that meant a circular halo "hovering" on top of the
     * square tile, which read as a stray UI artifact rather than a
     * selection cue. Selection is already legible via the fill +
     * outline-ring colour swap (cream → COLOR_SELECTED on the tile /
     * dot ring), so the extra halo was redundant. Hidden permanently;
     * left in `SceneRefs` to avoid churning the dispose path. */
    this.selectedEntityRing.visible = false;
    void selectedRingPos;
  }

  updateLanding(
    selected: { gridLat: number; gridLong: number } | null,
    cssPxPerCell: number,
  ): void {
    if (!selected) {
      this.selectedLandingRing.visible = false;
      this.selectedLandingCross.visible = false;
      return;
    }
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    const ox = selected.gridLong - this.cityLongGrid;
    const oy = selected.gridLat - this.cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, this.rgu);
    const y = getElevationAt(ox, oy) + OVERLAY_Y_BIAS * 1.5;
    /* Tile mode: ring tightly around the cell. Dot mode: target
     * a constant ~10 CSS px DIAMETER on screen so it reads as a
     * deliberate landing picker — slightly larger than the 6 CSS px
     * occupant dots so a chosen cell stands out from the crowd. */
    const TARGET_LANDING_DIAMETER_CSS_PX = 10;
    const cssPxClamped = Math.max(0.05, cssPxPerCell);
    const r = renderAsTiles
      ? cellWorld * 0.55
      : (TARGET_LANDING_DIAMETER_CSS_PX * 0.5 * cellWorld) / cssPxClamped;
    this.selectedLandingRing.scale.set(r, 1, r);
    this.selectedLandingRing.position.set(wx, y, wz);
    this.selectedLandingRing.visible = true;
    /* Crosshair arms slightly shorter than the ring radius so the
     * `+` reads through the ring rather than poking past it. */
    const crossR = r * 0.65;
    this.selectedLandingCross.scale.set(crossR, 1, crossR);
    this.selectedLandingCross.position.set(wx, y + 1e-4, wz);
    this.selectedLandingCross.visible = true;
  }

  updateOwnWalk(walk: WalkLine | null | undefined): void {
    if (!walk) {
      this.ownWalkLine.visible = false;
      this.ownWalkMarker.visible = false;
      this.ownWalkHalo.visible = false;
      return;
    }
    const oxF = walk.fromGridLong - this.cityLongGrid;
    const oyF = walk.fromGridLat - this.cityLatGrid;
    const oxT = walk.toGridLong - this.cityLongGrid;
    const oyT = walk.toGridLat - this.cityLatGrid;
    const from = gridToWorld(oxF, oyF, this.rgu);
    const to = gridToWorld(oxT, oyT, this.rgu);
    const yF = getElevationAt(oxF, oyF) + OVERLAY_Y_BIAS + WALK_LINE_LIFT;
    const yT = getElevationAt(oxT, oyT) + OVERLAY_Y_BIAS + WALK_LINE_LIFT;

    const posAttr = this.ownWalkLine.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    posAttr.setXYZ(0, from.wx, yF, from.wz);
    posAttr.setXYZ(1, to.wx, yT, to.wz);
    posAttr.needsUpdate = true;
    this.ownWalkLine.geometry.computeBoundingSphere();
    this.ownWalkLine.computeLineDistances();
    this.ownWalkLine.visible = true;

    /* Cosmetic name colour tints both the line and the marker so the
     * walker's identity follows them across the disc — same rule the
     * 2D fallback applies. Falls through to the canonical seal-orange
     * when the walker has no colour equipped. */
    const walkColor = walk.nameColorHex
      ? parseHexLinear(walk.nameColorHex)
      : null;
    const lineMat = this.ownWalkLine.material as THREE.LineBasicMaterial;
    lineMat.color.copy(walkColor ?? COLOR_SEAL);
    const markerMat = this.ownWalkMarker.material as THREE.MeshBasicMaterial;
    markerMat.color.copy(walkColor ?? COLOR_SEAL);

    const t = Math.min(1, Math.max(0, walk.pct / 100));
    const mx = from.wx + (to.wx - from.wx) * t;
    const my = yF + (yT - yF) * t;
    const mz = from.wz + (to.wz - from.wz) * t;
    /* Marker size: constant ~5 CSS px on screen, same formula as
     * occupant dots so the local walker reads as a moving "you" dot. */
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    const r = (5 * cellWorld) / this.currentCssPxPerCell;
    this.ownWalkMarker.scale.set(r, 1, r);
    this.ownWalkMarker.position.set(mx, my + 5e-4, mz);
    this.ownWalkMarker.visible = true;
    this.ownWalkHalo.scale.set(r * 2.2, 1, r * 2.2);
    this.ownWalkHalo.position.set(mx, my + 2e-4, mz);
    this.ownWalkHalo.visible = true;
  }

  updateOtherWalks(walks: WalkLine[] | null | undefined): void {
    const list = walks ?? [];
    const n = Math.min(list.length, MAX_OTHER_WALKS);
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    /* Other-walker markers slightly smaller than own (3 vs 5 CSS px)
     * so the user's own walk reads as primary. */
    const r = (3 * cellWorld) / this.currentCssPxPerCell;

    for (let i = 0; i < n; i++) {
      const w = list[i]!;
      const entry = this.otherWalksPool[i]!;
      const oxF = w.fromGridLong - this.cityLongGrid;
      const oyF = w.fromGridLat - this.cityLatGrid;
      const oxT = w.toGridLong - this.cityLongGrid;
      const oyT = w.toGridLat - this.cityLatGrid;
      const from = gridToWorld(oxF, oyF, this.rgu);
      const to = gridToWorld(oxT, oyT, this.rgu);
      /* Same 5e-4 lift as the own-walk line — keeps the dashed
       * overlay above the terrain plate so depth-test ties don't
       * chop the line into visible pieces. */
      const yF = getElevationAt(oxF, oyF) + OVERLAY_Y_BIAS + WALK_LINE_LIFT;
      const yT = getElevationAt(oxT, oyT) + OVERLAY_Y_BIAS + WALK_LINE_LIFT;
      const posAttr = entry.line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      posAttr.setXYZ(0, from.wx, yF, from.wz);
      posAttr.setXYZ(1, to.wx, yT, to.wz);
      posAttr.needsUpdate = true;
      entry.line.geometry.computeBoundingSphere();
      entry.line.computeLineDistances();
      entry.line.visible = true;

      /* Cosmetic colour for each remote walker too — matches the 2D
       * fallback's per-walk tint so paid identity is visible while
       * remote players are in motion. */
      const walkColor = w.nameColorHex
        ? parseHexLinear(w.nameColorHex)
        : null;
      const lineMat = entry.line.material as THREE.LineBasicMaterial;
      lineMat.color.copy(walkColor ?? COLOR_SEAL);
      const markerMat = entry.marker.material as THREE.MeshBasicMaterial;
      markerMat.color.copy(walkColor ?? COLOR_SEAL);

      const t = Math.min(1, Math.max(0, w.pct / 100));
      const mx = from.wx + (to.wx - from.wx) * t;
      const my = yF + (yT - yF) * t;
      const mz = from.wz + (to.wz - from.wz) * t;
      entry.marker.scale.set(r, 1, r);
      entry.marker.position.set(mx, my + 5e-4, mz);
      entry.marker.visible = true;
    }
    /* Hide pool entries beyond the active count. */
    for (let i = n; i < this.otherWalksActiveCount; i++) {
      const entry = this.otherWalksPool[i]!;
      entry.line.visible = false;
      entry.marker.visible = false;
    }
    this.otherWalksActiveCount = n;
  }

  /* Proximity grid — rebuilt only when the doubling-stride or pan
   * shifts meaningfully. Cheap to dispose/rebuild because it's
   * just `LineSegments` of a few thousand verts.
   *
   * Always renders (no zoom threshold). Stride is a power-of-two
   * decimation so the visible line density stays bounded at every
   * zoom level — at low zoom you see a coarse net (every 64th cell
   * or so), at high zoom you see every cell. The doubling steps
   * line up with the dot-vs-tile transition so the grid feels
   * continuous as you zoom in. */
  updateGrid(cssPxPerCell: number, _viewCenter: THREE.Vector3): void {
    /* Grid renders in BOTH 2D and 3D modes — under flat-strategy the
     * mesh is a single flat quad at Y=0 (see coords.ts::getElevationAt),
     * so the chord-on-uneven-terrain concern that previously gated this
     * to 2D-only no longer applies. The lift offset below keeps the
     * lines just above the terrain surface to avoid z-fighting. */
    /* Gate on the same `cssPxPerCell` threshold that flips dot→tile
     * mode. Below it, cells are sub-pixel and gridlines look like
     * a moiré wash with no cell structure visible. Above it, cells
     * resolve to discrete tiles and the grid usefully outlines them. */
    if (cssPxPerCell < GRID_OVERLAY_MIN_CSS_PX_PER_CELL) {
      if (this.gridLines) this.gridLines.visible = false;
      return;
    }
    /* Target ~8 CSS px between lines (readable but not crowded).
     * Stride is the next power of two that gets us there. */
    const TARGET_PX_BETWEEN_LINES = 8;
    const ratio = TARGET_PX_BETWEEN_LINES / Math.max(0.001, cssPxPerCell);
    const stride = Math.max(1, 2 ** Math.max(0, Math.ceil(Math.log2(ratio))));
    const halfSide = MESH_SIZE / 2;
    /* Grid now covers the full mesh always, so only the stride
     * change triggers a rebuild — pan no longer matters because
     * the lines extend ±rgu around the centre regardless of where
     * the camera is. */
    if (this.gridLines && stride === this.gridStride) {
      this.gridLines.visible = true;
      return;
    }

    if (this.gridLines) {
      this.group.remove(this.gridLines);
      this.gridLines.geometry.dispose();
      (this.gridLines.material as THREE.Material).dispose();
      this.gridLines = null;
    }
    this.gridStride = stride;

    /* Cover the FULL mesh at every zoom. Endpoint-only sampling
     * keeps the buffer tiny even when rgu is large — total verts
     * are 2 × num_lines, never num_lines². For rgu=3600 stride=1
     * (extreme deep zoom), that's still only ~28k verts. The
     * chord approximation in 3D mode (lines that span a hill are
     * straight, not curved) is acceptable because (a) in 2D mode
     * the group scale.y=0 collapses everything flat anyway, and
     * (b) in 3D mode the eye reads slight chord deviation as the
     * line "passing through" the surface, which is fine for a
     * graph-paper overlay. */
    const minOx = -this.rgu;
    const maxOx = this.rgu;
    const minOy = -this.rgu;
    const maxOy = this.rgu;
    const verts: number[] = [];
    const lift = 1e-4;
    /* Half-integer offset so lines bound cells rather than bisect
     * them — matches the Canvas2D fallback. */
    const startOx = Math.ceil(minOx / stride) * stride;
    const startOy = Math.ceil(minOy / stride) * stride;
    const wzMin = (minOy / this.rgu) * halfSide;
    const wzMax = (maxOy / this.rgu) * halfSide;
    const wxMin = (minOx / this.rgu) * halfSide;
    const wxMax = (maxOx / this.rgu) * halfSide;
    for (let ox = startOx; ox <= maxOx; ox += stride) {
      const wxA = ((ox - 0.5) / this.rgu) * halfSide;
      const yA = getElevationAt(ox, minOy) + lift;
      const yB = getElevationAt(ox, maxOy) + lift;
      verts.push(wxA, yA, -wzMin, wxA, yB, -wzMax);
    }
    for (let oy = startOy; oy <= maxOy; oy += stride) {
      const wzA = ((oy - 0.5) / this.rgu) * halfSide;
      const yA = getElevationAt(minOx, oy) + lift;
      const yB = getElevationAt(maxOx, oy) + lift;
      verts.push(wxMin, yA, -wzA, wxMax, yB, -wzA);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(verts), 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: COLOR_BOUNDARY,
      transparent: true,
      opacity: 0.22,
    });
    this.gridLines = new THREE.LineSegments(geom, mat);
    this.gridLines.renderOrder = 1.1;
    this.gridLines.frustumCulled = false;
    this.group.add(this.gridLines);
  }

  /* Sync the marker group's Y scale to the terrain mesh's
   * scale.y. In 2D mode (terrain scale.y=0) this collapses every
   * overlay to Y=0 — sitting ON the flat plate rather than floating
   * above it. In 3D mode (scale.y=1) markers stay at their natural
   * elevation. During the mode-transition tween, scale.y is mid-
   * lerp; calling this each paint keeps the overlays in sync. */
  setTerrainScaleY(s: number): void {
    this.group.scale.y = s;
  }

  /**
   * Meshes the click raycaster should intersect, in addition to
   * the terrain. Lets a click that lands on the rendered dot/tile
   * pixel-perfectly always resolve to its occupant cell, even if
   * the grid-coord round-trip via terrain would have rounded to a
   * neighbouring cell.
   */
  getInteractiveMeshes(): THREE.Object3D[] {
    return [
      this.playerDots,
      this.playerTiles,
      this.encounterDots,
      this.encounterTiles,
      this.castles,
    ];
  }

  /**
   * Look up the cell that drove a given instance of one of the
   * interactive meshes. Returns null if the index is out of range
   * or the mesh isn't one of the occupant layers.
   */
  cellForInstance(mesh: THREE.Object3D, instanceId: number): OccupiedCell | null {
    if (mesh === this.playerDots) return this.playerDotInstanceCells[instanceId] ?? null;
    if (mesh === this.playerTiles) return this.playerTileInstanceCells[instanceId] ?? null;
    if (mesh === this.encounterDots) return this.encounterDotInstanceCells[instanceId] ?? null;
    if (mesh === this.encounterTiles) return this.encounterTileInstanceCells[instanceId] ?? null;
    if (mesh === this.castles) return this.castleInstanceCells[instanceId] ?? null;
    return null;
  }

  updateCentreScale(_cssPxPerCell: number): void {
    /* No-op — centre marker was removed. Kept as a stable export so
     * the WebGL component's paint() loop doesn't need a conditional. */
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.parent?.remove(this.group);
    // Single traversal: every descendant — including gridLines, which was
    // add()'d to this.group at construction — is disposed exactly once.
    // The previous explicit `gridLines.dispose()` after the traversal
    // was a double-dispose, which emits redundant EventDispatcher events
    // and can confuse three.js inspector / perf monitors.
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = (m as THREE.Mesh).material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
