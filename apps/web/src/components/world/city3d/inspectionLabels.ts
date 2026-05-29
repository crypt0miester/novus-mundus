/**
 * Inspection-band name labels — the 3D port of the 2D fallback's
 * Variant A (`CityTerrainMap2DFallback.tsx:1206-1356`).
 *
 * One DOM pill per visible occupant when the camera zoom sits inside
 * the inspection band. Each pill carries `t.primary` (name) plus the
 * cosmetic title suffix and the equipped name colour — same surface
 * area as the canvas-painted version, just expressed as DOM so we
 * can reuse the existing `.dotTooltip*` parchment styling and the
 * cascaded theme variables.
 *
 * Implementation notes:
 *
 *   - Pool of `MAX_INSPECTION_LABELS` `CSS2DObject`s pre-allocated at
 *     construction. `update()` assigns DOM content + world position
 *     to the first N slots, hides the rest. No allocation in the
 *     hot path.
 *
 *   - Priority order matches the 2D fallback: my player → selected →
 *     teammates → encounters → others. Greedy collision-culling in
 *     screen space — `Vector3.project(camera)` gives NDC, multiplied
 *     by canvas dims to get a screen-px bbox per candidate. Earlier
 *     priority wins; later candidates are silently hidden.
 *
 *   - Zoom band: `viewScale` is `displayZoom` from the controller.
 *     The 2D fallback uses 1.5..30 — same range here.
 *
 *   - Cosmetic name colour is applied to the DOM element's `color`
 *     style. Animated colours work via the CSS class declared in
 *     `app/globals.css` (`.cosmetic-color-anim-*`); we set the class
 *     name + base hex and let CSS drive the animation.
 *
 *   - No click handling on the labels themselves — the user clicks
 *     through to the occupant via the canvas. The 2D fallback's
 *     label hit-box was a Canvas2D affordance because the label
 *     covered the dot at low zoom; in 3D the dot stays drawn
 *     underneath so the canvas raycaster catches the click.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import type { DotTooltip } from "../CityTerrainMap2DFallback";
import { OCCUPANT_PLAYER, OCCUPANT_ENCOUNTER, OCCUPANT_CASTLE } from "novus-mundus-sdk";
import { getCosmeticTitle } from "@/lib/config/cosmetics-catalog";
import { MESH_SIZE } from "./coords";

/** Pool capacity. The 2D fallback collision-culls down to a handful
 * of visible labels even in busy cities, so 256 is plenty — pure
 * GPU-cost-free DOM nodes that stay hidden when unused. */
const MAX_INSPECTION_LABELS = 256;

/** Zoom band — mirrors `CityTerrainMap2DFallback.tsx:1225-1226`. */
const INSPECTION_ZOOM_LOW = 1.5;
const INSPECTION_ZOOM_HIGH = 30;

/** Lift label position fractionally above Y=0 so labels project
 * slightly forward of the terrain at iso angles — keeps the pill
 * from appearing to clip into the ground. Imperceptible at top-down. */
const LABEL_Y = 1e-3;

/** Padding for the collision bbox — pads each label so two pills with
 * just-touching edges still skip each other rather than abutting. */
const COLLISION_PAD_PX = 4;

interface PoolEntry {
  obj: CSS2DObject;
  el: HTMLDivElement;
  nameEl: HTMLSpanElement;
  /* Cell the label currently represents — populated by `update()`,
   * read by the click handler so the parent's `onLabelClick` callback
   * gets the right occupant. Null when the slot is hidden. */
  currentCell: OccupiedCell | null;
}

export interface InspectionLabelsConfig {
  scene: THREE.Scene;
  /** Optional pubkeys of OTHER players on the local viewer's team. */
  teamMatePubkeys?: string[];
}

