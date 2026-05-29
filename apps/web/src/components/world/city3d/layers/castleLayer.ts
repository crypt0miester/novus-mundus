/**
 * Castle plates + cream ring + tier-keyed tower glyphs + status pip.
 *
 * Four InstancedMeshes:
 *   - `plates`: slate fills, one per castle (anchor cell only).
 *   - `rings`: cream/gold outline matching the plate.
 *   - `towers`: 1–5 dark-ink disks inside the plate per tier.
 *   - `pips`: optional corner-disk coloured by `CastleStatus`.
 *
 * `useCityOccupied` emits N² OccupiedCell entries per N×N castle (one
 * per footprint cell so any click resolves to the castle); this layer
 * only paints on the cell with `footprintAnchor === true`, then
 * spans the plate over the full footprint using `plateExtent`.
 *
 * Tile mode (zoomed-in): plate = n × cellWorld.
 * Dot mode (zoomed-out): plate inflates to a constant CSS-px target
 * × castleScale so a Citadel reads visibly bigger than an Outpost at
 * overview zoom. Tower/pip positions use `cellOnPlate = plateExtent/n`
 * so glyphs follow the rendered plate's size in both modes.
 */
import * as THREE from "three";
import { OCCUPANT_CASTLE } from "novus-mundus-sdk";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import { MESH_SIZE, gridToWorld } from "../coords";
import {
  COLOR_CASTLE,
  COLOR_CASTLE_TOWER,
  COLOR_CREAM,
  COLOR_SELECTED,
  COLOR_STATUS_CONTEST,
  COLOR_STATUS_PROTECTED,
  COLOR_STATUS_TRANSITIONING,
  COLOR_STATUS_VULNERABLE,
  MAX_CASTLES,
  MAX_CASTLE_PIPS,
  MAX_CASTLE_TOWERS,
  OVERLAY_Y_BIAS,
} from "./palette";

interface TowerSpec {
  ox: number;
  oy: number;
  scaleFrac: number;
}

/* Tower-placement per `CastleTier`. Positions are in grid cells from
 * the castle's geometric centre (can be fractional); `scaleFrac` is
 * a fraction of the PLATE side length, so towers scale with N×N
 * footprint and stay proportionate. Corner offset insets 15% so the
 * tower sits visibly inside the cream ring.
 *
 * Tier ladder:
 *   Outpost  (0) — single small tower (lookout)
 *   Keep     (1) — single larger tower (a proper keep)
 *   Stronghold (2) — keep + 2 flanking towers across an axis
 *   Fortress (3) — 4 corner towers (curtain-wall fortress)
 *   Citadel  (4) — 4 corner towers + central keep
 *
 * N=1 footprints collapse all corner positions onto centre — return
 * a single centre tower so the tier reads from pip + ring colour
 * instead of from tower count. */
function getCastleTowerPositions(tier: number, n: number): TowerSpec[] {
  if (n <= 1) {
    return [{ ox: 0, oy: 0, scaleFrac: 0.3 }];
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
      return [{ ox: 0, oy: 0, scaleFrac: 0.2 }];
  }
}

/* Vacant returns null — pip is hidden so the plate reads as "no
 * urgent state to signal". Other states map to their palette colour. */
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

export interface SelectedCastleInfo {
  occupantType: number;
  pubkey: string;
}

export interface CastleLayerCenter {
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
}

export interface CastleLayerGeometries {
  /* Plate geometry — PlaneGeometry(1,1) rotated to XZ. Cloned by the
   * orchestrator and handed in so the geometry buffer is shared with
   * the player/encounter tile layers. */
  tileGeom: THREE.BufferGeometry;
  /* Ring geometry — ShapeGeometry of a square frame with a hole. */
  tileFrameGeom: THREE.BufferGeometry;
  /* Dot geometry — CircleGeometry rotated to XZ. Used for towers + pips. */
  dotGeom: THREE.BufferGeometry;
  /* Shared base materials — cloned per layer so material tweaks
   * (polygonOffset, opacity) stay scoped to one layer. */
  fillMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

export class CastleLayer {
  private group: THREE.Group;
  private rgu: number;
  private cityLatGrid: number;
  private cityLongGrid: number;
  private disposed = false;

