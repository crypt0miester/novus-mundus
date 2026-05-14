/**
 * Economy cart system — animated carts traveling between buildings along
 * CatmullRom spline routes, and resource particle arcs flying between
 * source and destination.
 *
 * Cart meshes are InstancedMesh (box body + circle wheels + bar handle).
 * Each cart bounces on terrain via a spring-damper that reads the terrain
 * height sampler along its path.
 *
 * Cart types:
 *   0 = ore    (Workshop -> Forge)   grey body + ore chunk particles
 *   1 = gold   (Treasury -> Market)  gold body
 *   2 = fish   (Dock -> Market)      wooden body
 *   3 = supply (Market -> others)    covered wagon body
 */

import * as THREE from 'three';

// Constants

const MAX_CARTS = 64;
const MAX_ARC_PARTICLES = 256;

/** Cart type enum. */
const CART_ORE = 0;
const CART_GOLD = 1;
const CART_FISH = 2;
const CART_SUPPLY = 3;

/** Cart body colors by type. */
const CART_COLORS = [
  0x808080, // ore — grey
  0xdaa520, // gold — goldenrod
  0xa0522d, // fish — sienna wood
  0x8b7355, // supply — tan canvas
];

/** Cargo accent colors (top decoration on cart). */
const CARGO_COLORS = [
  0x555555, // ore chunks — dark grey
  0xffd700, // gold coins — bright gold
  0x87ceeb, // fish — sky blue shimmer
  0xdeb887, // supply — burlap
];

/** Resource arc particle colors. */
const ARC_PARTICLE_COLORS = [
  0x888888, // ore
  0xffd700, // gold
  0x4682b4, // fish
  0xdeb887, // supply
];

/** Cart dimensions (world units). */
const CART_BODY_W = 0.035;
const CART_BODY_H = 0.015;
const CART_BODY_D = 0.025;

const WHEEL_RADIUS = 0.007;
const WHEEL_SEGMENTS = 8;

const HANDLE_LENGTH = 0.02;
const HANDLE_RADIUS = 0.002;

/** Spring-damper for terrain bounce. */
const SPRING_K = 120.0;
const SPRING_DAMP = 8.0;
const CART_MASS = 1.0;

/** Arc particle defaults. */
const ARC_HEIGHT = 0.15;
const ARC_PARTICLE_SIZE = 0.006;

// Reusable THREE objects

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _tangent = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

// Cart route record

/**
 * @typedef {object} CartRoute
 * @property {number} id
 * @property {THREE.CatmullRomCurve3} curve
 * @property {number} cartType
 * @property {number} speed       - Normalized speed: 1/tripDuration
 * @property {number} t           - Current path parameter [0,1]
 * @property {number} heightY     - Spring-tracked Y position
 * @property {number} velocityY   - Spring velocity
 * @property {number} instanceIdx - Index into InstancedMesh
 */

/**
 * @typedef {object} ResourceArc
 * @property {number} id
 * @property {THREE.Vector3} from
 * @property {THREE.Vector3} to
 * @property {number} arcHeight
 * @property {number} resourceType
 * @property {number} count         - Number of particles in flight
 * @property {number} interval      - Time between spawns
 * @property {number} spawnTimer
 * @property {{ t: number, alive: boolean, startIdx: number }[]} particles
 */

// EconomyCartSystem