export interface InspectionLabelsUpdate {
  occupied: OccupiedCell[];
  getDotTooltip: ((occupant: string, occupantType: number) => DotTooltip | null) | undefined;
  myPlayerPubkey: string | undefined;
  selectedEntity: { gridLat: number; gridLong: number } | null;
  viewScale: number;
  camera: THREE.PerspectiveCamera;
  canvasW: number;
  canvasH: number;
  cityLatGrid: number;
  cityLongGrid: number;
  rgu: number;
  teamMatePubkeys?: string[];
  /* Click handler invoked when a label pill is tapped. Receives the
   * cell the label represents. Parent typically fires `focusCell` +
   * `onEntitySelect`. */
  onLabelClick?: (cell: OccupiedCell) => void;
}

export class InspectionLabelsLayer {
  private group: THREE.Group;
  private pool: PoolEntry[] = [];
  private activeCount = 0;
  private disposed = false;
  /* Latest click handler. Rebound per `update()` call so React's
   * fresh closure (captures the latest props.onActiveOccupant etc.)
   * is what actually fires. Without the indirection, the listener
   * would invoke a callback stale by N renders. */
  private currentClickHandler: ((cell: OccupiedCell) => void) | null = null;
  /* Memoised sort + teamSet inputs. `update()` runs every paint and
   * the inputs only change when the parent's react state changes —
   * usually 1-10 Hz at most. Sorting 2000 occupants and rebuilding the
   * teamSet at 60 Hz is pure wasted work. Cache hit = the four
   * identity tracks all match; cache miss = rebuild and store. */
  private cachedOccupiedRef: OccupiedCell[] | null = null;
  private cachedMyPubkey: string | undefined = undefined;
  private cachedSelectedKey: string | null = null;
  private cachedTeamMatesRef: string[] | undefined = undefined;
  private cachedSorted: OccupiedCell[] | null = null;
  private cachedTeamSet: Set<string> = new Set();

  constructor(cfg: InspectionLabelsConfig) {
    this.group = new THREE.Group();
    this.group.name = "city-inspection-labels";
    cfg.scene.add(this.group);

    for (let i = 0; i < MAX_INSPECTION_LABELS; i++) {
      const el = document.createElement("div");
      el.className = "dotTooltip nm-inspection-label";
      el.style.position = "absolute";
      /* Pointer-events ENABLED so clicks land on the pill; the wrap-
       * level mousemove listener still receives bubbled events from
       * the parent so hover/orbit gestures keep working with the
       * cursor over a label. */
      el.style.pointerEvents = "auto";
      el.style.cursor = "pointer";
      el.style.userSelect = "none";
      el.style.whiteSpace = "nowrap";
      /* DO NOT set `transform` here — CSS2DRenderer manages it each
       * render. We control where the element sits relative to the
       * projected point via `CSS2DObject.center` below (top-edge at
       * projection so the pill hangs below the marker). */
      /* Compact sizing — multiple occupants on adjacent cells now read
       * cleanly. Original 0.7rem font was too dominant when several
       * pills stacked in a dense neighbourhood. */
      el.style.fontSize = "0.55rem";
      el.style.lineHeight = "1.05";
      el.style.padding = "0.12rem 0.32rem";
      /* Tiny gap between the marker's south edge and the pill — the
       * label's world anchor is already the marker's southern edge
       * (see update() below), so only a few pixels of breathing
       * space are needed before the pill text starts. */
      el.style.marginTop = "3px";
      el.style.background = "var(--parchment, #efe2c4)";
      el.style.border = "1px solid var(--ink-faint, #b89a72)";
      el.style.borderRadius = "3px";
      el.style.color = "var(--ink, #2e1f10)";
      el.style.boxShadow = "0 1px 2px rgba(46, 31, 16, 0.18)";
      el.style.fontFamily = `var(--font-jetbrains), ui-monospace, "JetBrains Mono", monospace`;
      el.style.letterSpacing = "0.03em";
      el.style.fontWeight = "600";
      el.style.display = "none";

      const nameEl = document.createElement("span");
      el.appendChild(nameEl);

      const obj = new CSS2DObject(el);
      obj.visible = false;
      /* `center` controls where on the element the projected point
       * lands. Default is (0.5, 0.5) — element centred on the point.
       * (0.5, 0) anchors the TOP edge of the element to the point so
       * the pill hangs below the marker. Combined with `marginTop`
       * on the element above, the marker stays clear of the pill. */
      obj.center.set(0.5, 0);
      this.group.add(obj);
      const entry: PoolEntry = { obj, el, nameEl, currentCell: null };
      el.addEventListener("click", (e) => {
        if (entry.currentCell && this.currentClickHandler) {
          /* Stop the click from bubbling into the canvas (which would
           * raycast and possibly resolve the same cell again via the
           * underlying dot/tile, triggering both an entity-select and
           * a focus pass). The label IS the click target. */
          e.stopPropagation();
          this.currentClickHandler(entry.currentCell);
        }
      });
      this.pool.push(entry);
    }
  }

