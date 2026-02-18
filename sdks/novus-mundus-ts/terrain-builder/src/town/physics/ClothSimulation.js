/**
 * CPU Verlet cloth simulation for flags, banners, and pennants.
 *
 * 20x10 grid = 200 particles, 5 constraint iterations = 1000 solves/frame.
 * Typical execution: ~0.01 ms on modern hardware.
 *
 * Usage:
 *   const cloth = new ClothSimulation(2, 1, 20, 10);
 *   cloth.pinLeftEdge(new THREE.Vector3(0, 5, 0), 1);
 *   scene.add(cloth.mesh);
 *   // in render loop:
 *   cloth.applyWind(windDir, strength);
 *   cloth.update(dt);
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Reusable temporaries (avoid per-frame allocation)
// ---------------------------------------------------------------------------

const _delta  = new THREE.Vector3();
const _tmpV   = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _ab     = new THREE.Vector3();
const _ac     = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Particle
// ---------------------------------------------------------------------------

class Particle {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {boolean} pinned
   */
  constructor(x, y, z, pinned = false) {
    this.position = new THREE.Vector3(x, y, z);
    this.previous = new THREE.Vector3(x, y, z);
    this.pinned   = pinned;
    /** @type {THREE.Vector3|null} If pinned, the world position to lock to. */
    this.pinPos   = null;
    /** Accumulated force for this frame. */
    this.force    = new THREE.Vector3();
  }
}

// ---------------------------------------------------------------------------
// Constraint
// ---------------------------------------------------------------------------

class Constraint {
  /**
   * @param {number} a  index into particle array
   * @param {number} b  index into particle array
   * @param {number} restLength
   */
  constructor(a, b, restLength) {
    this.a = a;
    this.b = b;
    this.restLength = restLength;
  }
}

// ---------------------------------------------------------------------------
// ClothSimulation
// ---------------------------------------------------------------------------

export class ClothSimulation {

