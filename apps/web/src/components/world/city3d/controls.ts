/**
 * Perspective camera controller for the 3D city scene.
 *
 * State is spherical: (yaw, pitch, distance, target). Cartesian camera
 * position is derived each frame from those four numbers — never
 * assigned directly. The controller smooths every parameter
 * exponentially (`factor = 1 - exp(-smoothing * dt)`) so gestures land
 * with momentum instead of snap-cutting.
 *
 * Ported from
 * `sdks/novus-mundus-ts/terrain-builder/src/town/camera/IsometricCamera.js`
 * with three additions on top:
 *
 *   1. Orbit (mouse right-drag, touch-orbit-toggle gesture) — the
 *      town camera lets you pan but not rotate; the city camera lets
 *      you do both.
 *
 *   2. Mode-aware bounds: in 2D mode pitch is locked at PITCH_2D
 *      (near-vertical, top-down look); in 3D mode pitch clamps to
 *      [MIN_PITCH_3D, MAX_PITCH_3D]. Yaw is free in both modes
 *      because spinning a top-down map is meaningful.
 *
 *   3. Transition bypass: when `isTransitioning` is set (by
 *      transition.ts during a mode tween), the controller's smoothing
 *      loop bypasses pitch/distance/target.y updates so the tween's
 *      eased curve is the canonical animation — no double-smoothing
 *      against the controller's own lerp.
 *
 * Pitch convention is *elevation angle from horizontal*: 0 = horizon,
 * PI/2 = directly above target. The design doc occasionally describes
 * "pitch = 0°" as top-down, which is the OrbitControls polar-angle
 * convention — incompatible with the spherical formula. We commit to
 * the elevation-angle convention throughout (PITCH_2D = 89°,
 * PITCH_3D = 35°) so the math is internally consistent.
 */

import * as THREE from "three";
import type { MapMode } from "@/lib/store/settings";
import { MESH_SIZE, midpointElevation } from "./coords";

const DEG = Math.PI / 180;

export const FOV_DEG = 30;

/* Elevation angle for 2D mode. 89° (not exactly 90°) keeps the camera
 * just shy of looking straight down — at exact π/2, lookAt's "up"
 * direction becomes ambiguous and the view roll-flips with any yaw
 * change. Visually indistinguishable from a true top-down view. */
export const PITCH_2D = 89 * DEG;

/* Elevation angle for 3D mode. Matches IsometricCamera.js:21
 * (`pitch: 35`) and the design doc's chosen value (the doc says 35°
 * specifically, despite the terrain-builder reference using 40°). */
export const PITCH_3D = 35 * DEG;

/* 3D pitch bounds. Equivalent to the reference's
 * `minPolarAngle=5°*DEG, maxPolarAngle=82°*DEG` once converted from
 * polar-from-vertical to elevation-from-horizontal (polar = π/2 -
 * elevation, so polar ∈ [5°, 82°] -> elevation ∈ [8°, 85°]). */
export const MIN_PITCH_3D = 8 * DEG;
export const MAX_PITCH_3D = 85 * DEG;

/* Initial camera distance per mode. 2D needs to be farther so the
 * full mesh fits the view at pitch=89° — at distance 4.5 with fov=30°
 * top-down only the central ~2.4 world units are visible, less than
 * the 4-unit-wide plate. 3D inherits the terrain-builder reference's
 * 4.5 (city.js:289) which gives a comfortable isometric framing. */
export const INITIAL_DISTANCE_2D = 8;
export const INITIAL_DISTANCE_3D = 4.5;

/* Exponential smoothing rate, in 1/sec. 8.0 matches IsometricCamera.js:33
 * — gestures feel responsive without snapping. */
export const SMOOTHING = 8.0;

/* Wheel/pinch zoom feel. Velocity decays geometrically per frame so
 * a single scroll burst trails off naturally. */
export const ZOOM_SPEED = 0.12;
export const ZOOM_MOMENTUM = 0.88;

