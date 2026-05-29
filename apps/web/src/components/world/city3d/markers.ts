/**
 * MarkersLayer — thin orchestrator that composes the four occupant
 * sub-layers (occupants, castle, walks, landing) plus the static
 * boundary square + dynamic grid lines onto a single THREE.Group.
 *
 * Public API is unchanged from the original monolith: the WebGL
 * renderer (`CityTerrainMapWebGL.tsx`) constructs one MarkersLayer
 * per scene, drives it through `updateOccupants` / `updateLanding` /
 * `updateOwnWalk` / `updateOtherWalks` / `updateGrid` per frame, then
 * raycasts via `getInteractiveMeshes` + `cellForInstance`.
 *
 * The original `markers.ts` did all of this in one ~1500-LOC class
 * with 38 private fields and one 350-line `updateOccupants`. The
 * split breaks that into focused sub-classes under `./layers/` so a
 * future occupant type (faction overlays, territory tints, etc.)
 * adds ~one file rather than threading through three monoliths.
 */
import * as THREE from "three";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import { GRID_OVERLAY_MIN_CSS_PX_PER_CELL, MESH_SIZE, midpointElevation } from "./coords";
import { CastleLayer } from "./layers/castleLayer";
import { LandingLayer } from "./layers/landingLayer";
import { OccupantsLayer, type OccupantsLayerGeometries } from "./layers/occupantsLayer";
import { WalksLayer, type WalkLine } from "./layers/walksLayer";
import { COLOR_BOUNDARY, OVERLAY_Y_BIAS } from "./layers/palette";

/* CityTerrain retired under flat strategy. Markers no longer carry a
 * terrain handle; the type alias below keeps the previous public
 * `cfg.terrain` / `setTerrain` surface but the value is unused. */
type CityTerrain = unknown;

export type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
export type { WalkLine } from "./layers/walksLayer";

/* `SelectedEntity` is the same shape as `CityTerrainEntity` (defined in
 * the 2D fallback, the canonical occupant-identity record shared
 * between both renderers). Re-export as an alias so the markers API
 * surface stays unchanged but there's a single declaration to update
 * when a new field lands on the occupant identity. */
