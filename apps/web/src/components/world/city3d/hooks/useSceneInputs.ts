/**
 * Pointer + keyboard input handlers for the city scene.
 *
 * Each handler reads through `propsRef.current` so a mount-time bound
 * controller callback always invokes the latest prop closures — no
 * stale `onPick` after a parent re-render.
 *
 * `requestRender` is threaded through so click/double-click handlers
 * that mutate the view tween can wake the rAF loop.
 */
import { useCallback } from "react";
import * as THREE from "three";
import { OCCUPANT_CASTLE } from "novus-mundus-sdk";

import type { CityTerrainMapWebGLProps } from "../CityTerrainMapWebGL";
import type { OccupiedCell } from "@/lib/hooks/useCityOccupied";
import {
  MESH_SIZE,
  METERS_PER_GRID_UNIT,
  getElevationAt,
  gridToWorld,
  midpointElevation,
  worldToGrid,
} from "../coords";
import { INITIAL_DISTANCE_2D, INITIAL_DISTANCE_3D } from "../controls";
import { runViewTween } from "../transition";
import {
  biomeAt,
  biomeKnobsFromCity,
  biomeName,
  isPassableBiome,
  type BiomeKnobs,
} from "@/lib/world/biome";
import type { SceneRefs } from "./setupCityScene";

interface CityTerrain {
  biomeSeed: number;
  knobs: BiomeKnobs;
}

function cityTerrain(city: {
  biomeSeed: number;
  widthGrid: number;
  heightGrid: number;
  waterFraction?: number;
}): CityTerrain {
  return {
    biomeSeed: city.biomeSeed >>> 0,
    knobs: biomeKnobsFromCity(city as unknown as Parameters<typeof biomeKnobsFromCity>[0]),
  };
}

function isPassable(terrain: CityTerrain, ox: number, oy: number): boolean {
  return isPassableBiome(biomeAt(terrain.biomeSeed, ox, oy, terrain.knobs));
}

/** Hover throttle — 33ms ≈ 30 Hz. Hover updates project to screen
 * coords + emit an active-occupant notification; 60 Hz is overkill. */
const HOVER_THROTTLE_MS = 33;

type RefObject<T> = { current: T };

export interface SceneInputHandlers {
  handleClick: (clientX: number, clientY: number) => void;
  handleDoubleClick: (clientX: number, clientY: number) => void;
  handleResetRequested: () => void;
  handleFrameSelected: () => void;
  handlePointerMove: (clientX: number, clientY: number) => void;
}

