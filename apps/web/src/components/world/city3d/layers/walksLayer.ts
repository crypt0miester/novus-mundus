/**
 * Travel-line overlay - the dashed line + interpolated marker the
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
 *
 * Dash pattern is SCREEN-SPACE: `refreshDashUniforms` re-derives the
 * world-unit dash/gap from the live cssPxPerCell so the dashes match
 * the 2D fallback's setLineDash CSS-px values at every zoom. The old
 * fixed world-unit dashes (0.06/0.04) spanned multiple grid cells in
 * a typical city, so short walks landed inside one gap and the line
 * read as cut off near the endpoints.
 *
 * `animate(nowMs)` runs once per paint: it extrapolates the marker
 * between 1 Hz chain pushes (via WalkLine.pctRatePerSec), advances
 * the fade-in/out alphas, and drives animated cosmetic colors. It
 * returns true while anything is still moving so the paint loop can
 * keep scheduling frames only when a walk is actually animating.
 */
import * as THREE from "three";
import { animatedColorAt } from "@/lib/config/cosmetics-catalog";
import { cellWorldFor, gridToWorld, srgbToLinear } from "../coords";
import {
  COLOR_SEAL,
  MAX_OTHER_WALKS,
  OVERLAY_Y_BIAS,
  WALK_LINE_LIFT,
  parseHexLinear,
} from "./palette";
// Canonical walk-line record shared between both renderers - same
// convention as SelectedEntity in markers.ts (the 2D fallback owns
// the shared occupant/walk identity types).
import type { WalkLine } from "../../CityTerrainMap2DFallback";

export type { WalkLine };

export interface WalksLayerCenter {
  rgu: number;
  cityLatGrid: number;
  cityLongGrid: number;
}

// Screen-space dash/gap, matching the 2D fallback's ctx.setLineDash
// values (CityTerrainMap2DFallback.tsx: [6,4] own / [4,4] others).
const OWN_DASH_CSS_PX = 6;
const OWN_GAP_CSS_PX = 4;
const OTHER_DASH_CSS_PX = 4;
const OTHER_GAP_CSS_PX = 4;

// Constant on-screen marker sizes; others slightly smaller than own
// so the user's own walk reads as primary.
const OWN_MARKER_CSS_PX = 5;
const OTHER_MARKER_CSS_PX = 3;

// Base opacities the fade alphas scale against.
const OWN_LINE_OPACITY = 0.85;
const OWN_HALO_OPACITY = 0.25;
const OTHER_LINE_OPACITY = 0.4;
const OTHER_MARKER_OPACITY = 0.85;

// Walk lines fade in on start and out on arrival/cancel instead of
// popping. Alpha advances by dt * (1000 / WALK_FADE_MS) per frame.
const WALK_FADE_MS = 260;

interface WalkEndpoints {
  fromWx: number;
  fromWz: number;
  toWx: number;
  toWz: number;
  y: number;
}

interface OtherWalkSlot {
  line: THREE.Line;
  marker: THREE.Mesh;
  // Identity of the walk currently occupying the slot - a key change
  // restarts the fade-in and rewrites the line geometry.
  key: string | null;
  walk: WalkLine | null;
  pushedAtMs: number;
  alpha: number;
  ends: WalkEndpoints;
}

const scratchColor = new THREE.Color();

interface WalkTint {
  alphaMod: number;
  animating: boolean;
}
// Reused per resolveWalkColor call so the per-frame walk sweep stays
// allocation-free.
const scratchTint: WalkTint = { alphaMod: 1, animating: false };

export class WalksLayer {
  private group: THREE.Group;
  private rgu: number;
  private cityLatGrid: number;
  private cityLongGrid: number;
  private currentCssPxPerCell = 1;
  private lastAnimMs = 0;
  private disposed = false;

  private ownLine: THREE.Line;
  private ownMarker: THREE.Mesh;
  private ownHalo: THREE.Mesh;
  // Last pushed walk, retained through the fade-out so the line holds
  // its final geometry while it dissolves. `ownActive` false means the
  // walk ended and the alpha is easing toward 0.
  private ownWalk: WalkLine | null = null;
  private ownActive = false;
  private ownAlpha = 0;
  private ownPushedAtMs = 0;
  private ownEnds: WalkEndpoints = { fromWx: 0, fromWz: 0, toWx: 0, toWz: 0, y: 0 };

  private otherPool: OtherWalkSlot[];

