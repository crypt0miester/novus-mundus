/**
 * Camera transition system — smooth fly-to animations for building focus,
 * overview zoom-out, and general camera movements.
 *
 * Uses cubic ease-in-out for position, target, and distance interpolation.
 * Locks the IsometricCamera controller during transitions to prevent
 * conflicting input.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/**
 * Cubic ease-in-out: [0,1] -> [0,1].
 * @param {number} t
 * @returns {number}
 */
function easeInOutCubic(t) {
  if (t < 0.5) return 4 * t * t * t;
  const f = 2 * t - 2;
  return 0.5 * f * f * f + 1;
}

// ---------------------------------------------------------------------------
// Default overview parameters
// ---------------------------------------------------------------------------

const OVERVIEW_DISTANCE = 6.0;
const OVERVIEW_TARGET_Y = 0.1;

// Margin multiplier applied to building size when computing focus distance
const FOCUS_MARGIN = 2.2;
const FOCUS_MIN_DISTANCE = 1.8;
const FOCUS_MAX_DISTANCE = 4.0;

// ---------------------------------------------------------------------------
// CameraTransitions
// ---------------------------------------------------------------------------

export class CameraTransitions {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./IsometricCamera.js').IsometricCamera} cameraController
   */
  constructor(camera, cameraController) {
    this._camera = camera;
    this._controller = cameraController;

    // Active transition state
    this._active = false;
    this._elapsed = 0;
    this._duration = 0;

    // Start / end snapshots
    this._startPos = new THREE.Vector3();
    this._endPos = new THREE.Vector3();
    this._startTarget = new THREE.Vector3();
    this._endTarget = new THREE.Vector3();
    this._startDistance = 0;
    this._endDistance = 0;

    // Callbacks
    this._onComplete = null;

    // Reusable temporaries
    this._tmpVec = new THREE.Vector3();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fly camera to focus on a building.
   * @param {THREE.Vector3} buildingPosition - World-space center of the building
   * @param {number} buildingSize - Approximate bounding radius of the building
   * @param {number} [duration=0.8] - Transition time in seconds
   * @returns {Promise<void>} Resolves when the transition finishes
   */
  flyToBuilding(buildingPosition, buildingSize, duration = 0.8) {
    return new Promise((resolve) => {
      // Compute an appropriate zoom distance based on building size
      let focusDist = buildingSize * FOCUS_MARGIN;
      focusDist = Math.max(FOCUS_MIN_DISTANCE, Math.min(FOCUS_MAX_DISTANCE, focusDist));

      // Target is the building position (keep existing Y or use building Y)
      const target = this._tmpVec.set(
        buildingPosition.x,
        buildingPosition.y,
        buildingPosition.z,
      );

      this._beginTransition(target, focusDist, duration, resolve);
    });
  }

  /**
   * Fly camera out to overview position.
   * @param {number} [duration=0.8]
   * @returns {Promise<void>}
   */
  flyToOverview(duration = 0.8) {
    return new Promise((resolve) => {
      const target = this._tmpVec.set(0, OVERVIEW_TARGET_Y, 0);
      this._beginTransition(target, OVERVIEW_DISTANCE, duration, resolve);
    });
  }

  /**
   * Whether a transition is currently in progress.
   * @returns {boolean}
   */
  get isTransitioning() {
    return this._active;
  }

  /**
   * Per-frame update. Must be called every frame.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    if (!this._active) return;

    this._elapsed += deltaTime;
    const rawT = Math.min(this._elapsed / this._duration, 1.0);
    const t = easeInOutCubic(rawT);

    // Interpolate camera position
    this._camera.position.lerpVectors(this._startPos, this._endPos, t);

    // Interpolate look-at target
    const lookTarget = this._tmpVec.lerpVectors(this._startTarget, this._endTarget, t);
    this._camera.lookAt(lookTarget);

    // If controller supports direct state overrides, push them so the
    // controller stays in sync when it resumes.
    // We approximate by setting the controller's target.
    if (t >= 0.5) {
      this._controller.setTarget(lookTarget);
    }

    // Transition complete
    if (rawT >= 1.0) {
      this._active = false;
      this._controller.setLocked(false);

      // Push final state into the controller
      this._controller.setTarget(this._endTarget);

      if (this._onComplete) {
        const cb = this._onComplete;
        this._onComplete = null;
        cb();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Begin a transition from current camera state to a new target + distance.
   * @param {THREE.Vector3} target
   * @param {number} distance
   * @param {number} duration
   * @param {Function} onComplete
   * @private
   */
  _beginTransition(target, distance, duration, onComplete) {
    // If already transitioning, snap to end of previous transition first
    if (this._active && this._onComplete) {
      const prevCb = this._onComplete;
      this._onComplete = null;
      prevCb();
    }

    this._controller.setLocked(true);

    // Snapshot start state
    this._startPos.copy(this._camera.position);
    // Use the current controller target direction to derive the current look-at point.
    // We approximate by projecting from camera position along the forward vector by the
    // current controller distance.
    const currentDist = this._controller.getDistance();
    const forward = this._tmpVec.set(0, 0, -1).applyQuaternion(this._camera.quaternion);
    this._startTarget.copy(this._camera.position).addScaledVector(forward, currentDist);

    // Compute end state: camera position offset from end target
    // Preserve current yaw/pitch direction but set new distance and target.
    const camOffset = this._tmpVec.copy(this._camera.position).sub(this._startTarget).normalize();
    this._endTarget.copy(target);
    this._endPos.copy(target).addScaledVector(camOffset, distance);

    // Store distances
    this._startDistance = currentDist;
    this._endDistance = distance;

    this._elapsed = 0;
    this._duration = Math.max(duration, 0.1);
    this._active = true;
    this._onComplete = onComplete || null;
  }
}