  /** Per-paint rebuild. Walk the priority-ordered occupant list, lay
   * out labels by collision skip, hide the rest. Called from the
   * paint loop in CityTerrainMapWebGL.tsx. */
  update(args: InspectionLabelsUpdate): void {
    if (this.disposed) return;

    /* Zoom band dropped — labels render at every zoom. The collision
     * culler hides duplicates when cells overlap on screen, so at
     * very low zoom only one or two pills survive and dense clusters
     * silently degrade rather than smear into noise. Bail only when
     * there's no resolver or no canvas to project against. */
    void INSPECTION_ZOOM_LOW;
    void INSPECTION_ZOOM_HIGH;
    if (args.getDotTooltip == null || args.canvasW <= 0 || args.canvasH <= 0) {
      this.hideFrom(0);
      this.activeCount = 0;
      return;
    }

    /* Rebind the click handler so the listener sees the latest
     * closure from the parent. The DOM listener stays in place across
     * paints; only the handler indirection updates. */
    this.currentClickHandler = args.onLabelClick ?? null;

    const halfSide = MESH_SIZE / 2;
    const halfW = args.canvasW / 2;
    const halfH = args.canvasH / 2;

    /* Cache lookup. selectedEntity is the only object input we compare
     * by content (gridLat/gridLong) rather than reference — its
     * identity churns when the parent re-renders, but its grid coords
     * are stable across the relevant window. The other three inputs
     * compare by reference; the parent (useCityOccupied, the team-mate
     * memo) returns stable references when nothing changed. */
    const selectedKey = args.selectedEntity
      ? `${args.selectedEntity.gridLat},${args.selectedEntity.gridLong}`
      : null;
    const cacheHit =
      this.cachedSorted != null &&
      this.cachedOccupiedRef === args.occupied &&
      this.cachedMyPubkey === args.myPlayerPubkey &&
      this.cachedSelectedKey === selectedKey &&
      this.cachedTeamMatesRef === args.teamMatePubkeys;

    let sorted: OccupiedCell[];
    let teamSet: Set<string>;
    if (cacheHit) {
      sorted = this.cachedSorted!;
      teamSet = this.cachedTeamSet;
    } else {
      teamSet = new Set(args.teamMatePubkeys ?? []);
      const isSelected = (c: OccupiedCell): boolean =>
        args.selectedEntity != null &&
        args.selectedEntity.gridLat === c.gridLat &&
        args.selectedEntity.gridLong === c.gridLong;
      /* Priority — lower number = higher priority. Mirrors the 2D
       * fallback's order so collision-cull biases identical. */
      const priority = (c: OccupiedCell): number => {
        if (args.myPlayerPubkey != null && c.occupant === args.myPlayerPubkey) {
          return 0;
        }
        if (isSelected(c)) return 1;
        if (c.occupantType === OCCUPANT_PLAYER && teamSet.has(c.occupant)) {
          return 2;
        }
        if (c.occupantType === OCCUPANT_ENCOUNTER) return 3;
        if (c.occupantType === OCCUPANT_CASTLE) return 4;
        return 5;
      };
      sorted = [...args.occupied].sort((a, b) => priority(a) - priority(b));
      this.cachedSorted = sorted;
      this.cachedTeamSet = teamSet;
      this.cachedOccupiedRef = args.occupied;
      this.cachedMyPubkey = args.myPlayerPubkey;
      this.cachedSelectedKey = selectedKey;
      this.cachedTeamMatesRef = args.teamMatePubkeys;
    }

    const tmpVec = new THREE.Vector3();
    const drawn: { x: number; y: number; w: number; h: number }[] = [];
    let slot = 0;

    for (let i = 0; i < sorted.length && slot < this.pool.length; i++) {
      const cell = sorted[i]!;
      if (cell.occupantType === OCCUPANT_CASTLE && cell.footprintAnchor !== true) {
        /* Castles emit N² entries — only the anchor cell gets a label
         * so we don't draw N² duplicates around a footprint. */
        continue;
      }
      const t = args.getDotTooltip(cell.occupant, cell.occupantType);
      if (!t) continue;

      const ox = cell.gridLong - args.cityLongGrid;
      const oy = cell.gridLat - args.cityLatGrid;
      /* Anchor the label at the marker's CENTRE-X in world coords —
       * for 1-cell occupants that's the cell centre, for N×N castles
       * (anchor at SW corner) it's `ox+(n-1)/2, oy+(n-1)/2`. The
       * label drops below the marker via a per-occupant marginTop
       * computed below from the marker's projected screen-height,
       * NOT from a world-south offset.
       *
       * Why not use a world-south anchor + center.y=0? Because in
       * iso view with the default yaw (~0.68 rad), south in world
       * projects to bottom-RIGHT in screen — which lands the pill
       * at the marker's SE apex rather than dead-centre below it.
       * Anchoring at the marker centre and offsetting in CSS px
       * (the down vector in screen space) gives a yaw-independent
       * "directly below" placement. */
      const isCastle = cell.occupantType === OCCUPANT_CASTLE;
      const n = isCastle ? Math.max(1, cell.footprintSize ?? 1) : 1;
      const labelOx = isCastle ? ox + (n - 1) / 2 : ox;
      const labelOy = isCastle ? oy + (n - 1) / 2 : oy;
      const wx = (labelOx / args.rgu) * halfSide;
      const wz = -(labelOy / args.rgu) * halfSide;

      /* Project to NDC, then convert to screen px. behind-camera /
       * off-canvas labels are skipped (cheap cull before bbox build). */
      tmpVec.set(wx, LABEL_Y, wz);
      tmpVec.project(args.camera);
      if (tmpVec.z < -1 || tmpVec.z > 1) continue;
      const screenX = tmpVec.x * halfW + halfW;
      const screenY = -tmpVec.y * halfH + halfH;

      /* Marker projected half-height in CSS px — used to push the
       * label below the marker via marginTop. Project the south
       * edge of the marker's world bbox and take the screen-Y
       * delta; this gives the down-vector projection of the
       * marker's bottom edge in screen space. Yaw-invariant
       * because we only use the Y component. */
      const cellWorld = halfSide / args.rgu;
      const halfMarkerWorld = (n * cellWorld) / 2;
      tmpVec.set(wx, LABEL_Y, wz + halfMarkerWorld);
      tmpVec.project(args.camera);
      const southSY = -tmpVec.y * halfH + halfH;
      const projectedHalfHeight = Math.max(0, southSY - screenY);
      /* Dot-mode markers are drawn at a constant CSS-px size that
       * exceeds the world projection at low zoom (cells sub-pixel).
       * Floor by the actual rendered marker half-height: dots are
       * TARGET_DOT_DIAMETER_CSS_PX=6 (half=3), castles use
       * TARGET_CASTLE_DIAMETER_CSS_PX=12 scaled by castleScale =
       * max(1, n * 0.7). cos(35°) ≈ 0.82 accounts for the iso tilt
       * compressing the marker's height vs its on-ground width. */
      const TARGET_DOT_DIAMETER_CSS_PX = 6;
      const TARGET_CASTLE_DIAMETER_CSS_PX = 12;
      const castleScale = Math.max(1, n * 0.7);
      const cssMarkerHalfHeight = isCastle
        ? (TARGET_CASTLE_DIAMETER_CSS_PX * castleScale * 0.82) / 2
        : (TARGET_DOT_DIAMETER_CSS_PX * 0.82) / 2;
      const markerHalfHeight = Math.max(projectedHalfHeight, cssMarkerHalfHeight);
      /* +3 px breathing space between marker bottom and label top. */
      const labelMarginTop = Math.round(markerHalfHeight + 3);
      if (
        screenX < -200 ||
        screenX > args.canvasW + 200 ||
        screenY < -100 ||
        screenY > args.canvasH + 100
      ) {
        continue;
      }

      /* Compose the label text and approximate width so the
       * collision bbox is reasonable. We can't measure DOM width
       * before insertion, so use a per-character estimate that
       * matches the JetBrains Mono pill's 0.7rem font. ~7 px/char
       * is close enough for collision purposes; mis-estimates only
       * affect which neighbour wins, not correctness. */
      const titleEntry = t.titleId ? getCosmeticTitle(t.titleId) : null;
      const text = titleEntry ? `${t.primary} · ${titleEntry.displayName}` : t.primary;
      /* Width / height estimates match the compact 0.55rem font + 0.12
       * padding pill style. Per-char width is approximate; collision
       * mis-estimates only affect which neighbour wins, not whether
       * the layer renders correctly. */
      const APPROX_PX_PER_CHAR = 5;
      const textW = Math.max(16, text.length * APPROX_PX_PER_CHAR);
      const PILL_H = 16;
      /* Pill sits at (screenX, screenY + labelMarginTop) — directly
       * below the marker's projected centre, offset down by the
       * marker's projected half-height + breathing space. Collision
       * bbox uses the same offset so cull math agrees with what's
       * drawn. */
      const bbox = {
        x: screenX - textW / 2 - 6 - COLLISION_PAD_PX,
        y: screenY + labelMarginTop - COLLISION_PAD_PX,
        w: textW + 12 + COLLISION_PAD_PX * 2,
        h: PILL_H + COLLISION_PAD_PX * 2,
      };
      const overlaps = drawn.some(
        (d) =>
          bbox.x < d.x + d.w &&
          bbox.x + bbox.w > d.x &&
          bbox.y < d.y + d.h &&
          bbox.y + bbox.h > d.y,
      );
      if (overlaps) continue;
      drawn.push(bbox);

      const entry = this.pool[slot]!;
      entry.currentCell = cell;
      entry.nameEl.textContent = text;

      /* Cosmetic name colour + optional animation class. The CSS in
       * `app/globals.css` defines the `cosmetic-color-anim-*` keyframes
       * already used by the 2D path's hover tooltip; we just attach
       * the matching class and set the base hex. */
      if (t.nameColorHex) {
        entry.nameEl.style.color = t.nameColorHex;
      } else {
        entry.nameEl.style.color = "var(--ink, #2e1f10)";
      }
      const baseClass = "dotTooltip nm-inspection-label";
      entry.el.className = t.nameColorAnim
        ? `${baseClass} cosmetic-color-anim-${t.nameColorAnim}`
        : baseClass;
      /* Border accent — surfaces rarity/tier on the pill edge. */
      entry.el.style.borderColor = t.accent ?? "var(--ink-faint, #b89a72)";
      /* Per-entry marginTop — pushes the pill below the projected
       * marker. Varies per occupant: dot markers ~6 px, castle
       * citadels ~20+ px, tile-mode markers scale with cssPxPerCell. */
      entry.el.style.marginTop = `${labelMarginTop}px`;

      entry.obj.position.set(wx, LABEL_Y, wz);
      entry.obj.visible = true;
      entry.el.style.display = "";

      slot++;
    }

    this.hideFrom(slot);
    this.activeCount = slot;
  }

  private hideFrom(idx: number): void {
    for (let i = idx; i < this.activeCount; i++) {
      const entry = this.pool[i]!;
      entry.obj.visible = false;
      entry.el.style.display = "none";
      entry.currentCell = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.pool) {
      this.group.remove(entry.obj);
      entry.el.remove();
    }
    this.pool = [];
    this.activeCount = 0;
    this.group.parent?.remove(this.group);
  }
}
