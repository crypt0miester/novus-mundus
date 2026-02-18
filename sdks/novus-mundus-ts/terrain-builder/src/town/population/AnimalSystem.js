/**
 * Animal population system — chickens, horses, fish, and bird flocks.
 *
 * All animals are rendered via InstancedMesh.  Birds use Craig Reynolds'
 * boids algorithm (separation, alignment, cohesion).  Chickens peck,
 * horses bob heads, and fish jump on parabolic arcs.
 *
 * Exports:
 *   - AnimalSystem
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BIRDS = 50;
const MAX_CHICKENS = 10;
const MAX_HORSES = 4;
const MAX_FISH = 8;

/** Bird orbit parameters. */
const BIRD_MIN_RADIUS = 1.0;
const BIRD_MAX_RADIUS = 3.0;
const BIRD_MIN_HEIGHT = 0.5;
const BIRD_MAX_HEIGHT = 1.2;
const BIRD_MIN_SPEED = 0.15;
const BIRD_MAX_SPEED = 0.35;
const BIRD_HEIGHT_WOBBLE = 0.1;
const BIRD_HEIGHT_WOBBLE_FREQ = 0.5;
const BIRD_WING_FLAP_FREQ = 6.0;
const BIRD_WING_FLAP_AMP = 0.3;

/** Chicken parameters. */
const CHICKEN_PECK_FREQ = 1.5;
const CHICKEN_PECK_AMP = 0.025;
const CHICKEN_WALK_SPEED = 0.15;
const CHICKEN_WANDER_RADIUS = 0.5;
const CHICKEN_PAUSE_MIN = 1.0;
const CHICKEN_PAUSE_MAX = 4.0;

/** Horse parameters. */
const HORSE_BOB_FREQ = 0.5;
const HORSE_BOB_AMP = 0.02;

/** Fish parameters. */
const FISH_ARC_HEIGHT = 0.4;
const FISH_ARC_DURATION = 0.8;
const FISH_PAUSE_MIN = 3.0;
const FISH_PAUSE_MAX = 10.0;

/** Building type IDs (from constants.js). */
const BUILDING_MANSION = 0;
const BUILDING_BARRACKS = 1;
const BUILDING_DOCK = 4;
const BUILDING_MARKET = 6;

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s >>> 16) / 65536;
  };
}

// ---------------------------------------------------------------------------
// Reusable THREE objects
// ---------------------------------------------------------------------------

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/**
 * Bird geometry: body triangle + 2 wing triangles = 3 triangles (9 verts).
 * Wings are separate triangles offset from body center so that flapping can
 * be simulated by scaling their Y in the update loop.
 */
function createBirdGeometry() {
  //   Body: elongated triangle along Z axis
  //   Left wing: triangle extending left (vertex 4 = wingtip for flap)
  //   Right wing: triangle extending right (vertex 7 = wingtip for flap)
  const S = 8; // scale factor — birds need to be visible from camera distance
  const verts = new Float32Array([
    // Body triangle (front, back-left, back-right)
    0.0,          0.0,       0.005 * S,
    -0.003 * S,   0.0,      -0.005 * S,
     0.003 * S,   0.0,      -0.005 * S,
    // Left wing (body center, wingtip, back)
    0.0,          0.0,       0.0,
    -0.012 * S,   0.0,      -0.002 * S,  // wingtip — Y animated in update
    -0.004 * S,   0.0,      -0.004 * S,
    // Right wing (body center, wingtip, back)
    0.0,          0.0,       0.0,
     0.012 * S,   0.0,      -0.002 * S,  // wingtip — Y animated in update
     0.004 * S,   0.0,      -0.004 * S,
  ]);

  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  return geo;
}

/**
 * Chicken geometry: body sphere approximation + head sphere.
 * Simplified as a small set of triangles forming an oval body and small head.
 */
function createChickenBodyGeometry() {
  // Slightly flattened sphere (icosahedron detail 0 gives 20 triangles)
  const geo = new THREE.IcosahedronGeometry(0.04, 0);
  // Flatten slightly
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * 0.7);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createChickenHeadGeometry() {
  return new THREE.SphereGeometry(0.02, 4, 3);
}

