/**
 * Players + encounters — circle dot vs filled-tile dual-mode overlay.
 *
 * Eight InstancedMeshes (4 player + 4 encounter), each mesh having a
 * dot-mode pair (sub-cell pixel for low-zoom) and a tile-mode pair
 * (full N×N grid cell for high-zoom). Visibility flips at
 * `GRID_OVERLAY_MIN_CSS_PX_PER_CELL` by toggling count=0 on the
 * inactive family.
 *
 * Castles flow through `update()` too but skip; the orchestrator
 * routes castles to `CastleLayer.update()` instead.
 *
 * Parallel `*InstanceCells` arrays let the raycaster resolve a hit
 * instance ID back to its source OccupiedCell.
 */
import * as THREE from "three";
import { OCCUPANT_PLAYER, OCCUPANT_ENCOUNTER } from "novus-mundus-sdk";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import { MESH_SIZE, getElevationAt, gridToWorld } from "../coords";
import {
  COLOR_CREAM,
  COLOR_MY_PLAYER,
  COLOR_PLAYER,
  COLOR_SELECTED,
  COLOR_WILD,
  MAX_OCCUPANTS,
  OVERLAY_Y_BIAS,
  parseHexLinear,
  warnOnce,
} from "./palette";

export interface SelectedOccupantInfo {
  gridLat: number;
  gridLong: number;
}

export interface OccupantsLayerCenter {
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
}

/* Shared geometries + base materials. The orchestrator builds these
 * once and hands clones to each sub-layer so vertex buffers + material
 * defaults are deduplicated. */
export interface OccupantsLayerGeometries {
  dotGeom: THREE.BufferGeometry;
  ringGeom: THREE.BufferGeometry;
  diamondGeom: THREE.BufferGeometry;
  diamondRingGeom: THREE.BufferGeometry;
  tileGeom: THREE.BufferGeometry;
  tileFrameGeom: THREE.BufferGeometry;
  fillMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
}

export class OccupantsLayer {
  private group: THREE.Group;
  private rgu: number;
  private cityLatGrid: number;
  private cityLongGrid: number;
  private disposed = false;

  private playerDots: THREE.InstancedMesh;
  private playerDotRings: THREE.InstancedMesh;
  private playerTiles: THREE.InstancedMesh;
  private playerTileRings: THREE.InstancedMesh;
  private encounterDots: THREE.InstancedMesh;
  private encounterDotRings: THREE.InstancedMesh;
  private encounterTiles: THREE.InstancedMesh;
  private encounterTileRings: THREE.InstancedMesh;

  private playerDotCells: OccupiedCell[] = [];
  private playerTileCells: OccupiedCell[] = [];
  private encounterDotCells: OccupiedCell[] = [];
  private encounterTileCells: OccupiedCell[] = [];