/* Pan sensitivity in grid-units / px. Scaled by current distance so
 * the same pixel drag feels identical at every zoom level — drag a
 * px, the target moves a fixed fraction of the view. */
export const PAN_SPEED = 0.001;

/* Orbit sensitivity in rad/px. Tuned so a half-screen drag rotates
 * yaw ~30°, which feels natural for inspecting terrain. */
export const ORBIT_SPEED = 0.005;

/* Keyboard pan speed in world-units/sec, scaled by current distance.
 * 0.6 means pressing W for 1s at distance 5 moves target 3 units —
 * about three-quarters of the plate. */
export const KEY_PAN_SPEED = 0.6;
export const KEY_ORBIT_SPEED = 1.2;
export const KEY_PITCH_SPEED = 0.6;

/* Click-suppression window after a pinch lifts on iOS. Without this,
 * end-of-pinch fires a phantom click that selects a cell or entity. */
export const TOUCH_CLICK_SUPPRESS_MS = 350;

export const PAN_THRESHOLD_PX = 4;
export const TOUCH_DRAG_THRESHOLD_PX = 6;

// Held-pan/zoom/orbit keys. Added to `this.keys` on keydown, drained
// each frame by applyKeyboard. preventDefault so arrows don't scroll
// the page and ± don't zoom the browser.
const HELD_KEYS = new Set([
  "w", "a", "s", "d",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "q", "e",
  "pageup", "pagedown",
  "=", "+", "-", "_",
]);

export interface ControllerOptions {
  domElement: HTMLElement;
  camera: THREE.PerspectiveCamera;
  initialMode: MapMode;
  /* Closest distance from camera to target. Smaller cities can zoom
   * in more aggressively; tuned at 20/radiusKm per city.js:275. */
  minDistance: number;
  /* Farthest distance. Caps the user's zoom-out at full-plate view. */
  maxDistance: number;
  /* Called when the user performs a click (NOT a drag). The
   * controller doesn't know about scene contents — the caller resolves
   * the click to a cell via raycaster. */
  onClick: (clientX: number, clientY: number) => void;
  /* Called when the user double-clicks. The caller is expected to
   * tween the target / distance via the in-mode view tween, not the
   * controller — this just emits the gesture. */
  onDoubleClick: (clientX: number, clientY: number) => void;
  /* Called when the user requests reset (Home / Space). Caller decides
   * what default state means per-mode. */
  onResetRequested: () => void;
  /* Called when the user requests "frame selected" (F key) — the Maya
   * / Unity / Blender / Substance convention. Caller tweens to the
   * current selection; no-op if nothing's selected. */
  onFrameSelectedRequested?: () => void;
  /* Called every time the controller mutates camera state — caller
   * uses this to request a re-render in render-on-demand mode. */
  onChange: () => void;
  /* Called on pointermove (non-click) so the caller can update hover
   * readouts. Throttled by the caller, not here. */
  onPointerMove: (clientX: number, clientY: number) => void;
  /* Called when the user initiates a fresh gesture (wheel, mousedown,
   * touchstart). Lets the caller cancel any in-flight view tween so
   * the user's gesture wins instead of racing the eased animation. */
  onGestureStart?: () => void;
}

export class CityCameraController {
  private dom: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  private cfg: ControllerOptions;

  /* Desired state (smoothing lerps toward these). */
  private yaw = 0;
  private pitch: number;
  private distance: number;
  private target: THREE.Vector3;

  /* Smoothed state (what the camera actually reflects). */
  private sYaw = 0;
  private sPitch: number;
  private sDistance: number;
  private sTarget: THREE.Vector3;

  private mode: MapMode;
  private isTransitioning = false;
  private zoomVelocity = 0;
  private destroyed = false;

  // Last pitch the user had in 3D mode. Updated when leaving 3D, read
  // when entering 3D, so toggling 2D↔3D doesn't clobber a user-tilted
  // angle. Defaults to PITCH_3D so first-ever entry uses the design
  // doc's isometric value.
  private storedPitch3D: number = PITCH_3D;