export type { CityTerrainEntity as SelectedEntity } from "../CityTerrainMap2DFallback";
import type { CityTerrainEntity as SelectedEntity } from "../CityTerrainMap2DFallback";

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
  private boundarySquare: THREE.LineSegments;
  private gridLines: THREE.LineSegments | null = null;
  private gridStride = 0;

  private occupants: OccupantsLayer;
  private castle: CastleLayer;
  private walks: WalksLayer;
  private landing: LandingLayer;

  private currentCssPxPerCell = 1;
  private disposed = false;

  constructor(cfg: MarkersConfig) {
    this.rgu = cfg.rgu;
    this.cityLatGrid = cfg.cityLatGrid;
    this.cityLongGrid = cfg.cityLongGrid;
    this.terrain = cfg.terrain;

    this.group = new THREE.Group();
    this.group.name = "city-markers";
    cfg.scene.add(this.group);

    /* Boundary square — static city-edge outline. renderOrder 1.7 sits
     * OVER the dashed walk lines (1.2/1.5) and their markers (1.3/1.6).
     * The walks use depthTest:false to dodge z-fighting with the
     * terrain plate, so the only way to stop a crossing walk from
     * visually breaking the boundary frame is to draw the boundary
     * after the walk in renderOrder. */
    this.boundarySquare = buildBoundarySquare();
    this.boundarySquare.renderOrder = 1.7;
    this.group.add(this.boundarySquare);

    /* Shared geometries + base materials. Each sub-layer clones what
     * it needs so vertex buffers + material defaults are deduplicated
     * but per-layer tweaks (polygonOffset on rings, depthTest:false
     * on walk lines) stay scoped to one mesh. */
    const geom = buildSharedGeometries();
    const center = {
      rgu: this.rgu,
      cityLatGrid: this.cityLatGrid,
      cityLongGrid: this.cityLongGrid,
    };
    this.occupants = new OccupantsLayer(this.group, center, geom);
    this.castle = new CastleLayer(this.group, center, geom);
    this.walks = new WalksLayer(this.group, center);
    this.landing = new LandingLayer(this.group, center);
  }

  /* ─── Update API ──────────────────────────────────────────── */

  setTerrain(terrain: CityTerrain): void {
    this.terrain = terrain;
  }

  setCenterGrid(cityLatGrid: number, cityLongGrid: number, rgu: number): void {
    this.cityLatGrid = cityLatGrid;
    this.cityLongGrid = cityLongGrid;
    this.rgu = rgu;
    const center = {
      rgu,
      cityLatGrid,
      cityLongGrid,
    };
    this.occupants.setCenterGrid(center);
    this.castle.setCenterGrid(center);
    this.walks.setCenterGrid(center);
    this.landing.setCenterGrid(center);
  }

  updateOccupants(
    occupied: OccupiedCell[],
    selectedEntity: SelectedEntity | null,
    myPlayerPubkey: string | undefined,
    cssPxPerCell: number,
  ): void {
    /* Sizing — target a constant on-screen DIAMETER of ~6 CSS px in
     * dot mode so occupants stay visible when cells are sub-pixel
     * (zoomed-out overview). At TILE-MODE threshold the dot formula
     * kicks back in only at low zoom where cells are too small to
     * resolve anyway. */
    const TARGET_DOT_DIAMETER_CSS_PX = 6;
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    const tileHalf = cellWorld * 0.5;
    const cssPxClamped = Math.max(0.05, cssPxPerCell);
    const dotR = (TARGET_DOT_DIAMETER_CSS_PX * 0.5 * cellWorld) / cssPxClamped;
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;
    this.currentCssPxPerCell = cssPxClamped;
    this.walks.setCssPxPerCell(cssPxClamped);

    /* `selectedEntity` is shared across layers — occupants match by
     * (gridLat,gridLong), castle matches by pubkey (anchor cell may
     * differ from clicked cell on a footprint). */
    const occupantSelected = selectedEntity
      ? { gridLat: selectedEntity.gridLat, gridLong: selectedEntity.gridLong }
      : null;
    const castleSelected = selectedEntity
      ? {
          occupantType: selectedEntity.occupantType,
          pubkey: selectedEntity.pubkey,
        }
      : null;

    this.occupants.update(
      occupied,
      occupantSelected,
      myPlayerPubkey,
      renderAsTiles,
      dotR,
      tileHalf,
    );
    this.castle.update(occupied, castleSelected, renderAsTiles, cellWorld, cssPxClamped);
  }

  updateLanding(
    selected: { gridLat: number; gridLong: number } | null,
    cssPxPerCell: number,
  ): void {
    this.landing.update(selected, cssPxPerCell);
  }

  updateOwnWalk(walk: WalkLine | null | undefined): void {
    this.walks.setCssPxPerCell(this.currentCssPxPerCell);
    this.walks.updateOwnWalk(walk);
  }

  updateOtherWalks(walks: WalkLine[] | null | undefined): void {
    this.walks.setCssPxPerCell(this.currentCssPxPerCell);
    this.walks.updateOtherWalks(walks);
  }

  /* Proximity grid — power-of-two stride decimation so the visible
   * line density stays bounded at every zoom level. Rebuilt only when
   * stride changes. */
  updateGrid(cssPxPerCell: number, _viewCenter: THREE.Vector3): void {
    if (cssPxPerCell < GRID_OVERLAY_MIN_CSS_PX_PER_CELL) {
      if (this.gridLines) this.gridLines.visible = false;
      return;
    }
    const TARGET_PX_BETWEEN_LINES = 8;
    const ratio = TARGET_PX_BETWEEN_LINES / Math.max(0.001, cssPxPerCell);
    const stride = Math.max(1, 2 ** Math.max(0, Math.ceil(Math.log2(ratio))));
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
    this.gridLines = buildGridLines(stride, this.rgu);
    this.gridLines.renderOrder = 1.1;
    this.gridLines.frustumCulled = false;
    this.group.add(this.gridLines);
  }

  /* Sync the marker group's Y scale to the terrain mesh's scale.y.
   * In 2D mode (terrain scale.y=0) this collapses every overlay to
   * Y=0; in 3D mode markers stay at their natural elevation. */
  setTerrainScaleY(s: number): void {
    this.group.scale.y = s;
  }

  getInteractiveMeshes(): THREE.Object3D[] {
    return [...this.occupants.getInteractiveMeshes(), ...this.castle.getInteractiveMeshes()];
  }

  cellForInstance(mesh: THREE.Object3D, instanceId: number): OccupiedCell | null {
    return (
      this.occupants.cellForInstance(mesh, instanceId) ??
      this.castle.cellForInstance(mesh, instanceId)
    );
  }

  updateCentreScale(_cssPxPerCell: number): void {
    /* No-op — centre marker was removed. Kept as a stable export so
     * the WebGL component's paint() loop doesn't need a conditional. */
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.occupants.dispose();
    this.castle.dispose();
    this.walks.dispose();
    this.landing.dispose();
    this.group.parent?.remove(this.group);
    /* Boundary + (optional) grid lines + the terrain handle stay
     * with the orchestrator; traverse the group to catch them. */
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    void this.terrain;
  }
}

