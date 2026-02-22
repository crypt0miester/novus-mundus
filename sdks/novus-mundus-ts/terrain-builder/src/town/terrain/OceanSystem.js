/**
 * OceanSystem — Animated Gerstner-wave ocean with simplified JONSWAP spectrum,
 * depth-based smooth coloring, shore foam, crest foam, rain foam, fresnel,
 * subsurface scattering, and specular highlights.
 *
 * Replaces the static MeshStandardMaterial sea from TownRenderer._createSea().
 * Designed for the fan-shaped ocean region at the map edge; inland water bodies
 * continue to use WaterSystem.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Perlin noise (shared with WaterSystem — identical algorithm)
// ─────────────────────────────────────────────────────────────────────────────

function _fade(t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
function _lerp(a, b, t) { return a + t * (b - a); }

function _generatePermutation() {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
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
      const nx = x / size;
      const ny = y / size;
      let val = 0.0;
      val += perlin2D(nx * 4, ny * 4) * 0.5;
      val += perlin2D(nx * 8, ny * 8) * 0.25;
      val += perlin2D(nx * 16, ny * 16) * 0.125;
      val += perlin2D(nx * 32, ny * 32) * 0.0625;
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
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simplified JONSWAP wave derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive 8 Gerstner wave components from wind speed/direction.
 *
 * Uses JONSWAP-inspired spectral shape but mapped to scene-scale coordinates
 * (the game tile is ~12 units across, so we need freq ~0.5–4.0 and amp ~0.01–0.08
 * to produce visible waves in the isometric view).
 *
 * @param {number} windSpeed  — 0 = calm, 1 = max storm (normalized)
 * @param {number} windAngle  — radians, direction wind blows toward
 * @returns {{ dir: [number, number], freq: number, amp: number, steepness: number, phase: number }[]}
 */
function deriveWavesFromWind(windSpeed, windAngle) {
  // Normalize wind to 0..1 range for scene-scale mapping
  const w = Math.max(0, Math.min(1, windSpeed));

  // Scene-scale parameters: amplitude and frequency ranges driven by wind
  // Calm (w=0): small gentle ripples. Storm (w=1): tall choppy waves.
  const ampBase  = 0.010 + w * 0.060;  // 0.01 .. 0.07
  const freqLow  = 0.6 + (1.0 - w) * 0.4;  // calmer → higher freq ripples (1.0..0.6)
  const freqHigh = 2.5 + w * 1.5;           // stormier → broader spectrum (2.5..4.0)

  const waves = [];
  const NUM = 16;

  // Deterministic phase offsets for variety
  const phaseSeeds = [0, 2.31, 4.62, 1.15, 3.46, 5.77, 0.58, 4.04];

  // Peak sits at ~1/3 of the frequency range (JONSWAP-like shape)
  const fpT = 0.3;
  const fp = freqLow + fpT * (freqHigh - freqLow);

  for (let i = 0; i < NUM; i++) {
    const t = i / (NUM - 1);
    const freq = freqLow + t * (freqHigh - freqLow);

    // Gaussian amplitude decay from peak frequency
    const sigma = (freqHigh - freqLow) * 0.35;
    const decay = Math.exp(-0.5 * ((freq - fp) / sigma) ** 2);
    const amp = ampBase * decay;

    // Directional spread: primary waves align with wind, high-freq scatter more
    const spreadAngle = (t * 0.8 - 0.4) * (0.3 + t * 0.7);
    const angle = windAngle + spreadAngle;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);

    // Steepness: higher frequency → steeper, clamped for stability
    const steepness = Math.min(0.8, 0.3 + t * 0.4);

    waves.push({
      dir: [dx, dz],
      freq,
      amp,
      steepness,
      phase: phaseSeeds[i],
    });
  }

  return waves;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLSL — Vertex Shader (8 Gerstner waves + shore attenuation)
// ─────────────────────────────────────────────────────────────────────────────