  /* Drag bookkeeping — `dragMode` distinguishes pan from orbit when
   * the same pointermove event must do different things. */
  private dragMode: "none" | "pan" | "orbit" = "none";
  private dragStartX = 0;
  private dragStartY = 0;
  private dragLastX = 0;
  private dragLastY = 0;
  private didDrag = false;

  /* Touch-specific: orbit-toggle pill controls two-finger drag
   * semantics; on iOS pinch-end click suppression is timer-driven. */
  private touchOrbitEnabled = false;
  private pinchDist: number | null = null;
  private touchClickSuppressUntil = 0;
  private suppressClickOnce = false;

  /* Keyboard state — accumulate held keys, apply in update(dt). */
  private keys = new Set<string>();

  /* Reusable scratch vectors — avoids per-frame allocation. */
  private tmpVec = new THREE.Vector3();
  private panRight = new THREE.Vector3();
  private panForward = new THREE.Vector3();

  private boundHandlers: Array<{
    el: EventTarget;
    type: string;
    handler: EventListener;
    options?: AddEventListenerOptions;
  }> = [];

  constructor(opts: ControllerOptions) {
    this.dom = opts.domElement;
    this.camera = opts.camera;
    this.cfg = opts;
    this.mode = opts.initialMode;

    this.pitch = this.mode === "3d" ? PITCH_3D : PITCH_2D;
    this.distance = this.mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    this.target = new THREE.Vector3(
      0,
      this.mode === "3d" ? midpointElevation() : 0,
      0,
    );

    this.sYaw = this.yaw;
    this.sPitch = this.pitch;
    this.sDistance = this.distance;
    this.sTarget = this.target.clone();

    this.camera.fov = FOV_DEG;
    this.camera.updateProjectionMatrix();

    this.applyCameraFromSmoothed();
    this.bindEvents();
  }

  /* ─── Public API ─────────────────────────────────────────────── */

  getMode(): MapMode {
    return this.mode;
  }

  /* Called by transition.ts at the start of a mode tween. While true,
   * the controller's smoothing bypasses pitch / distance / target.y
   * (the tween writes both desired AND smoothed values directly from
   * the eased curve, so double-smoothing would damp the tween). */
  setTransitioning(v: boolean): void {
    this.isTransitioning = v;
  }

  /* Called by transition.ts after a tween completes. Snaps the
   * controller's `mode` so subsequent gestures use the new bounds. */
  commitModeChange(mode: MapMode): void {
    this.mode = mode;
  }

  /* Writes desired and smoothed pitch in lockstep — used by the
   * transition driver and by reset-to-default snap paths. */
  setPitchHard(p: number): void {
    this.pitch = p;
    this.sPitch = p;
  }

  setDistanceHard(d: number): void {
    this.distance = d;
    this.sDistance = d;
    this.zoomVelocity = 0;
  }

  setTargetHard(v: THREE.Vector3): void {
    this.target.copy(v);
    this.sTarget.copy(v);
  }

  setYawHard(y: number): void {
    this.yaw = y;
    this.sYaw = y;
  }

  /**
   * Force the camera position/quaternion to match the current
   * smoothed state immediately, bypassing the normal `update(dt)`
   * cycle's "only apply when moved" gate. Use after a batch of
   * setHard() calls when you need the change visible on the very
   * next paint — e.g. auto-focus snap at mount, where the renderer
   * is about to paint once and there's no smoothing delta to drive
   * an applyCameraFromSmoothed call.
   */
  applyToCamera(): void {
    this.applyCameraFromSmoothed();
  }

