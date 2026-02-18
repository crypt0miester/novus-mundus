/**
 * Flower field system with instanced rendering for wildflowers, crop fields,
 * and shrine flowers. Uses the same blade-geometry technique as the grass
 * system but adds wider colored petal tips and type-specific behaviors.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INSTANCES = 15000;
const POISSON_MAX_ATTEMPTS = 30;

const WILDFLOWER_COLORS = [
  new THREE.Color(0.9, 0.2, 0.3),   // red
  new THREE.Color(0.95, 0.8, 0.1),  // yellow
  new THREE.Color(0.6, 0.15, 0.7),  // purple
  new THREE.Color(0.95, 0.55, 0.1), // orange
  new THREE.Color(0.85, 0.4, 0.6),  // pink
  new THREE.Color(1.0, 1.0, 0.85),  // white-cream
];

const SHRINE_COLORS = [
  new THREE.Color(0.4, 0.7, 1.0),  // light blue glow
  new THREE.Color(0.6, 0.4, 1.0),  // violet glow
  new THREE.Color(0.3, 1.0, 0.7),  // mint glow
];

const CROP_COLOR = new THREE.Color(0.75, 0.65, 0.2); // golden wheat

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
// Flower blade geometry — stem + wide petal tip
// ---------------------------------------------------------------------------

/**
 * Create a single flower stalk geometry.
 *
 * The stalk is similar to a grass blade but the top 2 rows flare out
 * to form a simple petal. Y goes from 0 (base) to 1 (normalized).
 *
 * Rows (bottom to top):
 *   0: y=0.0  stem base (narrow)
 *   1: y=0.3  stem mid
 *   2: y=0.6  stem upper
 *   3: y=0.75 petal base (widens)
 *   4: y=0.88 petal mid (widest)
 *   5: y=1.0  petal tip (tapers)
 */
function createFlowerGeometry() {
  const rows = [
    { y: 0.0,  halfW: 0.002, z: 0.0 },
    { y: 0.3,  halfW: 0.0025, z: 0.001 },
    { y: 0.6,  halfW: 0.002, z: 0.003 },
    { y: 0.75, halfW: 0.006, z: 0.004 },   // petal starts
    { y: 0.88, halfW: 0.009, z: 0.004 },   // widest petal
    { y: 1.0,  halfW: 0.003, z: 0.003 },   // tip
  ];

  const vertCount = rows.length * 2;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const li = i * 2;
    const ri = i * 2 + 1;

    positions[li * 3 + 0] = -r.halfW;
    positions[li * 3 + 1] = r.y;
    positions[li * 3 + 2] = r.z;

    positions[ri * 3 + 0] = r.halfW;
    positions[ri * 3 + 1] = r.y;
    positions[ri * 3 + 2] = r.z;

    normals[li * 3 + 2] = -1;
    normals[ri * 3 + 2] = -1;

    uvs[li * 2 + 0] = 0;
    uvs[li * 2 + 1] = r.y;
    uvs[ri * 2 + 0] = 1;
    uvs[ri * 2 + 1] = r.y;
  }

  const indices = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const bl = i * 2;
    const br = i * 2 + 1;
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    indices.push(bl, br, tl);
    indices.push(br, tr, tl);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Create a wheat stalk geometry — taller, thinner stem with a fat grain head.
 *
 * Rows:
 *   0: y=0.0  base
 *   1: y=0.4  stem mid
 *   2: y=0.7  stem upper (thin)
 *   3: y=0.8  head base (fat)
 *   4: y=0.9  head mid (fattest)
 *   5: y=1.0  head tip
 */