  private plates: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private towers: THREE.InstancedMesh;
  private pips: THREE.InstancedMesh;
  private instanceCells: OccupiedCell[] = [];

  constructor(parent: THREE.Group, center: CastleLayerCenter, geom: CastleLayerGeometries) {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;

    this.group = new THREE.Group();
    this.group.name = "city-castle-layer";
    parent.add(this.group);

    /* Plates — slate fills at the castle's footprint. RenderOrder 3.0
     * sits BENEATH player + encounter dots (3.2) so a player standing
     * on a castle cell remains visible. */
    this.plates = new THREE.InstancedMesh(geom.tileGeom.clone(), geom.fillMat.clone(), MAX_CASTLES);
    this.plates.count = 0;
    this.plates.frustumCulled = false;
    this.plates.renderOrder = 3.0;
    this.group.add(this.plates);

    /* Rings — cream stroke for vacant / non-selected, gold for the
     * currently selected castle. */
    this.rings = new THREE.InstancedMesh(
      geom.tileFrameGeom.clone(),
      geom.ringMat.clone(),
      MAX_CASTLES,
    );
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2.9;
    this.group.add(this.rings);

    /* Towers — small dark-ink disks. RenderOrder 3.05 sits between
     * the plate (3.0) and player dots (3.2). */
    this.towers = new THREE.InstancedMesh(
      geom.dotGeom.clone(),
      geom.fillMat.clone(),
      MAX_CASTLE_TOWERS,
    );
    this.towers.count = 0;
    this.towers.frustumCulled = false;
    this.towers.renderOrder = 3.05;
    this.group.add(this.towers);

    /* Status pip — one coloured disk per castle. RenderOrder above
     * the tower layer so the pip is always visible at the plate
     * corner regardless of which tower happens to sit nearest. */
    this.pips = new THREE.InstancedMesh(
      geom.dotGeom.clone(),
      geom.fillMat.clone(),
      MAX_CASTLE_PIPS,
    );
    this.pips.count = 0;
    this.pips.frustumCulled = false;
    this.pips.renderOrder = 3.07;
    this.group.add(this.pips);
  }

  setCenterGrid(center: CastleLayerCenter): void {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;
  }

  /** Returns the cell that drove a given plate instance (raycast
   * resolves clicks on plates back to the source castle). */
  cellForInstance(mesh: THREE.Object3D, instanceId: number): OccupiedCell | null {
    if (mesh === this.plates) return this.instanceCells[instanceId] ?? null;
    return null;
  }

  /** Raycaster targets — plate only; towers/pips/rings are passive
   * paint and don't need their own click resolution. */
  getInteractiveMeshes(): THREE.Object3D[] {
    return [this.plates];
  }