export class EconomyCartSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {number} [options.maxCarts=64]
   * @param {number} [options.maxArcParticles=256]
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._maxCarts = options.maxCarts || MAX_CARTS;
    this._maxArcParticles = options.maxArcParticles || MAX_ARC_PARTICLES;
    this._disposed = false;

    // Route/arc storage
    this._nextId = 1;
    this._routes = new Map();
    this._arcs = new Map();

    // Instanced meshes for carts
    this._cartBody = this._createCartBodyInstanced(this._maxCarts);
    this._cartWheels = this._createCartWheelInstanced(this._maxCarts * 2);
    this._cartHandle = this._createCartHandleInstanced(this._maxCarts);
    this._cartCargo = this._createCartCargoInstanced(this._maxCarts);

    scene.add(this._cartBody);
    scene.add(this._cartWheels);
    scene.add(this._cartHandle);
    scene.add(this._cartCargo);

    // Points geometry for arc particles
    this._arcPositions = new Float32Array(this._maxArcParticles * 3);
    this._arcColors = new Float32Array(this._maxArcParticles * 3);
    this._arcAlive = new Uint8Array(this._maxArcParticles);
    this._arcGeo = new THREE.BufferGeometry();
    this._arcGeo.setAttribute('position', new THREE.BufferAttribute(this._arcPositions, 3));
    this._arcGeo.setAttribute('color', new THREE.BufferAttribute(this._arcColors, 3));
    this._arcMat = new THREE.PointsMaterial({
      size: ARC_PARTICLE_SIZE,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this._arcPoints = new THREE.Points(this._arcGeo, this._arcMat);
    this._arcPoints.frustumCulled = false;
    scene.add(this._arcPoints);

    this._activeArcCount = 0;
    this._activeCartCount = 0;
  }

  // Public API

  /**
   * Add a cart route between two positions, with optional waypoints.
   * @param {THREE.Vector3} fromPos
   * @param {THREE.Vector3} toPos
   * @param {THREE.Vector3[]} waypoints - Intermediate curve control points
   * @param {number} cartType - 0=ore, 1=gold, 2=fish, 3=supply
   * @param {number} speed - Trip duration in seconds
   * @returns {number} Route ID
   */
  addRoute(fromPos, toPos, waypoints = [], cartType = 0, speed = 6) {
    if (this._routes.size >= this._maxCarts) return -1;

    const id = this._nextId++;
    const points = [fromPos.clone()];
    for (let i = 0; i < waypoints.length; i++) {
      points.push(waypoints[i].clone());
    }
    points.push(toPos.clone());

    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    const instanceIdx = this._activeCartCount;
    this._activeCartCount++;

    /** @type {CartRoute} */
    const route = {
      id,
      curve,
      cartType,
      speed: 1.0 / Math.max(speed, 0.1),
      t: 0,
      heightY: fromPos.y,
      velocityY: 0,
      instanceIdx,
    };

    this._routes.set(id, route);
    this._updateInstanceCounts();
    return id;
  }

  /**
   * Add a resource arc (particles flying in a parabola).
   * @param {THREE.Vector3} fromPos
   * @param {THREE.Vector3} toPos
   * @param {number} resourceType - 0=ore, 1=gold, 2=fish, 3=supply
   * @param {number} count - Number of particles in flight simultaneously
   * @param {number} interval - Time in seconds between spawns
   * @returns {number} Arc ID
   */
  addResourceArc(fromPos, toPos, resourceType = 0, count = 3, interval = 0.5) {
    const id = this._nextId++;

    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({ t: -1, alive: false, startIdx: 0 });
    }

    /** @type {ResourceArc} */
    const arc = {
      id,
      from: fromPos.clone(),
      to: toPos.clone(),
      arcHeight: ARC_HEIGHT,
      resourceType,
      count,
      interval,
      spawnTimer: 0,
      particles,
    };

    this._arcs.set(id, arc);
    return id;
  }

  /**
   * Remove a cart route by ID.
   * @param {number} id
   */
  removeRoute(id) {
    if (!this._routes.has(id)) return;
    this._routes.delete(id);
    this._rebuildRouteIndices();
  }

  /**
   * Remove a resource arc by ID.
   * @param {number} id
   */
  removeArc(id) {
    this._arcs.delete(id);
  }

  /**
   * Per-frame update.
   * @param {number} deltaTime
   * @param {{ getHeight(x: number, z: number): number } | null} terrainSampler
   */
  update(deltaTime, terrainSampler) {
    if (this._disposed) return;

    const dt = Math.min(deltaTime, 0.1);

    this._updateRoutes(dt, terrainSampler);
    this._updateArcs(dt);
  }

  /**
   * Get active cart track segments (for footprint stamping).
   * @returns {Array<{ x1: number, z1: number, x2: number, z2: number }>}
   */
  getActiveSegments() {
    const result = [];
    const _pos = new THREE.Vector3();
    const _prev = new THREE.Vector3();
    for (const [, route] of this._routes) {
      if (!route.curve || route.curve.points.length < 2 || route.t <= 0) continue;
      try {
        const t = Math.max(0, Math.min(route.t, 1));
        route.curve.getPointAt(t, _pos);
        const prevT = Math.max(0, t - 0.02);
        route.curve.getPointAt(prevT, _prev);
        result.push({ x1: _prev.x, z1: _prev.z, x2: _pos.x, z2: _pos.z });
      } catch (_) {
        // Skip routes with invalid curves
      }
    }
    return result;
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    this._disposed = true;

    const meshes = [this._cartBody, this._cartWheels, this._cartHandle, this._cartCargo, this._arcPoints];
    for (const mesh of meshes) {
      this._scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else mesh.material.dispose();
      }
      if (mesh.dispose) mesh.dispose();
    }

    this._routes.clear();
    this._arcs.clear();
  }

  // Instanced mesh creation

  /** @private */
  _createCartBodyInstanced(maxCount) {
    const geo = new THREE.BoxGeometry(CART_BODY_W, CART_BODY_H, CART_BODY_D);
    geo.translate(0, CART_BODY_H * 0.5 + WHEEL_RADIUS, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 });
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  /** @private */
  _createCartWheelInstanced(maxCount) {
    const geo = new THREE.CircleGeometry(WHEEL_RADIUS, WHEEL_SEGMENTS);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9, metalness: 0.0 });
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  /** @private */
  _createCartHandleInstanced(maxCount) {
    const geo = new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, HANDLE_LENGTH, 4);
    geo.rotateZ(Math.PI / 2);
    geo.translate(CART_BODY_W * 0.5 + HANDLE_LENGTH * 0.5, WHEEL_RADIUS + CART_BODY_H * 0.3, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9, metalness: 0.0 });
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    return mesh;
  }

  /** @private */
  _createCartCargoInstanced(maxCount) {
    const geo = new THREE.BoxGeometry(CART_BODY_W * 0.7, CART_BODY_H * 0.5, CART_BODY_D * 0.7);
    geo.translate(0, CART_BODY_H + WHEEL_RADIUS + CART_BODY_H * 0.25, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.15 });
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    return mesh;
  }

  // Route update

  /** @private */
  _updateRoutes(dt, terrainSampler) {
    for (const [, route] of this._routes) {
      // Advance along path (ping-pong)
      route.t += route.speed * dt;
      if (route.t > 1.0) {
        // Reverse direction: flip the curve parameter back
        route.t = 2.0 - route.t;
        route.speed = -Math.abs(route.speed);
      } else if (route.t < 0.0) {
        route.t = -route.t;
        route.speed = Math.abs(route.speed);
      }

      const clampedT = Math.max(0, Math.min(1, route.t));

      // Get position + tangent from spline
      route.curve.getPointAt(clampedT, _pos);
      route.curve.getTangentAt(clampedT, _tangent);

      // Spring-damper terrain tracking
      const terrainY = terrainSampler ? terrainSampler.getHeight(_pos.x, _pos.z) : 0;
      const displacement = terrainY - route.heightY;
      const springForce = SPRING_K * displacement;
      const dampForce = -SPRING_DAMP * route.velocityY;
      const accel = (springForce + dampForce) / CART_MASS;
      route.velocityY += accel * dt;
      route.heightY += route.velocityY * dt;

      _pos.y = route.heightY;

      // Orient cart along tangent
      _tangent.y = 0;
      if (_tangent.lengthSq() < 0.0001) _tangent.set(1, 0, 0);
      _tangent.normalize();

      _quat.setFromUnitVectors(_up, _up); // identity
      // Build rotation: look along tangent
      const lookTarget = _pos.clone().add(_tangent);
      const lookMat = new THREE.Matrix4().lookAt(_pos, lookTarget, _up);
      _quat.setFromRotationMatrix(lookMat);

      const idx = route.instanceIdx;

      // Wheel spin (cosmetic rotation based on distance traveled)
      const wheelAngle = clampedT * 40; // arbitrary spin factor

      // Cart body
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      this._cartBody.setMatrixAt(idx, _mat4);
      _color.setHex(CART_COLORS[route.cartType] || 0x808080);
      this._cartBody.setColorAt(idx, _color);

      // Handle
      this._cartHandle.setMatrixAt(idx, _mat4);
      // (handle color is fixed via material)

      // Cargo
      this._cartCargo.setMatrixAt(idx, _mat4);
      _color.setHex(CARGO_COLORS[route.cartType] || 0xaaaaaa);
      this._cartCargo.setColorAt(idx, _color);

      // Wheels — left and right
      const wheelOffsetZ = CART_BODY_D * 0.5 + 0.001;
      const right = new THREE.Vector3().crossVectors(_tangent, _up).normalize();

      // Left wheel
      const leftWheelPos = _pos.clone().addScaledVector(right, -wheelOffsetZ);
      leftWheelPos.y = route.heightY + WHEEL_RADIUS;
      const wheelQuat = _quat.clone();
      // Rotate the wheel disc to face sideways
      const sideRotation = new THREE.Quaternion().setFromAxisAngle(_tangent, Math.PI / 2);
      wheelQuat.multiply(sideRotation);
      // Add spin
      const spinQuat = new THREE.Quaternion().setFromAxisAngle(right, wheelAngle);
      wheelQuat.multiply(spinQuat);
      _mat4.compose(leftWheelPos, wheelQuat, _scale);
      this._cartWheels.setMatrixAt(idx * 2, _mat4);

      // Right wheel
      const rightWheelPos = _pos.clone().addScaledVector(right, wheelOffsetZ);
      rightWheelPos.y = route.heightY + WHEEL_RADIUS;
      _mat4.compose(rightWheelPos, wheelQuat, _scale);
      this._cartWheels.setMatrixAt(idx * 2 + 1, _mat4);
    }

    // Flag GPU updates
    if (this._routes.size > 0) {
      this._cartBody.instanceMatrix.needsUpdate = true;
      this._cartWheels.instanceMatrix.needsUpdate = true;
      this._cartHandle.instanceMatrix.needsUpdate = true;
      this._cartCargo.instanceMatrix.needsUpdate = true;
      if (this._cartBody.instanceColor) this._cartBody.instanceColor.needsUpdate = true;
      if (this._cartCargo.instanceColor) this._cartCargo.instanceColor.needsUpdate = true;
    }
  }

  // Arc particle update

  /** @private */
  _updateArcs(dt) {
    let writeIdx = 0;

    for (const [, arc] of this._arcs) {
      // Spawn new particles on interval
      arc.spawnTimer += dt;
      if (arc.spawnTimer >= arc.interval) {
        arc.spawnTimer -= arc.interval;
        // Find a dead particle slot and activate it
        for (let i = 0; i < arc.particles.length; i++) {
          if (!arc.particles[i].alive) {
            arc.particles[i].alive = true;
            arc.particles[i].t = 0;
            break;
          }
        }
      }

      // Update each particle
      const arcColor = new THREE.Color(ARC_PARTICLE_COLORS[arc.resourceType] || 0xffffff);
      const speed = 1.0 / Math.max(arc.interval * arc.count, 0.5);

      for (let i = 0; i < arc.particles.length; i++) {
        const p = arc.particles[i];
        if (!p.alive) continue;

        p.t += speed * dt;
        if (p.t >= 1.0) {
          p.alive = false;
          continue;
        }

        if (writeIdx >= this._maxArcParticles) continue;

        // Parabolic arc: lerp XZ, arc Y
        const t = p.t;
        const px = arc.from.x + (arc.to.x - arc.from.x) * t;
        const py = arc.from.y + (arc.to.y - arc.from.y) * t + arc.arcHeight * 4 * t * (1 - t);
        const pz = arc.from.z + (arc.to.z - arc.from.z) * t;

        const base = writeIdx * 3;
        this._arcPositions[base] = px;
        this._arcPositions[base + 1] = py;
        this._arcPositions[base + 2] = pz;
        this._arcColors[base] = arcColor.r;
        this._arcColors[base + 1] = arcColor.g;
        this._arcColors[base + 2] = arcColor.b;
        this._arcAlive[writeIdx] = 1;
        writeIdx++;
      }
    }

    // Zero out remaining slots
    for (let i = writeIdx; i < this._activeArcCount; i++) {
      const base = i * 3;
      this._arcPositions[base] = 0;
      this._arcPositions[base + 1] = -100; // off-screen
      this._arcPositions[base + 2] = 0;
    }

    this._activeArcCount = writeIdx;
    this._arcGeo.setDrawRange(0, writeIdx);
    this._arcGeo.attributes.position.needsUpdate = true;
    this._arcGeo.attributes.color.needsUpdate = true;
  }

  // Internals

  /** @private */
  _updateInstanceCounts() {
    const n = this._routes.size;
    this._cartBody.count = n;
    this._cartWheels.count = n * 2;
    this._cartHandle.count = n;
    this._cartCargo.count = n;
  }

  /**
   * Rebuild instanceIdx values after a route is removed.
   * @private
   */
  _rebuildRouteIndices() {
    let idx = 0;
    for (const [, route] of this._routes) {
      route.instanceIdx = idx;
      idx++;
    }
    this._activeCartCount = idx;
    this._updateInstanceCounts();
  }
}