export function useSceneInputs(
  refs: RefObject<SceneRefs | null>,
  propsRef: RefObject<CityTerrainMapWebGLProps>,
  requestRender: () => void,
  /* The raycast helpers live in CityTerrainMapWebGL.tsx — passing them
   * keeps this hook independent of file-local module-scope helpers. */
  raycastMarkers: (
    r: SceneRefs,
    clientX: number,
    clientY: number,
    occupied: OccupiedCell[],
  ) => { cell: OccupiedCell } | null,
  raycast: (r: SceneRefs, clientX: number, clientY: number) => THREE.Intersection | null,
): SceneInputHandlers {
  const handlePointerMove = useCallback((clientX: number, clientY: number) => {
    const r = refs.current;
    if (!r) return;
    const now = performance.now();
    if (now - r.lastHoverTs < HOVER_THROTTLE_MS) return;
    r.lastHoverTs = now;

    /* Marker raycast FIRST so an occupant under the pointer wins the
     * hover even if the terrain ray would land on a neighbouring cell. */
    const p = propsRef.current;
    const markerHit = raycastMarkers(r, clientX, clientY, p.occupied);
    if (markerHit && p.onActiveOccupant) {
      let cell = markerHit.cell;
      /* Castles emit N² OccupiedCell entries (one per footprint
       * cell) with identical occupant pubkey but different grid
       * coords. The 2D-mode ground-plane fallback in raycastMarkers
       * can return ANY of those cells; anchoring the tooltip to
       * whichever cell was hit makes the bubble jump 1–3 cells
       * SW→NE as the cursor slides across the same castle. Snap to
       * the anchor cell (the one with footprintAnchor=true). */
      if (cell.occupantType === OCCUPANT_CASTLE && cell.footprintAnchor !== true) {
        const anchor = p.occupied.find(
          (c) =>
            c.occupantType === OCCUPANT_CASTLE &&
            c.occupant === cell.occupant &&
            c.footprintAnchor === true,
        );
        if (anchor) cell = anchor;
      }
      const ox = cell.gridLong - r.cityLongGrid;
      const oy = cell.gridLat - r.cityLatGrid;
      const halfSide = MESH_SIZE / 2;
      const wx = (ox / r.rgu) * halfSide;
      const wz = -(oy / r.rgu) * halfSide;
      const tmpV = new THREE.Vector3(wx, 0, wz);
      tmpV.project(r.camera);
      const canvasW = r.renderer.domElement.clientWidth;
      const canvasH = r.renderer.domElement.clientHeight;
      const screenX = (tmpV.x * 0.5 + 0.5) * canvasW;
      const screenY = (-tmpV.y * 0.5 + 0.5) * canvasH;
      p.onActiveOccupant({
        cell: cell as OccupiedCell,
        screen: { x: screenX, y: screenY },
      });
    } else if (p.onActiveOccupant) {
      p.onActiveOccupant(null);
    }

    const hit = raycast(r, clientX, clientY);
    if (!hit) {
      p.onHover(null);
      return;
    }
    const { ox, oy } = worldToGrid(hit.point.x, hit.point.z, r.rgu);
    /* AABB bounds — mirrors `is_within_city_grid` on chain. The
     * previous disc check rejected the four corners of the square
     * plot even though they're legal cells. */
    const cityAcc = p.cityAccount;
    const plotHalfW = cityAcc.widthGrid / 2;
    const plotHalfH = cityAcc.heightGrid / 2;
    const outOfBounds = Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH;
    if (outOfBounds) {
      p.onHover(null);
      return;
    }
    const knobs = biomeKnobsFromCity(cityAcc);
    const biome = biomeAt(cityAcc.biomeSeed, ox, oy, knobs);
    const passable = isPassableBiome(biome);
    const rawName = biomeName(biome);
    const label = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const distM = Math.round(Math.sqrt(ox * ox + oy * oy) * METERS_PER_GRID_UNIT);
    p.onHover({ label, distM, passable, outOfBounds: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = useCallback((clientX: number, clientY: number) => {
    const r = refs.current;
    if (!r) return;
    const markerHit = raycastMarkers(r, clientX, clientY, propsRef.current.occupied);
    if (markerHit) {
      propsRef.current.onPick({
        gridLat: markerHit.cell.gridLat,
        gridLong: markerHit.cell.gridLong,
        passable: true,
        outOfBounds: false,
        entityAtCell: {
          pubkey: markerHit.cell.occupant,
          occupantType: markerHit.cell.occupantType,
          gridLat: markerHit.cell.gridLat,
          gridLong: markerHit.cell.gridLong,
        },
      });
      return;
    }
    const hit = raycast(r, clientX, clientY);
    if (!hit) {
      propsRef.current.onPick({
        gridLat: 0,
        gridLong: 0,
        passable: false,
        outOfBounds: true,
        entityAtCell: null,
      });
      return;
    }
    const { ox, oy } = worldToGrid(hit.point.x, hit.point.z, r.rgu);
    const cityAcc = propsRef.current.cityAccount;
    const plotHalfW = cityAcc.widthGrid / 2;
    const plotHalfH = cityAcc.heightGrid / 2;
    const outOfBounds = Math.abs(ox) > plotHalfW || Math.abs(oy) > plotHalfH;
    const gridLat = r.cityLatGrid + oy;
    const gridLong = r.cityLongGrid + ox;
    const liveTerrain = cityTerrain(propsRef.current.cityAccount);
    const passable = !outOfBounds && isPassable(liveTerrain, ox, oy);
    /* Strict equality lookup — same contract as the Canvas2D
     * fallback. The marker raycast above is the primary path for
     * occupant clicks; this branch only runs when the click landed
     * on raw terrain (empty cell), so it should NEVER fire entity
     * selection via snap-to-nearest. */
    const p = propsRef.current;
    const exact = p.occupied.find((c) => c.gridLat === gridLat && c.gridLong === gridLong);
    const entityAtCell = exact
      ? {
          pubkey: exact.occupant,
          occupantType: exact.occupantType,
          gridLat: exact.gridLat,
          gridLong: exact.gridLong,
        }
      : null;
    const finalGridLat = exact ? exact.gridLat : gridLat;
    const finalGridLong = exact ? exact.gridLong : gridLong;
    p.onPick({
      gridLat: finalGridLat,
      gridLong: finalGridLong,
      passable,
      outOfBounds,
      entityAtCell,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDoubleClick = useCallback((clientX: number, clientY: number) => {
    const r = refs.current;
    if (!r) return;
    const hit = raycast(r, clientX, clientY);
    if (!hit) return;
    /* Double-click zooms in 2× at the cursor. */
    const targetXZ = new THREE.Vector3(hit.point.x, 0, hit.point.z);
    if (r.controller.getMode() === "iso") {
      targetXZ.y = midpointElevation();
    }
    const newDistance = Math.max(0.04, r.controller.getDistance() / 2);
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      { target: targetXZ, distance: newDistance },
      requestRender,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetRequested = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const mode = r.controller.getMode();
    const tDefault = new THREE.Vector3(0, mode === "iso" ? midpointElevation() : 0, 0);
    const dDefault = mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    r.viewTween?.cancel();
    // Recenter + zoom out only; PRESERVE yaw (and pitch) so reset never
    // spins the camera. Omitting `yaw` makes runViewTween hold the
    // current yaw (yTo = to.yaw ?? yFrom).
    r.viewTween = runViewTween(
      r.controller,
      { target: tDefault, distance: dDefault },
      requestRender,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* F key — Maya/Unity/Blender "Frame Selected" convention. Tweens to
   * selectedEntity (preferred) or the landing-cell selection; no-op if
   * nothing's selected. */
  const handleFrameSelected = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const p = propsRef.current;
    const sel = p.selectedEntity ?? p.selected;
    if (!sel) return;
    const ox = sel.gridLong - r.cityLongGrid;
    const oy = sel.gridLat - r.cityLatGrid;
    const { wx, wz } = gridToWorld(ox, oy, r.rgu);
    const mode = r.controller.getMode();
    const dTarget = (mode === "iso" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D) / 8;
    r.viewTween?.cancel();
    r.viewTween = runViewTween(
      r.controller,
      {
        target: new THREE.Vector3(wx, mode === "iso" ? getElevationAt(ox, oy) : 0, wz),
        distance: dTarget,
      },
      requestRender,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    handleClick,
    handleDoubleClick,
    handleResetRequested,
    handleFrameSelected,
    handlePointerMove,
  };
}