/**
 * Horse geometry: body box + head box + 4 leg cylinders, merged into one.
 */
function createHorseGeometry() {
  const S = 7;

  // Body box
  const bodyGeo = new THREE.BoxGeometry(0.012 * S, 0.012 * S, 0.025 * S);
  bodyGeo.translate(0, 0.018 * S, 0);

  // Head box
  const headGeo = new THREE.BoxGeometry(0.006 * S, 0.008 * S, 0.012 * S);
  headGeo.translate(0, 0.026 * S, 0.015 * S);

  // Legs (4 thin boxes)
  const legGeo1 = new THREE.BoxGeometry(0.003 * S, 0.014 * S, 0.003 * S);
  legGeo1.translate(-0.004 * S, 0.007 * S, 0.008 * S);
  const legGeo2 = new THREE.BoxGeometry(0.003 * S, 0.014 * S, 0.003 * S);
  legGeo2.translate(0.004 * S, 0.007 * S, 0.008 * S);
  const legGeo3 = new THREE.BoxGeometry(0.003 * S, 0.014 * S, 0.003 * S);
  legGeo3.translate(-0.004 * S, 0.007 * S, -0.008 * S);
  const legGeo4 = new THREE.BoxGeometry(0.003 * S, 0.014 * S, 0.003 * S);
  legGeo4.translate(0.004 * S, 0.007 * S, -0.008 * S);

  // Merge all into a single geometry for instancing
  const merged = mergeGeometries([bodyGeo, headGeo, legGeo1, legGeo2, legGeo3, legGeo4]);
  return merged;
}

/**
 * Fish geometry: small elongated diamond shape.
 */
