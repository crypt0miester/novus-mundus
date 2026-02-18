/**
 * WaterSystem — stylized toon-shaded water with Gerstner waves, depth-based
 * coloring, intersection foam, flow-map animation, subsurface scattering,
 * fresnel, and sparkle. Provides CPU-side wave sampling for boat bobbing.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Default Gerstner wave bank (6 waves)
// Each: { dir: [dx, dz], freq, amp, steepness }
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_WAVES = [
  { dir: [1.0, 0.0],   freq: 1.2,  amp: 0.040, steepness: 0.55 },
  { dir: [0.7, 0.7],   freq: 2.0,  amp: 0.025, steepness: 0.45 },
  { dir: [-0.5, 0.86], freq: 0.8,  amp: 0.050, steepness: 0.60 },
  { dir: [0.3, -0.95], freq: 3.2,  amp: 0.015, steepness: 0.70 },
  { dir: [-0.9, -0.4], freq: 1.6,  amp: 0.030, steepness: 0.50 },
  { dir: [0.6, -0.8],  freq: 3.8,  amp: 0.012, steepness: 0.35 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Noise texture generation (256x256 Perlin)
// ─────────────────────────────────────────────────────────────────────────────

function _fade(t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
function _lerp(a, b, t) { return a + t * (b - a); }

function _generatePermutation() {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  // Fisher-Yates with deterministic seed
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) / 32768.0; };
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
  }
  for (let i = 0; i < 256; i++) { p[i] = base[i]; p[i + 256] = base[i]; }
  return p;
}

const PERM = _generatePermutation();
const GRAD3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

function _grad(hash, x, y) {
  const g = GRAD3[hash % 12];
  return g[0] * x + g[1] * y;
}

function perlin2D(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = _fade(xf);
  const v = _fade(yf);
  const aa = PERM[PERM[X] + Y];
  const ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y];
  const bb = PERM[PERM[X + 1] + Y + 1];
  return _lerp(
    _lerp(_grad(aa, xf, yf), _grad(ba, xf - 1, yf), u),
    _lerp(_grad(ab, xf, yf - 1), _grad(bb, xf - 1, yf - 1), u),
    v
  );
}

function generateNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Multi-octave Perlin
      const nx = x / size;
      const ny = y / size;
      let val = 0.0;
      val += perlin2D(nx * 4, ny * 4) * 0.5;
      val += perlin2D(nx * 8, ny * 8) * 0.25;
      val += perlin2D(nx * 16, ny * 16) * 0.125;
      val += perlin2D(nx * 32, ny * 32) * 0.0625;
      // Normalize from [-1,1] to [0,255]
      const v = Math.min(255, Math.max(0, ((val + 1.0) * 0.5) * 255));
      const idx = (y * size + x) * 4;
      data[idx]     = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLSL — Vertex Shader
// ─────────────────────────────────────────────────────────────────────────────

const WATER_VERTEX = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uWindInfluence;
uniform float uRainIntensity;

// Gerstner wave params packed into vec4s: (dirX, dirZ, freq, amp) + steepness
uniform vec4  uWaveA[6]; // dir.x, dir.z, freq, amp
uniform float uWaveS[6]; // steepness

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vWaveHeight;
varying float vDepth;

vec3 gerstnerWave(vec3 pos, float time, vec2 dir, float amp, float freq, float steep) {
  float phase = dot(dir, pos.xz) * freq + time;
  float s = sin(phase);
  float c = cos(phase);
  return vec3(steep * amp * dir.x * c, amp * s, steep * amp * dir.y * c);
}

void main() {
  vec3 pos = position;
  vUv = uv;

  // Wind and rain modulate amplitude
  float ampScale = 1.0 + uWindInfluence * 0.5 + uRainIntensity * 0.2;

  // Sum Gerstner waves
  vec3 displacement = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 bitangent = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < 6; i++) {
    vec2 dir = normalize(uWaveA[i].xy);
    float freq = uWaveA[i].z;
    float amp = uWaveA[i].w * ampScale;
    float steep = uWaveS[i];

    float phase = dot(dir, pos.xz) * freq + uTime;
    float s = sin(phase);
    float c = cos(phase);

    displacement.x += steep * amp * dir.x * c;
    displacement.y += amp * s;
    displacement.z += steep * amp * dir.y * c;

    // Analytical derivatives for normal computation
    tangent.x -= steep * dir.x * dir.x * freq * amp * s;
    tangent.y += dir.x * freq * amp * c;

    bitangent.z -= steep * dir.y * dir.y * freq * amp * s;
    bitangent.y += dir.y * freq * amp * c;
  }

  pos += displacement;

  vec3 normal = normalize(cross(bitangent, tangent));
  vNormal = normalize(normalMatrix * normal);
  vWaveHeight = displacement.y;

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;

  vec4 mvPos = viewMatrix * worldPos;
  vDepth = -mvPos.z;

  gl_Position = projectionMatrix * mvPos;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// GLSL — Fragment Shader
// ─────────────────────────────────────────────────────────────────────────────

const WATER_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform vec3  uSkyColor;
uniform vec2  uFlowDirection;
uniform float uFoamThreshold;
uniform float uRainIntensity;

uniform sampler2D uNoiseTex;
uniform sampler2D uDepthTex;
uniform vec2 uResolution;

// Water normal maps (dual-scroll)
uniform bool uUseNormals;
uniform sampler2D uWaterNormal1;
uniform sampler2D uWaterNormal2;
uniform float uNormalTexScale;     // UV tiling (default 4.0)
uniform float uCameraNear;
uniform float uCameraFar;
uniform bool uHasDepthTex;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vWaveHeight;
varying float vDepth;

// Toon water color bands
const vec3 SHALLOW = vec3(0.267, 0.733, 0.733);  // #44BBBB
const vec3 MID     = vec3(0.133, 0.400, 0.667);  // #2266AA
const vec3 DEEP    = vec3(0.067, 0.133, 0.333);  // #112255

// Simple hash-based noise for sparkle
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(uSunDirection);

  // ─── 0. Dual-scroll normal map detail ───
  if (uUseNormals) {
    vec2 nUv1 = vWorldPos.xz * uNormalTexScale + vec2(uTime * 0.03, uTime * 0.02);
    vec2 nUv2 = vWorldPos.xz * uNormalTexScale * 0.8 + vec2(-uTime * 0.02, uTime * 0.04);

    vec3 n1 = texture2D(uWaterNormal1, nUv1).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uWaterNormal2, nUv2).rgb * 2.0 - 1.0;

    // Blend the two scrolling normals
    vec3 detailN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));

    // Perturb the geometric normal (water is mostly Y-up, so XZ maps to tangent space)
    normal = normalize(vec3(
      normal.x + detailN.x * 0.3,
      normal.y,
      normal.z + detailN.y * 0.3
    ));
  }

  // ─── 1. Depth-based color banding (toon water) ───
  float depthFactor = clamp(vDepth * 0.15, 0.0, 1.0);
  float band1 = smoothstep(0.15, 0.20, depthFactor);
  float band2 = smoothstep(0.45, 0.50, depthFactor);
  vec3 baseColor = mix(SHALLOW, MID, band1);
  baseColor = mix(baseColor, DEEP, band2);

  // Wave height also influences color (crests are lighter)
  float heightBias = clamp(vWaveHeight * 5.0 + 0.5, 0.0, 1.0);
  baseColor = mix(baseColor, SHALLOW, heightBias * 0.15);

  // ─── 2. Depth-buffer intersection foam ───
  float foam = 0.0;
  if (uHasDepthTex) {
    vec2 screenUV = gl_FragCoord.xy / uResolution;
    float sceneDepthRaw = texture2D(uDepthTex, screenUV).r;
    float sceneDepth = linearizeDepth(sceneDepthRaw);
    float waterDepth = vDepth;
    float depthDiff = sceneDepth - waterDepth;
    foam = 1.0 - smoothstep(0.0, uFoamThreshold, depthDiff);
  }

  // Rain adds small foam patches
  if (uRainIntensity > 0.0) {
    float rainFoam = noise(vWorldPos.xz * 30.0 + uTime * 5.0);
    rainFoam = step(1.0 - uRainIntensity * 0.15, rainFoam);
    foam = max(foam, rainFoam);
  }

  // ─── 3. Flow map animation ───
  vec2 flowDir = uFlowDirection;
  float phase0 = fract(uTime * 0.1);
  float phase1 = fract(uTime * 0.1 + 0.5);
  vec2 uv0 = vUv * 3.0 + flowDir * phase0;
  vec2 uv1 = vUv * 3.0 + flowDir * phase1;
  float blend = abs(2.0 * phase0 - 1.0);
  vec4 flowSample0 = texture2D(uNoiseTex, uv0);
  vec4 flowSample1 = texture2D(uNoiseTex, uv1);
  vec4 flowColor = mix(flowSample0, flowSample1, blend);

  // Flow adds subtle surface detail
  baseColor += (flowColor.r - 0.5) * 0.06;

  // ─── 4. Subsurface scattering fake ───
  float sss = pow(max(0.0, dot(viewDir, lightDir)), 4.0) * clamp(vWaveHeight * 8.0 + 0.3, 0.0, 1.0);
  vec3 sssColor = vec3(0.1, 0.8, 0.6);
  baseColor = mix(baseColor, sssColor, sss * 0.3 * uSunIntensity);

  // ─── 5. Fresnel + sparkle ───
  float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
  baseColor = mix(baseColor, uSkyColor, fresnel * 0.4);

  float sparkle = step(0.998, noise(vWorldPos.xz * 50.0 + uTime * 3.0)) * uSunIntensity;
  baseColor += vec3(sparkle);

  // Apply foam on top as white
  baseColor = mix(baseColor, vec3(1.0), foam * 0.85);

  // Basic diffuse lighting
  float NdotL = max(0.0, dot(normal, lightDir));
  float diffuse = 0.4 + 0.6 * NdotL;
  baseColor *= diffuse * uSunColor;

  // Specular highlight (Blinn-Phong)
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(0.0, dot(normal, halfDir)), 64.0);
  baseColor += uSunColor * spec * 0.4 * uSunIntensity;

  float alpha = 0.82 + fresnel * 0.15;

  gl_FragColor = vec4(baseColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// WaterSystem class
// ─────────────────────────────────────────────────────────────────────────────

export class WaterSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [options]
   * @param {THREE.Vector3} [options.sunDirection]
   * @param {THREE.Color|number} [options.sunColor]
   * @param {THREE.Color|number} [options.skyColor]
   * @param {THREE.Vector2} [options.flowDirection]
   * @param {number} [options.waveScale]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this._time = 0;
    this._meshes = [];
    this._disposed = false;

    // Normalize wave directions
    this._waves = DEFAULT_WAVES.map(w => {
      const len = Math.sqrt(w.dir[0] * w.dir[0] + w.dir[1] * w.dir[1]);
      return {
        dir: [w.dir[0] / len, w.dir[1] / len],
        freq: w.freq * (options.waveScale || 1.0),
        amp: w.amp,
        steepness: w.steepness,
      };
    });

    // Generate procedural noise texture
    this._noiseTex = generateNoiseTexture(256);

    // Build uniforms
    const sunDir = options.sunDirection || new THREE.Vector3(0.5, 0.8, 0.3);
    const sunColor = new THREE.Color(options.sunColor !== undefined ? options.sunColor : 0xfff8e7);
    const skyColor = new THREE.Color(options.skyColor !== undefined ? options.skyColor : 0x6ba3c7);
    const flowDir = options.flowDirection || new THREE.Vector2(0.3, 0.1);

    const waveA = [];
    const waveS = [];
    for (let i = 0; i < 6; i++) {
      const w = this._waves[i];
      waveA.push(new THREE.Vector4(w.dir[0], w.dir[1], w.freq, w.amp));
      waveS.push(w.steepness);
    }

    this._uniforms = {
      uTime:           { value: 0.0 },
      uSunDirection:   { value: sunDir.clone().normalize() },
      uSunColor:       { value: sunColor },
      uSunIntensity:   { value: 1.0 },
      uSkyColor:       { value: skyColor },
      uFlowDirection:  { value: flowDir },
      uFoamThreshold:  { value: 0.3 },
      uWindInfluence:  { value: 0.0 },
      uRainIntensity:  { value: 0.0 },
      uNoiseTex:       { value: this._noiseTex },
      uDepthTex:       { value: null },
      uHasDepthTex:    { value: false },
      uResolution:     { value: new THREE.Vector2(1024, 768) },
      uCameraNear:     { value: 0.1 },
      uCameraFar:      { value: 100.0 },
      uWaveA:          { value: waveA },
      uWaveS:          { value: waveS },
      uUseNormals:     { value: false },
      uWaterNormal1:   { value: null },
      uWaterNormal2:   { value: null },
      uNormalTexScale:  { value: 4.0 },
    };

    // Shared material
    this._material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: this._uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  // ───────────────────── Water body creation ─────────────────────

  /**
   * Create a river ribbon along a CatmullRomCurve3 path.
   * @param {THREE.Vector3[]} pathPoints - Control points for the spline
   * @param {number} width - River width
   * @param {object} [options]
   * @param {number} [options.segments] - Number of segments along the river
   * @param {number} [options.widthSegments] - Cross-sections across the width
   * @returns {THREE.Mesh}
   */
  createRiver(pathPoints, width = 0.15, options = {}) {
    const segments = options.segments || 48;
    const widthSegs = options.widthSegments || 4;
    const curve = new THREE.CatmullRomCurve3(pathPoints);

    const vertCount = (segments + 1) * (widthSegs + 1);
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = [];

    const halfW = width * 0.5;
    const tmpPos = new THREE.Vector3();
    const tmpTangent = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3();

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      curve.getPointAt(t, tmpPos);
      curve.getTangentAt(t, tmpTangent);
      tmpTangent.normalize();
      perp.crossVectors(up, tmpTangent).normalize();

      for (let j = 0; j <= widthSegs; j++) {
        const frac = j / widthSegs;
        const offset = (frac - 0.5) * width;
        const idx = i * (widthSegs + 1) + j;
        positions[idx * 3]     = tmpPos.x + perp.x * offset;
        positions[idx * 3 + 1] = tmpPos.y;
        positions[idx * 3 + 2] = tmpPos.z + perp.z * offset;
        uvs[idx * 2]     = t * (segments / 4); // repeat along length
        uvs[idx * 2 + 1] = frac;
      }
    }

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < widthSegs; j++) {
        const a = i * (widthSegs + 1) + j;
        const b = a + 1;
        const c = a + (widthSegs + 1);
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this._material);
    mesh.name = 'water-river';
    mesh.renderOrder = 5; // draw water after opaque objects
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this._meshes.push(mesh);
    return mesh;
  }

  /**
   * Create a circular harbor water plane.
   * @param {THREE.Vector3} center
   * @param {number} radius
   * @param {object} [options]
   * @param {number} [options.segments] - Radial + ring segments
   * @returns {THREE.Mesh}
   */
  createHarbor(center, radius, options = {}) {
    const segs = options.segments || 32;
    const geometry = new THREE.CircleGeometry(radius, segs, 0, Math.PI * 2);
    // CircleGeometry is in XY plane, rotate to XZ
    geometry.rotateX(-Math.PI / 2);

    // Subdivide for Gerstner displacement — rebuild as a grid-like disc
    // Use a plane and clip to circle in shader, or use a sufficiently tessellated circle.
    // For better wave displacement, use PlaneGeometry and discard fragments outside radius.
    const planeGeo = new THREE.PlaneGeometry(radius * 2, radius * 2, segs, segs);
    planeGeo.rotateX(-Math.PI / 2);

    // Mask vertices outside the circle (set y to negative to hide, but
    // better: just use the plane — the visual circle is close enough for a harbor)
    const mesh = new THREE.Mesh(planeGeo, this._material);
    mesh.position.copy(center);
    mesh.name = 'water-harbor';
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this._meshes.push(mesh);

    geometry.dispose(); // unused circle
    return mesh;
  }

  /**
   * Create a rectangular pool (e.g., fountain basin).
   * @param {THREE.Vector3} center
   * @param {THREE.Vector2|{x:number,y:number}} size - Width and depth of pool
   * @param {object} [options]
   * @param {number} [options.subdivisions]
   * @returns {THREE.Mesh}
   */
  createPool(center, size, options = {}) {
    const subdivs = options.subdivisions || 16;
    const sx = (size && size.x) || size || 0.3;
    const sz = (size && size.y) || size || 0.3;
    const geometry = new THREE.PlaneGeometry(sx, sz, subdivs, subdivs);
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, this._material);
    mesh.position.copy(center);
    mesh.name = 'water-pool';
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this._meshes.push(mesh);
    return mesh;
  }

  // ───────────────────── CPU wave sampling ─────────────────────

  /**
   * Sample the wave height at a given world XZ coordinate.
   * Replicates the exact Gerstner sum from the vertex shader.
   * @param {number} x
   * @param {number} z
   * @returns {number} Y displacement
   */
  getWaveHeight(x, z) {
    const time = this._time;
    const windScale = 1.0 + this._uniforms.uWindInfluence.value * 0.5
                          + this._uniforms.uRainIntensity.value * 0.2;
    let dy = 0;
    for (let i = 0; i < this._waves.length; i++) {
      const w = this._waves[i];
      const amp = w.amp * windScale;
      const phase = (w.dir[0] * x + w.dir[1] * z) * w.freq + time;
      dy += amp * Math.sin(phase);
    }
    return dy;
  }

  /**
   * Sample the analytical wave normal at a given world XZ coordinate.
   * Uses the same derivative math as the vertex shader.
   * @param {number} x
   * @param {number} z
   * @returns {THREE.Vector3}
   */
  getWaveNormal(x, z) {
    const time = this._time;
    const windScale = 1.0 + this._uniforms.uWindInfluence.value * 0.5
                          + this._uniforms.uRainIntensity.value * 0.2;

    // Tangent = partial derivative along x; bitangent = partial along z
    const tangent = { x: 1, y: 0, z: 0 };
    const bitangent = { x: 0, y: 0, z: 1 };

    for (let i = 0; i < this._waves.length; i++) {
      const w = this._waves[i];
      const amp = w.amp * windScale;
      const dx = w.dir[0];
      const dz = w.dir[1];
      const freq = w.freq;
      const steep = w.steepness;

      const phase = (dx * x + dz * z) * freq + time;
      const s = Math.sin(phase);
      const c = Math.cos(phase);

      tangent.x -= steep * dx * dx * freq * amp * s;
      tangent.y += dx * freq * amp * c;

      bitangent.z -= steep * dz * dz * freq * amp * s;
      bitangent.y += dz * freq * amp * c;
    }

    // Normal = cross(bitangent, tangent)
    const nx = bitangent.y * tangent.z - bitangent.z * tangent.y;
    const ny = bitangent.z * tangent.x - bitangent.x * tangent.z;
    const nz = bitangent.x * tangent.y - bitangent.y * tangent.x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return new THREE.Vector3(nx / len, ny / len, nz / len);
  }

  // ───────────────────── Environment setters ─────────────────────

  /**
   * @param {THREE.Vector3} dir
   */
  setSunDirection(dir) {
    this._uniforms.uSunDirection.value.copy(dir).normalize();
  }

  /**
   * @param {number} intensity
   */
  setSunIntensity(intensity) {
    this._uniforms.uSunIntensity.value = intensity;
  }

  /**
   * @param {THREE.Color|number} color
   */
  setSkyColor(color) {
    if (color instanceof THREE.Color) {
      this._uniforms.uSkyColor.value.copy(color);
    } else {
      this._uniforms.uSkyColor.value.set(color);
    }
  }

  /**
   * @param {THREE.Vector2} dir
   */
  setFlowDirection(dir) {
    this._uniforms.uFlowDirection.value.copy(dir);
  }

  /**
   * @param {number} strength - 0.0 (calm) to 1.0 (strong wind)
   */
  setWindInfluence(strength) {
    this._uniforms.uWindInfluence.value = Math.max(0, Math.min(1, strength));
  }

  /**
   * @param {number} intensity - 0.0 (no rain) to 1.0 (heavy rain)
   */
  setRainIntensity(intensity) {
    this._uniforms.uRainIntensity.value = Math.max(0, Math.min(1, intensity));
  }

  /**
   * Provide a depth texture from the scene render target for intersection foam.
   * @param {THREE.DepthTexture|THREE.Texture} depthTexture
   */
  setDepthTexture(depthTexture) {
    this._uniforms.uDepthTex.value = depthTexture;
    this._uniforms.uHasDepthTex.value = depthTexture != null;
  }

  /**
   * Set water normal map textures for dual-scroll surface detail.
   * Automatically enables normal mapping in the shader.
   *
   * @param {THREE.Texture} normal1 - First water normal map
   * @param {THREE.Texture} normal2 - Second water normal map (scrolls in different direction)
   */
  setWaterNormals(normal1, normal2) {
    if (normal1) this._uniforms.uWaterNormal1.value = normal1;
    if (normal2) this._uniforms.uWaterNormal2.value = normal2;
    this._uniforms.uUseNormals.value = !!(normal1 && normal2);
  }

  // ───────────────────── Per-frame update ─────────────────────

  /**
   * Call once per frame.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    if (this._disposed) return;
    this._time += deltaTime;
    this._uniforms.uTime.value = this._time;

    // Update resolution from renderer (if camera is available)
    const camera = this.scene.getObjectByProperty('isCamera', true);
    if (camera) {
      if (camera.isPerspectiveCamera || camera.isOrthographicCamera) {
        this._uniforms.uCameraNear.value = camera.near;
        this._uniforms.uCameraFar.value = camera.far;
      }
    }
  }

  // ───────────────────── Cleanup ─────────────────────

  dispose() {
    this._disposed = true;
    for (const mesh of this._meshes) {
      if (mesh.geometry) mesh.geometry.dispose();
      this.scene.remove(mesh);
    }
    this._meshes.length = 0;
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    if (this._noiseTex) {
      this._noiseTex.dispose();
      this._noiseTex = null;
    }
  }
}