function createWheatGeometry() {
  const rows = [
    { y: 0.0,  halfW: 0.002, z: 0.0 },
    { y: 0.4,  halfW: 0.0022, z: 0.001 },
    { y: 0.7,  halfW: 0.0018, z: 0.003 },
    { y: 0.8,  halfW: 0.005, z: 0.003 },   // grain head
    { y: 0.9,  halfW: 0.006, z: 0.003 },   // fattest
    { y: 1.0,  halfW: 0.002, z: 0.002 },   // tip
  ];

  const vertCount = rows.length * 2;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const li = i * 2;
    const ri = i * 2 + 1;

    positions[li * 3 + 0] = -r.halfW;
    positions[li * 3 + 1] = r.y;
    positions[li * 3 + 2] = r.z;

    positions[ri * 3 + 0] = r.halfW;
    positions[ri * 3 + 1] = r.y;
    positions[ri * 3 + 2] = r.z;

    normals[li * 3 + 2] = -1;
    normals[ri * 3 + 2] = -1;

    uvs[li * 2 + 0] = 0;
    uvs[li * 2 + 1] = r.y;
    uvs[ri * 2 + 0] = 1;
    uvs[ri * 2 + 1] = r.y;
  }

  const indices = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const bl = i * 2;
    const br = i * 2 + 1;
    const tl = (i + 1) * 2;
    const tr = (i + 1) * 2 + 1;
    indices.push(bl, br, tl);
    indices.push(br, tr, tl);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// ---------------------------------------------------------------------------
// Shader materials
// ---------------------------------------------------------------------------

/**
 * Wildflower material — wind-animated stems with colored petal tips.
 */
function createWildflowerMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector2(1, 0) },
      windStrength: { value: 0.3 },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      ambientColor: { value: new THREE.Color(0.3, 0.35, 0.3) },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute vec3 instanceOffset;
      attribute float instanceRotation;
      attribute float instanceHeight;
      attribute vec3 instanceStemColor;
      attribute vec3 instancePetalColor;
      attribute float instancePhase;

      uniform float time;
      uniform vec2 windDirection;
      uniform float windStrength;

      varying vec3 vStemColor;
      varying vec3 vPetalColor;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
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
        // Scale width with height
        float widthScale = bladeHeight / 0.04;
        pos.x *= widthScale;
        pos.z *= widthScale;

        float heightFrac = position.y;
        vHeightFrac = heightFrac;

        // Wind sway — similar to grass but gentler
        float sway = sin(time * 2.0 + instanceOffset.x * 3.0 + instancePhase) * 0.08;
        sway *= heightFrac * windStrength;

        // Petal flutter at the top — higher frequency
        float flutter = sin(time * 8.0 + instanceOffset.z * 5.0 + instancePhase * 2.0) * 0.02;
        flutter *= smoothstep(0.6, 1.0, heightFrac) * windStrength;

        vec3 displaced = pos;
        displaced.x += (sway + flutter) * windDirection.x;
        displaced.z += (sway * 0.5 + flutter) * windDirection.y;

        // Rotate around Y
        displaced = rotateY(instanceRotation) * displaced;

        // Offset to world
        displaced += instanceOffset;

        vStemColor = instanceStemColor;
        vPetalColor = instancePetalColor;
        vNormal = rotateY(instanceRotation) * normal;
        vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;

      varying vec3 vStemColor;
      varying vec3 vPetalColor;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vHeightFrac;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = max(dot(N, sunDirection), 0.0);

        // Blend from stem color to petal color
        float petalBlend = smoothstep(0.65, 0.80, vHeightFrac);
        vec3 baseColor = mix(vStemColor, vPetalColor, petalBlend);

        // Translucency for thin petals
        float backLight = max(dot(-N, sunDirection), 0.0) * 0.3;
        float subsurface = backLight * petalBlend;

        vec3 diffuse = baseColor * (ambientColor + sunColor * (NdotL * 0.7 + subsurface));

        // Darken stem base
        float baseDarken = mix(0.55, 1.0, smoothstep(0.0, 0.25, vHeightFrac));
        diffuse *= baseDarken;

        // Petal saturation boost
        float satBoost = 1.0 + petalBlend * 0.3;
        float lum = dot(diffuse, vec3(0.2126, 0.7152, 0.0722));
        diffuse = mix(vec3(lum), diffuse, satBoost);

        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

/**
 * Crop (wheat) material — coordinated wave motion for adjacent stalks.
 */
function createCropMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector2(1, 0) },
      windStrength: { value: 0.3 },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      ambientColor: { value: new THREE.Color(0.35, 0.35, 0.25) },
      waveSpeed: { value: 3.0 },
      waveFrequency: { value: 8.0 },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute vec3 instanceOffset;
      attribute float instanceRotation;
      attribute float instanceHeight;
      attribute vec3 instanceStemColor;
      attribute vec3 instancePetalColor;
      attribute float instancePhase;
      attribute float instanceRow;

      uniform float time;
      uniform vec2 windDirection;
      uniform float windStrength;
      uniform float waveSpeed;
      uniform float waveFrequency;

      varying vec3 vStemColor;
      varying vec3 vPetalColor;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
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
        float widthScale = bladeHeight / 0.05;
        pos.x *= widthScale;
        pos.z *= widthScale;

        float heightFrac = position.y;
        vHeightFrac = heightFrac;

        // Coordinated wave: adjacent stalks in the same row move in phase.
        // The wave travels along windDirection.
        float spatialPhase = dot(vec2(instanceOffset.x, instanceOffset.z), windDirection) * waveFrequency;
        float wave = sin(time * waveSpeed + spatialPhase + instanceRow * 0.1) * 0.1;
        wave *= heightFrac * windStrength;

        // Subtle individual variation so it does not look too mechanical
        float individual = sin(time * 5.0 + instancePhase * 7.0) * 0.008;
        individual *= heightFrac * windStrength;

        vec3 displaced = pos;
        displaced.x += (wave + individual) * windDirection.x;
        displaced.z += (wave * 0.5 + individual) * windDirection.y;

        // Slight lean from persistent wind
        float lean = windStrength * 0.02 * heightFrac;
        displaced.x += lean * windDirection.x;
        displaced.z += lean * windDirection.y;

        displaced = rotateY(instanceRotation) * displaced;
        displaced += instanceOffset;

        vStemColor = instanceStemColor;
        vPetalColor = instancePetalColor;
        vNormal = rotateY(instanceRotation) * normal;
        vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;

      varying vec3 vStemColor;
      varying vec3 vPetalColor;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vHeightFrac;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = max(dot(N, sunDirection), 0.0);

        // Stem to grain-head blend
        float headBlend = smoothstep(0.7, 0.85, vHeightFrac);
        vec3 baseColor = mix(vStemColor, vPetalColor, headBlend);

        // Subsurface scattering for wheat heads
        float backLight = max(dot(-N, sunDirection), 0.0) * 0.35;
        float subsurface = backLight * headBlend;

        vec3 diffuse = baseColor * (ambientColor + sunColor * (NdotL * 0.8 + subsurface));

        // Base darkening
        float baseDarken = mix(0.5, 1.0, smoothstep(0.0, 0.2, vHeightFrac));
        diffuse *= baseDarken;

        // Golden rim on wheat heads
        float rimFactor = headBlend * (1.0 - NdotL) * 0.15;
        diffuse += sunColor * rimFactor * vec3(1.0, 0.85, 0.4);

        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

/**
 * Shrine flower material — glowing emissive petals.
 */
function createShrineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      windDirection: { value: new THREE.Vector2(1, 0) },
      windStrength: { value: 0.3 },
      sunDirection: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      sunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      ambientColor: { value: new THREE.Color(0.25, 0.3, 0.35) },
      glowIntensity: { value: 1.0 },
      glowPulseSpeed: { value: 2.0 },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      attribute vec3 instanceOffset;
      attribute float instanceRotation;
      attribute float instanceHeight;
      attribute vec3 instanceStemColor;
      attribute vec3 instancePetalColor;
      attribute float instancePhase;

      uniform float time;
      uniform vec2 windDirection;
      uniform float windStrength;

      varying vec3 vStemColor;
      varying vec3 vPetalColor;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vHeightFrac;
      varying float vPhase;

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
        float widthScale = bladeHeight / 0.04;
        pos.x *= widthScale;
        pos.z *= widthScale;

        float heightFrac = position.y;
        vHeightFrac = heightFrac;
        vPhase = instancePhase;

        // Gentle mystical sway
        float sway = sin(time * 1.5 + instanceOffset.x * 2.0 + instancePhase) * 0.06;
        sway *= heightFrac * windStrength;

        // Petal flutter
        float flutter = sin(time * 6.0 + instancePhase * 3.0 + instanceOffset.z * 4.0) * 0.015;
        flutter *= smoothstep(0.5, 1.0, heightFrac) * windStrength;

        vec3 displaced = pos;
        displaced.x += (sway + flutter) * windDirection.x;
        displaced.z += (sway * 0.5 + flutter) * windDirection.y;

        displaced = rotateY(instanceRotation) * displaced;
        displaced += instanceOffset;

        vStemColor = instanceStemColor;
        vPetalColor = instancePetalColor;
        vNormal = rotateY(instanceRotation) * normal;
        vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform vec3 ambientColor;
      uniform float time;
      uniform float glowIntensity;
      uniform float glowPulseSpeed;

      varying vec3 vStemColor;
      varying vec3 vPetalColor;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vHeightFrac;
      varying float vPhase;

      void main() {
        vec3 N = normalize(vNormal);
        float NdotL = max(dot(N, sunDirection), 0.0);

        // Stem to petal blend
        float petalBlend = smoothstep(0.6, 0.78, vHeightFrac);
        vec3 baseColor = mix(vStemColor, vPetalColor, petalBlend);

        // Normal diffuse lighting
        vec3 diffuse = baseColor * (ambientColor + sunColor * NdotL * 0.6);

        // Emissive glow on petals — pulsing
        float pulse = 0.7 + 0.3 * sin(time * glowPulseSpeed + vPhase);
        float glowMask = petalBlend * pulse * glowIntensity;
        vec3 emissive = vPetalColor * glowMask * 1.5;

        // Additive glow
        diffuse += emissive;

        // Slight bloom-friendly overbright at petal center
        float petalCenter = smoothstep(0.75, 0.88, vHeightFrac) * (1.0 - smoothstep(0.88, 1.0, vHeightFrac));
        diffuse += vPetalColor * petalCenter * glowMask * 0.5;

        // Stem darkening
        float baseDarken = mix(0.5, 1.0, smoothstep(0.0, 0.2, vHeightFrac));
        diffuse *= mix(baseDarken, 1.0, petalBlend); // don't darken glowing petals

        gl_FragColor = vec4(diffuse, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Poisson disk sampling
// ---------------------------------------------------------------------------

function poissonDiskSample(bounds, radius, maxPoints, rng) {
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
  points.push({ x: sx, z: sz });
  const gi = gridIndex(sx, sz);
  if (gi >= 0) grid[gi] = 0;
  active.push(0);

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

      const idx = points.length;
      points.push({ x: nx, z: nz });
      const gii = gridIndex(nx, nz);
      if (gii >= 0) grid[gii] = idx;
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
// FlowerFieldSystem class
// ---------------------------------------------------------------------------

export class FlowerFieldSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {number} [options.maxInstances=15000]
   * @param {number} [options.seed=13]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxInstances = options.maxInstances || MAX_INSTANCES;
    this.seed = options.seed || 13;

    this._time = 0;
    this._disposed = false;
    this._patches = [];

    // ── Wildflower system ──
    this._wildflowerGeo = createFlowerGeometry();
    this._wildflowerMat = createWildflowerMaterial();
    this._wildflowerMesh = this._createInstancedMesh(
      this._wildflowerGeo,
      this._wildflowerMat,
      this.maxInstances,
      'wildflower'
    );
    this._wildflowerInstances = [];

    // ── Crop system ──
    this._cropGeo = createWheatGeometry();
    this._cropMat = createCropMaterial();
    this._cropMesh = this._createInstancedMesh(
      this._cropGeo,
      this._cropMat,
      this.maxInstances,
      'crop'
    );
    this._cropInstances = [];

    // ── Shrine system ──
    this._shrineGeo = createFlowerGeometry();
    this._shrineMat = createShrineMaterial();
    this._shrineMesh = this._createInstancedMesh(
      this._shrineGeo,
      this._shrineMat,
      this.maxInstances,
      'shrine'
    );
    this._shrineInstances = [];
  }

  // ── Public API ──

  /**
   * Create a circular flower patch.
   * @param {{ x: number, y: number, z: number } | THREE.Vector3} center
   * @param {number} radius
   * @param {string} type - 'wildflower' | 'crop' | 'shrine'
   * @param {object} options
   * @param {number} [options.density=200] - Flowers per unit area
   * @param {number} [options.heightMin=0.025]
   * @param {number} [options.heightMax=0.055]
   * @param {function} [options.getHeight] - (x, z) => y
   */
  createPatch(center, radius, type, options = {}) {
    const density = options.density || 200;
    const heightMin = options.heightMin || 0.025;
    const heightMax = options.heightMax || 0.055;
    const getHeight = options.getHeight || (() => center.y || 0);

    const area = Math.PI * radius * radius;
    const count = Math.min(Math.floor(area * density), this.maxInstances);
    const minSpacing = Math.sqrt(area / (count * Math.PI * 0.65));

    const rng = makeRng(this.seed + this._patches.length * 31);

    const bounds = {
      minX: center.x - radius,
      maxX: center.x + radius,
      minZ: center.z - radius,
      maxZ: center.z + radius,
    };

    const allPoints = poissonDiskSample(bounds, Math.max(minSpacing, 0.003), count, rng);

    // Filter to circular area
    const radiusSq = radius * radius;
    const points = allPoints.filter(p => {
      const dx = p.x - center.x;
      const dz = p.z - center.z;
      return dx * dx + dz * dz <= radiusSq;
    });

    const instances = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const y = getHeight(p.x, p.z);
      const height = heightMin + rng() * (heightMax - heightMin);
      const rotation = rng() * Math.PI * 2;
      const phase = rng() * Math.PI * 2;

      let stemColor, petalColor;

      if (type === 'wildflower') {
        stemColor = new THREE.Color(
          0.15 + rng() * 0.08,
          0.35 + rng() * 0.15,
          0.10 + rng() * 0.05
        );
        petalColor = WILDFLOWER_COLORS[Math.floor(rng() * WILDFLOWER_COLORS.length)].clone();
        // Slight variation
        petalColor.r = Math.max(0, Math.min(1, petalColor.r + (rng() - 0.5) * 0.1));
        petalColor.g = Math.max(0, Math.min(1, petalColor.g + (rng() - 0.5) * 0.1));
        petalColor.b = Math.max(0, Math.min(1, petalColor.b + (rng() - 0.5) * 0.1));
      } else if (type === 'shrine') {
        stemColor = new THREE.Color(
          0.1 + rng() * 0.05,
          0.25 + rng() * 0.1,
          0.15 + rng() * 0.05
        );
        petalColor = SHRINE_COLORS[Math.floor(rng() * SHRINE_COLORS.length)].clone();
        petalColor.r = Math.max(0, Math.min(1, petalColor.r + (rng() - 0.5) * 0.08));
        petalColor.g = Math.max(0, Math.min(1, petalColor.g + (rng() - 0.5) * 0.08));
        petalColor.b = Math.max(0, Math.min(1, petalColor.b + (rng() - 0.5) * 0.08));
      } else {
        // Default: wildflower fallback
        stemColor = new THREE.Color(0.18, 0.4, 0.12);
        petalColor = WILDFLOWER_COLORS[0].clone();
      }

      instances.push({
        x: p.x, y: y, z: p.z,
        rotation, height, phase,
        stemColor, petalColor,
        row: 0,
      });
    }

    const patch = { type, center: { ...center }, radius, instances };
    this._patches.push(patch);

    this._addInstances(type, instances);
    this._rebuildType(type);

    return patch;
  }

  /**
   * Create a crop field with aligned rows of wheat.
   * @param {{ x: number, y: number, z: number } | THREE.Vector3} corner - Bottom-left corner
   * @param {number} width - Field width along X
   * @param {number} height - Field height along Z
   * @param {number} rowSpacing - Distance between rows
   * @param {object} options
   * @param {number} [options.stalkSpacing=0.012] - Distance between stalks in a row
   * @param {number} [options.heightMin=0.04]
   * @param {number} [options.heightMax=0.07]
   * @param {number} [options.rowJitter=0.003] - Random offset from perfect row
   * @param {function} [options.getHeight] - (x, z) => y
   */
  createCropField(corner, width, height, rowSpacing, options = {}) {
    const stalkSpacing = options.stalkSpacing || 0.012;
    const heightMin = options.heightMin || 0.04;
    const heightMax = options.heightMax || 0.07;
    const rowJitter = options.rowJitter || 0.003;
    const getHeight = options.getHeight || (() => corner.y || 0);

    const rng = makeRng(this.seed + this._patches.length * 47);
    const instances = [];

    const numRows = Math.floor(height / rowSpacing);
    const stalksPerRow = Math.floor(width / stalkSpacing);

    for (let row = 0; row < numRows; row++) {
      const baseZ = corner.z + row * rowSpacing + rowSpacing * 0.5;

      for (let col = 0; col < stalksPerRow; col++) {
        if (instances.length >= this.maxInstances) break;

        const baseX = corner.x + col * stalkSpacing + stalkSpacing * 0.5;

        // Jitter for natural look
        const jx = (rng() - 0.5) * rowJitter * 2;
        const jz = (rng() - 0.5) * rowJitter * 2;
        const x = baseX + jx;
        const z = baseZ + jz;
        const y = getHeight(x, z);

        const stalkHeight = heightMin + rng() * (heightMax - heightMin);
        const rotation = (rng() - 0.5) * 0.3; // slight random lean, mostly upright
        const phase = rng() * Math.PI * 2;

        // Wheat stem: green-brown gradient
        const greenFrac = rng() * 0.3;
        const stemColor = new THREE.Color(
          0.30 + greenFrac * 0.1,
          0.40 + greenFrac * 0.15,
          0.12 + greenFrac * 0.05
        );

        // Wheat head: golden with variation
        const petalColor = CROP_COLOR.clone();
        petalColor.r = Math.max(0, Math.min(1, petalColor.r + (rng() - 0.5) * 0.08));
        petalColor.g = Math.max(0, Math.min(1, petalColor.g + (rng() - 0.5) * 0.08));
        petalColor.b = Math.max(0, Math.min(1, petalColor.b + (rng() - 0.5) * 0.04));

        instances.push({
          x, y, z,
          rotation, height: stalkHeight, phase,
          stemColor, petalColor,
          row: row,
        });
      }
      if (instances.length >= this.maxInstances) break;
    }

    const patch = {
      type: 'crop',
      center: {
        x: corner.x + width * 0.5,
        y: corner.y || 0,
        z: corner.z + height * 0.5,
      },
      radius: Math.max(width, height) * 0.7,
      instances,
    };
    this._patches.push(patch);

    this._addInstances('crop', instances);
    this._rebuildType('crop');

    return patch;
  }

  /**
   * Update all flower field animations.
   * @param {number} deltaTime
   * @param {THREE.Vector2 | { x: number, y: number }} windDirection
   * @param {number} windStrength
   */
  update(deltaTime, windDirection, windStrength) {
    if (this._disposed) return;

    this._time += deltaTime;

    const mats = [this._wildflowerMat, this._cropMat, this._shrineMat];
    for (const mat of mats) {
      mat.uniforms.time.value = this._time;
      mat.uniforms.windStrength.value = windStrength;
      if (windDirection) {
        mat.uniforms.windDirection.value.set(
          windDirection.x,
          windDirection.y || windDirection.z || 0
        );
      }
    }
  }

  /**
   * Release all GPU resources.
   */
  dispose() {
    this._disposed = true;

    const meshes = [this._wildflowerMesh, this._cropMesh, this._shrineMesh];
    const geos = [this._wildflowerGeo, this._cropGeo, this._shrineGeo];
    const mats = [this._wildflowerMat, this._cropMat, this._shrineMat];

    for (const mesh of meshes) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }
    for (const geo of geos) {
      if (geo) geo.dispose();
    }
    for (const mat of mats) {
      if (mat) mat.dispose();
    }

    this._wildflowerInstances = [];
    this._cropInstances = [];
    this._shrineInstances = [];
    this._patches = [];
  }

  // ── Internal ──

  /**
   * Create an InstancedMesh with all required per-instance attributes.
   */
  _createInstancedMesh(geo, mat, maxCount, type) {
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    // Per-instance attributes
    const offsetBuf = new Float32Array(maxCount * 3);
    const rotationBuf = new Float32Array(maxCount);
    const heightBuf = new Float32Array(maxCount);
    const stemColorBuf = new Float32Array(maxCount * 3);
    const petalColorBuf = new Float32Array(maxCount * 3);
    const phaseBuf = new Float32Array(maxCount);

    geo.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsetBuf, 3));
    geo.setAttribute('instanceRotation', new THREE.InstancedBufferAttribute(rotationBuf, 1));
    geo.setAttribute('instanceHeight', new THREE.InstancedBufferAttribute(heightBuf, 1));
    geo.setAttribute('instanceStemColor', new THREE.InstancedBufferAttribute(stemColorBuf, 3));
    geo.setAttribute('instancePetalColor', new THREE.InstancedBufferAttribute(petalColorBuf, 3));
    geo.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phaseBuf, 1));

    // Crop-specific: row index for coordinated wave
    if (type === 'crop') {
      const rowBuf = new Float32Array(maxCount);
      geo.setAttribute('instanceRow', new THREE.InstancedBufferAttribute(rowBuf, 1));
    }

    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Add instances to the appropriate type list.
   */
  _addInstances(type, instances) {
    switch (type) {
      case 'wildflower':
        this._wildflowerInstances.push(...instances);
        break;
      case 'crop':
        this._cropInstances.push(...instances);
        break;
      case 'shrine':
        this._shrineInstances.push(...instances);
        break;
    }
  }

  /**
   * Rebuild GPU buffers for a given flower type.
   */
  _rebuildType(type) {
    let instances, geo, mesh;

    switch (type) {
      case 'wildflower':
        instances = this._wildflowerInstances;
        geo = this._wildflowerGeo;
        mesh = this._wildflowerMesh;
        break;
      case 'crop':
        instances = this._cropInstances;
        geo = this._cropGeo;
        mesh = this._cropMesh;
        break;
      case 'shrine':
        instances = this._shrineInstances;
        geo = this._shrineGeo;
        mesh = this._shrineMesh;
        break;
      default:
        return;
    }

    const count = Math.min(instances.length, this.maxInstances);

    const offsetAttr = geo.getAttribute('instanceOffset');
    const rotationAttr = geo.getAttribute('instanceRotation');
    const heightAttr = geo.getAttribute('instanceHeight');
    const stemColorAttr = geo.getAttribute('instanceStemColor');
    const petalColorAttr = geo.getAttribute('instancePetalColor');
    const phaseAttr = geo.getAttribute('instancePhase');
    const rowAttr = type === 'crop' ? geo.getAttribute('instanceRow') : null;

    for (let i = 0; i < count; i++) {
      const inst = instances[i];

      offsetAttr.array[i * 3 + 0] = inst.x;
      offsetAttr.array[i * 3 + 1] = inst.y;
      offsetAttr.array[i * 3 + 2] = inst.z;

      rotationAttr.array[i] = inst.rotation;
      heightAttr.array[i] = inst.height;
      phaseAttr.array[i] = inst.phase;

      stemColorAttr.array[i * 3 + 0] = inst.stemColor.r;
      stemColorAttr.array[i * 3 + 1] = inst.stemColor.g;
      stemColorAttr.array[i * 3 + 2] = inst.stemColor.b;

      petalColorAttr.array[i * 3 + 0] = inst.petalColor.r;
      petalColorAttr.array[i * 3 + 1] = inst.petalColor.g;
      petalColorAttr.array[i * 3 + 2] = inst.petalColor.b;

      if (rowAttr) {
        rowAttr.array[i] = inst.row;
      }
    }

    offsetAttr.needsUpdate = true;
    rotationAttr.needsUpdate = true;
    heightAttr.needsUpdate = true;
    stemColorAttr.needsUpdate = true;
    petalColorAttr.needsUpdate = true;
    phaseAttr.needsUpdate = true;
    if (rowAttr) rowAttr.needsUpdate = true;

    mesh.count = count;
  }
}
