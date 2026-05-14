/**
 * Custom isometric camera controller.
 *
 * Fixed-angle camera with smooth zoom and pan, suited to a town view.
 *
 * Interactions:
 *   Left-click    -> select (handled by TownRenderer)
 *   Right-drag    -> pan  (clamped to town bounds)
 *   Scroll wheel  -> zoom (minDistance..maxDistance)
 */

import * as THREE from 'three';

// Constants

const DEG = Math.PI / 180;

const CAMERA_CONFIG = {
  // View angle
  fov: 30,              // field of view (degrees)
  pitch: 35,            // camera elevation angle (degrees) — 35° ≈ true isometric
  yaw: 0,              // horizontal rotation (degrees)

  // Zoom
  distance: 5.0,        // starting zoom distance
  minDistance: 1.2,      // closest zoom
  maxDistance: 10.0,      // farthest zoom — keep edges invisible

  // Interaction feel
  zoomSpeed: 0.12,      // scroll wheel sensitivity
  zoomMomentum: 0.88,   // zoom inertia decay (0 = instant stop, 1 = never stops)
  panSpeed: 0.001,       // right-drag pan sensitivity
  smoothing: 8.0,       // camera interpolation speed (higher = snappier)

  // Bounds
  targetY: 0.1,         // look-at height above ground
  panBounds: 5.5,       // default pan limit (symmetric ± from center)

};

// IsometricCamera

