/**
 * BiomeShaderMaterial -- custom ShaderMaterial for terrain with moisture-driven
 * biome texturing, triplanar mapping, district overlay blending, weather
 * effects (wetness, snow), and procedural FBM detail noise.
 *
 * Biome Table:
 * | Moisture | Elevation Zone | Visual                                |
 * |----------|---------------|---------------------------------------|
 * | 0-64     | Low           | Cracked earth, sand, dead shrubs      |
 * | 0-64     | Mid           | Dry grass, tan soil, sparse cacti     |
 * | 0-64     | High          | Red rock, scree, wind-carved          |
 * | 65-170   | Low           | Grass + dirt path, wildflowers        |
 * | 65-170   | Mid           | Dense grass, moss, oak trees          |
 * | 65-170   | High          | Rocky meadow, pine trees, boulders    |
 * | 171-255  | Low           | Mud, reeds, puddles, fog              |
 * | 171-255  | Mid           | Lush moss, ferns, dense canopy        |
 * | 171-255  | High          | Wet stone, waterfalls, cloud forest   |
 */

import * as THREE from 'three';

// GLSL Vertex Shader

const BIOME_VERTEX = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vElevation;
varying float vMoisture;
varying vec2 vUv;

// Per-vertex elevation and moisture are passed via custom attributes
// if available; otherwise we reconstruct from vertex color and position.
attribute float aElevation;
attribute float aMoisture;

void main() {
  vUv = uv;
  vColor = color;

  // Elevation and moisture from custom attributes
  vElevation = aElevation;
  vMoisture = aMoisture;

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  vNormal = normalize(normalMatrix * normal);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// GLSL Fragment Shader

const BIOME_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uMoisture;         // Average moisture for the tile (0-255 mapped to 0-1)
uniform float uSnowAmount;       // 0-1 from weather system
uniform float uWetness;          // 0-1 from rain
uniform float uDistrictBlend;    // 0-1 blending with district ground
uniform vec3 uDistrictColor;     // District ground tint
uniform float uTimeOfDay;        // 0-24 hour
uniform float uDetailScale;      // Detail noise scale (default 20.0)
uniform float uTriplanarSharpness; // Triplanar blend exponent (default 4.0)

// Terrain texture splatting (enabled via uUseTextures)
uniform bool uUseTextures;
uniform sampler2D uTexGrass;       // grass-lush color map
uniform sampler2D uTexDirt;        // ground-dirt color map
uniform sampler2D uTexRock;        // rock-cliff color map
uniform sampler2D uTexSand;        // ground-sand color map
uniform float uTerrainTexScale;    // world-space UV tiling (default 8.0)

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vElevation;
varying float vMoisture;
varying vec2 vUv;

// ───────────────────────────────────────────────────────────────
// Hash and noise functions
// ───────────────────────────────────────────────────────────────

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion: 3 octaves
float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 3; i++) {
    val += amp * valueNoise(p * freq);
    freq *= 2.17;
    amp *= 0.48;
  }
  return val;
}

// ───────────────────────────────────────────────────────────────
// Biome color computation
// ───────────────────────────────────────────────────────────────

// Elevation zones: 0.0 = water line, 1.0 = peak line
// Low: 0.0 - 0.33, Mid: 0.33 - 0.66, High: 0.66 - 1.0
// Moisture zones: Arid: 0.0 - 0.25, Temperate: 0.25 - 0.67, Wet: 0.67 - 1.0