  constructor(parent: THREE.Group, center: OccupantsLayerCenter, geom: OccupantsLayerGeometries) {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;

    this.group = new THREE.Group();
    this.group.name = "city-occupants-layer";
    parent.add(this.group);

    /* Player dot family — circle fill + ring halo for low-zoom. */
    this.playerDots = new THREE.InstancedMesh(geom.dotGeom, geom.fillMat.clone(), MAX_OCCUPANTS);
    this.playerDots.count = 0;
    this.playerDots.frustumCulled = false;
    this.playerDots.renderOrder = 3.2;
    this.group.add(this.playerDots);

    this.playerDotRings = new THREE.InstancedMesh(
      geom.ringGeom,
      geom.ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.playerDotRings.count = 0;
    this.playerDotRings.frustumCulled = false;
    this.playerDotRings.renderOrder = 3.1;
    this.group.add(this.playerDotRings);

    /* Player tile family — full cell fill + square frame for high-zoom. */
    this.playerTiles = new THREE.InstancedMesh(geom.tileGeom, geom.fillMat.clone(), MAX_OCCUPANTS);
    this.playerTiles.count = 0;
    this.playerTiles.frustumCulled = false;
    this.playerTiles.renderOrder = 3.2;
    this.group.add(this.playerTiles);

    this.playerTileRings = new THREE.InstancedMesh(
      geom.tileFrameGeom,
      geom.ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.playerTileRings.count = 0;
    this.playerTileRings.frustumCulled = false;
    this.playerTileRings.renderOrder = 3.1;
    this.group.add(this.playerTileRings);

    /* Encounter dot family — axis-aligned square (not a diamond) +
     * matching frame so shape alone distinguishes from players at
     * any zoom. */
    this.encounterDots = new THREE.InstancedMesh(
      geom.diamondGeom,
      geom.fillMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterDots.count = 0;
    this.encounterDots.frustumCulled = false;
    this.encounterDots.renderOrder = 3.2;
    this.group.add(this.encounterDots);

    this.encounterDotRings = new THREE.InstancedMesh(
      geom.diamondRingGeom,
      geom.ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterDotRings.count = 0;
    this.encounterDotRings.frustumCulled = false;
    this.encounterDotRings.renderOrder = 3.1;
    this.group.add(this.encounterDotRings);

    /* Encounter tile family — same shapes as player tile family
     * (a 1-cell square frame), distinguished only by fill colour
     * (wild rust vs player tobacco). */
    this.encounterTiles = new THREE.InstancedMesh(
      geom.tileGeom.clone(),
      geom.fillMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterTiles.count = 0;
    this.encounterTiles.frustumCulled = false;
    this.encounterTiles.renderOrder = 3.2;
    this.group.add(this.encounterTiles);

    this.encounterTileRings = new THREE.InstancedMesh(
      geom.tileFrameGeom.clone(),
      geom.ringMat.clone(),
      MAX_OCCUPANTS,
    );
    this.encounterTileRings.count = 0;
    this.encounterTileRings.frustumCulled = false;
    this.encounterTileRings.renderOrder = 3.1;
    this.group.add(this.encounterTileRings);
  }

  setCenterGrid(center: OccupantsLayerCenter): void {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;
  }

  /** Returns the cell that drove a given instance of an interactive
   * mesh. Returns null if the mesh isn't one of the occupant layers
   * or the instance ID is out of range. */
  cellForInstance(mesh: THREE.Object3D, instanceId: number): OccupiedCell | null {
    if (mesh === this.playerDots) return this.playerDotCells[instanceId] ?? null;
    if (mesh === this.playerTiles) return this.playerTileCells[instanceId] ?? null;
    if (mesh === this.encounterDots) return this.encounterDotCells[instanceId] ?? null;
    if (mesh === this.encounterTiles) return this.encounterTileCells[instanceId] ?? null;
    return null;
  }

  /** Meshes the raycaster should test against. */
  getInteractiveMeshes(): THREE.Object3D[] {
    return [this.playerDots, this.playerTiles, this.encounterDots, this.encounterTiles];
  }

  /** Paint all players + encounters from `occupied`. Castle cells in
   * the stream are skipped — the orchestrator routes them to
   * CastleLayer. */
  update(
    occupied: OccupiedCell[],
    selected: SelectedOccupantInfo | null,
    myPlayerPubkey: string | undefined,
    renderAsTiles: boolean,
    dotR: number,
    tileHalf: number,
  ): void {
    let pCount = 0;
    let eCount = 0;
    let pTileCount = 0;
    let eTileCount = 0;

    this.playerDotCells.length = 0;
    this.playerTileCells.length = 0;
    this.encounterDotCells.length = 0;
    this.encounterTileCells.length = 0;

    const tmpMat = new THREE.Matrix4();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const tmpPos = new THREE.Vector3();

    for (let i = 0; i < occupied.length; i++) {
      const cell = occupied[i]!;
      const isPlayer = cell.occupantType === OCCUPANT_PLAYER;
      const isEncounter = cell.occupantType === OCCUPANT_ENCOUNTER;
      if (!isPlayer && !isEncounter) continue;

      const ox = cell.gridLong - this.cityLongGrid;
      const oy = cell.gridLat - this.cityLatGrid;
      const { wx, wz } = gridToWorld(ox, oy, this.rgu);
      const y = getElevationAt(ox, oy) + OVERLAY_Y_BIAS;

      const isMyPlayer = isPlayer && myPlayerPubkey != null && cell.occupant === myPlayerPubkey;
      const isSelected =
        selected != null &&
        selected.gridLat === cell.gridLat &&
        selected.gridLong === cell.gridLong;

      /* Cosmetic name colour wins over the canonical palette. Falls
       * through to default ink colours when the player has no paid
       * colour equipped. */
      const cosmeticFill = cell.nameColorHex ? parseHexLinear(cell.nameColorHex) : null;
      const fill = cosmeticFill
        ? cosmeticFill
        : isMyPlayer
          ? COLOR_MY_PLAYER
          : isPlayer
            ? COLOR_PLAYER
            : COLOR_WILD;

      /* Capacity cap — writes past MAX_OCCUPANTS silently drop into
       * the TypedArray's overflow but `.count` would still bump and
       * three.js would render past-the-end instances holding the
       * identity matrix (visible as a stack of ghost dots at world
       * origin). Skip + warn once. */
      const playerCapHit = isPlayer && (renderAsTiles ? pTileCount : pCount) >= MAX_OCCUPANTS;
      const encounterCapHit = isEncounter && (renderAsTiles ? eTileCount : eCount) >= MAX_OCCUPANTS;
      if (playerCapHit || encounterCapHit) {
        warnOnce(
          `[city3d/occupants] capacity reached — MAX_OCCUPANTS=${MAX_OCCUPANTS}. ` +
            `Some dots/tiles are being dropped this frame. Bump the constant in layers/palette.ts.`,
        );
        continue;
      }

      if (renderAsTiles) {
        tmpPos.set(wx, y, wz);
        tmpScale.set(tileHalf * 2, 1, tileHalf * 2);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        if (isPlayer) {
          this.playerTiles.setMatrixAt(pTileCount, tmpMat);
          this.playerTiles.setColorAt(pTileCount, fill);
          this.playerTileRings.setMatrixAt(pTileCount, tmpMat);
          this.playerTileRings.setColorAt(pTileCount, isSelected ? COLOR_SELECTED : COLOR_CREAM);
          this.playerTileCells[pTileCount] = cell;
          pTileCount++;
        } else {
          this.encounterTiles.setMatrixAt(eTileCount, tmpMat);
          this.encounterTiles.setColorAt(eTileCount, fill);
          this.encounterTileRings.setMatrixAt(eTileCount, tmpMat);
          this.encounterTileRings.setColorAt(eTileCount, isSelected ? COLOR_SELECTED : COLOR_CREAM);
          this.encounterTileCells[eTileCount] = cell;
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
          this.playerDotRings.setColorAt(pCount, isSelected ? COLOR_SELECTED : COLOR_CREAM);
          this.playerDotCells[pCount] = cell;
          pCount++;
        } else {
          this.encounterDots.setMatrixAt(eCount, tmpMat);
          this.encounterDots.setColorAt(eCount, fill);
          this.encounterDotRings.setMatrixAt(eCount, tmpMat);
          this.encounterDotRings.setColorAt(eCount, isSelected ? COLOR_SELECTED : COLOR_CREAM);
          this.encounterDotCells[eCount] = cell;
          eCount++;
        }
      }
    }

    /* Toggle visibility by setting count=0 on the inactive family. */
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
    if (this.playerDots.instanceColor) this.playerDots.instanceColor.needsUpdate = true;
    if (this.playerDotRings.instanceColor) this.playerDotRings.instanceColor.needsUpdate = true;
    if (this.encounterDots.instanceColor) this.encounterDots.instanceColor.needsUpdate = true;
    if (this.encounterDotRings.instanceColor)
      this.encounterDotRings.instanceColor.needsUpdate = true;
    if (this.playerTiles.instanceColor) this.playerTiles.instanceColor.needsUpdate = true;
    if (this.playerTileRings.instanceColor) this.playerTileRings.instanceColor.needsUpdate = true;
    if (this.encounterTiles.instanceColor) this.encounterTiles.instanceColor.needsUpdate = true;
    if (this.encounterTileRings.instanceColor)
      this.encounterTileRings.instanceColor.needsUpdate = true;

    /* MESH_SIZE is unused here directly but the import is kept so
     * future grid-relative math stays close to the layer's coord
     * helpers without round-tripping through the orchestrator. */
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