  /** Paint all castles from `occupied`. Caller filters NOTHING — this
   * method walks the full stream and ignores non-castle cells so the
   * orchestrator doesn't need a separate pre-pass. `renderAsTiles` /
   * `cssPxClamped` come from the caller (same values the occupant
   * layer uses) so dot-mode plate scaling stays in sync. */
  update(
    occupied: OccupiedCell[],
    selected: SelectedCastleInfo | null,
    renderAsTiles: boolean,
    cellWorld: number,
    cssPxClamped: number,
  ): void {
    const PLATE_CAPACITY = this.plates.instanceMatrix.count;
    const TOWER_CAPACITY = this.towers.instanceMatrix.count;
    const PIP_CAPACITY = this.pips.instanceMatrix.count;
    let plateCount = 0;
    let towerCount = 0;
    let pipCount = 0;
    this.instanceCells.length = 0;

    const tmpMat = new THREE.Matrix4();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const tmpPos = new THREE.Vector3();

    for (let i = 0; i < occupied.length; i++) {
      const cell = occupied[i]!;
      if (cell.occupantType !== OCCUPANT_CASTLE) continue;
      if (cell.footprintAnchor !== true) continue;
      if (plateCount >= PLATE_CAPACITY) continue;

      const ox = cell.gridLong - this.cityLongGrid;
      const oy = cell.gridLat - this.cityLatGrid;
      const n = Math.max(1, cell.footprintSize ?? 1);
      /* Anchor is the SW corner; centre the plate over the geometric
       * centre of the N×N range. */
      const centerOx = ox + (n - 1) / 2;
      const centerOy = oy + (n - 1) / 2;
      const center = gridToWorld(centerOx, centerOy, this.rgu);
      const y = OVERLAY_Y_BIAS;

      /* Match selection by occupant pubkey, not by (gridLat, gridLong).
       * The raycast fallback in CityTerrainMapWebGL can commit
       * selectedEntity at a non-anchor footprint cell — a coord-based
       * check would then see no selection and the gold stroke would
       * fail to fire. */
      const isSelected =
        selected != null &&
        selected.occupantType === OCCUPANT_CASTLE &&
        selected.pubkey === cell.occupant;

      /* Plate sizing — tile mode draws the full N×N footprint; dot
       * mode scales up to a constant CSS-px target so the castle
       * stays legible at low zoom. `castleScale = max(1, n*0.7)`
       * mirrors the 2D fallback so a Citadel reads visibly bigger
       * than an Outpost at overview zoom. */
      const TARGET_CASTLE_DIAMETER_CSS_PX = 12;
      const dotExtent = (TARGET_CASTLE_DIAMETER_CSS_PX * cellWorld) / cssPxClamped;
      const castleScale = Math.max(1, n * 0.7);
      const plateExtent = renderAsTiles ? n * cellWorld : dotExtent * castleScale;
      /* Per-grid-cell world distance on the RENDERED plate — equals
       * cellWorld in tile mode, plateExtent/n in dot mode. Tower/pip
       * positions use this so they follow the plate's visual size. */
      const cellOnPlate = plateExtent / n;

      tmpPos.set(center.wx, y, center.wz);
      tmpScale.set(plateExtent, 1, plateExtent);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      this.plates.setMatrixAt(plateCount, tmpMat);
      this.plates.setColorAt(plateCount, COLOR_CASTLE);
      this.rings.setMatrixAt(plateCount, tmpMat);
      this.rings.setColorAt(plateCount, isSelected ? COLOR_SELECTED : COLOR_CREAM);
      this.instanceCells[plateCount] = cell;
      plateCount++;

      /* Tower glyphs. */
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
        this.towers.setMatrixAt(towerCount, tmpMat);
        this.towers.setColorAt(towerCount, COLOR_CASTLE_TOWER);
        towerCount++;
      }

      /* Status pip. */
      const pipColor = colorForCastleStatus(cell.castleStatus);
      if (pipColor && pipCount < PIP_CAPACITY) {
        /* N=1: ~60% of the half-cell toward a corner so the pip sits
         * visibly inside the cell rather than over the central tower.
         * N≥2: 85% of the half-plate so the pip lands in a corner cell. */
        const pipReach = (n / 2) * (n <= 1 ? 0.6 : 0.85);
        const pipDx = pipReach * cellOnPlate;
        const pipDz = -pipReach * cellOnPlate;
        tmpPos.set(center.wx + pipDx, y + 2e-4, center.wz + pipDz);
        const pipR = plateExtent * (n <= 1 ? 0.13 : 0.09);
        tmpScale.set(pipR, 1, pipR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        this.pips.setMatrixAt(pipCount, tmpMat);
        this.pips.setColorAt(pipCount, pipColor);
        pipCount++;
      }
    }

    this.plates.count = plateCount;
    this.rings.count = plateCount;
    this.towers.count = towerCount;
    this.pips.count = pipCount;

    this.plates.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.towers.instanceMatrix.needsUpdate = true;
    this.pips.instanceMatrix.needsUpdate = true;
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    if (this.towers.instanceColor) this.towers.instanceColor.needsUpdate = true;
    if (this.pips.instanceColor) this.pips.instanceColor.needsUpdate = true;

    /* Quieten unused-var TS check on MESH_SIZE in case future tooling
     * elides unused imports. The constant comes from coords and is
     * useful enough to keep around for inline grid math. */
    void MESH_SIZE;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