  getPitch(): number {
    return this.sPitch;
  }
  getYaw(): number {
    return this.sYaw;
  }
  getDistance(): number {
    return this.sDistance;
  }
  getTarget(): THREE.Vector3 {
    return this.sTarget;
  }
  getDesiredTarget(): THREE.Vector3 {
    return this.target;
  }
  getDesiredPitch(): number {
    return this.pitch;
  }
  getDesiredDistance(): number {
    return this.distance;
  }
  getDesiredYaw(): number {
    return this.yaw;
  }

  getDisplayZoom(): number {
    const base =
      this.mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    return base / this.sDistance;
  }

  setTouchOrbitEnabled(v: boolean): void {
    this.touchOrbitEnabled = v;
  }

  /* Update distance clamp bounds at runtime — fires on city change
   * (radiusKm changes -> minDistance changes) and on mode change
   * (maxDistance differs per mode). Existing distance is re-clamped
   * to the new range so smaller cities don't leave the camera
   * silently zoomed past the new max. */
  setDistanceBounds(min: number, max: number): void {
    this.cfg.minDistance = min;
    this.cfg.maxDistance = max;
    this.distance = Math.max(min, Math.min(max, this.distance));
    this.sDistance = Math.max(min, Math.min(max, this.sDistance));
  }
  getTouchOrbitEnabled(): boolean {
    return this.touchOrbitEnabled;
  }

  setStoredPitch3D(p: number): void {
    this.storedPitch3D = Math.max(MIN_PITCH_3D, Math.min(MAX_PITCH_3D, p));
  }
  getStoredPitch3D(): number {
    return this.storedPitch3D;
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = this.mode === "3d" ? PITCH_3D : PITCH_2D;
    this.distance = this.mode === "3d" ? INITIAL_DISTANCE_3D : INITIAL_DISTANCE_2D;
    this.target.set(0, this.mode === "3d" ? midpointElevation() : 0, 0);
    this.zoomVelocity = 0;
    this.cfg.onChange();
  }

  /* Per-frame update — call from the scene's rAF loop or after any
   * gesture/keyboard input that needs visible motion. Returns true
   * iff anything visible changed (so the caller can trigger a render
   * in on-demand mode without unconditional re-paints). */
  update(dt: number): boolean {
    /* Apply held-key inputs first — they mutate desired state, then
     * smoothing carries them through. Keyboard never fires during a
     * mode transition (the transition itself locks input). */
    if (!this.isTransitioning && this.keys.size > 0) {
      this.applyKeyboard(dt);
    }

    /* Zoom momentum — distance accrues velocity from wheel/pinch and
     * decays toward zero. Bypassed during mode transition because
     * the tween drives distance directly. */
    if (!this.isTransitioning && Math.abs(this.zoomVelocity) > 0.0001) {
      this.distance = this.clampDistance(this.distance + this.zoomVelocity);
      this.zoomVelocity *= ZOOM_MOMENTUM;
    } else if (!this.isTransitioning) {
      this.zoomVelocity = 0;
    }

    this.clampTarget(this.target);

    const factor = 1 - Math.exp(-SMOOTHING * Math.min(dt, 0.1));

    const prevSYaw = this.sYaw;
    const prevSPitch = this.sPitch;
    const prevSDistance = this.sDistance;
    const prevSTargetX = this.sTarget.x;
    const prevSTargetY = this.sTarget.y;
    const prevSTargetZ = this.sTarget.z;

    this.sYaw += (this.yaw - this.sYaw) * factor;

    /* During a mode transition, pitch + distance + target.y are
     * driven by the eased curve directly (set via setPitchHard etc),
     * so DO NOT lerp them here — the lerp would smooth twice and
     * desync the tween. target.x/z still lerp normally because
     * selection-aware framing uses the same setTarget path the
     * gesture handlers use. */
    if (!this.isTransitioning) {
      this.sPitch += (this.pitch - this.sPitch) * factor;
      this.sDistance += (this.distance - this.sDistance) * factor;
      this.sTarget.y += (this.target.y - this.sTarget.y) * factor;
    }
    this.sTarget.x += (this.target.x - this.sTarget.x) * factor;
    this.sTarget.z += (this.target.z - this.sTarget.z) * factor;

    this.clampTarget(this.sTarget);

    const moved =
      Math.abs(this.sYaw - prevSYaw) > 1e-5 ||
      Math.abs(this.sPitch - prevSPitch) > 1e-5 ||
      Math.abs(this.sDistance - prevSDistance) > 1e-5 ||
      Math.abs(this.sTarget.x - prevSTargetX) > 1e-5 ||
      Math.abs(this.sTarget.y - prevSTargetY) > 1e-5 ||
      Math.abs(this.sTarget.z - prevSTargetZ) > 1e-5;

    if (moved) {
      this.applyCameraFromSmoothed();
    }
    return moved;
  }