vec3 computeBiomeColor(float elevation, float moisture) {
  // Normalize elevation: 0 = waterLine, 1 = peakLine
  // vElevation is already in raw 0-255 range; we use vertex color as primary
  // but compute biome tint overlay

  float e = clamp(elevation, 0.0, 1.0);
  float m = clamp(moisture, 0.0, 1.0);

  // ── Arid biome colors (moisture 0 - 0.25) ──
  // Low: cracked earth / sand
  vec3 aridLow = vec3(0.82, 0.73, 0.55);     // Sandy beige
  // Mid: dry grass / tan soil
  vec3 aridMid = vec3(0.72, 0.62, 0.40);     // Tan grass
  // High: red rock / scree
  vec3 aridHigh = vec3(0.65, 0.42, 0.30);    // Red rock

  // ── Temperate biome colors (moisture 0.25 - 0.67) ──
  // Low: grass + dirt path
  vec3 tempLow = vec3(0.42, 0.58, 0.24);     // Green grass
  // Mid: dense grass / moss
  vec3 tempMid = vec3(0.30, 0.52, 0.18);     // Dense forest green
  // High: rocky meadow
  vec3 tempHigh = vec3(0.48, 0.50, 0.38);    // Alpine meadow

  // ── Wet biome colors (moisture 0.67 - 1.0) ──
  // Low: mud / reeds
  vec3 wetLow = vec3(0.35, 0.42, 0.28);      // Muddy green
  // Mid: lush moss / ferns
  vec3 wetMid = vec3(0.18, 0.45, 0.20);      // Rich moss
  // High: wet stone
  vec3 wetHigh = vec3(0.38, 0.42, 0.40);     // Wet grey-green stone

  // Elevation interpolation within each moisture zone
  float lowMidT = smoothstep(0.25, 0.40, e);
  float midHighT = smoothstep(0.58, 0.75, e);

  vec3 aridColor = mix(mix(aridLow, aridMid, lowMidT), aridHigh, midHighT);
  vec3 tempColor = mix(mix(tempLow, tempMid, lowMidT), tempHigh, midHighT);
  vec3 wetColor = mix(mix(wetLow, wetMid, lowMidT), wetHigh, midHighT);

  // Moisture interpolation between zones
  float aridTempT = smoothstep(0.15, 0.35, m);
  float tempWetT = smoothstep(0.55, 0.75, m);

  vec3 biome = mix(mix(aridColor, tempColor, aridTempT), wetColor, tempWetT);

  // Beach band (very low elevation, near water)
  float beachT = 1.0 - smoothstep(0.0, 0.12, e);
  vec3 beachColor = vec3(0.82, 0.78, 0.63);
  biome = mix(biome, beachColor, beachT);

  return biome;
}

// ───────────────────────────────────────────────────────────────
// Time-of-day ambient tint
// ───────────────────────────────────────────────────────────────

vec3 timeOfDayTint(float hour) {
  // Dawn (5-8): warm golden
  // Day (8-17): neutral
  // Dusk (17-20): warm amber
  // Night (20-5): cool blue

  vec3 dawn = vec3(1.08, 0.95, 0.80);
  vec3 day = vec3(1.0, 1.0, 1.0);
  vec3 dusk = vec3(1.05, 0.88, 0.75);
  vec3 night = vec3(0.65, 0.70, 0.85);

  float h = mod(hour, 24.0);

  if (h < 5.0) return night;
  if (h < 8.0) return mix(night, dawn, (h - 5.0) / 3.0);
  if (h < 10.0) return mix(dawn, day, (h - 8.0) / 2.0);
  if (h < 16.0) return day;
  if (h < 18.0) return mix(day, dusk, (h - 16.0) / 2.0);
  if (h < 20.0) return mix(dusk, night, (h - 18.0) / 2.0);
  return night;
}

// ───────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────

