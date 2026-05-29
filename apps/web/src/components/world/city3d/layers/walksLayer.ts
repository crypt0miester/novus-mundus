/**
 * Travel-line overlay — the dashed line + interpolated marker the
 * disc shows while a player is walking from one cell to another.
 *
 * Two walk styles:
 *   - Own walk: single solid-coloured pair of (line, marker, halo)
 *     showing the local viewer's in-flight intracity walk.
 *   - Other walks: pre-allocated pool of N=MAX_OTHER_WALKS pairs for
 *     every other player visibly walking in the same city. Pool
 *     entries beyond the active count are hidden.
 *
 * Both line materials carry `depthTest: false` + `depthWrite: false`
 * because the line is coplanar with the terrain plate at Y≈0 and the
 * GPU's depth-buffer precision at typical camera angles flickered
 * dashes in and out at oblique views ("cut in places" symptom). The
 * terrain's polygonOffset protects triangle overlays but doesn't
 * apply to Line primitives.
 */
import * as THREE from "three";
import { MESH_SIZE, getElevationAt, gridToWorld } from "../coords";
import {
  COLOR_SEAL,
  MAX_OTHER_WALKS,
  OVERLAY_Y_BIAS,
  WALK_LINE_LIFT,
  parseHexLinear,
} from "./palette";

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

export interface WalksLayerCenter {
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
}

interface OtherWalkSlot {
  line: THREE.Line;
  marker: THREE.Mesh;
}

export class WalksLayer {
  private group: THREE.Group;
  private rgu: number;
  private cityLatGrid: number;
  private cityLongGrid: number;
  private currentCssPxPerCell = 1;
  private disposed = false;

  private ownLine: THREE.Line;
  private ownMarker: THREE.Mesh;
  private ownHalo: THREE.Mesh;
  private otherPool: OtherWalkSlot[];
  private otherActiveCount = 0;

  constructor(parent: THREE.Group, center: WalksLayerCenter) {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;

    this.group = new THREE.Group();
    this.group.name = "city-walks-layer";
    parent.add(this.group);

    /* Own walk — line + marker + halo. */
    const ownLineGeom = new THREE.BufferGeometry();
    ownLineGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const ownLineMat = new THREE.LineDashedMaterial({
      color: COLOR_SEAL,
      transparent: true,
      opacity: 0.85,
      dashSize: 0.06,
      gapSize: 0.04,
      linewidth: 2,
      depthTest: false,
      depthWrite: false,
    });
    this.ownLine = new THREE.Line(ownLineGeom, ownLineMat);
    this.ownLine.visible = false;
    this.ownLine.renderOrder = 1.5;
    this.group.add(this.ownLine);

    const markerGeom = new THREE.CircleGeometry(1, 16);
    markerGeom.rotateX(-Math.PI / 2);
    this.ownMarker = new THREE.Mesh(
      markerGeom.clone(),
      new THREE.MeshBasicMaterial({ color: COLOR_SEAL }),
    );
    this.ownMarker.visible = false;
    this.ownMarker.renderOrder = 1.6;
    this.group.add(this.ownMarker);

    this.ownHalo = new THREE.Mesh(
      markerGeom.clone(),
      new THREE.MeshBasicMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.25,
      }),
    );
    this.ownHalo.visible = false;
    this.ownHalo.renderOrder = 1.55;
    this.group.add(this.ownHalo);

    /* Other walks — pre-allocated pool. */
    this.otherPool = [];
    for (let i = 0; i < MAX_OTHER_WALKS; i++) {
      const lineGeom = new THREE.BufferGeometry();
      lineGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const lineMat = new THREE.LineDashedMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: 0.4,
        dashSize: 0.04,
        gapSize: 0.04,
        linewidth: 1.5,
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
      this.otherPool.push({ line, marker });
    }
  }

  setCenterGrid(center: WalksLayerCenter): void {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;
  }

  /** Marker size needs the current zoom (constant CSS-px on screen).
   * Pulled from the renderer's last-known cssPxPerCell so callers
   * don't have to thread it through both updateOwnWalk + updateOther. */
  setCssPxPerCell(cssPxPerCell: number): void {
    this.currentCssPxPerCell = Math.max(0.05, cssPxPerCell);
  }

  updateOwnWalk(walk: WalkLine | null | undefined): void {
    if (!walk) {
      this.ownLine.visible = false;
      this.ownMarker.visible = false;
      this.ownHalo.visible = false;
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

    const posAttr = this.ownLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    posAttr.setXYZ(0, from.wx, yF, from.wz);
    posAttr.setXYZ(1, to.wx, yT, to.wz);
    posAttr.needsUpdate = true;
    this.ownLine.geometry.computeBoundingSphere();
    this.ownLine.computeLineDistances();
    this.ownLine.visible = true;

    /* Cosmetic name colour tints both the line and the marker so the
     * walker's identity follows them across the disc — same rule the
     * 2D fallback applies. Falls through to the canonical seal-orange
     * when the walker has no colour equipped. */
    const walkColor = walk.nameColorHex ? parseHexLinear(walk.nameColorHex) : null;
    const lineMat = this.ownLine.material as THREE.LineBasicMaterial;
    lineMat.color.copy(walkColor ?? COLOR_SEAL);
    const markerMat = this.ownMarker.material as THREE.MeshBasicMaterial;
    markerMat.color.copy(walkColor ?? COLOR_SEAL);

    const t = Math.min(1, Math.max(0, walk.pct / 100));
    const mx = from.wx + (to.wx - from.wx) * t;
    const my = yF + (yT - yF) * t;
    const mz = from.wz + (to.wz - from.wz) * t;
    /* Marker size: constant ~5 CSS px on screen, same formula as
     * occupant dots so the local walker reads as a moving "you" dot. */
    const cellWorld = MESH_SIZE / (2 * this.rgu);
    const r = (5 * cellWorld) / this.currentCssPxPerCell;
    this.ownMarker.scale.set(r, 1, r);
    this.ownMarker.position.set(mx, my + 5e-4, mz);
    this.ownMarker.visible = true;
    this.ownHalo.scale.set(r * 2.2, 1, r * 2.2);
    this.ownHalo.position.set(mx, my + 2e-4, mz);
    this.ownHalo.visible = true;
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
      const entry = this.otherPool[i]!;
      const oxF = w.fromGridLong - this.cityLongGrid;
      const oyF = w.fromGridLat - this.cityLatGrid;
      const oxT = w.toGridLong - this.cityLongGrid;
      const oyT = w.toGridLat - this.cityLatGrid;
      const from = gridToWorld(oxF, oyF, this.rgu);
      const to = gridToWorld(oxT, oyT, this.rgu);
      const yF = getElevationAt(oxF, oyF) + OVERLAY_Y_BIAS + WALK_LINE_LIFT;
      const yT = getElevationAt(oxT, oyT) + OVERLAY_Y_BIAS + WALK_LINE_LIFT;
      const posAttr = entry.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      posAttr.setXYZ(0, from.wx, yF, from.wz);
      posAttr.setXYZ(1, to.wx, yT, to.wz);
      posAttr.needsUpdate = true;
      entry.line.geometry.computeBoundingSphere();
      entry.line.computeLineDistances();
      entry.line.visible = true;

      const walkColor = w.nameColorHex ? parseHexLinear(w.nameColorHex) : null;
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
    for (let i = n; i < this.otherActiveCount; i++) {
      const entry = this.otherPool[i]!;
      entry.line.visible = false;
      entry.marker.visible = false;
    }
    this.otherActiveCount = n;
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