  /* Anchored zoom — convert wheel/pinch delta into a distance velocity
   * and (later) correct the target so the world point under the cursor
   * stays put. The actual XZ correction is applied by the scene
   * (which owns the raycaster); this just bumps zoomVelocity. */
  applyZoomDelta(delta: number): void {
    if (this.isTransitioning) return;
    this.zoomVelocity += delta;
  }

  /* Apply an immediate XZ correction to the target — used by the
   * scene's zoom-at-cursor logic to keep the world point under the
   * cursor stationary across a zoom step. */
  nudgeTargetXZ(dx: number, dz: number): void {
    if (this.isTransitioning) return;
    this.target.x += dx;
    this.target.z += dz;
    this.sTarget.x += dx;
    this.sTarget.z += dz;
    this.clampTarget(this.target);
    this.clampTarget(this.sTarget);
  }

  dispose(): void {
    this.destroyed = true;
    for (const { el, type, handler, options } of this.boundHandlers) {
      el.removeEventListener(type, handler, options);
    }
    this.boundHandlers = [];
  }

  /* ─── Internals ──────────────────────────────────────────────── */

  private applyCameraFromSmoothed(): void {
    /* Spherical -> Cartesian. pitch is elevation angle (sin = up,
     * cos = ground projection). */
    const cosP = Math.cos(this.sPitch);
    const sinP = Math.sin(this.sPitch);
    const cosY = Math.cos(this.sYaw);
    const sinY = Math.sin(this.sYaw);
    const d = this.sDistance;
    this.camera.position.set(
      this.sTarget.x + d * sinY * cosP,
      this.sTarget.y + d * sinP,
      this.sTarget.z + d * cosY * cosP,
    );
    this.camera.lookAt(this.sTarget);
  }

  private clampDistance(d: number): number {
    return Math.max(this.cfg.minDistance, Math.min(this.cfg.maxDistance, d));
  }

  /* Square AABB clamp on the target's X/Z. visibleHalf depends on
   * current smoothed distance so zoom-out tightens the clamp (and
   * zoom-in relaxes it). Y is unconstrained — the mode transition
   * lerps target.y and we don't want to fight it. */
  private clampTarget(v: THREE.Vector3): void {
    const halfSide = MESH_SIZE / 2;
    const visibleHalf =
      this.sDistance * Math.tan((this.camera.fov * DEG) / 2);
    const maxOffset = Math.max(0, halfSide - visibleHalf);
    v.x = Math.max(-maxOffset, Math.min(maxOffset, v.x));
    v.z = Math.max(-maxOffset, Math.min(maxOffset, v.z));
  }

  private applyPan(dxPx: number, dyPx: number): void {
    if (this.isTransitioning) return;
    /* Pan vectors: right = perpendicular to camera-target on the
     * ground plane (XZ), forward = camera-to-target projected to XZ.
     * Scaling by distance keeps drag feel consistent across zoom. */
    const camDir = this.tmpVec.copy(this.sTarget).sub(this.camera.position);
    this.panRight.set(-camDir.z, 0, camDir.x).normalize();
    this.panForward.set(camDir.x, 0, camDir.z).normalize();
    const k = PAN_SPEED * this.sDistance;
    this.target.addScaledVector(this.panRight, -dxPx * k);
    this.target.addScaledVector(this.panForward, dyPx * k);
    this.clampTarget(this.target);
    this.cfg.onChange();
  }

