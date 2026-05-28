/**
 * Per-frame paint loop for the city scene.
 *
 * Extracted from CityTerrainMapWebGL.tsx where it lived as a pair of
 * useCallback'd `requestRender` + `paint` with empty deps. The
 * orchestrator now imports `usePaintLoop(refs, propsRef)` and gets
 * back a stable `requestRender` it can hand to controller callbacks
 * and other effects.
 *
 * Paint logic:
 *   1. controller.update(dt) — apply gesture smoothing
 *   2. push cssPxPerCell to markers (dot ↔ tile mode flip)
 *   3. markers.updateOccupants / updateLanding (current props)
 *   4. inspectionLabels.update (DOM pill projection)
 *   5. renderer.render + cssRenderer.render
 *   6. orchestrator callbacks: onZoomChange / onCellsVisibleChange
 *   7. scaleBar + compass HUD update
 *   8. self-reschedule if controller is still smoothing
 */
import { useCallback } from "react";
import type { CityTerrainMapWebGLProps } from "../CityTerrainMapWebGL";
import {
  GRID_OVERLAY_MIN_CSS_PX_PER_CELL,
  MARKER_FLAT_SCALE_Y,
  cssPxPerCellAt,
} from "../coords";
import type { SceneRefs } from "./setupCityScene";

type RefObject<T> = { current: T };

/** Wire the rAF paint loop. Returns a stable `requestRender` the
 *  caller hands to long-lived callbacks (controller, input handlers,
 *  prop-sync effects). */
export function usePaintLoop(
  refs: RefObject<SceneRefs | null>,
  propsRef: RefObject<CityTerrainMapWebGLProps>,
  updateScaleBar: (r: SceneRefs) => void,
  updateCompass: (r: SceneRefs) => void,
): { requestRender: () => void } {
  const requestRender = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    if (r.paintQueued) return;
    r.paintQueued = true;
    requestAnimationFrame((now) => {
      if (!refs.current) return;
      paint(now);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paint = useCallback((now: number) => {
    const r = refs.current;
    if (!r) return;
    r.paintQueued = false;
    const dt = Math.min(0.1, Math.max(0, (now - r.lastUpdateMs) / 1000));
    r.lastUpdateMs = now;

    /* Tween rAF self-schedules; here we only need to ensure the
     * controller's smoothing is applied and the camera is rebuilt.
     * `update` returns true if anything moved, in which case we
     * need to keep painting until the smoothing settles. */
    const moved = r.controller.update(dt);

    /* Push CSS-px-per-cell to markers so they swap dot/tile mode if
     * threshold crossed. */
    const canvasH = r.renderer.domElement.clientHeight;
    const cssPx = cssPxPerCellAt(
      r.camera,
      r.controller.getTarget(),
      r.rgu,
      canvasH,
    );
    /* Markers follow the terrain's effective height scale but with a
     * MARKER_FLAT_SCALE_Y floor — their raycaster needs a non-singular
     * world matrix to dispatch hits in 2D mode. */
    r.markers.setTerrainScaleY(
      Math.max(MARKER_FLAT_SCALE_Y, r.terrain.heightScale.value),
    );
    r.markers.updateCentreScale(cssPx);
    r.markers.updateGrid(cssPx, r.controller.getTarget());

    /* Re-evaluate occupant layer mode (dot vs tile) on each paint —
     * markers.updateOccupants is the canonical entry but it requires
     * the latest props. Just re-fire it with current props. */
    const p = propsRef.current;
    r.markers.updateOccupants(
      p.occupied,
      p.selectedEntity ?? null,
      p.myPlayerPubkey,
      cssPx,
    );
    r.markers.updateLanding(p.selected, cssPx);

    /* Inspection-band labels — refresh every paint so projected
     * positions track camera motion. The layer short-circuits when
     * the zoom is outside the inspection band. */
    const zoom = r.controller.getDisplayZoom();
    const canvasW = r.renderer.domElement.clientWidth;
    r.inspectionLabels.update({
      occupied: p.occupied,
      getDotTooltip: p.getDotTooltip,
      myPlayerPubkey: p.myPlayerPubkey,
      selectedEntity: p.selectedEntity ?? null,
      viewScale: zoom,
      camera: r.camera,
      canvasW,
      canvasH,
      cityLatGrid: r.cityLatGrid,
      cityLongGrid: r.cityLongGrid,
      rgu: r.rgu,
      teamMatePubkeys: p.teamMatePubkeys,
      onLabelClick: p.onLabelClick,
    });

    r.renderer.render(r.scene, r.camera);
    r.cssRenderer.render(r.scene, r.camera);

    /* Notify orchestrator of zoom + cells-visible state for the
     * status row. */
    p.onZoomChange(zoom);
    p.onCellsVisibleChange(cssPx >= GRID_OVERLAY_MIN_CSS_PX_PER_CELL);

    updateScaleBar(r);
    updateCompass(r);

    /* If the controller is still smoothing toward a desired state
     * (gesture in flight or just released), schedule the next paint. */
    if (moved) {
      r.paintQueued = true;
      requestAnimationFrame((t) => paint(t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { requestRender };
}