/* ─── Build-once helpers ──────────────────────────────────── */

function buildBoundarySquare(): THREE.LineSegments {
  const half = MESH_SIZE / 2;
  /* OVERLAY_Y_BIAS = 0 under flat strategy; kept as a hook for the
   * eventual lift if the terrain mesh ever leaves the Y=0 plane. */
  const y = midpointElevation() + OVERLAY_Y_BIAS;
  const verts = new Float32Array([
    -half,
    y,
    -half,
    +half,
    y,
    -half,
    +half,
    y,
    -half,
    +half,
    y,
    +half,
    +half,
    y,
    +half,
    -half,
    y,
    +half,
    -half,
    y,
    +half,
    -half,
    y,
    -half,
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

function buildGridLines(stride: number, rgu: number): THREE.LineSegments {
  const halfSide = MESH_SIZE / 2;
  /* Cover the FULL mesh at every zoom. Endpoint-only sampling keeps
   * the buffer tiny — total verts are 2 × num_lines, never num_lines². */
  const minOx = -rgu;
  const maxOx = rgu;
  const minOy = -rgu;
  const maxOy = rgu;
  const verts: number[] = [];
  const lift = 1e-4;
  /* Half-integer offset so lines BOUND cells rather than bisect them
   * — matches the Canvas2D fallback. */
  const startOx = Math.ceil(minOx / stride) * stride;
  const startOy = Math.ceil(minOy / stride) * stride;
  const wzMin = (minOy / rgu) * halfSide;
  const wzMax = (maxOy / rgu) * halfSide;
  const wxMin = (minOx / rgu) * halfSide;
  const wxMax = (maxOx / rgu) * halfSide;
  for (let ox = startOx; ox <= maxOx; ox += stride) {
    const wxA = ((ox - 0.5) / rgu) * halfSide;
    const yA = lift;
    const yB = lift;
    verts.push(wxA, yA, -wzMin, wxA, yB, -wzMax);
  }
  for (let oy = startOy; oy <= maxOy; oy += stride) {
    const wzA = ((oy - 0.5) / rgu) * halfSide;
    const yA = lift;
    const yB = lift;
    verts.push(wxMin, yA, -wzA, wxMax, yB, -wzA);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  const mat = new THREE.LineBasicMaterial({
    color: COLOR_BOUNDARY,
    transparent: true,
    opacity: 0.22,
  });
  return new THREE.LineSegments(geom, mat);
}

/* Shared geometries + base materials handed to occupant + castle
 * sub-layers. Each layer clones the materials it needs so per-layer
 * polygonOffset / depthTest tweaks stay scoped. */
function buildSharedGeometries(): OccupantsLayerGeometries {
  const dotGeom = new THREE.CircleGeometry(1, 24);
  dotGeom.rotateX(-Math.PI / 2);
  const ringGeom = new THREE.RingGeometry(1, 1.45, 24);
  ringGeom.rotateX(-Math.PI / 2);

  /* Encounter shape: axis-aligned SQUARE. Vertices at (±1, 0, ±1);
   * scaled by dotR gives a half-extent of dotR. */
  const diamondGeom = new THREE.BufferGeometry();
  const dVerts = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);
  diamondGeom.setAttribute("position", new THREE.BufferAttribute(dVerts, 3));
  diamondGeom.setIndex([0, 3, 2, 0, 2, 1]);
  diamondGeom.computeVertexNormals();
  diamondGeom.computeBoundingSphere();

  /* Encounter outline: square frame matching the fill shape. Outer
   * ±1, inner ±0.72 → ~28% stroke width. */
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

  /* Tile-mode outline: square frame matching the tile fill. Outer
   * ±0.5 wraps the PlaneGeometry corners; inner ±0.37 gives ~26%
   * stroke width. */
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

  /* DoubleSide so we don't lose dots to back-face culling at oblique
   * camera angles — particularly the diamond shape whose triangulation
   * winding isn't guaranteed by ShapeGeometry. */
  const fillMat = new THREE.MeshBasicMaterial({
    transparent: false,
    side: THREE.DoubleSide,
  });
  /* polygonOffset nudges the ring's depth slightly toward the camera
   * so it always wins the depth comparison against the coplanar fill
   * underneath. Without this, ring + fill at the same world Y flicker
   * a jittery fringe as the camera moves. */
  const ringMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  return {
    dotGeom,
    ringGeom,
    diamondGeom,
    diamondRingGeom,
    tileGeom,
    tileFrameGeom,
    fillMat,
    ringMat,
  };
}