  constructor(parent: THREE.Group, center: WalksLayerCenter) {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;

    this.group = new THREE.Group();
    this.group.name = "city-walks-layer";
    parent.add(this.group);

    // Own walk - line + marker + halo.
    const ownLineGeom = new THREE.BufferGeometry();
    ownLineGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    // dashSize/gapSize are owned by refreshDashUniforms (screen-space,
    // re-derived per zoom); linewidth is omitted - WebGL ignores it.
    const ownLineMat = new THREE.LineDashedMaterial({
      color: COLOR_SEAL,
      transparent: true,
      opacity: OWN_LINE_OPACITY,
      depthTest: false,
      depthWrite: false,
    });
    this.ownLine = new THREE.Line(ownLineGeom, ownLineMat);
    this.ownLine.visible = false;
    this.ownLine.renderOrder = 1.5;
    // Every overlay layer opts out of frustum culling - the geometry is
    // rewritten in place and a culled line mid-walk reads as a vanished
    // route. Same convention as occupants/castle/grid.
    this.ownLine.frustumCulled = false;
    this.group.add(this.ownLine);

    const markerGeom = new THREE.CircleGeometry(1, 16);
    markerGeom.rotateX(-Math.PI / 2);
    this.ownMarker = new THREE.Mesh(
      markerGeom.clone(),
      new THREE.MeshBasicMaterial({ color: COLOR_SEAL, transparent: true }),
    );
    this.ownMarker.visible = false;
    this.ownMarker.renderOrder = 1.6;
    this.ownMarker.frustumCulled = false;
    this.group.add(this.ownMarker);

    this.ownHalo = new THREE.Mesh(
      markerGeom.clone(),
      new THREE.MeshBasicMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: OWN_HALO_OPACITY,
      }),
    );
    this.ownHalo.visible = false;
    this.ownHalo.renderOrder = 1.55;
    this.ownHalo.frustumCulled = false;
    this.group.add(this.ownHalo);

    // Other walks - pre-allocated pool.
    this.otherPool = [];
    for (let i = 0; i < MAX_OTHER_WALKS; i++) {
      const lineGeom = new THREE.BufferGeometry();
      lineGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const lineMat = new THREE.LineDashedMaterial({
        color: COLOR_SEAL,
        transparent: true,
        opacity: OTHER_LINE_OPACITY,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.visible = false;
      line.renderOrder = 1.2;
      line.frustumCulled = false;
      const marker = new THREE.Mesh(
        markerGeom.clone(),
        new THREE.MeshBasicMaterial({
          color: COLOR_SEAL,
          transparent: true,
          opacity: OTHER_MARKER_OPACITY,
        }),
      );
      marker.visible = false;
      marker.renderOrder = 1.3;
      marker.frustumCulled = false;
      this.group.add(line);
      this.group.add(marker);
      this.otherPool.push({
        line,
        marker,
        key: null,
        walk: null,
        pushedAtMs: 0,
        alpha: 0,
        ends: { fromWx: 0, fromWz: 0, toWx: 0, toWz: 0, y: 0 },
      });
    }
    this.refreshDashUniforms();
  }

  setCenterGrid(center: WalksLayerCenter): void {
    this.rgu = center.rgu;
    this.cityLatGrid = center.cityLatGrid;
    this.cityLongGrid = center.cityLongGrid;
    this.refreshDashUniforms();
  }

  /** Marker + dash sizes need the current zoom (constant CSS-px on
   * screen). Pushed every paint from the markers orchestrator; the
   * epsilon guard skips the uniform sweep when the zoom hasn't moved. */
  setCssPxPerCell(cssPxPerCell: number): void {
    const clamped = Math.max(0.05, cssPxPerCell);
    if (Math.abs(clamped - this.currentCssPxPerCell) < this.currentCssPxPerCell * 1e-3) return;
    this.currentCssPxPerCell = clamped;
    this.refreshDashUniforms();
  }

  // World units per CSS pixel at the camera focus - the conversion the
  // dash + marker sizing shares.
  private worldPerCssPx(): number {
    return cellWorldFor(this.rgu) / this.currentCssPxPerCell;
  }

  private refreshDashUniforms(): void {
    const wpp = this.worldPerCssPx();
    const ownMat = this.ownLine.material as THREE.LineDashedMaterial;
    ownMat.dashSize = OWN_DASH_CSS_PX * wpp;
    ownMat.gapSize = OWN_GAP_CSS_PX * wpp;
    for (const slot of this.otherPool) {
      // Pool fills contiguously; inactive slots get dashes on activation.
      if (!slot.walk) break;
      const mat = slot.line.material as THREE.LineDashedMaterial;
      mat.dashSize = OTHER_DASH_CSS_PX * wpp;
      mat.gapSize = OTHER_GAP_CSS_PX * wpp;
    }
  }

  private computeEnds(w: WalkLine, out: WalkEndpoints): void {
    const from = gridToWorld(
      w.fromGridLong - this.cityLongGrid,
      w.fromGridLat - this.cityLatGrid,
      this.rgu,
    );
    const to = gridToWorld(
      w.toGridLong - this.cityLongGrid,
      w.toGridLat - this.cityLatGrid,
      this.rgu,
    );
    out.fromWx = from.wx;
    out.fromWz = from.wz;
    out.toWx = to.wx;
    out.toWz = to.wz;
    // Flat-strategy terrain sits at Y=0; the lift dodges z-fighting.
    out.y = OVERLAY_Y_BIAS + WALK_LINE_LIFT;
  }

  private writeLineGeometry(line: THREE.Line, ends: WalkEndpoints): void {
    const posAttr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    posAttr.setXYZ(0, ends.fromWx, ends.y, ends.fromWz);
    posAttr.setXYZ(1, ends.toWx, ends.y, ends.toWz);
    posAttr.needsUpdate = true;
    line.computeLineDistances();
  }

  updateOwnWalk(walk: WalkLine | null | undefined): void {
    if (!walk) {
      // Keep the last geometry on screen and let animate() fade it out.
      this.ownActive = false;
      return;
    }
    if (!this.ownActive) this.ownAlpha = 0;
    this.ownActive = true;
    const endpointsChanged =
      !this.ownWalk ||
      this.ownWalk.fromGridLat !== walk.fromGridLat ||
      this.ownWalk.fromGridLong !== walk.fromGridLong ||
      this.ownWalk.toGridLat !== walk.toGridLat ||
      this.ownWalk.toGridLong !== walk.toGridLong;
    this.ownWalk = walk;
    this.ownPushedAtMs = performance.now();
    if (endpointsChanged) {
      this.computeEnds(walk, this.ownEnds);
      this.writeLineGeometry(this.ownLine, this.ownEnds);
    }
  }

  updateOtherWalks(walks: WalkLine[] | null | undefined): void {
    const list = walks ?? [];
    const n = Math.min(list.length, MAX_OTHER_WALKS);
    const now = performance.now();
    const wpp = this.worldPerCssPx();
    for (let i = 0; i < n; i++) {
      const w = list[i]!;
      const slot = this.otherPool[i]!;
      const key = `${w.fromGridLat},${w.fromGridLong}>${w.toGridLat},${w.toGridLong}`;
      if (slot.key !== key) {
        slot.key = key;
        slot.alpha = 0;
        this.computeEnds(w, slot.ends);
        this.writeLineGeometry(slot.line, slot.ends);
        // Newly (re)activated slot - the zoom sweep skips inactive slots,
        // so seed the screen-space dash here.
        const mat = slot.line.material as THREE.LineDashedMaterial;
        mat.dashSize = OTHER_DASH_CSS_PX * wpp;
        mat.gapSize = OTHER_GAP_CSS_PX * wpp;
      }
      slot.walk = w;
      slot.pushedAtMs = now;
    }
    for (let i = n; i < this.otherPool.length; i++) {
      const slot = this.otherPool[i]!;
      if (!slot.walk) break;
      slot.walk = null;
      slot.key = null;
      slot.alpha = 0;
      slot.line.visible = false;
      slot.marker.visible = false;
    }
  }

  /** Resolve the walk's tint for this frame into `scratchColor` and
   * `scratchTint` (reused across calls - animate() runs per walk per
   * frame). Animated colours re-resolve per frame (same modulator the
   * 2D fallback applies); static colours hit the parseHexLinear cache. */
  private resolveWalkColor(w: WalkLine, nowMs: number): WalkTint {
    if (w.nameColorHex && w.nameColorAnim) {
      const c = animatedColorAt(w.nameColorHex, w.nameColorAnim, nowMs);
      scratchColor.setRGB(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b));
      scratchTint.alphaMod = c.a;
      scratchTint.animating = true;
      return scratchTint;
    }
    const staticColor = w.nameColorHex ? parseHexLinear(w.nameColorHex) : null;
    scratchColor.copy(staticColor ?? COLOR_SEAL);
    scratchTint.alphaMod = 1;
    scratchTint.animating = false;
    return scratchTint;
  }

  /** Extrapolated march pct for the walk at `nowMs`. Walks are constant
   * rate on chain, so advancing the last pushed pct by rate * elapsed is
   * exact up to clock skew; the next 1 Hz push re-anchors it. */
  private marchPct(w: WalkLine, pushedAtMs: number, nowMs: number, advance: boolean): number {
    const rate = w.pctRatePerSec ?? 0;
    if (!advance || rate <= 0 || w.pct >= 100) return w.pct;
    return Math.min(100, w.pct + (rate * (nowMs - pushedAtMs)) / 1000);
  }

  /** Per-paint tick: fades, marker extrapolation, animated colours.
   * Returns true while another frame is needed so the paint loop only
   * free-runs while a walk is actually animating. */
  animate(nowMs: number): boolean {
    const dt =
      this.lastAnimMs > 0 ? Math.min(0.1, Math.max(0, (nowMs - this.lastAnimMs) / 1000)) : 0.016;
    this.lastAnimMs = nowMs;
    const fadeStep = dt * (1000 / WALK_FADE_MS);
    const wpp = this.worldPerCssPx();
    let needsMore = false;

    // Own walk.
    const own = this.ownWalk;
    if (own) {
      const target = this.ownActive ? 1 : 0;
      if (this.ownAlpha !== target) {
        this.ownAlpha =
          target > this.ownAlpha
            ? Math.min(target, this.ownAlpha + fadeStep)
            : Math.max(target, this.ownAlpha - fadeStep);
        needsMore = true;
      }
      if (!this.ownActive && this.ownAlpha <= 0) {
        this.ownWalk = null;
        this.ownLine.visible = false;
        this.ownMarker.visible = false;
        this.ownHalo.visible = false;
      } else {
        const { alphaMod, animating } = this.resolveWalkColor(own, nowMs);
        if (animating) needsMore = true;
        const lineMat = this.ownLine.material as THREE.LineDashedMaterial;
        lineMat.color.copy(scratchColor);
        lineMat.opacity = OWN_LINE_OPACITY * this.ownAlpha * alphaMod;
        const markerMat = this.ownMarker.material as THREE.MeshBasicMaterial;
        markerMat.color.copy(scratchColor);
        markerMat.opacity = this.ownAlpha * alphaMod;
        (this.ownHalo.material as THREE.MeshBasicMaterial).opacity =
          OWN_HALO_OPACITY * this.ownAlpha;

        const pct = this.marchPct(own, this.ownPushedAtMs, nowMs, this.ownActive);
        if (this.ownActive && (own.pctRatePerSec ?? 0) > 0 && pct < 100) needsMore = true;
        const t = Math.min(1, Math.max(0, pct / 100));
        const mx = this.ownEnds.fromWx + (this.ownEnds.toWx - this.ownEnds.fromWx) * t;
        const mz = this.ownEnds.fromWz + (this.ownEnds.toWz - this.ownEnds.fromWz) * t;
        const r = OWN_MARKER_CSS_PX * wpp;
        this.ownMarker.scale.set(r, 1, r);
        this.ownMarker.position.set(mx, this.ownEnds.y + 5e-4, mz);
        this.ownHalo.scale.set(r * 2.2, 1, r * 2.2);
        this.ownHalo.position.set(mx, this.ownEnds.y + 2e-4, mz);
        this.ownLine.visible = true;
        this.ownMarker.visible = true;
        this.ownHalo.visible = true;
      }
    }

    // Other walks.
    const otherR = OTHER_MARKER_CSS_PX * wpp;
    for (const slot of this.otherPool) {
      const w = slot.walk;
      if (!w) break;
      if (slot.alpha < 1) {
        slot.alpha = Math.min(1, slot.alpha + fadeStep);
        needsMore = true;
      }
      const { alphaMod, animating } = this.resolveWalkColor(w, nowMs);
      if (animating) needsMore = true;
      const lineMat = slot.line.material as THREE.LineDashedMaterial;
      lineMat.color.copy(scratchColor);
      lineMat.opacity = OTHER_LINE_OPACITY * slot.alpha * alphaMod;
      const markerMat = slot.marker.material as THREE.MeshBasicMaterial;
      markerMat.color.copy(scratchColor);
      markerMat.opacity = OTHER_MARKER_OPACITY * slot.alpha * alphaMod;

      const pct = this.marchPct(w, slot.pushedAtMs, nowMs, true);
      if ((w.pctRatePerSec ?? 0) > 0 && pct < 100) needsMore = true;
      const t = Math.min(1, Math.max(0, pct / 100));
      const mx = slot.ends.fromWx + (slot.ends.toWx - slot.ends.fromWx) * t;
      const mz = slot.ends.fromWz + (slot.ends.toWz - slot.ends.fromWz) * t;
      slot.marker.scale.set(otherR, 1, otherR);
      slot.marker.position.set(mx, slot.ends.y + 5e-4, mz);
      slot.line.visible = true;
      slot.marker.visible = true;
    }

    return needsMore;
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