function createFishGeometry() {
  const S = 7;
  const verts = new Float32Array([
    // Top half diamond
    0.0, 0.002 * S, 0.0,
    -0.004 * S, 0.0, 0.0,
    0.0, 0.0, 0.01 * S,
    // Top half diamond (other side)
    0.0, 0.002 * S, 0.0,
    0.0, 0.0, 0.01 * S,
    0.004 * S, 0.0, 0.0,
    // Bottom half diamond
    0.0, -0.002 * S, 0.0,
    0.0, 0.0, 0.01 * S,
    -0.004 * S, 0.0, 0.0,
    // Bottom half diamond (other side)
    0.0, -0.002 * S, 0.0,
    0.004 * S, 0.0, 0.0,
    0.0, 0.0, 0.01 * S,
    // Tail
    0.0, 0.0, 0.01 * S,
    -0.003 * S, 0.002 * S, 0.016 * S,
    0.003 * S, 0.002 * S, 0.016 * S,
  ]);

  const normals = new Float32Array(verts.length);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = 0;
    normals[i + 1] = 1;
    normals[i + 2] = 0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const indices = [];
  for (let i = 0; i < verts.length / 3; i++) indices.push(i);
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Merge multiple BufferGeometries into one (simple vertex + index concat).
 * All input geometries must have position and normal attributes.
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
function mergeGeometries(geometries) {
  let totalVerts = 0;
  let totalIndices = 0;

  for (const g of geometries) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = [];
  let vertOffset = 0;

  for (const g of geometries) {
    const gPos = g.attributes.position;
    const gNorm = g.attributes.normal;
    const gIdx = g.index;

    for (let i = 0; i < gPos.count; i++) {
      const base = (vertOffset + i) * 3;
      positions[base] = gPos.getX(i);
      positions[base + 1] = gPos.getY(i);
      positions[base + 2] = gPos.getZ(i);
      if (gNorm) {
        normals[base] = gNorm.getX(i);
        normals[base + 1] = gNorm.getY(i);
        normals[base + 2] = gNorm.getZ(i);
      } else {
        normals[base + 1] = 1;
      }
    }

    if (gIdx) {
      for (let i = 0; i < gIdx.count; i++) {
        indices.push(gIdx.getX(i) + vertOffset);
      }
    } else {
      for (let i = 0; i < gPos.count; i++) {
        indices.push(i + vertOffset);
      }
    }

    vertOffset += gPos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

// ---------------------------------------------------------------------------
// AnimalSystem
// ---------------------------------------------------------------------------

export class AnimalSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {number} [options.maxBirds=50]
   * @param {number} [options.maxChickens=10]
   * @param {number} [options.maxHorses=4]
   * @param {number} [options.maxFish=8]
   * @param {number} [options.seed=77]
   * @param {THREE.Vector3} [options.townCenter]
   */
  constructor(scene, options = {}) {
    this._scene = scene;
    this._disposed = false;
    this._seed = options.seed || 77;
    this._rng = makeRng(this._seed);
    this._townCenter = options.townCenter || new THREE.Vector3(0, 0, 0);

    this._maxBirds = options.maxBirds || MAX_BIRDS;
    this._maxChickens = options.maxChickens || MAX_CHICKENS;
    this._maxHorses = options.maxHorses || MAX_HORSES;
    this._maxFish = options.maxFish || MAX_FISH;

    // --- Birds (circular orbits) ---
    this._birdCount = 0;
    this._birdAngle = new Float32Array(this._maxBirds);     // current orbit angle
    this._birdRadius = new Float32Array(this._maxBirds);    // orbit radius
    this._birdHeight = new Float32Array(this._maxBirds);    // base flight height
    this._birdSpeed = new Float32Array(this._maxBirds);     // angular speed (rad/s)
    this._birdDirection = new Int8Array(this._maxBirds);    // +1 or -1 (CW/CCW)
    this._birdPhase = new Float32Array(this._maxBirds);     // phase for height wobble + flap

    const birdGeo = createBirdGeometry();
    const birdMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      side: THREE.DoubleSide,
    });
    this._birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, this._maxBirds);
    this._birdMesh.count = 0;
    this._birdMesh.frustumCulled = false;
    this._birdMesh.castShadow = false;
    scene.add(this._birdMesh);

    // --- Chickens ---
    this._chickenCount = 0;
    this._chickenPosX = new Float32Array(this._maxChickens);
    this._chickenPosY = new Float32Array(this._maxChickens);
    this._chickenPosZ = new Float32Array(this._maxChickens);
    this._chickenTargetX = new Float32Array(this._maxChickens);
    this._chickenTargetZ = new Float32Array(this._maxChickens);
    this._chickenHomeX = new Float32Array(this._maxChickens);
    this._chickenHomeZ = new Float32Array(this._maxChickens);
    this._chickenPhase = new Float32Array(this._maxChickens);
    this._chickenTimer = new Float32Array(this._maxChickens);
    this._chickenWalking = new Uint8Array(this._maxChickens);
    this._chickenRotation = new Float32Array(this._maxChickens);

    const chickenBodyGeo = createChickenBodyGeometry();
    const chickenBodyMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5dc,
      roughness: 0.85,
      metalness: 0.0,
    });
    this._chickenBodyMesh = new THREE.InstancedMesh(chickenBodyGeo, chickenBodyMat, this._maxChickens);
    this._chickenBodyMesh.count = 0;
    this._chickenBodyMesh.frustumCulled = false;
    this._chickenBodyMesh.castShadow = true;
    scene.add(this._chickenBodyMesh);

    const chickenHeadGeo = createChickenHeadGeometry();
    const chickenHeadMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5dc,
      roughness: 0.7,
      metalness: 0.0,
    });
    this._chickenHeadMesh = new THREE.InstancedMesh(chickenHeadGeo, chickenHeadMat, this._maxChickens);
    this._chickenHeadMesh.count = 0;
    this._chickenHeadMesh.frustumCulled = false;
    this._chickenHeadMesh.castShadow = false;
    scene.add(this._chickenHeadMesh);

    // --- Horses ---
    this._horseCount = 0;
    this._horsePosX = new Float32Array(this._maxHorses);
    this._horsePosY = new Float32Array(this._maxHorses);
    this._horsePosZ = new Float32Array(this._maxHorses);
    this._horseRotation = new Float32Array(this._maxHorses);
    this._horsePhase = new Float32Array(this._maxHorses);

    const horseGeo = createHorseGeometry();
    const horseMat = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.7,
      metalness: 0.0,
    });
    this._horseMesh = new THREE.InstancedMesh(horseGeo, horseMat, this._maxHorses);
    this._horseMesh.count = 0;
    this._horseMesh.frustumCulled = false;
    this._horseMesh.castShadow = true;
    scene.add(this._horseMesh);

    // --- Fish ---
    this._fishCount = 0;
    this._fishBaseX = new Float32Array(this._maxFish);
    this._fishBaseY = new Float32Array(this._maxFish);
    this._fishBaseZ = new Float32Array(this._maxFish);
    this._fishArcTimer = new Float32Array(this._maxFish);
    this._fishPauseTimer = new Float32Array(this._maxFish);
    this._fishJumping = new Uint8Array(this._maxFish);
    this._fishRotation = new Float32Array(this._maxFish);
    this._fishArcDir = new Float32Array(this._maxFish); // angle of jump arc

    const fishGeo = createFishGeometry();
    const fishMat = new THREE.MeshStandardMaterial({
      color: 0xc0c0c0,
      roughness: 0.3,
      metalness: 0.5,
    });
    this._fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, this._maxFish);
    this._fishMesh.count = 0;
    this._fishMesh.frustumCulled = false;
    this._fishMesh.castShadow = false;
    scene.add(this._fishMesh);

    this._terrainSampler = null;
  }

  /**
   * Initialize animal populations based on buildings present.
   * @param {{ typeId: number, level: number, position: {x:number,z:number} }[]} buildings
   * @param {{ getHeight(x:number,z:number): number }} terrainSampler
   */
  initialize(buildings, terrainSampler) {
    this._terrainSampler = terrainSampler;
    const rng = this._rng;

    // --- Spawn chickens near Mansion / Market ---
    this._chickenCount = 0;
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (b.typeId !== BUILDING_MANSION && b.typeId !== BUILDING_MARKET) continue;

      const count = 3 + Math.floor(rng() * 3); // 3-5
      for (let ci = 0; ci < count; ci++) {
        if (this._chickenCount >= this._maxChickens) break;
        const idx = this._chickenCount;

        const angle = rng() * Math.PI * 2;
        const dist = rng() * CHICKEN_WANDER_RADIUS;
        const cx = b.position.x + Math.cos(angle) * dist;
        const cz = b.position.z + Math.sin(angle) * dist;
        const cy = terrainSampler ? terrainSampler.getHeight(cx, cz) : 0;

        this._chickenPosX[idx] = cx;
        this._chickenPosY[idx] = cy;
        this._chickenPosZ[idx] = cz;
        this._chickenTargetX[idx] = cx;
        this._chickenTargetZ[idx] = cz;
        this._chickenHomeX[idx] = b.position.x;
        this._chickenHomeZ[idx] = b.position.z;
        this._chickenPhase[idx] = rng() * Math.PI * 2;
        this._chickenTimer[idx] = CHICKEN_PAUSE_MIN + rng() * (CHICKEN_PAUSE_MAX - CHICKEN_PAUSE_MIN);
        this._chickenWalking[idx] = 0;
        this._chickenRotation[idx] = rng() * Math.PI * 2;

        this._chickenCount++;
      }
    }
    this._chickenBodyMesh.count = this._chickenCount;
    this._chickenHeadMesh.count = this._chickenCount;

    // --- Spawn horses near Barracks ---
    this._horseCount = 0;
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (b.typeId !== BUILDING_BARRACKS) continue;

      const count = 1 + Math.floor(rng() * 2); // 1-2
      for (let hi = 0; hi < count; hi++) {
        if (this._horseCount >= this._maxHorses) break;
        const idx = this._horseCount;

        // Place next to barracks, slight offset as if hitched
        const side = hi === 0 ? 1 : -1;
        const hx = b.position.x + side * 0.4;
        const hz = b.position.z + 0.3;
        const hy = terrainSampler ? terrainSampler.getHeight(hx, hz) : 0;

        this._horsePosX[idx] = hx;
        this._horsePosY[idx] = hy;
        this._horsePosZ[idx] = hz;
        this._horseRotation[idx] = rng() * Math.PI * 2;
        this._horsePhase[idx] = rng() * Math.PI * 2;

        this._horseCount++;
      }
    }
    this._horseMesh.count = this._horseCount;

    // --- Spawn fish near Dock ---
    this._fishCount = 0;
    for (let bi = 0; bi < buildings.length; bi++) {
      const b = buildings[bi];
      if (b.typeId !== BUILDING_DOCK) continue;

      const count = 2 + Math.floor(rng() * 4); // 2-5
      for (let fi = 0; fi < count; fi++) {
        if (this._fishCount >= this._maxFish) break;
        const idx = this._fishCount;

        // Scatter in water near the dock
        const angle = rng() * Math.PI * 2;
        const dist = 0.3 + rng() * 0.8;
        const fx = b.position.x + Math.cos(angle) * dist;
        const fz = b.position.z + Math.sin(angle) * dist + 0.8; // offset toward water

        // Fish base Y is at water surface level
        const fy = terrainSampler ? Math.max(terrainSampler.getHeight(fx, fz), 0.003) : 0.003;

        this._fishBaseX[idx] = fx;
        this._fishBaseY[idx] = fy;
        this._fishBaseZ[idx] = fz;
        this._fishArcTimer[idx] = 0;
        this._fishPauseTimer[idx] = FISH_PAUSE_MIN + rng() * (FISH_PAUSE_MAX - FISH_PAUSE_MIN);
        this._fishJumping[idx] = 0;
        this._fishRotation[idx] = rng() * Math.PI * 2;
        this._fishArcDir[idx] = rng() * Math.PI * 2;

        this._fishCount++;
      }
    }
    this._fishMesh.count = this._fishCount;

    // --- Spawn birds on circular orbits ---
    this._birdCount = 0;
    const flockSize = Math.min(this._maxBirds, 8 + Math.floor(buildings.length * 0.5));

    for (let i = 0; i < flockSize; i++) {
      const idx = this._birdCount;

      // Each bird gets a unique orbit: radius, height, speed, starting angle
      this._birdAngle[idx] = (i / flockSize) * Math.PI * 2 + rng() * 0.3;
      this._birdRadius[idx] = BIRD_MIN_RADIUS + rng() * (BIRD_MAX_RADIUS - BIRD_MIN_RADIUS);
      this._birdHeight[idx] = BIRD_MIN_HEIGHT + rng() * (BIRD_MAX_HEIGHT - BIRD_MIN_HEIGHT);
      this._birdSpeed[idx] = BIRD_MIN_SPEED + rng() * (BIRD_MAX_SPEED - BIRD_MIN_SPEED);
      this._birdDirection[idx] = rng() > 0.5 ? 1 : -1;
      this._birdPhase[idx] = rng() * Math.PI * 2;

      this._birdCount++;
    }
    this._birdMesh.count = this._birdCount;
  }

  /**
   * Per-frame update. Updates all animal systems.
   * @param {number} deltaTime - Seconds since last frame
   * @param {{ x: number, z: number }|null} windDirection - Normalized XZ wind
   */
  update(deltaTime, windDirection) {
    if (this._disposed) return;
    const dt = Math.min(deltaTime, 0.1);

    this._updateBirds(dt);
    this._updateChickens(dt);
    this._updateHorses(dt);
    this._updateFish(dt);
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    this._disposed = true;

    const meshes = [
      this._birdMesh,
      this._chickenBodyMesh,
      this._chickenHeadMesh,
      this._horseMesh,
      this._fishMesh,
    ];

    for (const mesh of meshes) {
      this._scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }

  // ── Birds (circular orbits) ──

  /**
   * Update birds on circular orbits around town center.
   * Each bird flies its own circle at a unique radius, height, and speed.
   * @param {number} dt
   */
  _updateBirds(dt) {
    const n = this._birdCount;
    if (n === 0) return;

    const cx = this._townCenter.x;
    const cz = this._townCenter.z;

    for (let i = 0; i < n; i++) {
      // Advance orbit angle
      const angularSpeed = this._birdSpeed[i] / this._birdRadius[i]; // v = wr
      this._birdAngle[i] += angularSpeed * this._birdDirection[i] * dt;
      this._birdPhase[i] += dt;

      // Position on orbit circle
      const angle = this._birdAngle[i];
      const r = this._birdRadius[i];
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;

      // Gentle height wobble
      const y = this._birdHeight[i] +
        Math.sin(this._birdPhase[i] * BIRD_HEIGHT_WOBBLE_FREQ * Math.PI * 2) * BIRD_HEIGHT_WOBBLE;

      // Face tangent direction (perpendicular to radius)
      const yaw = angle + (this._birdDirection[i] > 0 ? -Math.PI * 0.5 : Math.PI * 0.5);

      // Wing flap
      const flapPhase = this._birdPhase[i] * BIRD_WING_FLAP_FREQ;
      const wingScaleY = 1.0 + Math.sin(flapPhase) * BIRD_WING_FLAP_AMP;

      _pos.set(x, y, z);
      _quat.setFromAxisAngle(_up, yaw);
      _scale.set(1, wingScaleY, 1);
      _mat4.compose(_pos, _quat, _scale);
      this._birdMesh.setMatrixAt(i, _mat4);
    }

    this._birdMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Chickens ──

  /**
   * Update chicken pecking and wandering.
   * @param {number} dt
   */
  _updateChickens(dt) {
    const n = this._chickenCount;
    if (n === 0) return;
    const rng = this._rng;

    for (let i = 0; i < n; i++) {
      this._chickenPhase[i] += dt;

      if (this._chickenWalking[i]) {
        // Walk toward target
        const dx = this._chickenTargetX[i] - this._chickenPosX[i];
        const dz = this._chickenTargetZ[i] - this._chickenPosZ[i];
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.005) {
          // Arrived — start pecking (idle)
          this._chickenWalking[i] = 0;
          this._chickenTimer[i] = CHICKEN_PAUSE_MIN + rng() * (CHICKEN_PAUSE_MAX - CHICKEN_PAUSE_MIN);
        } else {
          const step = CHICKEN_WALK_SPEED * dt;
          const inv = Math.min(1, step / dist);
          this._chickenPosX[i] += dx * inv;
          this._chickenPosZ[i] += dz * inv;
          this._chickenRotation[i] = Math.atan2(dx, dz);
        }
      } else {
        // Pecking idle — count down timer
        this._chickenTimer[i] -= dt;
        if (this._chickenTimer[i] <= 0) {
          // Pick new wander target near home
          const angle = rng() * Math.PI * 2;
          const dist = rng() * CHICKEN_WANDER_RADIUS;
          this._chickenTargetX[i] = this._chickenHomeX[i] + Math.cos(angle) * dist;
          this._chickenTargetZ[i] = this._chickenHomeZ[i] + Math.sin(angle) * dist;
          this._chickenWalking[i] = 1;
        }
      }

      // Update terrain height
      if (this._terrainSampler) {
        this._chickenPosY[i] = this._terrainSampler.getHeight(
          this._chickenPosX[i], this._chickenPosZ[i]
        );
      }

      // Pecking animation: periodic head dip
      const peckT = Math.sin(this._chickenPhase[i] * Math.PI * 2 * CHICKEN_PECK_FREQ);
      const peckDip = this._chickenWalking[i] ? 0 : Math.max(0, peckT) * CHICKEN_PECK_AMP;

      // Body instance matrix
      const bx = this._chickenPosX[i];
      const by = this._chickenPosY[i] + 0.04; // lift body off ground
      const bz = this._chickenPosZ[i];
      _pos.set(bx, by, bz);
      _quat.setFromAxisAngle(_up, this._chickenRotation[i]);
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      this._chickenBodyMesh.setMatrixAt(i, _mat4);

      // Head instance matrix — sits in front and above body, dips for pecking
      const headOffsetZ = 0.055;
      const headY = by + 0.03 - peckDip;
      const sin = Math.sin(this._chickenRotation[i]);
      const cos = Math.cos(this._chickenRotation[i]);
      const hx = bx + sin * headOffsetZ;
      const hz = bz + cos * headOffsetZ;
      _pos.set(hx, headY, hz);
      _mat4.compose(_pos, _quat, _scale);
      this._chickenHeadMesh.setMatrixAt(i, _mat4);
    }

    this._chickenBodyMesh.instanceMatrix.needsUpdate = true;
    this._chickenHeadMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Horses ──

  /**
   * Update horse head bob animation.
   * @param {number} dt
   */
  _updateHorses(dt) {
    const n = this._horseCount;
    if (n === 0) return;

    for (let i = 0; i < n; i++) {
      this._horsePhase[i] += dt;

      // Head bob: gentle sinusoidal Y displacement applied via scale
      const bob = Math.sin(this._horsePhase[i] * Math.PI * 2 * HORSE_BOB_FREQ) * HORSE_BOB_AMP;

      _pos.set(this._horsePosX[i], this._horsePosY[i] + bob, this._horsePosZ[i]);
      _quat.setFromAxisAngle(_up, this._horseRotation[i]);
      _scale.set(1, 1, 1);
      _mat4.compose(_pos, _quat, _scale);
      this._horseMesh.setMatrixAt(i, _mat4);
    }

    this._horseMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Fish ──

  /**
   * Update fish jumping arcs.
   * @param {number} dt
   */
  _updateFish(dt) {
    const n = this._fishCount;
    if (n === 0) return;
    const rng = this._rng;

    for (let i = 0; i < n; i++) {
      if (this._fishJumping[i]) {
        // Advance arc timer
        this._fishArcTimer[i] += dt;
        const t = this._fishArcTimer[i] / FISH_ARC_DURATION;

        if (t >= 1.0) {
          // Splash down — go back underwater (invisible via scale to 0)
          this._fishJumping[i] = 0;
          this._fishPauseTimer[i] = FISH_PAUSE_MIN + rng() * (FISH_PAUSE_MAX - FISH_PAUSE_MIN);

          // Hide fish below surface
          _pos.set(this._fishBaseX[i], this._fishBaseY[i] - 0.05, this._fishBaseZ[i]);
          _quat.setFromAxisAngle(_up, this._fishRotation[i]);
          _scale.set(0, 0, 0);
          _mat4.compose(_pos, _quat, _scale);
          this._fishMesh.setMatrixAt(i, _mat4);
        } else {
          // Parabolic arc: y = arcHeight * 4 * t * (1 - t)
          const arcY = FISH_ARC_HEIGHT * 4.0 * t * (1.0 - t);

          // Horizontal movement along arc direction
          const arcDist = 0.25; // total horizontal travel
          const arcDir = this._fishArcDir[i];
          const hx = this._fishBaseX[i] + Math.cos(arcDir) * arcDist * t;
          const hz = this._fishBaseZ[i] + Math.sin(arcDir) * arcDist * t;

          // Tilt fish along arc trajectory (pitch)
          const dYdt = FISH_ARC_HEIGHT * 4.0 * (1.0 - 2.0 * t);
          const pitchAngle = Math.atan2(dYdt, arcDist / FISH_ARC_DURATION);

          _pos.set(hx, this._fishBaseY[i] + arcY, hz);

          // Compose rotation: yaw from arcDir, pitch from trajectory
          const euler = new THREE.Euler(pitchAngle, arcDir, 0, 'YXZ');
          _quat.setFromEuler(euler);
          _scale.set(1, 1, 1);
          _mat4.compose(_pos, _quat, _scale);
          this._fishMesh.setMatrixAt(i, _mat4);
        }
      } else {
        // Waiting underwater
        this._fishPauseTimer[i] -= dt;

        if (this._fishPauseTimer[i] <= 0) {
          // Start a new jump
          this._fishJumping[i] = 1;
          this._fishArcTimer[i] = 0;
          this._fishArcDir[i] = rng() * Math.PI * 2;
          this._fishRotation[i] = this._fishArcDir[i];
        } else {
          // Stay hidden
          _pos.set(this._fishBaseX[i], this._fishBaseY[i] - 0.05, this._fishBaseZ[i]);
          _quat.setFromAxisAngle(_up, 0);
          _scale.set(0, 0, 0);
          _mat4.compose(_pos, _quat, _scale);
          this._fishMesh.setMatrixAt(i, _mat4);
        }
      }
    }

    this._fishMesh.instanceMatrix.needsUpdate = true;
  }
}