const OCEAN_VERTEX = /* glsl */ `
precision highp float;

uniform float uTime;

// 8 Gerstner waves: (dirX, dirZ, freq, amp)
uniform vec4  uWaveA[8];
uniform float uWaveS[8]; // steepness per wave
uniform float uWavePhase[8]; // random phase offset per wave

// Shore attenuation distance
uniform float uShoreAtten;

// Per-vertex attributes
attribute float aShoreDistance;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying vec2  vUv;
varying float vWaveHeight;
varying float vShoreDistance;
varying float vAngularFade;

// Pass angular fade from attribute
attribute float aAngularFade;

void main() {
  vec3 pos = position;
  vUv = uv;
  vShoreDistance = aShoreDistance;
  vAngularFade = aAngularFade;

  // Shore attenuation: flat at shore, full amplitude in open water
  float shoreT = smoothstep(0.0, uShoreAtten, aShoreDistance);
  // Angular fade at fan edges
  float waveScale = shoreT * aAngularFade;

  // Sum 8 Gerstner waves
  vec3 displacement = vec3(0.0);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 bitangent = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < 8; i++) {
    vec2 dir = normalize(uWaveA[i].xy);
    float freq = uWaveA[i].z;
    float amp = uWaveA[i].w * waveScale;
    float steep = uWaveS[i];

    float phase = dot(dir, pos.xz) * freq + uTime + uWavePhase[i];
    float s = sin(phase);
    float c = cos(phase);

    displacement.x += steep * amp * dir.x * c;
    displacement.y += amp * s;
    displacement.z += steep * amp * dir.y * c;

    // Analytical derivatives for normal
    tangent.x  -= steep * dir.x * dir.x * freq * amp * s;
    tangent.y  += dir.x * freq * amp * c;
    bitangent.z -= steep * dir.y * dir.y * freq * amp * s;
    bitangent.y += dir.y * freq * amp * c;
  }

  pos += displacement;
  vWaveHeight = displacement.y;

  vec3 normal = normalize(cross(bitangent, tangent));
  vNormal = normalize(normalMatrix * normal);

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// GLSL — Fragment Shader
// ─────────────────────────────────────────────────────────────────────────────

const OCEAN_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3  uSunDirection;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform vec3  uSkyColor;
uniform float uRainIntensity;

// Normal maps
uniform bool      uUseNormals;
uniform sampler2D uWaterNormal1;
uniform sampler2D uWaterNormal2;
uniform float     uNormalTexScale;

// Noise
uniform sampler2D uNoiseTex;

// Foam config
uniform float uFoamCrestThreshold;
uniform float uShoreFoamWidth;
uniform float uSalinity;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying vec2  vUv;
varying float vWaveHeight;
varying float vShoreDistance;
varying float vAngularFade;

// Depth-based ocean colors (smooth gradient, no toon bands)
const vec3 SHALLOW = vec3(0.20, 0.65, 0.65);  // turquoise
const vec3 MID     = vec3(0.08, 0.30, 0.55);  // blue
const vec3 DEEP    = vec3(0.03, 0.07, 0.20);  // navy

// Hash for sparkle/noise
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

void main() {
  // Discard fully outside fan (angular fade = 0)
  if (vAngularFade <= 0.001) discard;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(uSunDirection);

  // ─── 0. Dual-scroll normal map detail ───
  if (uUseNormals) {
    vec2 nUv1 = vWorldPos.xz * uNormalTexScale + vec2(uTime * 0.03, uTime * 0.02);
    vec2 nUv2 = vWorldPos.xz * uNormalTexScale * 0.8 + vec2(-uTime * 0.02, uTime * 0.04);
    vec3 n1 = texture2D(uWaterNormal1, nUv1).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uWaterNormal2, nUv2).rgb * 2.0 - 1.0;
    vec3 detailN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
    normal = normalize(vec3(
      normal.x + detailN.x * 0.25,
      normal.y,
      normal.z + detailN.y * 0.25
    ));
  }

  // ─── 1. Smooth depth-based coloring ───
  float depthT = smoothstep(0.0, 6.0, vShoreDistance);
  vec3 baseColor = mix(SHALLOW, MID, smoothstep(0.0, 0.4, depthT));
  baseColor = mix(baseColor, DEEP, smoothstep(0.4, 1.0, depthT));

  // ─── 2. Shore foam — driven by wave crests ───
  float foam = 0.0;
  float salinityFoamScale = 0.8 + uSalinity * 0.4;

  // Foam appears on wave crests near shore
  float shoreProximity = 1.0 - smoothstep(0.0, uShoreFoamWidth, vShoreDistance);
  float crestFoam = smoothstep(0.0, 0.03, vWaveHeight) * shoreProximity * salinityFoamScale;
  foam = max(foam, crestFoam);

  baseColor = mix(baseColor, vec3(0.95, 0.97, 1.0), foam * 0.85);

  // ─── 3. Subsurface scattering ───
  float sss = pow(max(0.0, dot(viewDir, lightDir)), 4.0) * 0.3;
  vec3 sssColor = vec3(0.05, 0.65, 0.45);
  baseColor = mix(baseColor, sssColor, sss * 0.35 * uSunIntensity);

  // ─── 4. Fresnel ───
  float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
  baseColor = mix(baseColor, uSkyColor, fresnel * 0.45);

  // ─── 5. Diffuse lighting ───
  float NdotL = max(0.0, dot(normal, lightDir));
  float diffuse = 0.35 + 0.65 * NdotL;
  baseColor *= diffuse * uSunColor;

  // ─── 6. Specular (Blinn-Phong) ───
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(0.0, dot(normal, halfDir)), 32.0);
  baseColor += uSunColor * spec * 0.3 * uSunIntensity;

  // ─── 7. Transparency ───
  // Slight transparency only at the very shore edge, fully opaque elsewhere
  float alpha = mix(0.75, 1.0, smoothstep(0.0, 1.0, vShoreDistance));
  // Fade at angular fan edges
  alpha *= smoothstep(0.0, 0.05, vAngularFade);

  gl_FragColor = vec4(baseColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// OceanSystem class
// ─────────────────────────────────────────────────────────────────────────────

export class OceanSystem {
  /**
   * @param {THREE.Group} parentGroup  — group to add ocean meshes to
   * @param {object} config            — sea config from layout (angle, spread, reach, depth, height, etc.)
   * @param {number} meshSize          — terrain mesh diameter
   * @param {object} [options]
   * @param {number} [options.salinity]       — 0..1, default 0.5
   * @param {number} [options.windSpeed]      — initial wind speed m/s, default 5
   * @param {number} [options.windAngle]      — initial wind direction radians, default 0
   * @param {number} [options.shoreAtten]     — shore wave attenuation distance, default 2.0
   * @param {number} [options.gridRes]        — grid subdivisions, default 64
   */
  constructor(parentGroup, config, meshSize, options = {}) {
    this._parentGroup = parentGroup;
    this._config = config;
    this._meshSize = meshSize;
    this._disposed = false;
    this._time = 0;

    const salinity = options.salinity ?? 0.5;
    const shoreAtten = options.shoreAtten ?? 2.0;
    const gridRes = options.gridRes ?? 64;

    // Parse sea config
    const half = meshSize * 0.5;
    const angleDeg = config.angle ?? 200;
    const spreadDeg = config.spread ?? 100;
    const reach = config.reach ?? 3.0;
    const seaHeight = config.height ?? -0.04;

    this._angleRad = angleDeg * Math.PI / 180;
    this._spreadRad = spreadDeg * Math.PI / 180;
    this._halfSpread = this._spreadRad / 2;
    this._seaHeight = seaHeight;
    this._half = half;
    this._reach = reach;

    // ── Derive initial waves from wind ──
    const windSpeed = options.windSpeed ?? 0.4; // 0..1 normalized
    const windAngle = options.windAngle ?? this._angleRad; // default: toward shore
    this._windSpeed = windSpeed;
    this._windAngle = windAngle;
    this._waves = deriveWavesFromWind(windSpeed, windAngle);
    this._targetWaves = null;
    this._waveTransitionTime = 0;
    this._waveTransitionDuration = 1.0;

    // ── Noise texture ──
    this._noiseTex = generateNoiseTexture(256);

    // ── Build uniforms ──
    const waveA = [];
    const waveS = [];
    const wavePhase = [];
    for (let i = 0; i < 8; i++) {
      const w = this._waves[i];
      waveA.push(new THREE.Vector4(w.dir[0], w.dir[1], w.freq, w.amp));
      waveS.push(w.steepness);
      wavePhase.push(w.phase);
    }

    this._uniforms = {
      uTime:               { value: 0.0 },
      uSunDirection:       { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      uSunColor:           { value: new THREE.Color(0xfff8e7) },
      uSunIntensity:       { value: 1.0 },
      uSkyColor:           { value: new THREE.Color(0x6ba3c7) },
      uRainIntensity:      { value: 0.0 },
      uWaveA:              { value: waveA },
      uWaveS:              { value: waveS },
      uWavePhase:          { value: wavePhase },
      uShoreAtten:         { value: shoreAtten },
      uNoiseTex:           { value: this._noiseTex },
      uUseNormals:         { value: false },
      uWaterNormal1:       { value: null },
      uWaterNormal2:       { value: null },
      uNormalTexScale:     { value: 0.5 },
      uFoamCrestThreshold: { value: 0.04 },
      uShoreFoamWidth:     { value: 2.5 },
      uSalinity:           { value: salinity },
    };

    // ── Build geometry ──
    this._buildGeometry(half, gridRes);

    // ── Create material ──
    this._material = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERTEX,
      fragmentShader: OCEAN_FRAGMENT,
      uniforms: this._uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // ── Create ocean mesh ──
    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.position.set(0, seaHeight, 0);
    this._mesh.name = 'water-ocean';
    this._mesh.renderOrder = 5;
    this._mesh.frustumCulled = false;
    parentGroup.add(this._mesh);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Geometry: fan-clipped subdivided grid
  // ─────────────────────────────────────────────────────────────────────────

  _buildGeometry(half, gridRes) {
    const outerR = half * 3.0; // extend well past terrain edge to fill the view
    const gridSize = outerR * 2;

    // Create plane geometry on XZ (rotate from XY default)
    const srcGeo = new THREE.PlaneGeometry(gridSize, gridSize, gridRes, gridRes);
    srcGeo.rotateX(-Math.PI / 2);

    const srcPos = srcGeo.attributes.position;
    const srcIdx = srcGeo.index;

    const angleRad = this._angleRad;
    const halfSpread = this._halfSpread;

    // Feather zone at angular edges for smooth fade
    const angularFeather = 5 * Math.PI / 180; // 5 degrees

    // ── Filter triangles to fan arc ──
    const keptIndices = [];
    for (let t = 0; t < srcIdx.count; t += 3) {
      const ia = srcIdx.getX(t);
      const ib = srcIdx.getX(t + 1);
      const ic = srcIdx.getX(t + 2);

      // Check if any vertex of the triangle is inside the extended fan arc
      let anyInside = false;
      for (const vi of [ia, ib, ic]) {
        const vx = srcPos.getX(vi);
        const vz = srcPos.getZ(vi);
        const dist = Math.sqrt(vx * vx + vz * vz);
        const vertAngle = Math.atan2(-vz, vx);

        let angleDiff = vertAngle - angleRad;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        if (Math.abs(angleDiff) <= halfSpread + angularFeather && dist <= outerR + 0.5) {
          anyInside = true;
          break;
        }
      }
      if (anyInside) {
        keptIndices.push(ia, ib, ic);
      }
    }

    // ── Compute per-vertex attributes ──
    const vertCount = srcPos.count;
    const shoreDistArr = new Float32Array(vertCount);
    const angularFadeArr = new Float32Array(vertCount);

    for (let i = 0; i < vertCount; i++) {
      const vx = srcPos.getX(i);
      const vz = srcPos.getZ(i);
      const dist = Math.sqrt(vx * vx + vz * vz);

      // Shore distance: 0 at terrain edge, increasing outward
      const edgeDist = dist - (half - this._reach);
      shoreDistArr[i] = Math.max(0, edgeDist);

      // Angular fade
      const vertAngle = Math.atan2(-vz, vx);
      let angleDiff = vertAngle - angleRad;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const absAngle = Math.abs(angleDiff);
      if (absAngle <= halfSpread) {
        angularFadeArr[i] = 1.0;
      } else if (absAngle <= halfSpread + angularFeather) {
        angularFadeArr[i] = 1.0 - (absAngle - halfSpread) / angularFeather;
      } else {
        angularFadeArr[i] = 0.0;
      }
    }

    // ── Build final geometry ──
    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', srcPos);
    this._geometry.setAttribute('uv', srcGeo.attributes.uv);
    this._geometry.setAttribute('aShoreDistance', new THREE.BufferAttribute(shoreDistArr, 1));
    this._geometry.setAttribute('aAngularFade', new THREE.BufferAttribute(angularFadeArr, 1));
    this._geometry.setIndex(keptIndices);
    this._geometry.computeVertexNormals();

    srcGeo.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Environment setters
  // ─────────────────────────────────────────────────────────────────────────

  setSunDirection(dir) {
    this._uniforms.uSunDirection.value.copy(dir).normalize();
  }

  setSunColor(color) {
    if (color instanceof THREE.Color) {
      this._uniforms.uSunColor.value.copy(color);
    } else {
      this._uniforms.uSunColor.value.set(color);
    }
  }

  setSunIntensity(v) {
    this._uniforms.uSunIntensity.value = v;
  }

  setSkyColor(color) {
    if (color instanceof THREE.Color) {
      this._uniforms.uSkyColor.value.copy(color);
    } else {
      this._uniforms.uSkyColor.value.set(color);
    }
  }

  setRainIntensity(v) {
    this._uniforms.uRainIntensity.value = Math.max(0, Math.min(1, v));
  }

  setNormalMaps(normal1, normal2) {
    if (normal1) this._uniforms.uWaterNormal1.value = normal1;
    if (normal2) this._uniforms.uWaterNormal2.value = normal2;
    this._uniforms.uUseNormals.value = !!(normal1 && normal2);
  }

  /**
   * Set wind parameters. Triggers a smooth wave transition.
   * @param {THREE.Vector2|{x:number,y:number}} direction — wind direction vector
   * @param {number} strength — 0..1 normalized strength
   */
  setWind(direction, strength) {
    const windSpeed = Math.max(0, Math.min(1, strength));
    const windAngle = Math.atan2(direction.y || direction.z || 0, direction.x || 0);

    // Only recompute if wind changed meaningfully
    if (Math.abs(windSpeed - this._windSpeed) < 0.05 &&
        Math.abs(windAngle - this._windAngle) < 0.1) return;

    // If mid-transition, snapshot current interpolated state as new source
    if (this._targetWaves && this._waveTransitionTime < this._waveTransitionDuration) {
      const t = Math.min(1, this._waveTransitionTime / this._waveTransitionDuration);
      const s = t * t * (3 - 2 * t);
      for (let i = 0; i < 8; i++) {
        const src = this._waves[i];
        const dst = this._targetWaves[i];
        src.dir[0] = src.dir[0] + (dst.dir[0] - src.dir[0]) * s;
        src.dir[1] = src.dir[1] + (dst.dir[1] - src.dir[1]) * s;
        src.freq = src.freq + (dst.freq - src.freq) * s;
        src.amp = src.amp + (dst.amp - src.amp) * s;
        src.steepness = src.steepness + (dst.steepness - src.steepness) * s;
      }
    }

    this._targetWaves = deriveWavesFromWind(windSpeed, windAngle);
    this._waveTransitionTime = 0;
    this._windSpeed = windSpeed;
    this._windAngle = windAngle;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-frame update
  // ─────────────────────────────────────────────────────────────────────────

  update(deltaTime) {
    if (this._disposed) return;
    this._time += deltaTime;
    this._uniforms.uTime.value = this._time;

    // ── Smooth wave transition ──
    if (this._targetWaves) {
      this._waveTransitionTime += deltaTime;
      const t = Math.min(1, this._waveTransitionTime / this._waveTransitionDuration);
      const smooth = t * t * (3 - 2 * t); // smoothstep

      for (let i = 0; i < 8; i++) {
        const src = this._waves[i];
        const dst = this._targetWaves[i];
        const uv4 = this._uniforms.uWaveA.value[i];

        uv4.x = src.dir[0] + (dst.dir[0] - src.dir[0]) * smooth;
        uv4.y = src.dir[1] + (dst.dir[1] - src.dir[1]) * smooth;
        uv4.z = src.freq + (dst.freq - src.freq) * smooth;
        uv4.w = src.amp + (dst.amp - src.amp) * smooth;
        this._uniforms.uWaveS.value[i] = src.steepness + (dst.steepness - src.steepness) * smooth;
      }

      if (t >= 1) {
        this._waves = this._targetWaves;
        this._targetWaves = null;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CPU wave sampling (for boat bobbing, etc.)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Sample the wave height at a given world XZ coordinate.
   * @param {number} x
   * @param {number} z
   * @returns {number} Y displacement + base sea height
   */
  getWaveHeight(x, z) {
    const time = this._time;
    let dy = 0;
    for (let i = 0; i < this._waves.length; i++) {
      const w = this._waves[i];
      const phase = (w.dir[0] * x + w.dir[1] * z) * w.freq + time + w.phase;
      dy += w.amp * Math.sin(phase);
    }
    return this._seaHeight + dy;
  }

  /**
   * Sample the analytical wave normal at a given world XZ coordinate.
   * @param {number} x
   * @param {number} z
   * @returns {THREE.Vector3}
   */
  getWaveNormal(x, z) {
    const time = this._time;
    const tangent = { x: 1, y: 0, z: 0 };
    const bitangent = { x: 0, y: 0, z: 1 };

    for (let i = 0; i < this._waves.length; i++) {
      const w = this._waves[i];
      const dx = w.dir[0];
      const dz = w.dir[1];
      const freq = w.freq;
      const amp = w.amp;
      const steep = w.steepness;
      const phase = (dx * x + dz * z) * freq + time + w.phase;
      const s = Math.sin(phase);
      const c = Math.cos(phase);

      tangent.x -= steep * dx * dx * freq * amp * s;
      tangent.y += dx * freq * amp * c;
      bitangent.z -= steep * dz * dz * freq * amp * s;
      bitangent.y += dz * freq * amp * c;
    }

    const nx = bitangent.y * tangent.z - bitangent.z * tangent.y;
    const ny = bitangent.z * tangent.x - bitangent.x * tangent.z;
    const nz = bitangent.x * tangent.y - bitangent.y * tangent.x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return new THREE.Vector3(nx / len, ny / len, nz / len);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  dispose() {
    this._disposed = true;

    if (this._mesh) {
      this._parentGroup.remove(this._mesh);
      if (this._mesh.geometry) this._mesh.geometry.dispose();
      this._mesh = null;
    }
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    if (this._noiseTex) {
      this._noiseTex.dispose();
      this._noiseTex = null;
    }
    if (this._geometry) {
      this._geometry.dispose();
      this._geometry = null;
    }
  }
}
