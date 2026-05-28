/**
 * Landing picker — the SEAL_ORANGE ring + crosshair the user sees
 * over a chosen destination cell before committing to walk there.
 *
 * Pure sub-layer: owns its ring + cross meshes, drives them from
 * `update(selected, cssPxPerCell)`. Disposes its own geometry +
 * materials.
 */
import * as THREE from "three";
import {
  GRID_OVERLAY_MIN_CSS_PX_PER_CELL,
  MESH_SIZE,
  getElevationAt,
  gridToWorld,
} from "../coords";
import { COLOR_SEAL, OVERLAY_Y_BIAS } from "./palette";

export interface LandingLayerCenter {
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
}

export class LandingLayer {
  private group: THREE.Group;
  private ring: THREE.Mesh;
  private cross: THREE.LineSegments;
  private rgu: number;
  private cityLatGrid: number;
  private cityLongGrid: number;
  private disposed = false;

  constructor(parent: THREE.Group, center: LandingLayerCenter) {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;
    this.group = new THREE.Group();
    this.group.name = "city-landing-layer";
    parent.add(this.group);

    /* Square frame aligned with the grid cell boundary — the
     * destination is a specific chain-grid cell, and a square outline
     * reinforces that, especially in tile mode where the cell fills
     * the screen. Outer ±1, inner ±0.78 → ~22% stroke width. */
    const shape = new THREE.Shape();
    shape.moveTo(-1, -1);
    shape.lineTo(1, -1);
    shape.lineTo(1, 1);
    shape.lineTo(-1, 1);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.78, -0.78);
    hole.lineTo(0.78, -0.78);
    hole.lineTo(0.78, 0.78);
    hole.lineTo(-0.78, 0.78);
    hole.closePath();
    shape.holes.push(hole);
    const ringGeom = new THREE.ShapeGeometry(shape);
    ringGeom.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 4;
    this.group.add(this.ring);

    /* Crosshair — built at unit scale, scaled per zoom in `update`. */
    const crossVerts = new Float32Array([
      -1, 0, 0, 1, 0, 0,
      0, 0, -1, 0, 0, 1,
    ]);
    const crossGeom = new THREE.BufferGeometry();
    crossGeom.setAttribute("position", new THREE.BufferAttribute(crossVerts, 3));
    this.cross = new THREE.LineSegments(
      crossGeom,
      new THREE.LineBasicMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.cross.visible = false;
    this.cross.renderOrder = 4.1;
    this.group.add(this.cross);
  }

  setCenterGrid(center: LandingLayerCenter): void {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;
  }

  update(
    selected: { gridLat: number; gridLong: number } | null,
    cssPxPerCell: number,
  ): void {
    if (!selected) {
      this.ring.visible = false;
      this.cross.visible = false;
      return;
    }
    const renderAsTiles = cssPxPerCell >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL;
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    const ox = selected.gridLong - this.cityLongGrid;
    const oy = selected.gridLat - this.cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, this.rgu);
    const y = getElevationAt(ox, oy) + OVERLAY_Y_BIAS * 1.5;
    /* Tile mode: ring tightly around the cell. Dot mode: target a
     * constant ~10 CSS px DIAMETER on screen so it reads as a
     * deliberate landing picker — slightly larger than the 6 CSS px
     * occupant dots so a chosen cell stands out from the crowd. */
    const TARGET_LANDING_DIAMETER_CSS_PX = 10;
    const cssPxClamped = Math.max(0.05, cssPxPerCell);
    const r = renderAsTiles
      ? cellWorld * 0.55
      : (TARGET_LANDING_DIAMETER_CSS_PX * 0.5 * cellWorld) / cssPxClamped;
    this.ring.scale.set(r, 1, r);
    this.ring.position.set(wx, y, wz);
    this.ring.visible = true;
    /* Crosshair arms slightly shorter than the ring radius so the
     * `+` reads through the ring rather than poking past it. */
    const crossR = r * 0.65;
    this.cross.scale.set(crossR, 1, crossR);
    this.cross.position.set(wx, y + 1e-4, wz);
    this.cross.visible = true;
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
