/**
 * Multi-layer tree wind animation system with instanced rendering.
 * Supports Oak, Pine, Birch, and Dead tree types, each with separate
 * InstancedMesh for trunks and foliage. Wind animation uses three layers:
 * primary sway, branch tremor, and leaf flutter.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TREES_PER_TYPE = 500;
const POISSON_MAX_ATTEMPTS = 30;

const TREE_TYPES = {
  oak: {
    trunkRadius: 0.012,
    trunkTopRadius: 0.006,
    trunkHeight: 0.12,
    trunkSegments: 8,
    trunkColor: 0x5a3a20,
    crownType: 'icosahedron',
    crownRadius: 0.07,
    crownDetail: 1,
    crownColor: 0x2d6b30,
    crownOffsetY: 0.14,
    crownColors: [0x2d6b30, 0x3a7a35, 0x4a8a40],
  },
  pine: {
    trunkRadius: 0.008,
    trunkTopRadius: 0.004,
    trunkHeight: 0.16,
    trunkSegments: 8,
    trunkColor: 0x4a2a18,
    crownType: 'cone',
    crownRadius: 0.05,
    crownHeight: 0.14,
    crownColor: 0x1a5a20,
    crownOffsetY: 0.15,
    crownColors: [0x1a5a20, 0x225a28, 0x1a4a18],
  },
  birch: {
    trunkRadius: 0.006,
    trunkTopRadius: 0.003,
    trunkHeight: 0.14,
    trunkSegments: 8,
    trunkColor: 0xd8d0c0,
    crownType: 'icosahedron',
    crownRadius: 0.04,
    crownDetail: 1,
    crownColor: 0x5a9a40,
    crownOffsetY: 0.14,
    crownColors: [0x5a9a40, 0x6aaa48, 0x4a8a38],
  },
  dead: {
    trunkRadius: 0.010,
    trunkTopRadius: 0.005,
    trunkHeight: 0.10,
    trunkSegments: 6,
    trunkColor: 0x6a5a4a,
    crownType: 'none',
    branchCount: 3,
    branchColor: 0x5a4a3a,
  },
};

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s >>> 16) / 65536;
  };
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/**
 * Create trunk geometry: tapered cylinder.
 */
function createTrunkGeometry(cfg) {
  return new THREE.CylinderGeometry(
    cfg.trunkTopRadius,
    cfg.trunkRadius,
    cfg.trunkHeight,
    cfg.trunkSegments,
    1,
    false
  );
}

/**
 * Create foliage geometry based on tree type.
 */
function createFoliageGeometry(cfg) {
  if (cfg.crownType === 'icosahedron') {
    const geo = new THREE.IcosahedronGeometry(cfg.crownRadius, cfg.crownDetail);
    // Displace vertices for organic look
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Pseudorandom displacement based on vertex index
      const noise = Math.sin(i * 73.17) * 0.15 + Math.cos(i * 127.43) * 0.1;
      const scale = 1.0 + noise;
      pos.setX(i, x * scale);
      pos.setY(i, y * scale * 0.85); // slight vertical squash
      pos.setZ(i, z * scale);
    }
    geo.computeVertexNormals();
    return geo;
  }

  if (cfg.crownType === 'cone') {
    return new THREE.ConeGeometry(cfg.crownRadius, cfg.crownHeight, 8);
  }

  return null;
}

/**
 * Create dead tree branch geometries (2-3 box sticks).
 */
function createBranchGeometry() {
  return new THREE.BoxGeometry(0.003, 0.04, 0.003);
}

// ---------------------------------------------------------------------------
// Shader materials
// ---------------------------------------------------------------------------

/**
 * Trunk shader — gentle primary sway only.
 */
function createTrunkMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector3(1, 0, 0) },
      windStrength: { value: 0.3 },
      trunkColor: { value: new THREE.Color(color) },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      ambientColor: { value: new THREE.Color(0.25, 0.3, 0.35) },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute vec3 instanceOffset;
      attribute float instanceScale;
      attribute float instancePhase;

      uniform float time;
      uniform vec3 windDirection;
      uniform float windStrength;

      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vec3 pos = position;

        // Scale trunk
        pos *= instanceScale;

        // Primary sway — gentle trunk movement, more at the top
        float heightFrac = (position.y + 0.5) * instanceScale; // normalized height within trunk
        float primarySway = sin(time * 1.5 + instanceOffset.x * 0.5 + instancePhase) * 0.02;
        primarySway *= heightFrac * windStrength;

        pos.x += primarySway * windDirection.x;
        pos.z += primarySway * windDirection.z;

        // Offset to world
        pos += instanceOffset;

        vNormal = normalMatrix * normal;
        vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 trunkColor;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;

      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = max(dot(N, sunDirection), 0.0);

        vec3 diffuse = trunkColor * (ambientColor + sunColor * NdotL * 0.8);

        // Slight AO at base
        float ao = smoothstep(-0.1, 0.1, vWorldPos.y) * 0.3 + 0.7;
        diffuse *= ao;

        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
  });
}

/**
 * Foliage shader — three-layer wind animation: primary sway, branch tremor, leaf flutter.
 */
function createFoliageMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector3(1, 0, 0) },
      windStrength: { value: 0.3 },
      foliageColor: { value: new THREE.Color(color) },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      ambientColor: { value: new THREE.Color(0.3, 0.35, 0.25) },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute vec3 instanceOffset;
      attribute float instanceScale;
      attribute float instancePhase;
      attribute vec3 instanceColor;

      uniform float time;
      uniform vec3 windDirection;
      uniform float windStrength;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vColor;
      varying float vLeafFade;

      void main() {
        vec3 pos = position;

        // Scale crown
        pos *= instanceScale;

        // Height within the crown for weighting
        float localHeight = position.y;

        // Layer 1: Primary sway — whole tree trunk movement transmitted to crown
        float primarySway = sin(time * 1.5 + instanceOffset.x * 0.5 + instancePhase) * 0.02;
        primarySway *= windStrength;

        // Layer 2: Branch tremor — medium frequency, varies along vertical axis
        float branchTremor = sin(time * 4.0 + position.y * 8.0 + instancePhase * 1.7) * 0.005;
        branchTremor *= windStrength;

        // Layer 3: Leaf flutter — high frequency, varies with position in all axes
        float leafFlutter = sin(time * 12.0 + position.x * 20.0 + position.z * 15.0 + instancePhase * 3.1) * 0.002;
        leafFlutter *= windStrength;

        // Combine all wind layers, weighted by vertex height within crown
        float windWeight = 0.5 + localHeight * 0.5; // bottom of crown sways less
        vec3 displaced = pos;
        displaced.x += (primarySway + branchTremor + leafFlutter) * windWeight * windDirection.x;
        displaced.z += (primarySway * 0.6 + branchTremor * 0.8 + leafFlutter) * windWeight * windDirection.z;
        displaced.y += leafFlutter * windWeight * 0.5; // subtle vertical bounce

        // Offset to world
        displaced += instanceOffset;

        vNormal = normalMatrix * normal;
        vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
        vColor = instanceColor;
        vLeafFade = 0.5 + localHeight * 0.5;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 foliageColor;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vColor;
      varying float vLeafFade;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = max(dot(N, sunDirection), 0.0);

        // Translucency: light passing through thin leaves
        float backLight = max(dot(-N, sunDirection), 0.0) * 0.25;
        float subsurface = backLight * vLeafFade;

        vec3 color = vColor * (ambientColor + sunColor * (NdotL * 0.6 + subsurface));

        // Rim lighting for leaf edges
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float rimDot = 1.0 - max(dot(viewDir, N), 0.0);
        float rim = pow(rimDot, 3.0) * 0.15;
        color += rim * sunColor * vColor;

        // Slight darkening at interior
        float ao = 0.8 + 0.2 * vLeafFade;
        color *= ao;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

/**
 * Branch shader for dead trees — minimal wind with only primary sway.
 */
function createBranchMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector3(1, 0, 0) },
      windStrength: { value: 0.3 },
      branchColor: { value: new THREE.Color(color) },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      ambientColor: { value: new THREE.Color(0.25, 0.3, 0.35) },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute vec3 instanceOffset;
      attribute float instanceScale;
      attribute float instancePhase;
      attribute vec3 branchOffset;
      attribute float branchAngle;

      uniform float time;
      uniform vec3 windDirection;
      uniform float windStrength;

      varying vec3 vNormal;

      mat3 rotateZ(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(
          c, -s, 0.0,
          s,  c, 0.0,
          0.0, 0.0, 1.0
        );
      }

      void main() {
        vec3 pos = position;

        // Rotate branch to its angle
        pos = rotateZ(branchAngle) * pos;

        // Offset branch from trunk
        pos += branchOffset * instanceScale;

        // Scale
        pos *= instanceScale;

        // Primary sway
        float primarySway = sin(time * 1.5 + instanceOffset.x * 0.5 + instancePhase) * 0.015;
        primarySway *= windStrength;

        // Tremor for thin branches
        float branchTremor = sin(time * 5.0 + branchAngle * 4.0 + instancePhase) * 0.003;
        branchTremor *= windStrength;

        pos.x += (primarySway + branchTremor) * windDirection.x;
        pos.z += (primarySway * 0.5 + branchTremor) * windDirection.z;

        pos += instanceOffset;

        vNormal = normalMatrix * normal;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 branchColor;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;

      varying vec3 vNormal;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = max(dot(N, sunDirection), 0.0);
        vec3 diffuse = branchColor * (ambientColor + sunColor * NdotL * 0.7);
        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Poisson disk sampling (simplified for tree scatter)
// ---------------------------------------------------------------------------

function poissonDiskSampleTrees(bounds, radius, maxPoints, isValid, rng) {
  const cellSize = radius / Math.SQRT2;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);
  const grid = new Int32Array(gridW * gridH).fill(-1);
  const points = [];
  const active = [];

  function gridIndex(x, z) {
    const gx = Math.floor((x - bounds.minX) / cellSize);
    const gz = Math.floor((z - bounds.minZ) / cellSize);
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridH) return -1;
    return gz * gridW + gx;
  }

  function isTooClose(x, z) {
    const gx = Math.floor((x - bounds.minX) / cellSize);
    const gz = Math.floor((z - bounds.minZ) / cellSize);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        const nz = gz + dy;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH) continue;
        const idx = grid[nz * gridW + nx];
        if (idx === -1) continue;
        const p = points[idx];
        const ddx = p.x - x;
        const ddz = p.z - z;
        if (ddx * ddx + ddz * ddz < radius * radius) return true;
      }
    }
    return false;
  }

  const sx = bounds.minX + rng() * width;
  const sz = bounds.minZ + rng() * height;
  if (isValid(sx, sz)) {
    points.push({ x: sx, z: sz });
    const gi = gridIndex(sx, sz);
    if (gi >= 0) grid[gi] = 0;
    active.push(0);
  }

  while (active.length > 0 && points.length < maxPoints) {
    const ai = Math.floor(rng() * active.length);
    const pi = active[ai];
    const base = points[pi];
    let found = false;

    for (let attempt = 0; attempt < POISSON_MAX_ATTEMPTS; attempt++) {
      const angle = rng() * Math.PI * 2;
      const dist = radius + rng() * radius;
      const nx = base.x + Math.cos(angle) * dist;
      const nz = base.z + Math.sin(angle) * dist;

      if (nx < bounds.minX || nx > bounds.maxX ||
          nz < bounds.minZ || nz > bounds.maxZ) continue;
      if (isTooClose(nx, nz)) continue;
      if (!isValid(nx, nz)) continue;

      const idx = points.length;
      points.push({ x: nx, z: nz });
      const gi = gridIndex(nx, nz);
      if (gi >= 0) grid[gi] = idx;
      active.push(idx);
      found = true;
      if (points.length >= maxPoints) break;
    }

    if (!found) {
      active.splice(ai, 1);
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// TreeWindSystem class
// ---------------------------------------------------------------------------

export class TreeWindSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {number} [options.maxTreesPerType=500]
   * @param {number} [options.seed=7]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxPerType = options.maxTreesPerType || MAX_TREES_PER_TYPE;
    this.seed = options.seed || 7;

    this._time = 0;
    this._disposed = false;

    // Per-type data
    this._types = {};
    this._allTrees = [];

    // Initialize each tree type
    for (const [typeName, cfg] of Object.entries(TREE_TYPES)) {
      this._initType(typeName, cfg);
    }
  }

  // ── Public API ──

  /**
   * Place a single tree.
   * @param {THREE.Vector3 | { x: number, y: number, z: number }} position
   * @param {string} type - 'oak' | 'pine' | 'birch' | 'dead'
   * @param {object} options
   * @param {number} [options.scale=1.0]
   * @param {number} [options.phase] - Wind phase offset (random if omitted)
   */
  placeTree(position, type, options = {}) {
    const typeData = this._types[type];
    if (!typeData) return;

    const rng = makeRng(this.seed + this._allTrees.length * 17);
    const scale = options.scale || (0.8 + rng() * 0.4);
    const phase = options.phase !== undefined ? options.phase : rng() * Math.PI * 2;
    const cfg = TREE_TYPES[type];

    const tree = {
      x: position.x,
      y: position.y !== undefined ? position.y : 0,
      z: position.z,
      type: type,
      scale: scale,
      phase: phase,
    };

    this._allTrees.push(tree);
    typeData.trees.push(tree);

    this._rebuildType(type);
  }

  /**
   * Batch-place multiple trees of the same type.
   * @param {Array<{ x: number, y: number, z: number }>} positions
   * @param {string} type
   * @param {object} options
   */
  placeTrees(positions, type, options = {}) {
    const typeData = this._types[type];
    if (!typeData) return;

    const rng = makeRng(this.seed + this._allTrees.length * 17);

    for (const pos of positions) {
      const scale = options.scale || (0.8 + rng() * 0.4);
      const phase = rng() * Math.PI * 2;

      const tree = {
        x: pos.x,
        y: pos.y !== undefined ? pos.y : 0,
        z: pos.z,
        type: type,
        scale: scale,
        phase: phase,
      };

      this._allTrees.push(tree);
      typeData.trees.push(tree);
    }

    this._rebuildType(type);
  }

  /**
   * Scatter trees in a region using Poisson disk sampling.
   * @param {object} terrainSampler - { getHeight(x, z), isGrassable(x, z) }
   * @param {object} bounds - { minX, maxX, minZ, maxZ }
   * @param {number} count - Target tree count
   * @param {object} options
   * @param {string} [options.type='oak'] - Tree type to scatter
   * @param {string[]} [options.types] - Array of types to randomly pick from
   * @param {number} [options.minSpacing=0.15] - Minimum distance between trees
   * @param {function} [options.isValid] - Additional validation (x, z) => boolean
   */
  scatter(terrainSampler, bounds, count, options = {}) {
    const types = options.types || [options.type || 'oak'];
    const minSpacing = options.minSpacing || 0.15;
    const externalValid = options.isValid || (() => true);

    const rng = makeRng(this.seed + this._allTrees.length);

    const isValid = (x, z) => {
      if (terrainSampler.isGrassable && !terrainSampler.isGrassable(x, z)) return false;
      return externalValid(x, z);
    };

    const points = poissonDiskSampleTrees(bounds, minSpacing, count, isValid, rng);

    const typeBuckets = {};
    for (const t of types) typeBuckets[t] = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const y = terrainSampler.getHeight(p.x, p.z);
      const typeName = types[Math.floor(rng() * types.length)];
      const scale = 0.7 + rng() * 0.6;
      const phase = rng() * Math.PI * 2;

      const tree = {
        x: p.x,
        y: y,
        z: p.z,
        type: typeName,
        scale: scale,
        phase: phase,
      };

      this._allTrees.push(tree);
      if (this._types[typeName]) {
        this._types[typeName].trees.push(tree);
      }
      if (typeBuckets[typeName]) {
        typeBuckets[typeName].push(tree);
      }
    }

    // Rebuild each affected type
    for (const t of types) {
      if (this._types[t]) {
        this._rebuildType(t);
      }
    }
  }

  /**
   * Update wind animation.
   * @param {number} deltaTime
   * @param {THREE.Vector3 | { x: number, y: number, z: number }} windDirection
   * @param {number} windStrength
   */
  update(deltaTime, windDirection, windStrength) {
    if (this._disposed) return;

    this._time += deltaTime;

    for (const [typeName, typeData] of Object.entries(this._types)) {
      // Update trunk uniforms
      if (typeData.trunkMat) {
        typeData.trunkMat.uniforms.time.value = this._time;
        typeData.trunkMat.uniforms.windStrength.value = windStrength;
        if (windDirection) {
          typeData.trunkMat.uniforms.windDirection.value.set(
            windDirection.x, windDirection.y || 0, windDirection.z || 0
          );
        }
      }

      // Update foliage uniforms
      if (typeData.foliageMat) {
        typeData.foliageMat.uniforms.time.value = this._time;
        typeData.foliageMat.uniforms.windStrength.value = windStrength;
        if (windDirection) {
          typeData.foliageMat.uniforms.windDirection.value.set(
            windDirection.x, windDirection.y || 0, windDirection.z || 0
          );
        }
      }

      // Update branch uniforms (dead trees)
      if (typeData.branchMat) {
        typeData.branchMat.uniforms.time.value = this._time;
        typeData.branchMat.uniforms.windStrength.value = windStrength;
        if (windDirection) {
          typeData.branchMat.uniforms.windDirection.value.set(
            windDirection.x, windDirection.y || 0, windDirection.z || 0
          );
        }
      }
    }
  }

  /**
   * Remove all trees within a radius.
   * @param {{ x: number, z: number } | THREE.Vector3} center
   * @param {number} radius
   */
  clearZone(center, radius) {
    const radiusSq = radius * radius;
    const affectedTypes = new Set();

    // Remove from _allTrees
    this._allTrees = this._allTrees.filter(tree => {
      const dx = tree.x - center.x;
      const dz = tree.z - center.z;
      if (dx * dx + dz * dz < radiusSq) {
        affectedTypes.add(tree.type);
        return false;
      }
      return true;
    });

    // Remove from per-type lists and rebuild
    for (const typeName of affectedTypes) {
      const typeData = this._types[typeName];
      if (!typeData) continue;
      typeData.trees = typeData.trees.filter(tree => {
        const dx = tree.x - center.x;
        const dz = tree.z - center.z;
        return dx * dx + dz * dz >= radiusSq;
      });
      this._rebuildType(typeName);
    }
  }

  /**
   * Release all GPU resources.
   */
  dispose() {
    this._disposed = true;

    for (const [typeName, typeData] of Object.entries(this._types)) {
      if (typeData.trunkMesh) {
        this.scene.remove(typeData.trunkMesh);
        typeData.trunkMesh.dispose();
      }
      if (typeData.trunkGeo) typeData.trunkGeo.dispose();
      if (typeData.trunkMat) typeData.trunkMat.dispose();

      if (typeData.foliageMesh) {
        this.scene.remove(typeData.foliageMesh);
        typeData.foliageMesh.dispose();
      }
      if (typeData.foliageGeo) typeData.foliageGeo.dispose();
      if (typeData.foliageMat) typeData.foliageMat.dispose();

      if (typeData.branchMesh) {
        this.scene.remove(typeData.branchMesh);
        typeData.branchMesh.dispose();
      }
      if (typeData.branchGeo) typeData.branchGeo.dispose();
      if (typeData.branchMat) typeData.branchMat.dispose();
    }

    this._types = {};
    this._allTrees = [];
  }

  // ── Internal ──

  /**
   * Initialize meshes and materials for a tree type.
   */
  _initType(typeName, cfg) {
    const typeData = {
      cfg: cfg,
      trees: [],
      trunkGeo: null,
      trunkMat: null,
      trunkMesh: null,
      foliageGeo: null,
      foliageMat: null,
      foliageMesh: null,
      branchGeo: null,
      branchMat: null,
      branchMesh: null,
    };

    // Trunk
    typeData.trunkGeo = createTrunkGeometry(cfg);
    typeData.trunkMat = createTrunkMaterial(cfg.trunkColor);

    typeData.trunkMesh = new THREE.InstancedMesh(
      typeData.trunkGeo,
      typeData.trunkMat,
      this.maxPerType
    );
    typeData.trunkMesh.count = 0;
    typeData.trunkMesh.frustumCulled = false;
    typeData.trunkMesh.castShadow = true;
    typeData.trunkMesh.receiveShadow = true;

    // Trunk instance attributes
    this._addInstanceAttributes(typeData.trunkGeo, this.maxPerType, false);

    this.scene.add(typeData.trunkMesh);

    // Foliage (not for dead trees)
    if (cfg.crownType !== 'none') {
      typeData.foliageGeo = createFoliageGeometry(cfg);
      if (typeData.foliageGeo) {
        typeData.foliageMat = createFoliageMaterial(cfg.crownColor);

        typeData.foliageMesh = new THREE.InstancedMesh(
          typeData.foliageGeo,
          typeData.foliageMat,
          this.maxPerType
        );
        typeData.foliageMesh.count = 0;
        typeData.foliageMesh.frustumCulled = false;
        typeData.foliageMesh.castShadow = true;
        typeData.foliageMesh.receiveShadow = false;

        this._addInstanceAttributes(typeData.foliageGeo, this.maxPerType, true);

        this.scene.add(typeData.foliageMesh);
      }
    }

    // Dead tree branches
    if (typeName === 'dead') {
      typeData.branchGeo = createBranchGeometry();
      typeData.branchMat = createBranchMaterial(cfg.branchColor);

      // Each dead tree has 3 branches, so max branches = maxPerType * 3
      const maxBranches = this.maxPerType * (cfg.branchCount || 3);
      typeData.branchMesh = new THREE.InstancedMesh(
        typeData.branchGeo,
        typeData.branchMat,
        maxBranches
      );
      typeData.branchMesh.count = 0;
      typeData.branchMesh.frustumCulled = false;
      typeData.branchMesh.castShadow = true;

      this._addBranchAttributes(typeData.branchGeo, maxBranches);

      this.scene.add(typeData.branchMesh);
    }

    this._types[typeName] = typeData;
  }

  /**
   * Add per-instance attributes to a geometry.
   */
  _addInstanceAttributes(geo, maxCount, withColor) {
    const offsetBuf = new Float32Array(maxCount * 3);
    const scaleBuf = new Float32Array(maxCount);
    const phaseBuf = new Float32Array(maxCount);

    geo.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
    geo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleBuf, 1));
    geo.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phaseBuf, 1));

    if (withColor) {
      const colorBuf = new Float32Array(maxCount * 3);
      geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorBuf, 3));
    }
  }

  /**
   * Add per-instance attributes for dead tree branches.
   */
  _addBranchAttributes(geo, maxCount) {
    const offsetBuf = new Float32Array(maxCount * 3);
    const scaleBuf = new Float32Array(maxCount);
    const phaseBuf = new Float32Array(maxCount);
    const branchOffsetBuf = new Float32Array(maxCount * 3);
    const branchAngleBuf = new Float32Array(maxCount);

    geo.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
    geo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleBuf, 1));
    geo.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phaseBuf, 1));
    geo.setAttribute('branchOffset', new THREE.InstancedBufferAttribute(branchOffsetBuf, 3));
    geo.setAttribute('branchAngle', new THREE.InstancedBufferAttribute(branchAngleBuf, 1));
  }

  /**
   * Rebuild instance buffers for a given tree type from its tree list.
   */
  _rebuildType(typeName) {
    const typeData = this._types[typeName];
    if (!typeData) return;

    const cfg = typeData.cfg;
    const trees = typeData.trees;
    const count = Math.min(trees.length, this.maxPerType);
    const rng = makeRng(this.seed + typeName.charCodeAt(0));

    // ── Trunk buffers ──
    const trunkOffset = typeData.trunkGeo.getAttribute('instanceOffset');
    const trunkScale = typeData.trunkGeo.getAttribute('instanceScale');
    const trunkPhase = typeData.trunkGeo.getAttribute('instancePhase');

    for (let i = 0; i < count; i++) {
      const t = trees[i];
      // Trunk base is at center of cylinder; offset so base sits on ground
      trunkOffset.array[i * 3 + 0] = t.x;
      trunkOffset.array[i * 3 + 1] = t.y + (cfg.trunkHeight * t.scale * 0.5);
      trunkOffset.array[i * 3 + 2] = t.z;
      trunkScale.array[i] = t.scale;
      trunkPhase.array[i] = t.phase;
    }

    trunkOffset.needsUpdate = true;
    trunkScale.needsUpdate = true;
    trunkPhase.needsUpdate = true;
    typeData.trunkMesh.count = count;

    // ── Foliage buffers ──
    if (typeData.foliageMesh && typeData.foliageGeo) {
      const fOffset = typeData.foliageGeo.getAttribute('instanceOffset');
      const fScale = typeData.foliageGeo.getAttribute('instanceScale');
      const fPhase = typeData.foliageGeo.getAttribute('instancePhase');
      const fColor = typeData.foliageGeo.getAttribute('instanceColor');

      const crownColors = cfg.crownColors || [cfg.crownColor];

      for (let i = 0; i < count; i++) {
        const t = trees[i];
        fOffset.array[i * 3 + 0] = t.x;
        fOffset.array[i * 3 + 1] = t.y + (cfg.crownOffsetY || cfg.trunkHeight) * t.scale;
        fOffset.array[i * 3 + 2] = t.z;
        fScale.array[i] = t.scale;
        fPhase.array[i] = t.phase;

        // Color variation
        if (fColor) {
          const colorIdx = Math.floor(rng() * crownColors.length);
          const col = new THREE.Color(crownColors[colorIdx]);
          // Slight random variation
          const vary = (rng() - 0.5) * 0.06;
          fColor.array[i * 3 + 0] = Math.max(0, Math.min(1, col.r + vary));
          fColor.array[i * 3 + 1] = Math.max(0, Math.min(1, col.g + vary));
          fColor.array[i * 3 + 2] = Math.max(0, Math.min(1, col.b + vary * 0.5));
        }
      }

      fOffset.needsUpdate = true;
      fScale.needsUpdate = true;
      fPhase.needsUpdate = true;
      if (fColor) fColor.needsUpdate = true;
      typeData.foliageMesh.count = count;
    }

    // ── Branch buffers (dead trees) ──
    if (typeData.branchMesh && typeName === 'dead') {
      const branchCount = cfg.branchCount || 3;
      const bOffset = typeData.branchGeo.getAttribute('instanceOffset');
      const bScale = typeData.branchGeo.getAttribute('instanceScale');
      const bPhase = typeData.branchGeo.getAttribute('instancePhase');
      const bBranchOffset = typeData.branchGeo.getAttribute('branchOffset');
      const bBranchAngle = typeData.branchGeo.getAttribute('branchAngle');

      let bi = 0;
      for (let i = 0; i < count; i++) {
        const t = trees[i];
        for (let b = 0; b < branchCount; b++) {
          const angle = (b / branchCount) * Math.PI * 2 + rng() * 0.5;
          const height = 0.5 + rng() * 0.4; // branch attachment height along trunk (fraction)
          const branchY = t.y + cfg.trunkHeight * t.scale * height;
          const branchDist = cfg.trunkRadius * t.scale * 1.5;

          bOffset.array[bi * 3 + 0] = t.x;
          bOffset.array[bi * 3 + 1] = branchY;
          bOffset.array[bi * 3 + 2] = t.z;
          bScale.array[bi] = t.scale;
          bPhase.array[bi] = t.phase + b;

          // Branch offset from trunk center
          bBranchOffset.array[bi * 3 + 0] = Math.cos(angle) * branchDist;
          bBranchOffset.array[bi * 3 + 1] = 0;
          bBranchOffset.array[bi * 3 + 2] = Math.sin(angle) * branchDist;

          // Branch tilt angle (angled upward from trunk)
          bBranchAngle.array[bi] = angle + (rng() - 0.5) * 0.8;

          bi++;
        }
      }

      bOffset.needsUpdate = true;
      bScale.needsUpdate = true;
      bPhase.needsUpdate = true;
      bBranchOffset.needsUpdate = true;
      bBranchAngle.needsUpdate = true;
      typeData.branchMesh.count = bi;
    }
  }
}