export class IsometricCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement
   * @param {object} [options]
   */
  constructor(camera, domElement, options = {}) {
    this._camera = camera;
    this._domElement = domElement;

    // Merge config — CAMERA_CONFIG is the single source of truth
    const cfg = { ...CAMERA_CONFIG, ...options };
    this._defaultYaw = cfg.yaw * DEG;
    this._defaultPitch = cfg.pitch * DEG;
    this._defaultDistance = cfg.distance;
    this._minDistance = cfg.minDistance;
    this._maxDistance = cfg.maxDistance;
    this._targetY = cfg.targetY;
    this._panBounds = options.panBounds !== undefined ? options.panBounds : cfg.panBounds;
    this._zoomSpeed = cfg.zoomSpeed;
    this._zoomMomentum = cfg.zoomMomentum;
    this._panSpeed = cfg.panSpeed;
    this._smoothing = cfg.smoothing;
    // Apply FOV to the camera
    if (cfg.fov && this._camera.fov !== cfg.fov) {
      this._camera.fov = cfg.fov;
      this._camera.updateProjectionMatrix();
    }

    // Current state (what we smoothly interpolate toward)
    this._yaw = this._defaultYaw;
    this._pitch = this._defaultPitch;
    this._distance = this._defaultDistance;
    this._target = new THREE.Vector3(0, this._targetY, 0);

    // Smooth state (actual values applied to the camera each frame)
    this._smoothYaw = this._yaw;
    this._smoothPitch = this._pitch;
    this._smoothDistance = this._distance;
    this._smoothTarget = this._target.clone();

    // Zoom momentum
    this._zoomVelocity = 0;

    // Interaction state
    this._isPanning = false;
    this._locked = false;
    this._prevPointer = { x: 0, y: 0 };

    // Reusable vectors
    this._tmpVec = new THREE.Vector3();
    this._panRight = new THREE.Vector3();
    this._panUp = new THREE.Vector3();

    // Bind handlers
    this._onWheel = this._handleWheel.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    this._domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this._domElement.addEventListener('pointerdown', this._onPointerDown);
    this._domElement.addEventListener('pointermove', this._onPointerMove);
    this._domElement.addEventListener('pointerup', this._onPointerUp);
    this._domElement.addEventListener('pointerleave', this._onPointerUp);
    this._domElement.addEventListener('contextmenu', this._onContextMenu);

    // Apply initial position
    this._applyImmediate();
  }

  // Public API

  /**
   * Set the camera target position (for fly-to-building).
   * Accepts THREE.Vector3 or individual x, y, z coordinates.
   * @param {THREE.Vector3|number} positionOrX
   * @param {number} [y]
   * @param {number} [z]
   */
  setTarget(positionOrX, y, z) {
    if (typeof positionOrX === 'number') {
      this._target.set(positionOrX, y ?? this._targetY, z ?? 0);
    } else {
      this._target.set(positionOrX.x, positionOrX.y, positionOrX.z);
    }
  }

  /**
   * Update pan bounds at runtime (e.g. when plots unlock).
   * @param {number|{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
   */
  setPanBounds(bounds) {
    this._panBounds = bounds;
  }

  /**
   * Reset camera to the default view.
   */
  resetView() {
    this._yaw = this._defaultYaw;
    this._pitch = this._defaultPitch;
    this._distance = this._defaultDistance;
    this._target.set(0, this._targetY, 0);
    this._zoomVelocity = 0;
  }

  /** Save current camera state for later restoration. */
  getState() {
    return {
      target: this._target.clone(),
      yaw: this._yaw,
      pitch: this._pitch,
      distance: this._distance,
    };
  }

  /** Restore a previously saved camera state (skips smooth interpolation). */
  setState(state) {
    this._target.copy(state.target);
    this._smoothTarget.copy(state.target);
    this._yaw = state.yaw;
    this._smoothYaw = state.yaw;
    this._pitch = state.pitch;
    this._smoothPitch = state.pitch;
    this._distance = state.distance;
    this._smoothDistance = state.distance;
    this._zoomVelocity = 0;
  }

  /**
   * Lock or unlock camera interaction (during transitions).
   * @param {boolean} locked
   */
  setLocked(locked) {
    this._locked = !!locked;
    if (locked) {
      this._isPanning = false;
      this._zoomVelocity = 0;
    }
  }

  /**
   * Per-frame update. Call every frame with deltaTime in seconds.
   * @param {number} deltaTime
   */
  update(deltaTime) {
    const dt = Math.min(deltaTime, 0.1);

    // Apply zoom momentum
    if (Math.abs(this._zoomVelocity) > 0.0001) {
      this._distance += this._zoomVelocity;
      this._distance = Math.max(this._minDistance, Math.min(this._maxDistance, this._distance));
      this._zoomVelocity *= this._zoomMomentum;
    } else {
      this._zoomVelocity = 0;
    }

    // Enforce pan bounds on target (covers setTarget, setState, all paths)
    this._clampTarget();

    // Smooth interpolation toward desired state
    const factor = 1.0 - Math.exp(-this._smoothing * dt);

    this._smoothYaw += (this._yaw - this._smoothYaw) * factor;
    this._smoothPitch += (this._pitch - this._smoothPitch) * factor;
    this._smoothDistance += (this._distance - this._smoothDistance) * factor;
    this._smoothTarget.lerp(this._target, factor);

    // Clamp smoothTarget too — prevents the visible camera from ever exceeding bounds
    // (smoothTarget drives the actual camera position, not _target)
    this._clampSmoothTarget();

    // Compute camera position from spherical coordinates
    const cosPitch = Math.cos(this._smoothPitch);
    const sinPitch = Math.sin(this._smoothPitch);
    const cosYaw = Math.cos(this._smoothYaw);
    const sinYaw = Math.sin(this._smoothYaw);

    const d = this._smoothDistance;
    this._camera.position.set(
      this._smoothTarget.x + d * sinYaw * cosPitch,
      this._smoothTarget.y + d * sinPitch,
      this._smoothTarget.z + d * cosYaw * cosPitch,
    );

    this._camera.lookAt(this._smoothTarget);
  }

  /**
   * Get the current camera distance.
   * @returns {number}
   */
  getDistance() {
    return this._smoothDistance;
  }

  /**
   * Clean up all event listeners.
   */
  dispose() {
    this._domElement.removeEventListener('wheel', this._onWheel);
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._domElement.removeEventListener('pointermove', this._onPointerMove);
    this._domElement.removeEventListener('pointerup', this._onPointerUp);
    this._domElement.removeEventListener('pointerleave', this._onPointerUp);
    this._domElement.removeEventListener('contextmenu', this._onContextMenu);
  }

  // Event handlers

  /** @private */
  _handleWheel(e) {
    e.preventDefault();
    if (this._locked) return;

    const delta = e.deltaY > 0 ? 1 : -1;
    this._zoomVelocity += delta * this._zoomSpeed;
  }

  /** @private */
  _handlePointerDown(e) {
    if (this._locked) return;

    // Right button -> pan
    if (e.button === 2) {
      this._isPanning = true;
      this._prevPointer.x = e.clientX;
      this._prevPointer.y = e.clientY;
      this._domElement.setPointerCapture(e.pointerId);
      return;
    }
  }

  /** @private */
  _handlePointerMove(e) {
    if (this._locked) return;

    const dx = e.clientX - this._prevPointer.x;
    const dy = e.clientY - this._prevPointer.y;
    this._prevPointer.x = e.clientX;
    this._prevPointer.y = e.clientY;

    if (this._isPanning) {
      // Compute camera-relative right and forward vectors on the ground (XZ only)
      const camDir = this._tmpVec.copy(this._smoothTarget).sub(this._camera.position);
      this._panRight.set(-camDir.z, 0, camDir.x).normalize();
      this._panUp.set(camDir.x, 0, camDir.z).normalize(); // forward on ground plane

      // Scale pan by distance for consistent feel
      const panScale = this._panSpeed * this._smoothDistance;
      this._target.addScaledVector(this._panRight, -dx * panScale);
      this._target.addScaledVector(this._panUp, dy * panScale);
      this._target.y = this._targetY; // keep target on the ground

      this._clampTarget();
      return;
    }
  }

  /** @private */
  _handlePointerUp(e) {
    if (this._isPanning && e.button === 2) {
      this._isPanning = false;
      try { this._domElement.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    }

    // pointerleave resets all
    if (e.type === 'pointerleave') {
        this._isPanning = false;
    }
  }

  // Internals

  /**
   * Clamp the current target to pan bounds.
   * @private
   */
  _clampTarget() {
    this._clampVec(this._target);
  }

  /**
   * Clamp the smooth target to pan bounds (prevents visible camera from exceeding bounds).
   * @private
   */
  _clampSmoothTarget() {
    this._clampVec(this._smoothTarget);
  }

  /**
   * Clamp a Vector3's X and Z to pan bounds.
   * @param {THREE.Vector3} vec
   * @private
   */
  _clampVec(vec) {
    const bounds = this._panBounds;
    if (typeof bounds === 'object' && bounds !== null) {
      vec.x = Math.max(bounds.minX, Math.min(bounds.maxX, vec.x));
      vec.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, vec.z));
    } else if (typeof bounds === 'number') {
      vec.x = Math.max(-bounds, Math.min(bounds, vec.x));
      vec.z = Math.max(-bounds, Math.min(bounds, vec.z));
    }
  }

  /**
   * Snap smooth values to desired immediately (skip interpolation).
   * Used during initialization.
   * @private
   */
  _applyImmediate() {
    this._smoothYaw = this._yaw;
    this._smoothPitch = this._pitch;
    this._smoothDistance = this._distance;
    this._smoothTarget.copy(this._target);

    const cosPitch = Math.cos(this._smoothPitch);
    const sinPitch = Math.sin(this._smoothPitch);
    const cosYaw = Math.cos(this._smoothYaw);
    const sinYaw = Math.sin(this._smoothYaw);

    const d = this._smoothDistance;
    this._camera.position.set(
      this._smoothTarget.x + d * sinYaw * cosPitch,
      this._smoothTarget.y + d * sinPitch,
      this._smoothTarget.z + d * cosYaw * cosPitch,
    );
    this._camera.lookAt(this._smoothTarget);
  }
}