  private applyOrbit(dxPx: number, dyPx: number): void {
    if (this.isTransitioning) return;
    this.yaw += -dxPx * ORBIT_SPEED;
    if (this.mode === "3d") {
      this.pitch += -dyPx * ORBIT_SPEED;
      this.pitch = Math.max(MIN_PITCH_3D, Math.min(MAX_PITCH_3D, this.pitch));
    }
    this.cfg.onChange();
  }

  private applyKeyboard(dt: number): void {
    /* Pan along camera-relative ground axes. Same vectors as mouse
     * pan so WASD feels consistent with drag. */
    const camDir = this.tmpVec.copy(this.sTarget).sub(this.camera.position);
    this.panRight.set(-camDir.z, 0, camDir.x).normalize();
    this.panForward.set(camDir.x, 0, camDir.z).normalize();
    const panK = KEY_PAN_SPEED * this.sDistance * dt;
    let panned = false;
    if (this.keys.has("w") || this.keys.has("arrowup")) {
      this.target.addScaledVector(this.panForward, panK);
      panned = true;
    }
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      this.target.addScaledVector(this.panForward, -panK);
      panned = true;
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      this.target.addScaledVector(this.panRight, -panK);
      panned = true;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      this.target.addScaledVector(this.panRight, panK);
      panned = true;
    }
    if (this.keys.has("q")) this.yaw += KEY_ORBIT_SPEED * dt;
    if (this.keys.has("e")) this.yaw -= KEY_ORBIT_SPEED * dt;
    if (this.mode === "3d") {
      if (this.keys.has("pageup")) {
        this.pitch = Math.min(MAX_PITCH_3D, this.pitch + KEY_PITCH_SPEED * dt);
      }
      if (this.keys.has("pagedown")) {
        this.pitch = Math.max(MIN_PITCH_3D, this.pitch - KEY_PITCH_SPEED * dt);
      }
    }
    if (this.keys.has("=") || this.keys.has("+")) {
      this.distance = this.clampDistance(this.distance - this.sDistance * 0.8 * dt);
    }
    if (this.keys.has("-") || this.keys.has("_")) {
      this.distance = this.clampDistance(this.distance + this.sDistance * 0.8 * dt);
    }