void main() {
  vec3 normal = normalize(vNormal);

  // ── 1. Triplanar blend weights for cliff faces ──
  vec3 blendWeights = abs(normal);
  blendWeights = pow(blendWeights, vec3(uTriplanarSharpness));
  float bSum = blendWeights.x + blendWeights.y + blendWeights.z;
  blendWeights /= max(bSum, 0.001);

  // ── 2. Start with per-vertex color (primary coloring from terrain builder) ──
  vec3 baseColor = vColor;

  // ── 3. Compute biome overlay color ──
  // Normalize elevation: rough estimate from height (Y position)
  float elevNorm = clamp(vWorldPos.y / 1.5 + 0.3, 0.0, 1.0);
  float moistNorm = vMoisture / 255.0;
  vec3 biomeColor = computeBiomeColor(elevNorm, moistNorm);

  // Blend biome color into vertex color (subtle overlay)
  // Use triplanar Y weight: on flat ground, use vertex color;
  // on steep cliffs, use more biome color (cliff texture)
  float cliffFactor = 1.0 - blendWeights.y;
  vec3 cliffColor = mix(biomeColor * 0.7, vec3(0.5, 0.48, 0.42), 0.5); // Rocky cliff
  baseColor = mix(baseColor, cliffColor, cliffFactor * 0.6);

  // ── 3b. Terrain texture splatting (replaces flat colors when PBR textures loaded) ──
  if (uUseTextures) {
    vec2 terrainUV = vWorldPos.xz * uTerrainTexScale;

    vec3 grassSample = texture2D(uTexGrass, terrainUV).rgb;
    vec3 dirtSample  = texture2D(uTexDirt,  terrainUV).rgb;
    vec3 rockSample  = texture2D(uTexRock,  terrainUV).rgb;
    vec3 sandSample  = texture2D(uTexSand,  terrainUV).rgb;

    // Triplanar rock projection for cliff faces
    vec3 triRock = rockSample * blendWeights.y
                 + texture2D(uTexRock, vWorldPos.xy * uTerrainTexScale).rgb * blendWeights.z
                 + texture2D(uTexRock, vWorldPos.yz * uTerrainTexScale).rgb * blendWeights.x;

    // Splat weights derived from elevation + moisture
    float sandW  = (1.0 - smoothstep(0.0, 0.12, elevNorm))
                 + (1.0 - smoothstep(0.0, 0.25, moistNorm)) * 0.3;
    float grassW = smoothstep(0.15, 0.40, moistNorm)
                 * (1.0 - smoothstep(0.60, 0.80, elevNorm));
    float dirtW  = (1.0 - smoothstep(0.15, 0.35, moistNorm))
                 * (1.0 - smoothstep(0.30, 0.55, elevNorm));
    float rockW  = smoothstep(0.55, 0.80, elevNorm) + cliffFactor;

    float splatTotal = max(sandW + grassW + dirtW + rockW, 0.001);
    baseColor = (grassSample * grassW
               + dirtSample  * dirtW
               + sandSample  * sandW
               + triRock     * rockW) / splatTotal;
  }

  // ── 4. Detail noise for texture variation ──
  // Sample FBM at three different scales for triplanar
  float detailXY = fbm(vWorldPos.xz * uDetailScale);
  float detailXZ = fbm(vWorldPos.xy * uDetailScale);
  float detailYZ = fbm(vWorldPos.yz * uDetailScale);

  float detail = detailXY * blendWeights.y
               + detailXZ * blendWeights.z
               + detailYZ * blendWeights.x;

  // Subtle detail variation (reduced when PBR textures provide their own detail)
  float detailStrength = uUseTextures ? 0.04 : 0.1;
  baseColor += (detail - 0.5) * detailStrength;

  // ── 5. District blending ──
  baseColor = mix(baseColor, uDistrictColor, uDistrictBlend * 0.3);

  // ── 6. Wetness effect (rain) ──
  // Wet surfaces: darker, slightly more saturated
  float wetDarken = mix(1.0, 0.78, uWetness);
  baseColor *= wetDarken;
  // Slight specular sheen on wet surfaces (fake via brightness on upward faces)
  float wetSheen = uWetness * blendWeights.y * 0.08;
  baseColor += wetSheen;

  // ── 7. Snow accumulation ──
  // Snow settles on upward-facing surfaces; heavier at higher elevation
  float snowSurface = smoothstep(0.6, 0.9, normal.y);
  float snowElevBoost = smoothstep(0.5, 0.8, elevNorm) * 0.3;
  float snow = snowSurface * uSnowAmount + snowElevBoost * uSnowAmount;
  snow = clamp(snow, 0.0, 1.0);
  vec3 snowColor = vec3(0.95, 0.96, 0.98);
  baseColor = mix(baseColor, snowColor, snow);

  // ── 8. Time-of-day tint ──
  baseColor *= timeOfDayTint(uTimeOfDay);

  // ── 9. Simple hemisphere lighting ──
  // Top-down: full light. Sides: ambient only. Shadows come from scene lights.
  float hemiFactor = dot(normal, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
  float ambient = 0.45;
  float lighting = ambient + (1.0 - ambient) * hemiFactor;
  baseColor *= lighting;

  // Clamp to valid range
  baseColor = clamp(baseColor, 0.0, 1.0);

  gl_FragColor = vec4(baseColor, 1.0);
}
`;

// BiomeShaderMaterial class

export class BiomeShaderMaterial extends THREE.ShaderMaterial {
  /**
   * @param {object} [options]
   * @param {number} [options.moisture=128]            - Average moisture (0-255)
   * @param {number} [options.snowAmount=0]             - Snow (0-1)
   * @param {number} [options.wetness=0]                - Wetness (0-1)
   * @param {number} [options.districtBlend=0]          - District overlay blend (0-1)
   * @param {THREE.Color|number} [options.districtColor=0x888888] - District tint
   * @param {number} [options.timeOfDay=12]             - Hour (0-24)
   * @param {number} [options.detailScale=20]           - FBM detail scale
   * @param {number} [options.triplanarSharpness=4]     - Triplanar blend exponent
   */
  constructor(options = {}) {
    const districtColor = options.districtColor instanceof THREE.Color
      ? options.districtColor.clone()
      : new THREE.Color(options.districtColor !== undefined ? options.districtColor : 0x888888);

    super({
      vertexShader: BIOME_VERTEX,
      fragmentShader: BIOME_FRAGMENT,
      uniforms: {
        uMoisture:            { value: (options.moisture !== undefined ? options.moisture : 128) / 255 },
        uSnowAmount:          { value: options.snowAmount || 0 },
        uWetness:             { value: options.wetness || 0 },
        uDistrictBlend:       { value: options.districtBlend || 0 },
        uDistrictColor:       { value: districtColor },
        uTimeOfDay:           { value: options.timeOfDay !== undefined ? options.timeOfDay : 12 },
        uDetailScale:         { value: options.detailScale || 20.0 },
        uTriplanarSharpness:  { value: options.triplanarSharpness || 4.0 },
        uUseTextures:         { value: false },
        uTexGrass:            { value: null },
        uTexDirt:             { value: null },
        uTexRock:             { value: null },
        uTexSand:             { value: null },
        uTerrainTexScale:     { value: options.terrainTexScale || 8.0 },
      },
      vertexColors: true,
      side: THREE.FrontSide,
    });

    // Store references for convenience setters
    this._uniforms = this.uniforms;
  }

  // Public setters

  /**
   * Set the average moisture level.
   * @param {number} value - 0-255
   */
  setMoisture(value) {
    this._uniforms.uMoisture.value = Math.max(0, Math.min(1, value / 255));
  }

  /**
   * Set the snow accumulation amount.
   * @param {number} value - 0-1
   */
  setSnowAmount(value) {
    this._uniforms.uSnowAmount.value = Math.max(0, Math.min(1, value));
  }

  /**
   * Set the surface wetness.
   * @param {number} value - 0-1
   */
  setWetness(value) {
    this._uniforms.uWetness.value = Math.max(0, Math.min(1, value));
  }

  /**
   * Set district ground overlay. Provides per-vertex tinting and blend strength.
   *
   * For uniform district color:
   *   setDistrictOverlay(new THREE.Color(0xff0000), 0.5)
   *
   * For per-vertex district colors, the caller should set per-vertex attributes
   * on the geometry directly. This setter handles the uniform-level blending.
   *
   * @param {THREE.Color|number|Array} color - District ground color
   * @param {number} blend - Blend strength (0-1)
   */
  setDistrictOverlay(color, blend) {
    if (color instanceof THREE.Color) {
      this._uniforms.uDistrictColor.value.copy(color);
    } else if (typeof color === 'number') {
      this._uniforms.uDistrictColor.value.setHex(color);
    } else if (Array.isArray(color) && color.length >= 3) {
      this._uniforms.uDistrictColor.value.setRGB(
        color[0],
        color[1],
        color[2],
      );
    }
    if (blend !== undefined) {
      this._uniforms.uDistrictBlend.value = Math.max(0, Math.min(1, blend));
    }
  }

  /**
   * Set the time of day for ambient color tinting.
   * @param {number} hour - 0-24
   */
  setTimeOfDay(hour) {
    this._uniforms.uTimeOfDay.value = ((hour % 24) + 24) % 24;
  }

  /**
   * Set the FBM detail noise scale.
   * Higher values = finer detail.
   * @param {number} scale
   */
  setDetailScale(scale) {
    this._uniforms.uDetailScale.value = scale;
  }

  /**
   * Set the triplanar blending sharpness.
   * Higher values = sharper transitions between planar projections.
   * @param {number} sharpness
   */
  setTriplanarSharpness(sharpness) {
    this._uniforms.uTriplanarSharpness.value = sharpness;
  }

  /**
   * Set the footprint map texture (from FootprintSystem RTT).
   * @param {THREE.Texture} texture
   */
  setFootprintMap(texture) {
    if (!this._uniforms.uFootprintMap) {
      this._uniforms.uFootprintMap = { value: texture };
    } else {
      this._uniforms.uFootprintMap.value = texture;
    }
  }

  /**
   * Set terrain PBR textures for biome splatting.
   * Pass the color (diffuse) maps from TextureManager.loadPBRSet() results.
   * Automatically enables texture splatting in the shader.
   *
   * @param {object} textures
   * @param {THREE.Texture} textures.grass - grass-lush color map
   * @param {THREE.Texture} textures.dirt  - ground-dirt color map
   * @param {THREE.Texture} textures.rock  - rock-cliff color map
   * @param {THREE.Texture} textures.sand  - ground-sand color map
   */
  setTerrainTextures(textures) {
    if (textures.grass) this._uniforms.uTexGrass.value = textures.grass;
    if (textures.dirt)  this._uniforms.uTexDirt.value = textures.dirt;
    if (textures.rock)  this._uniforms.uTexRock.value = textures.rock;
    if (textures.sand)  this._uniforms.uTexSand.value = textures.sand;
    // Only enable splatting when all 4 terrain textures are provided
    this._uniforms.uUseTextures.value = !!(textures.grass && textures.dirt && textures.rock && textures.sand);
  }

  /**
   * Set the terrain texture UV tiling scale.
   * @param {number} scale - Higher = more repetitions (default 8.0)
   */
  setTerrainTexScale(scale) {
    this._uniforms.uTerrainTexScale.value = scale;
  }

  // Static factory: create material with per-vertex elevation/moisture data

  /**
   * Attach per-vertex elevation and moisture attributes to a geometry,
   * enabling full biome shading in the vertex/fragment shaders.
   *
   * @param {THREE.BufferGeometry} geometry - The terrain geometry
   * @param {Float32Array} elevations - Per-vertex elevation (0-255)
   * @param {Float32Array} moistures  - Per-vertex moisture (0-255)
   */
  static attachTerrainAttributes(geometry, elevations, moistures) {
    if (elevations) {
      geometry.setAttribute('aElevation', new THREE.BufferAttribute(elevations, 1));
    }
    if (moistures) {
      geometry.setAttribute('aMoisture', new THREE.BufferAttribute(moistures, 1));
    }
  }
}