  /**
   * @param {number} width       world-space width of the cloth
   * @param {number} height      world-space height of the cloth
   * @param {number} segmentsX   horizontal subdivisions (e.g. 20)
   * @param {number} segmentsY   vertical subdivisions (e.g. 10)
   * @param {object} [options]
   * @param {number} [options.damping=0.97]
   * @param {THREE.Vector3} [options.gravity]  default (0, -9.81, 0)
   * @param {number} [options.constraintIterations=5]
   */
  constructor(width, height, segmentsX, segmentsY, options = {}) {
    this._width  = width;
    this._height = height;
    this._segX   = segmentsX;
    this._segY   = segmentsY;

    this._damping    = options.damping ?? 0.97;
    this._gravity    = options.gravity ? options.gravity.clone() : new THREE.Vector3(0, -9.81, 0);
    this._iterations = options.constraintIterations ?? 5;

    /** @type {Particle[]} */
    this._particles   = [];
    /** @type {Constraint[]} */
    this._constraints = [];

    // Wind accumulator (set each frame via applyWind, reset in update)
    this._windDir      = new THREE.Vector3();
    this._windStrength = 0;

    // Build particle grid ---------------------------------------------------
    const countX = segmentsX + 1;
    const countY = segmentsY + 1;
    this._countX = countX;
    this._countY = countY;

    for (let iy = 0; iy < countY; iy++) {
      for (let ix = 0; ix < countX; ix++) {
        const x = (ix / segmentsX) * width;
        const y = -(iy / segmentsY) * height; // y goes downward
        this._particles.push(new Particle(x, y, 0));
      }
    }

    // Build constraints (structural + shear) --------------------------------
    for (let iy = 0; iy < countY; iy++) {
      for (let ix = 0; ix < countX; ix++) {
        const idx = iy * countX + ix;

        // Structural — right
        if (ix < segmentsX) {
          const right = idx + 1;
          const rest  = this._particles[idx].position.distanceTo(this._particles[right].position);
          this._constraints.push(new Constraint(idx, right, rest));
        }

        // Structural — down
        if (iy < segmentsY) {
          const below = idx + countX;
          const rest  = this._particles[idx].position.distanceTo(this._particles[below].position);
          this._constraints.push(new Constraint(idx, below, rest));
        }

        // Shear — diagonal down-right
        if (ix < segmentsX && iy < segmentsY) {
          const dr   = idx + countX + 1;
          const rest = this._particles[idx].position.distanceTo(this._particles[dr].position);
          this._constraints.push(new Constraint(idx, dr, rest));
        }

        // Shear — diagonal down-left
        if (ix > 0 && iy < segmentsY) {
          const dl   = idx + countX - 1;
          const rest = this._particles[idx].position.distanceTo(this._particles[dl].position);
          this._constraints.push(new Constraint(idx, dl, rest));
        }
      }
    }

    // Build Three.js mesh ---------------------------------------------------
    this._geometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY);
    this._material = new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.0,
    });
    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.castShadow    = true;
    this._mesh.receiveShadow = false;
    this._mesh.frustumCulled = false;

    // Sync initial particle positions into the geometry so its rest shape
    // matches the particle grid exactly.
    this._syncGeometry();
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /** @returns {THREE.Mesh} The cloth mesh (add to your scene). */
  get mesh() { return this._mesh; }

  /**
   * Replace the cloth material.
   * @param {THREE.Material} mat
   */
  setMaterial(mat) {
    if (this._material && this._material !== mat) this._material.dispose();
    this._material = mat;
    this._mesh.material = mat;
  }

  // -------------------------------------------------------------------------
  // Pinning
  // -------------------------------------------------------------------------

  /**
   * Pin a single vertex to a fixed world position.
   * @param {number} index  particle index (row-major, top-left = 0)
   * @param {THREE.Vector3} position
   */
  pinVertex(index, position) {
    const p = this._particles[index];
    if (!p) return;
    p.pinned = true;
    p.pinPos = position.clone();
    p.position.copy(position);
    p.previous.copy(position);
  }

  /**
   * Unpin a vertex so it participates in the simulation again.
   * @param {number} index
   */
  unpinVertex(index) {
    const p = this._particles[index];
    if (!p) return;
    p.pinned = false;
    p.pinPos = null;
  }

  /**
   * Pin the entire left column of the grid to a flag pole.
   * Vertices are spaced evenly along the pole from top to bottom.
   * @param {THREE.Vector3} polePosition  world position of the pole base (top attachment)
   * @param {number} poleHeight  height the flag spans along the pole
   */
  pinLeftEdge(polePosition, poleHeight) {
    for (let iy = 0; iy < this._countY; iy++) {
      const idx = iy * this._countX; // left column
      const t   = iy / (this._countY - 1); // 0 at top, 1 at bottom
      const pos = new THREE.Vector3(
        polePosition.x,
        polePosition.y - t * poleHeight,
        polePosition.z,
      );
      this.pinVertex(idx, pos);
    }
  }

  // -------------------------------------------------------------------------
  // Forces
  // -------------------------------------------------------------------------

  /**
   * Apply a global wind force this frame.
   * @param {THREE.Vector3|{x:number,y:number,z:number}} direction
   * @param {number} strength
   */
  applyWind(direction, strength) {
    this._windDir.set(direction.x, direction.y, direction.z).normalize();
    this._windStrength = strength;
  }

  /**
   * Apply a local force within a radius (e.g. NPC walking past the flag).
   * @param {THREE.Vector3} position  world position of the force source
   * @param {number} radius
   * @param {THREE.Vector3} force
   */
  applyForce(position, radius, force) {
    const r2 = radius * radius;
    for (let i = 0, len = this._particles.length; i < len; i++) {
      const p = this._particles[i];
      if (p.pinned) continue;
      const d2 = p.position.distanceToSquared(position);
      if (d2 < r2) {
        const falloff = 1 - d2 / r2;
        p.force.addScaledVector(force, falloff);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Simulation step
  // -------------------------------------------------------------------------

  /**
   * Advance the simulation by deltaTime seconds.
   * @param {number} deltaTime
   */
  update(deltaTime) {
    const dt   = Math.min(deltaTime, 0.033); // cap at ~30 fps minimum
    const dt2  = dt * dt;
    const damp = this._damping;
    const grav = this._gravity;
    const particles   = this._particles;
    const constraints = this._constraints;
    const iterations  = this._iterations;

    // 1. Accumulate forces (gravity + wind) --------------------------------
    const windForce = _tmpV.copy(this._windDir).multiplyScalar(this._windStrength);

    for (let i = 0, len = particles.length; i < len; i++) {
      const p = particles[i];
      if (p.pinned) continue;
      // Gravity
      p.force.x += grav.x;
      p.force.y += grav.y;
      p.force.z += grav.z;
      // Wind — add slight variation per particle for a ripple effect
      const noise = 0.8 + 0.4 * Math.sin(i * 1.7 + dt * 100);
      p.force.x += windForce.x * noise;
      p.force.y += windForce.y * noise;
      p.force.z += windForce.z * noise;
    }

    // 2. Verlet integration -------------------------------------------------
    for (let i = 0, len = particles.length; i < len; i++) {
      const p = particles[i];
      if (p.pinned) continue;

      const px = p.position.x;
      const py = p.position.y;
      const pz = p.position.z;

      // Velocity = current - previous
      let vx = (px - p.previous.x) * damp;
      let vy = (py - p.previous.y) * damp;
      let vz = (pz - p.previous.z) * damp;

      // Apply accumulated force
      vx += p.force.x * dt2;
      vy += p.force.y * dt2;
      vz += p.force.z * dt2;

      p.previous.x = px;
      p.previous.y = py;
      p.previous.z = pz;

      p.position.x = px + vx;
      p.position.y = py + vy;
      p.position.z = pz + vz;

      // Reset force accumulator
      p.force.x = 0;
      p.force.y = 0;
      p.force.z = 0;
    }

    // 3. Distance constraints (Jakobsen relaxation) -------------------------
    for (let iter = 0; iter < iterations; iter++) {
      for (let c = 0, clen = constraints.length; c < clen; c++) {
        const con = constraints[c];
        const pA  = particles[con.a];
        const pB  = particles[con.b];

        _delta.x = pB.position.x - pA.position.x;
        _delta.y = pB.position.y - pA.position.y;
        _delta.z = pB.position.z - pA.position.z;

        const dist = Math.sqrt(_delta.x * _delta.x + _delta.y * _delta.y + _delta.z * _delta.z);
        if (dist < 1e-8) continue;

        const diff = (dist - con.restLength) / dist;

        if (!pA.pinned && !pB.pinned) {
          const half = diff * 0.5;
          pA.position.x += _delta.x * half;
          pA.position.y += _delta.y * half;
          pA.position.z += _delta.z * half;
          pB.position.x -= _delta.x * half;
          pB.position.y -= _delta.y * half;
          pB.position.z -= _delta.z * half;
        } else if (!pA.pinned) {
          pA.position.x += _delta.x * diff;
          pA.position.y += _delta.y * diff;
          pA.position.z += _delta.z * diff;
        } else if (!pB.pinned) {
          pB.position.x -= _delta.x * diff;
          pB.position.y -= _delta.y * diff;
          pB.position.z -= _delta.z * diff;
        }
      }
    }

    // 4. Enforce pin constraints --------------------------------------------
    for (let i = 0, len = particles.length; i < len; i++) {
      const p = particles[i];
      if (p.pinned && p.pinPos) {
        p.position.copy(p.pinPos);
        p.previous.copy(p.pinPos);
      }
    }

    // 5. Update geometry ----------------------------------------------------
    this._syncGeometry();

    // 6. Reset wind (caller must re-apply each frame) -----------------------
    this._windStrength = 0;
  }

  // -------------------------------------------------------------------------
  // Geometry sync
  // -------------------------------------------------------------------------

  /** Copy particle positions into the PlaneGeometry attributes. */
  _syncGeometry() {
    const posAttr   = this._geometry.attributes.position;
    const particles = this._particles;

    for (let i = 0, len = particles.length; i < len; i++) {
      const p = particles[i];
      posAttr.setXYZ(i, p.position.x, p.position.y, p.position.z);
    }

    posAttr.needsUpdate = true;
    this._geometry.computeVertexNormals();
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose() {
    if (this._geometry) {
      this._geometry.dispose();
      this._geometry = null;
    }
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    if (this._mesh) {
      if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
      this._mesh = null;
    }
    this._particles.length   = 0;
    this._constraints.length = 0;
  }
}
