/**
 * Analytical physics for town props — no physics engine required.
 *
 * Each prop uses ~5 float ops per frame.  State is stored in parallel
 * Float32Arrays for cache-friendly iteration.
 *
 * Prop categories:
 *   pendulum  — shop signs, lanterns (damped pendulum)
 *   spring    — cart suspension (spring-damper)
 *   rotor     — windmill blades, water wheels (angular momentum)
 *   hinge     — drawbridges, gates (constrained hinge)
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Internal enum for prop type
// ---------------------------------------------------------------------------

const TYPE_PENDULUM = 0;
const TYPE_SPRING   = 1;
const TYPE_ROTOR    = 2;
const TYPE_HINGE    = 3;

// Default capacity — grows automatically if exceeded.
const DEFAULT_MAX_PROPS = 128;

// ---------------------------------------------------------------------------
// Reusable temporaries
// ---------------------------------------------------------------------------

const _windVec = new THREE.Vector3();
const _tmpVec  = new THREE.Vector3();

// ---------------------------------------------------------------------------
// PropPhysicsSystem
// ---------------------------------------------------------------------------

export class PropPhysicsSystem {

  constructor() {
    /** @type {number} Current number of registered props. */
    this._count = 0;

    /** @type {number} Allocated capacity. */
    this._capacity = DEFAULT_MAX_PROPS;

    // Parallel state arrays ---------------------------------------------------
    this._angles        = new Float32Array(this._capacity);
    this._angVelocities = new Float32Array(this._capacity);
    this._displacements = new Float32Array(this._capacity);
    this._velocities    = new Float32Array(this._capacity);

    // Per-prop metadata (not perf-critical — plain arrays) --------------------
    /** @type {Array<THREE.Object3D|null>} */
    this._meshes = new Array(this._capacity).fill(null);
    /** @type {Int8Array} prop type enum */
    this._types  = new Int8Array(this._capacity);

    // Config arrays (one set per type, indexed by prop slot) ------------------
    // Pendulum
    this._ropeLength = new Float32Array(this._capacity);
    this._damping    = new Float32Array(this._capacity);
    this._restAngle  = new Float32Array(this._capacity);
    /** @type {Array<string>} rotation axis 'x'|'y'|'z' */
    this._pendulumAxis = new Array(this._capacity).fill('z');

    // Spring
    this._springK    = new Float32Array(this._capacity);
    this._dampD      = new Float32Array(this._capacity);
    this._restHeight = new Float32Array(this._capacity);

    // Rotor
    this._friction  = new Float32Array(this._capacity);
    this._rotorAxis = new Array(this._capacity).fill('z');
    this._rotorSpeed = new Float32Array(this._capacity); // base target speed

    // Hinge
    this._hingeTarget = new Float32Array(this._capacity);
    this._hingeSpeed  = new Float32Array(this._capacity);
    this._hingeAxis   = new Array(this._capacity).fill('x');

    // External accumulator — impulse to apply next frame
    this._impulses = new Float32Array(this._capacity);

    // Global wind state -------------------------------------------------------
    this._windDirection = new THREE.Vector3(1, 0, 0);
    this._windStrength  = 0;

    // Id bookkeeping ----------------------------------------------------------
    /** @type {Map<string, number>} propId → slot index */
    this._idMap = new Map();
    /** @type {string[]} slot → propId */
    this._ids   = new Array(this._capacity).fill('');
    /** @type {number[]} free list of recycled slots */
    this._freeSlots = [];
    /** @type {number} monotonic counter for auto-ids */
    this._nextAutoId = 0;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Grow all parallel arrays to at least `newCap`. */
  _grow(newCap) {
    const copy = (old, cap) => {
      const a = new Float32Array(cap);
      a.set(old);
      return a;
    };
    const copyI8 = (old, cap) => {
      const a = new Int8Array(cap);
      a.set(old);
      return a;
    };
    const copyArr = (old, cap, fill) => {
      const a = new Array(cap).fill(fill);
      for (let i = 0; i < old.length; i++) a[i] = old[i];
      return a;
    };

    this._angles        = copy(this._angles, newCap);
    this._angVelocities = copy(this._angVelocities, newCap);
    this._displacements = copy(this._displacements, newCap);
    this._velocities    = copy(this._velocities, newCap);
    this._ropeLength    = copy(this._ropeLength, newCap);
    this._damping       = copy(this._damping, newCap);
    this._restAngle     = copy(this._restAngle, newCap);
    this._springK       = copy(this._springK, newCap);
    this._dampD         = copy(this._dampD, newCap);
    this._restHeight    = copy(this._restHeight, newCap);
    this._friction      = copy(this._friction, newCap);
    this._rotorSpeed    = copy(this._rotorSpeed, newCap);
    this._hingeTarget   = copy(this._hingeTarget, newCap);
    this._hingeSpeed    = copy(this._hingeSpeed, newCap);
    this._impulses      = copy(this._impulses, newCap);
    this._types         = copyI8(this._types, newCap);
    this._meshes        = copyArr(this._meshes, newCap, null);
    this._pendulumAxis  = copyArr(this._pendulumAxis, newCap, 'z');
    this._rotorAxis     = copyArr(this._rotorAxis, newCap, 'z');
    this._hingeAxis     = copyArr(this._hingeAxis, newCap, 'x');
    this._ids           = copyArr(this._ids, newCap, '');

    this._capacity = newCap;
  }

  /** Allocate one slot, returning the index. */
  _allocSlot() {
    if (this._freeSlots.length > 0) return this._freeSlots.pop();
    const idx = this._count;
    this._count++;
    if (this._count > this._capacity) this._grow(this._capacity * 2);
    return idx;
  }

  /** Generate or validate a prop id, returning it. */
  _resolveId(mesh, explicitId) {
    if (explicitId != null) return String(explicitId);
    if (mesh && mesh.uuid) return mesh.uuid;
    return `prop_${this._nextAutoId++}`;
  }

  /** Common registration entry point. */
  _register(mesh, type, id) {
    if (this._idMap.has(id)) {
      // Already registered — return existing slot for update.
      return this._idMap.get(id);
    }
    const slot = this._allocSlot();
    this._meshes[slot] = mesh;
    this._types[slot]  = type;
    this._ids[slot]    = id;
    this._idMap.set(id, slot);

    // Zero state
    this._angles[slot]        = 0;
    this._angVelocities[slot] = 0;
    this._displacements[slot] = 0;
    this._velocities[slot]    = 0;
    this._impulses[slot]      = 0;

    return slot;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a swinging sign or lantern (damped pendulum).
   * @param {THREE.Object3D} mesh
   * @param {object} options
   * @param {number}  [options.ropeLength=0.5]
   * @param {number}  [options.damping=0.98]
   * @param {number}  [options.restAngle=0]
   * @param {string}  [options.axis='z']
   * @param {string}  [options.id]
   * @returns {string} propId
   */
  registerPendulum(mesh, options = {}) {
    const id   = this._resolveId(mesh, options.id);
    const slot = this._register(mesh, TYPE_PENDULUM, id);

    this._ropeLength[slot]   = options.ropeLength ?? 0.5;
    this._damping[slot]      = options.damping    ?? 0.98;
    this._restAngle[slot]    = options.restAngle  ?? 0;
    this._pendulumAxis[slot] = options.axis        ?? 'z';

    this._angles[slot] = this._restAngle[slot];

    return id;
  }

  /**
   * Register a cart with spring suspension.
   * @param {THREE.Object3D} mesh
   * @param {object} options
   * @param {number}  [options.springK=50]
   * @param {number}  [options.dampD=3]
   * @param {number}  [options.restHeight]  defaults to mesh.position.y
   * @param {string}  [options.id]
   * @returns {string} propId
   */
  registerSpring(mesh, options = {}) {
    const id   = this._resolveId(mesh, options.id);
    const slot = this._register(mesh, TYPE_SPRING, id);

    this._springK[slot]    = options.springK    ?? 50;
    this._dampD[slot]      = options.dampD      ?? 3;
    this._restHeight[slot] = options.restHeight ?? (mesh ? mesh.position.y : 0);

    return id;
  }

  /**
   * Register a windmill or water wheel (angular momentum).
   * @param {THREE.Object3D} mesh
   * @param {object} options
   * @param {number}  [options.friction=0.1]
   * @param {string}  [options.axis='z']
   * @param {number}  [options.speed=1]
   * @param {string}  [options.id]
   * @returns {string} propId
   */
  registerRotor(mesh, options = {}) {
    const id   = this._resolveId(mesh, options.id);
    const slot = this._register(mesh, TYPE_ROTOR, id);

    this._friction[slot]   = options.friction ?? 0.1;
    this._rotorAxis[slot]  = options.axis     ?? 'z';
    this._rotorSpeed[slot] = options.speed    ?? 1;

    return id;
  }

  /**
   * Register a drawbridge or gate (constrained hinge).
   * @param {THREE.Object3D} mesh
   * @param {object} options
   * @param {number}  [options.targetAngle=0]
   * @param {number}  [options.speed=0.05]
   * @param {string}  [options.axis='x']
   * @param {string}  [options.id]
   * @returns {string} propId
   */
  registerHinge(mesh, options = {}) {
    const id   = this._resolveId(mesh, options.id);
    const slot = this._register(mesh, TYPE_HINGE, id);

    this._hingeTarget[slot] = options.targetAngle ?? 0;
    this._hingeSpeed[slot]  = options.speed       ?? 0.05;
    this._hingeAxis[slot]   = options.axis         ?? 'x';

    return id;
  }

  // -------------------------------------------------------------------------
  // External forces
  // -------------------------------------------------------------------------

  /**
   * Apply an impulse to a registered prop.
   * For pendulums this is added to angular velocity; for springs it is added
   * to linear velocity; for rotors it is added to angular velocity.
   * @param {string} propId
   * @param {number} force  scalar impulse magnitude
   */
  applyImpulse(propId, force) {
    const slot = this._idMap.get(propId);
    if (slot === undefined) return;
    this._impulses[slot] += force;
  }

  /**
   * Set the global wind that affects all pendulums and rotors.
   * @param {THREE.Vector3|{x:number,y:number,z:number}} direction
   * @param {number} strength
   */
  applyWindToAll(direction, strength) {
    this._windDirection.set(direction.x, direction.y, direction.z).normalize();
    this._windStrength = strength;
  }

  /**
   * Update the hinge target (e.g. open / close a drawbridge).
   * @param {string} propId
   * @param {number} targetAngle  in radians
   */
  setHingeTarget(propId, targetAngle) {
    const slot = this._idMap.get(propId);
    if (slot === undefined) return;
    this._hingeTarget[slot] = targetAngle;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  /**
   * Step all prop physics and write back to mesh transforms.
   * @param {number} deltaTime  seconds since last frame (clamped internally)
   */
  update(deltaTime) {
    // Clamp dt to avoid spiral-of-death with large frame spikes.
    const dt = Math.min(deltaTime, 0.05);

    const windStr = this._windStrength;

    for (let i = 0; i < this._count; i++) {
      const mesh = this._meshes[i];
      if (mesh === null) continue; // slot was freed

      const type    = this._types[i];
      const impulse = this._impulses[i];
      this._impulses[i] = 0;

      switch (type) {

        // ---- Pendulum (damped) -------------------------------------------
        case TYPE_PENDULUM: {
          let angle  = this._angles[i];
          let angVel = this._angVelocities[i];
          const L    = this._ropeLength[i];
          const damp = this._damping[i];
          const rest = this._restAngle[i];

          // Gravity torque
          angVel += (-9.81 / L) * Math.sin(angle - rest) * dt;

          // Wind contribution — project wind onto the swing axis.
          // A sign hanging on the Z axis swings from X-wind, etc.
          const axis = this._pendulumAxis[i];
          let windComponent = 0;
          if (axis === 'z') windComponent = this._windDirection.x;
          else if (axis === 'x') windComponent = this._windDirection.z;
          else windComponent = this._windDirection.x;
          angVel += windComponent * windStr * 0.3 * dt;

          // External impulse
          angVel += impulse;

          // Damping
          angVel *= damp;

          // Integrate
          angle += angVel * dt;

          this._angles[i]        = angle;
          this._angVelocities[i] = angVel;

          // Write to mesh
          mesh.rotation[axis] = angle;
          break;
        }

        // ---- Spring-Damper -----------------------------------------------
        case TYPE_SPRING: {
          let disp = this._displacements[i];
          let vel  = this._velocities[i];
          const k  = this._springK[i];
          const d  = this._dampD[i];
          const rh = this._restHeight[i];

          // Spring + damping force
          const force = -k * disp - d * vel;
          vel  += force * dt;
          disp += vel * dt;

          // External impulse as a velocity kick
          vel += impulse;

          this._displacements[i] = disp;
          this._velocities[i]    = vel;

          mesh.position.y = rh + disp;
          break;
        }

        // ---- Rotor (angular momentum) ------------------------------------
        case TYPE_ROTOR: {
          let angVel   = this._angVelocities[i];
          const fric   = this._friction[i];
          const axis   = this._rotorAxis[i];
          const target = this._rotorSpeed[i];

          // Wind drives the rotor toward its target speed.
          const driveTorque = (target * windStr) - fric * angVel;
          angVel += driveTorque * dt;

          // External impulse
          angVel += impulse;

          this._angVelocities[i] = angVel;

          // Accumulate angle
          this._angles[i] += angVel * dt;

          mesh.rotation[axis] = this._angles[i];
          break;
        }

        // ---- Hinge (constrained) -----------------------------------------
        case TYPE_HINGE: {
          let angle  = this._angles[i];
          const tgt  = this._hingeTarget[i];
          const spd  = this._hingeSpeed[i];
          const axis = this._hingeAxis[i];

          // Smooth interpolation toward target
          angle += (tgt - angle) * spd;

          this._angles[i] = angle;

          mesh.rotation[axis] = angle;
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Removal
  // -------------------------------------------------------------------------

  /**
   * Remove a prop from the simulation.
   * @param {string} propId
   */
  unregister(propId) {
    const slot = this._idMap.get(propId);
    if (slot === undefined) return;

    this._meshes[slot] = null;
    this._ids[slot]    = '';
    this._idMap.delete(propId);
    this._freeSlots.push(slot);
  }

  /**
   * Clean up all internal state.
   */
  dispose() {
    this._meshes.fill(null);
    this._idMap.clear();
    this._freeSlots.length = 0;
    this._count = 0;
  }
}