    if (panned) this.clampTarget(this.target);
    this.cfg.onChange();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    el: EventTarget,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const h = handler as EventListener;
    el.addEventListener(type as string, h, options);
    this.boundHandlers.push({ el, type: type as string, handler: h, options });
  }

  private bindEvents(): void {
    const dom = this.dom;

    this.listen(dom, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      if (this.isTransitioning) return;
      this.cfg.onGestureStart?.();
      /* Wheel delta -> zoom velocity. ctrlKey indicates trackpad
       * pinch (browsers synthesise wheel with ctrlKey for pinch); use
       * a smaller multiplier to keep pinch feeling proportional. */
      const intensity = Math.min(Math.abs(e.deltaY) / 100, 2.5);
      const mult = e.ctrlKey ? 0.35 : 1.0;
      const stepSign = e.deltaY > 0 ? +1 : -1;
      const step = stepSign * ZOOM_SPEED * intensity * mult * this.sDistance;
      this.applyZoomDelta(step);
      this.cfg.onChange();
    }, { passive: false });

    this.listen(dom, "mousedown", (e: MouseEvent) => {
      if (this.isTransitioning) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      // preventDefault on mousedown blocks the browser's default
      // focus-on-click. Without an explicit focus(), the wrap never
      // receives keydown events even with tabIndex=0.
      this.dom.focus();
      this.cfg.onGestureStart?.();
      this.dragMode = e.button === 2 ? "orbit" : "pan";
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragLastX = e.clientX;
      this.dragLastY = e.clientY;
      this.didDrag = false;
    });

    // Hover detection: bind to `dom`, NOT `window` — otherwise every
    // page-wide mousemove triggers a raycast + onHover state update,
    // forcing a re-render of the orchestrator on each pixel of motion
    // outside the canvas.
    this.listen(dom, "mousemove", (e: MouseEvent) => {
      if (this.dragMode === "none") {
        this.cfg.onPointerMove(e.clientX, e.clientY);
      }
    });

    // Drag tracking: must stay on `window` so the gesture continues
    // when the pointer leaves the canvas mid-drag.
    this.listen(window, "mousemove", (e: MouseEvent) => {
      if (this.dragMode === "none") return;
      const dx = e.clientX - this.dragLastX;
      const dy = e.clientY - this.dragLastY;
      this.dragLastX = e.clientX;
      this.dragLastY = e.clientY;
      if (!this.didDrag) {
        const total = Math.hypot(
          e.clientX - this.dragStartX,
          e.clientY - this.dragStartY,
        );
        if (total < PAN_THRESHOLD_PX) return;
        this.didDrag = true;
      }
      if (this.dragMode === "pan") this.applyPan(dx, dy);
      else if (this.dragMode === "orbit") this.applyOrbit(dx, dy);
    });

    this.listen(window, "mouseup", (e: MouseEvent) => {
      if (this.dragMode === "none") return;
      if (this.didDrag) {
        this.suppressClickOnce = true;
        // Auto-clear if the drag ended outside `dom`. In that case the
        // click event never reaches the dom-bound click listener that
        // would normally consume the flag, and without this timer the
        // flag would still be set when the user later clicks legitimately,
        // silently swallowing their selection.
        window.setTimeout(() => {
          this.suppressClickOnce = false;
        }, 50);
      }
      this.dragMode = "none";
      this.didDrag = false;
      e;
    });

    this.listen(dom, "click", (e: MouseEvent) => {
      if (this.suppressClickOnce) {
        this.suppressClickOnce = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (performance.now() < this.touchClickSuppressUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (this.isTransitioning) return;
      this.cfg.onClick(e.clientX, e.clientY);
    });

    this.listen(dom, "dblclick", (e: MouseEvent) => {
      e.preventDefault();
      if (this.isTransitioning) return;
      this.cfg.onDoubleClick(e.clientX, e.clientY);
    });

    /* Suppress browser context menu on right-click so the orbit
     * gesture isn't fighting a menu popup. */
    this.listen(dom, "contextmenu", (e: MouseEvent) => {
      e.preventDefault();
    });

    /* ── Touch ───────────────────────────────────────────────── */

    this.listen(dom, "touchstart", (e: TouchEvent) => {
      if (this.isTransitioning) return;
      this.cfg.onGestureStart?.();
      const t = e.touches;
      if (t.length === 1) {
        this.dragMode = "pan";
        this.dragStartX = t[0]!.clientX;
        this.dragStartY = t[0]!.clientY;
        this.dragLastX = t[0]!.clientX;
        this.dragLastY = t[0]!.clientY;
        this.didDrag = false;
      } else if (t.length === 2) {
        const dx = t[1]!.clientX - t[0]!.clientX;
        const dy = t[1]!.clientY - t[0]!.clientY;
        this.pinchDist = Math.hypot(dx, dy);
        this.dragMode = this.touchOrbitEnabled ? "orbit" : "none";
        this.dragStartX = (t[0]!.clientX + t[1]!.clientX) / 2;
        this.dragStartY = (t[0]!.clientY + t[1]!.clientY) / 2;
        this.dragLastX = this.dragStartX;
        this.dragLastY = this.dragStartY;
        this.didDrag = false;
      }
    }, { passive: true });

    this.listen(dom, "touchmove", (e: TouchEvent) => {
      if (this.isTransitioning) return;
      const t = e.touches;
      if (t.length === 1 && this.dragMode === "pan") {
        const dx = t[0]!.clientX - this.dragLastX;
        const dy = t[0]!.clientY - this.dragLastY;
        if (!this.didDrag) {
          const total = Math.hypot(
            t[0]!.clientX - this.dragStartX,
            t[0]!.clientY - this.dragStartY,
          );
          if (total < TOUCH_DRAG_THRESHOLD_PX) return;
          this.didDrag = true;
        }
        e.preventDefault();
        this.dragLastX = t[0]!.clientX;
        this.dragLastY = t[0]!.clientY;
        this.applyPan(dx, dy);
      } else if (t.length === 2 && this.pinchDist != null) {
        e.preventDefault();
        const dx = t[1]!.clientX - t[0]!.clientX;
        const dy = t[1]!.clientY - t[0]!.clientY;
        const dist = Math.hypot(dx, dy);
        // Two-finger touches that resolve to the same coordinate produce
        // pinchDist=0; the divide would propagate Infinity → NaN through
        // applyZoomDelta into the camera distance, blacking the scene
        // until the gesture ends. Re-seed and skip the frame instead.
        if (this.pinchDist <= 0) {
          this.pinchDist = dist;
          return;
        }
        const factor = dist / this.pinchDist;
        /* Pinch out (factor > 1) -> distance shrinks (zoom in). */
        const step = -(factor - 1) * this.sDistance;
        this.applyZoomDelta(step);
        this.pinchDist = dist;

        if (this.touchOrbitEnabled && this.dragMode === "orbit") {
          const cx = (t[0]!.clientX + t[1]!.clientX) / 2;
          const cy = (t[0]!.clientY + t[1]!.clientY) / 2;
          const odx = cx - this.dragLastX;
          const ody = cy - this.dragLastY;
          this.dragLastX = cx;
          this.dragLastY = cy;
          this.applyOrbit(odx, ody);
        }
        this.cfg.onChange();
      }
    }, { passive: false });

    this.listen(dom, "touchend", (e: TouchEvent) => {
      if (e.touches.length < 2 && this.pinchDist != null) {
        this.pinchDist = null;
        /* Phantom-click suppression after pinch-end on iOS. */
        this.touchClickSuppressUntil = performance.now() + TOUCH_CLICK_SUPPRESS_MS;
      }
      if (e.touches.length === 0) {
        if (this.didDrag) {
          this.touchClickSuppressUntil = Math.max(
            this.touchClickSuppressUntil,
            performance.now() + TOUCH_CLICK_SUPPRESS_MS,
          );
        }
        this.dragMode = "none";
        this.didDrag = false;
      }
    }, { passive: true });

    this.listen(dom, "touchcancel", () => {
      this.dragMode = "none";
      this.didDrag = false;
      this.pinchDist = null;
    }, { passive: true });

    /* ── Keyboard ───────────────────────────────────────────── */

    this.listen(dom, "keydown", (e: KeyboardEvent) => {
      if (this.isTransitioning) return;
      const k = e.key.toLowerCase();
      // Single-fire shortcuts (Maya / Unity / RTS conventions):
      //   Home, Space → reset / frame all
      //   F          → frame selected entity
      if (k === "home" || k === " ") {
        e.preventDefault();
        this.cfg.onResetRequested();
        return;
      }
      if (k === "f") {
        e.preventDefault();
        this.cfg.onFrameSelectedRequested?.();
        return;
      }
      if (!HELD_KEYS.has(k)) return;
      e.preventDefault();
      if (!this.keys.has(k)) {
        this.keys.add(k);
        // Kick the rAF loop. Once applyKeyboard runs and mutates
        // target/pitch/yaw, smoothing keeps `moved` true and the
        // paint loop self-reschedules until the key is released.
        this.cfg.onChange();
      }
    });
    this.listen(dom, "keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.key.toLowerCase());
    });
    this.listen(dom, "blur", () => {
      this.keys.clear();
    });
  }
}
