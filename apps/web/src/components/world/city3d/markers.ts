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
import { OCCUPANT_PLAYER, OCCUPANT_ENCOUNTER } from "novus-mundus-sdk";

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
const CREAM_STROKE_SRGB = [252, 244, 220] as const;
const SELECTED_STROKE_SRGB = [220, 175, 60] as const;
const SEAL_ORANGE_SRGB = [180, 83, 9] as const;
const CENTRE_INK_SRGB = [70, 50, 28] as const;
const BOUNDARY_INK_SRGB = [46, 31, 16] as const;

function linearColor(rgb: readonly [number, number, number]): THREE.Color {
  const c = new THREE.Color();
  c.setRGB(
    srgbToLinear(rgb[0] / 255),
    srgbToLinear(rgb[1] / 255),
    srgbToLinear(rgb[2] / 255),
  );
  return c;
}

const COLOR_PLAYER = linearColor(PLAYER_FILL_SRGB);
const COLOR_MY_PLAYER = linearColor(MY_PLAYER_FILL_SRGB);
const COLOR_WILD = linearColor(WILD_FILL_SRGB);
const COLOR_CREAM = linearColor(CREAM_STROKE_SRGB);
const COLOR_SELECTED = linearColor(SELECTED_STROKE_SRGB);
const COLOR_SEAL = linearColor(SEAL_ORANGE_SRGB);
const COLOR_CENTRE = linearColor(CENTRE_INK_SRGB);
const COLOR_BOUNDARY = linearColor(BOUNDARY_INK_SRGB);

const MAX_OCCUPANTS = 512;
const MAX_OTHER_WALKS = 256;

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

  /* Occupant fills + outlines (dual-mode). */
  private playerDots: THREE.InstancedMesh;
  private playerDotRings: THREE.InstancedMesh;
  private playerTiles: THREE.InstancedMesh;
  private playerTileRings: THREE.InstancedMesh;
  private encounterDots: THREE.InstancedMesh;
  private encounterDotRings: THREE.InstancedMesh;
  private encounterTiles: THREE.InstancedMesh;
  private encounterTileRings: THREE.InstancedMesh;

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

    /* Reset instance->cell maps before this frame's rebuild. */
    this.playerDotInstanceCells.length = 0;
    this.playerTileInstanceCells.length = 0;
    this.encounterDotInstanceCells.length = 0;
    this.encounterTileInstanceCells.length = 0;

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
      if (!isPlayer && !isEncounter) continue;
      const isMyPlayer =
        isPlayer && myPlayerPubkey != null && cell.occupant === myPlayerPubkey;
      const isSelected =
        selectedEntity != null &&
        selectedEntity.gridLat === cell.gridLat &&
        selectedEntity.gridLong === cell.gridLong;

      const fill = isMyPlayer
        ? COLOR_MY_PLAYER
        : isPlayer
          ? COLOR_PLAYER
          : COLOR_WILD;

      // Cap iteration at the InstancedMesh capacity. Without this, writes
      // past MAX_OCCUPANTS silently drop into the TypedArray's overflow
      // (no-op) but .count is bumped, so three.js renders past-the-end
      // instances that still hold the identity matrix — visible as a
      // stack of ghost dots at world origin (city centre).
      if (isPlayer && (renderAsTiles ? pTileCount : pCount) >= MAX_OCCUPANTS) continue;
      if (isEncounter && (renderAsTiles ? eTileCount : eCount) >= MAX_OCCUPANTS) continue;

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

    this.playerDots.instanceMatrix.needsUpdate = true;
    this.playerDotRings.instanceMatrix.needsUpdate = true;
    this.encounterDots.instanceMatrix.needsUpdate = true;
    this.encounterDotRings.instanceMatrix.needsUpdate = true;
    this.playerTiles.instanceMatrix.needsUpdate = true;
    this.playerTileRings.instanceMatrix.needsUpdate = true;
    this.encounterTiles.instanceMatrix.needsUpdate = true;
    this.encounterTileRings.instanceMatrix.needsUpdate = true;

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

    if (selectedRingPos) {
      const r = renderAsTiles ? tileHalf * 1.4 : dotR * 1.4;
      this.selectedEntityRing.scale.set(r, 1, r);
      this.selectedEntityRing.position.set(
        selectedRingPos.wx,
        selectedRingPos.y + 5e-4,
        selectedRingPos.wz,
      );
      this.selectedEntityRing.visible = true;
    } else {
      this.selectedEntityRing.visible = false;
    }
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
    const yF = getElevationAt(oxF, oyF) + OVERLAY_Y_BIAS;
    const yT = getElevationAt(oxT, oyT) + OVERLAY_Y_BIAS;

    const posAttr = this.ownWalkLine.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    posAttr.setXYZ(0, from.wx, yF, from.wz);
    posAttr.setXYZ(1, to.wx, yT, to.wz);
    posAttr.needsUpdate = true;
    this.ownWalkLine.geometry.computeBoundingSphere();
    this.ownWalkLine.computeLineDistances();
    this.ownWalkLine.visible = true;

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
      const yF = getElevationAt(oxF, oyF) + OVERLAY_Y_BIAS;
      const yT = getElevationAt(oxT, oyT) + OVERLAY_Y_BIAS;
      const posAttr = entry.line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      posAttr.setXYZ(0, from.wx, yF, from.wz);
      posAttr.setXYZ(1, to.wx, yT, to.wz);
      posAttr.needsUpdate = true;
      entry.line.geometry.computeBoundingSphere();
      entry.line.computeLineDistances();
      entry.line.visible = true;

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
    ];
  }

  /**
   * Look up the cell that drove a given instance of one of the
   * interactive meshes. Returns null if the index is out of range
   * or the mesh isn't one of the four occupant layers.
   */
  cellForInstance(mesh: THREE.Object3D, instanceId: number): OccupiedCell | null {
    if (mesh === this.playerDots) return this.playerDotInstanceCells[instanceId] ?? null;
    if (mesh === this.playerTiles) return this.playerTileInstanceCells[instanceId] ?? null;
    if (mesh === this.encounterDots) return this.encounterDotInstanceCells[instanceId] ?? null;
    if (mesh === this.encounterTiles) return this.encounterTileInstanceCells[instanceId] ?? null;
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
