/**
 * GrassSystem — instanced grass with cross-quad star geometry for volume,
 * upward-biased normals for consistent lighting, and wave-propagation wind.
 *
 * Each instance renders 3 intersecting quads (star pattern) so blades
 * have volume from every camera angle instead of paper-thin single strips.
 */

import * as THREE from 'three';

// Constants

const MAX_BLADES = 200000;
const DEFAULT_DENSITY = 15000;

const BLADE_MIN_HEIGHT = 0.018;
const BLADE_MAX_HEIGHT = 0.055;

const POISSON_MAX_ATTEMPTS = 30;

// Cross-quad blade geometry — 3 intersecting quads at 0°/60°/120°

/**
 * Build a grass clump as 3 intersecting blade strips (star pattern).
 * Each strip has 3 rows (base → mid → tip) for curved wind bending.
 *
 * Total: 18 vertices, 12 triangles per instance.
 */
function createBladeGeometry(baseHalfWidth = 0.0075) {
  const ANGLES = [0, Math.PI / 3, (Math.PI * 2) / 3];

  const s = baseHalfWidth / 0.0075; // scale factor relative to default
  const rows = [
    { y: 0.00, halfW: baseHalfWidth, curve: 0.000 },
    { y: 0.45, halfW: 0.0055 * s, curve: 0.003 },
    { y: 1.00, halfW: 0.0008 * s, curve: 0.007 },
  ];

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let q = 0; q < ANGLES.length; q++) {
    const a = ANGLES[q];
    const ca = Math.cos(a);
    const sa = Math.sin(a);

    // Normal: mostly upward with slight outward bias per quad
    const upBias = 0.85;
    const sideBias = Math.sqrt(1 - upBias * upBias);

    for (let r = 0; r < rows.length; r++) {
      const { y, halfW, curve } = rows[r];

      // Left vertex: perpendicular to quad + forward curve
      positions.push(
        -halfW * ca + sa * curve,
        y,
        -halfW * sa - ca * curve,
      );
      // Right vertex
      positions.push(
        halfW * ca + sa * curve,
        y,
        halfW * sa - ca * curve,
      );

      // Upward-biased normals — grass catches light uniformly
      normals.push(-sa * sideBias, upBias, ca * sideBias);
      normals.push(sa * sideBias, upBias, -ca * sideBias);

      uvs.push(0, y, 1, y);
    }

    // 2 quads per strip (base→mid, mid→tip) = 4 triangles
    for (let r = 0; r < rows.length - 1; r++) {
      const bl = (q * rows.length + r) * 2;
      indices.push(bl, bl + 1, bl + 2);
      indices.push(bl + 1, bl + 3, bl + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// Shader material — vertex-animated instanced grass

function createGrassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector2(1.0, 0.0) },
      windStrength: { value: 0.3 },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.97, 0.88) },
      ambientColor: { value: new THREE.Color(0.38, 0.42, 0.48) },
      fogColor: { value: new THREE.Color(0.53, 0.73, 0.87) },
      fogNear: { value: 9.0 },
      fogFar: { value: 16.0 },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      // Per-instance attributes
      attribute vec3 instanceOffset;
      attribute float instanceRotation;
      attribute float instanceHeight;
      attribute vec3 instanceColor;
      attribute float instancePhase;

      uniform float time;
      uniform vec2 windDirection;
      uniform float windStrength;

      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vHeightFrac;

      mat3 rotateY(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(
          c, 0.0, s,
          0.0, 1.0, 0.0,
          -s, 0.0, c
        );
      }

      void main() {
        float bladeHeight = instanceHeight;

        vec3 pos = position;
        pos.y *= bladeHeight;

        // Height fraction for wind weighting (from normalized geometry y)
        float heightFrac = position.y;
        vHeightFrac = heightFrac;

        // Rotate blade around Y (per-instance random facing)
        vec3 rotated = rotateY(instanceRotation) * pos;

        // ── Wind sway (world space, after rotation) ──
        // Primary wave: large slow oscillation
        float phase = time * 2.2 + instanceOffset.x * 5.0 + instanceOffset.z * 4.0 + instancePhase;
        float primary = sin(phase) * 0.055;

        // Secondary gust: faster, smaller
        float gust = sin(phase * 1.7 + 2.1) * 0.025;

        // Tertiary flutter: high frequency, tiny
        float flutter = sin(phase * 4.3 + instancePhase * 3.0) * 0.008;

        float totalSway = (primary + gust + flutter) * heightFrac * heightFrac * windStrength;

        rotated.x += totalSway * windDirection.x;
        rotated.z += totalSway * windDirection.y;

        // Place in world
        rotated += instanceOffset;

        vColor = instanceColor;
        vNormal = rotateY(instanceRotation) * normal;
        vWorldPosition = (modelMatrix * vec4(rotated, 1.0)).xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(rotated, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;

      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vHeightFrac;

      void main() {
        vec3 N = normalize(vNormal);

        // Wrap-around diffuse — grass catches light from wide angles
        float wrap = (dot(N, sunDirection) + 0.5) / 1.5;
        wrap = max(wrap, 0.0);

        // Subsurface scattering at blade tips (light through thin grass)
        float scatter = max(dot(-N, sunDirection), 0.0) * 0.35 * vHeightFrac;

        vec3 diffuse = vColor * (ambientColor + sunColor * (wrap * 0.7 + scatter));

        // Vertical gradient: darker base (grounding), brighter tip (translucency)
        float gradient = mix(0.72, 1.18, smoothstep(0.0, 0.75, vHeightFrac));
        diffuse *= gradient;

        // Distance fog
        float dist = length(vWorldPosition - cameraPosition);
        float fogFactor = smoothstep(fogNear, fogFar, dist);
        diffuse = mix(diffuse, fogColor, fogFactor);

        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
}

// Poisson disk sampling

/**
 * Generate 2D Poisson-disk distributed points within rectangular bounds.
 * @param {object} bounds - { minX, maxX, minZ, maxZ }
 * @param {number} radius - Minimum distance between points
 * @param {number} maxPoints - Maximum number of points to generate
 * @param {function} isValid - (x, z) => boolean
 * @returns {Array<{x: number, z: number}>}
 */
function poissonDiskSample(bounds, radius, maxPoints, isValid, rng) {
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
    const searchRadius = 2;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
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

  // Seed point — try up to 100 candidates to find a valid starting position
  for (let si = 0; si < 100; si++) {
    const sx = bounds.minX + rng() * width;
    const sz = bounds.minZ + rng() * height;
    if (isValid(sx, sz)) {
      points.push({ x: sx, z: sz });
      const gi = gridIndex(sx, sz);
      if (gi >= 0) grid[gi] = 0;
      active.push(0);
      break;
    }
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

// Seeded RNG

function makeRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s >>> 16) / 65536;
  };
}

// GrassSystem class

export class GrassSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {number} [options.maxBlades=30000]
   * @param {number} [options.seed=42]
   * @param {THREE.Vector3} [options.sunDirection]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxBlades = options.maxBlades || MAX_BLADES;
    this.seed = options.seed || 42;

    // Configurable blade properties
    this._minHeight = options.minHeight ?? BLADE_MIN_HEIGHT;
    this._maxHeight = options.maxHeight ?? BLADE_MAX_HEIGHT;
    this._bladeWidth = options.bladeWidth ?? null; // null = use geometry default
    this._windStrength = options.windStrength ?? 0.3;
    this._colorBrightness = options.colorBrightness ?? 1.0;

    this._time = 0;
    this._bladeCount = 0;
    this._exclusionZones = [];
    this._exclusionTests = [];
    this._densityFactor = 1.0;
    this._disposed = false;

    // Cross-quad blade mesh
    this._bladeGeo = this._bladeWidth
      ? createBladeGeometry(this._bladeWidth)
      : createBladeGeometry();
    this._bladeMat = createGrassMaterial();
    this._bladeMat.uniforms.windStrength.value = this._windStrength;
    if (options.sunDirection) {
      this._bladeMat.uniforms.sunDirection.value.copy(options.sunDirection).normalize();
    }

    this._bladeMesh = new THREE.InstancedMesh(this._bladeGeo, this._bladeMat, this.maxBlades);
    this._bladeMesh.count = 0;
    this._bladeMesh.frustumCulled = false;
    this._bladeMesh.castShadow = false;
    this._bladeMesh.receiveShadow = false;

    // Instance attribute buffers
    this._offsetBuf = new Float32Array(this.maxBlades * 3);
    this._rotationBuf = new Float32Array(this.maxBlades);
    this._heightBuf = new Float32Array(this.maxBlades);
    this._colorBuf = new Float32Array(this.maxBlades * 3);
    this._phaseBuf = new Float32Array(this.maxBlades);

    this._offsetAttr = new THREE.InstancedBufferAttribute(this._offsetBuf, 3);
    this._offsetAttr.setUsage(THREE.DynamicDrawUsage);
    this._rotationAttr = new THREE.InstancedBufferAttribute(this._rotationBuf, 1);
    this._rotationAttr.setUsage(THREE.DynamicDrawUsage);
    this._heightAttr = new THREE.InstancedBufferAttribute(this._heightBuf, 1);
    this._heightAttr.setUsage(THREE.DynamicDrawUsage);
    this._colorAttr = new THREE.InstancedBufferAttribute(this._colorBuf, 3);
    this._colorAttr.setUsage(THREE.DynamicDrawUsage);
    this._phaseAttr = new THREE.InstancedBufferAttribute(this._phaseBuf, 1);
    this._phaseAttr.setUsage(THREE.DynamicDrawUsage);

    this._bladeGeo.setAttribute('instanceOffset', this._offsetAttr);
    this._bladeGeo.setAttribute('instanceRotation', this._rotationAttr);
    this._bladeGeo.setAttribute('instanceHeight', this._heightAttr);
    this._bladeGeo.setAttribute('instanceColor', this._colorAttr);
    this._bladeGeo.setAttribute('instancePhase', this._phaseAttr);

    // Store all blade data
    this._allBlades = [];

    scene.add(this._bladeMesh);
  }

  // ── Public API ──

  /**
   * Scatter grass blades on terrain using Poisson disk sampling.
   * @param {object} terrainSampler - { getHeight(x, z), getMoisture(x, z), isGrassable(x, z) }
   * @param {object} bounds - { minX, maxX, minZ, maxZ }
   * @param {number} density - Target blade count
   */
  scatter(terrainSampler, bounds, density = DEFAULT_DENSITY) {
    const count = Math.min(Math.floor(density * this._densityFactor), this.maxBlades);
    if (count <= 0) return;

    const exclusions = this._exclusionZones;
    const exclusionTests = this._exclusionTests;

    const isValid = (x, z) => {
      if (!terrainSampler.isGrassable(x, z)) return false;
      for (let i = 0; i < exclusions.length; i++) {
        const e = exclusions[i];
        const dx = x - e.center.x;
        const dz = z - e.center.z;
        if (dx * dx + dz * dz < e.radiusSq) return false;
      }
      for (let i = 0; i < exclusionTests.length; i++) {
        if (exclusionTests[i](x, z)) return false;
      }
      return true;
    };

    const rng = makeRng(this.seed);

    // Deterministic jittered grid — same seed always produces same positions
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxZ - bounds.minZ;
    const area = width * height;
    const cellSize = Math.sqrt(area / count);
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const jitter = cellSize * 0.45; // max offset from grid center

    const points = [];
    for (let row = 0; row < rows && points.length < count; row++) {
      for (let col = 0; col < cols && points.length < count; col++) {
        const cx = bounds.minX + (col + 0.5) * cellSize + (rng() - 0.5) * 2 * jitter;
        const cz = bounds.minZ + (row + 0.5) * cellSize + (rng() - 0.5) * 2 * jitter;
        if (cx < bounds.minX || cx > bounds.maxX || cz < bounds.minZ || cz > bounds.maxZ) continue;
        if (!isValid(cx, cz)) continue;
        points.push({ x: cx, z: cz });
      }
    }

    // Brighter, more varied base colors — sunlit grass
    const baseColors = [
      new THREE.Color(0.34, 0.54, 0.19),  // mid green
      new THREE.Color(0.40, 0.58, 0.22),  // bright green
      new THREE.Color(0.30, 0.48, 0.16),  // rich green
      new THREE.Color(0.44, 0.56, 0.24),  // warm yellow-green
      new THREE.Color(0.36, 0.52, 0.18),  // forest green
      new THREE.Color(0.42, 0.50, 0.22),  // olive green
    ];

    this._allBlades = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const y = terrainSampler.getHeight(p.x, p.z);
      const moistureRaw = terrainSampler.getMoisture ? terrainSampler.getMoisture(p.x, p.z) : 128;
      const moisture = moistureRaw / 255;

      // Height variation: taller in moist areas
      const hMin = this._minHeight;
      const hMax = this._maxHeight;
      const heightRange = hMax - hMin;
      const heightBase = hMin + rng() * heightRange;
      const height = heightBase * (0.85 + moisture * 0.35);

      // Random rotation
      const rotation = rng() * Math.PI * 2;

      // Color with random tint
      const baseIdx = Math.floor(rng() * baseColors.length);
      const tintR = (rng() - 0.5) * 0.06;
      const tintG = (rng() - 0.5) * 0.04;
      const tintB = (rng() - 0.5) * 0.03;

      const bc = baseColors[baseIdx];
      // Moisture influence: greener when wet, yellower when dry
      const moistShift = (moisture - 0.5) * 0.08;

      const br = this._colorBrightness;
      const r = Math.max(0, Math.min(1, (bc.r + tintR - moistShift * 0.3) * br));
      const g = Math.max(0, Math.min(1, (bc.g + tintG + moistShift) * br));
      const b = Math.max(0, Math.min(1, (bc.b + tintB - moistShift * 0.2) * br));

      // Wind phase offset
      const phase = rng() * Math.PI * 2;

      this._allBlades.push({
        x: p.x, y: y, z: p.z,
        rotation,
        height: Math.max(hMin, Math.min(hMax, height)),
        r, g, b,
        phase,
      });
    }

    this._rebuildBuffers();
  }

  /**
   * Add an exclusion zone where grass will not grow.
   * @param {{ x: number, z: number } | THREE.Vector3} center
   * @param {number} radius
   */
  addExclusionZone(center, radius) {
    this._exclusionZones.push({
      center: { x: center.x, z: center.z },
      radiusSq: radius * radius,
      radius: radius,
    });
  }

  /**
   * Clear all exclusion zones.
   */
  clearExclusionZones() {
    this._exclusionZones.length = 0;
  }

  /**
   * Add a custom exclusion test function.
   * @param {function(number, number): boolean} fn - (x, z) => true if excluded
   */
  addExclusionTest(fn) {
    this._exclusionTests.push(fn);
  }

  /**
   * Update grass animation.
   * @param {number} deltaTime
   * @param {THREE.Vector2 | { x: number, y: number }} windDirection
   * @param {number} windStrength - 0-1
   */
  update(deltaTime, windDirection, windStrength) {
    if (this._disposed || this._allBlades.length === 0) return;

    this._time += deltaTime;

    this._bladeMat.uniforms.time.value = this._time;
    this._bladeMat.uniforms.windStrength.value = windStrength;
    if (windDirection) {
      this._bladeMat.uniforms.windDirection.value.set(
        windDirection.x,
        windDirection.y || windDirection.z || 0,
      );
    }
  }

  /**
   * Sync fog parameters with the scene fog.
   * @param {number} near
   * @param {number} far
   * @param {THREE.Color|number} [color]
   */
  setFog(near, far, color) {
    this._bladeMat.uniforms.fogNear.value = near;
    this._bladeMat.uniforms.fogFar.value = far;
    if (color != null) {
      if (typeof color === 'number') this._bladeMat.uniforms.fogColor.value.set(color);
      else this._bladeMat.uniforms.fogColor.value.copy(color);
    }
  }

  /**
   * Set quality density factor (0-1).
   * @param {number} factor
   */
  setDensity(factor) {
    this._densityFactor = Math.max(0, Math.min(1, factor));
    this._rebuildBuffers();
  }

  /**
   * Release all GPU resources.
   */
  dispose() {
    this._disposed = true;

    this.scene.remove(this._bladeMesh);

    this._bladeGeo.dispose();
    this._bladeMat.dispose();
    this._bladeMesh.dispose();

    this._allBlades = [];
  }

  // ── Internal ──

  /**
   * Rebuild instance attribute buffers from _allBlades.
   */
  _rebuildBuffers() {
    const maxVisible = Math.floor(this._allBlades.length * this._densityFactor);
    const count = Math.min(maxVisible, this.maxBlades);

    for (let i = 0; i < count; i++) {
      const b = this._allBlades[i];
      this._offsetBuf[i * 3 + 0] = b.x;
      this._offsetBuf[i * 3 + 1] = b.y;
      this._offsetBuf[i * 3 + 2] = b.z;
      this._rotationBuf[i] = b.rotation;
      this._heightBuf[i] = b.height;
      this._colorBuf[i * 3 + 0] = b.r;
      this._colorBuf[i * 3 + 1] = b.g;
      this._colorBuf[i * 3 + 2] = b.b;
      this._phaseBuf[i] = b.phase;
    }

    this._offsetAttr.needsUpdate = true;
    this._rotationAttr.needsUpdate = true;
    this._heightAttr.needsUpdate = true;
    this._colorAttr.needsUpdate = true;
    this._phaseAttr.needsUpdate = true;

    this._bladeCount = count;
    this._bladeMesh.count = count;
  }
}
